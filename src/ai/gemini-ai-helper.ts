import { EnhancedGenerateContentResponse, FinishReason, GenerateContentRequest, GenerateContentResult, GoogleGenerativeAI, UsageMetadata } from '@google/generative-ai';
import { AIHelperInterface, GeminiConfig, Logger } from './types';

// Minimal model interface we depend on
interface LLMModel {
  generateContent: (request: GenerateContentRequest) => Promise<GenerateContentResult>;
}

class GeminiAIHelper implements AIHelperInterface {
  private readonly config: GeminiConfig;
  private readonly logger: Logger;

  private currentModelName: string | null = null;
  private currentModel: LLMModel | null = null;

  constructor(params: { config: GeminiConfig; logger: Logger }) {
    this.config = params.config;
    this.logger = params.logger;
  }

  async createPullRequestDescription(_diffOutput: string, prompt: string): Promise<string> {
    try {
      const { model: modelName, temperature, maxOutputTokens: initialMaxOutputTokens, systemText } = this.config;
      const promptPreview = prompt.length > 2000 ? `${prompt.slice(0, 2000)}[...]` : prompt;
      this.logger.info(`[AI][Gemini] Request model=${modelName} temperature=${temperature} maxOutputTokens=${initialMaxOutputTokens}`);
      this.logger.info(`[AI][Gemini] promptLength=${prompt.length}`);
      this.logger.info(`[AI][Gemini] promptPreview=\n${promptPreview}`);

      const payload: GenerateContentRequest = {
        contents: [
          { role: 'user', parts: [{ text: !this.supportsSystemInstruction(modelName) ? `${systemText}\n\n${prompt}` : prompt }] },
        ],
        generationConfig: {
          temperature,
          maxOutputTokens: initialMaxOutputTokens,
        },
      };

      const { result, modelUsed } = await this.generateWithRetry(payload, modelName);

      const response: EnhancedGenerateContentResponse = result.response;
      const textFromParts = this.concatCandidatePartsText(response);
      let text = textFromParts;
      const usage: UsageMetadata | undefined = response.usageMetadata || (result as any).usageMetadata || undefined;
      const finishReason: FinishReason | undefined = response.candidates?.[0]?.finishReason;
      this.logger.info(`[AI][Gemini] Response finishReason=${finishReason}`);
      this.logger.info(`[AI][Gemini] usage=${JSON.stringify(usage)} descLength=${text.length}`);
      this.logger.info(`[AI][Gemini] description=\n${text}`);

      this.logUsageDiagnostics(usage, text);

      if (finishReason === FinishReason.MAX_TOKENS) {
        if (!text || text.trim().length === 0) {
          const bumped = Math.ceil(initialMaxOutputTokens * 1.5);
          this.logger.info(`[AI][Gemini] MAX_TOKENS with empty output; retry maxOutputTokens=${bumped}`);
          const retryPayload: GenerateContentRequest = {
            contents: [
              { role: 'user', parts: [{ text: !this.supportsSystemInstruction(modelName) ? `${systemText}\n\n${prompt}` : prompt }] },
            ],
            generationConfig: { temperature, maxOutputTokens: bumped },
          };
          const res = await this.ensureModel(modelUsed).generateContent(retryPayload);
          const retryResp: EnhancedGenerateContentResponse = res.response;
          const retryText = this.concatCandidatePartsText(retryResp);
          const frRetry: FinishReason | undefined = retryResp.candidates?.[0]?.finishReason;
          this.logger.info(`[AI][Gemini] Retry finishReason=${frRetry} length=${retryText.length}`);
          text = retryText;
        } else {
          this.logger.info('[AI][Gemini] continuation: MAX_TOKENS with non-empty output, requesting continuation...');
          const contPayload: GenerateContentRequest = {
            contents: [
              { role: 'user', parts: [{ text: prompt }] },
              { role: 'model', parts: [{ text }] },
              { role: 'user', parts: [{ text: 'Continue from where you left off. Do not repeat earlier content. Keep the same structure and style.' }] },
            ],
            generationConfig: { temperature, maxOutputTokens: initialMaxOutputTokens },
          };
          const cont = await this.ensureModel(modelUsed).generateContent(contPayload);
          const contResp: EnhancedGenerateContentResponse = cont.response;
          const more = this.concatCandidatePartsText(contResp);
          const fr2: FinishReason | undefined = contResp.candidates?.[0]?.finishReason;
          this.logger.info(`[AI][Gemini] Continuation finishReason=${fr2} moreLength=${more.length}`);
          this.logger.info(`[AI][Gemini] more=\n${more}`);
          text = (text + '\n\n' + more).trim();
        }
      }

      return text;
    } catch (error) {
      this.logger.error(`[AI][Gemini] exception message=${(error as Error).message}`);
      throw new Error(`Gemini API Error: ${(error as Error).message}`);
    }
  }

  // Retry helper with fallback ladder
  private async generateWithRetry(payload: GenerateContentRequest, initialModel: string): Promise<{ result: GenerateContentResult; modelUsed: string }> {
    const maxAttempts = 100;
    const baseDelayMs = 1000;
    const maxDelayMs = 30000;
    const jitterMs = 250;

    const ladder = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-flash'];
    const ordered = [initialModel, ...ladder.filter(m => m !== initialModel)];
    let currentModelIndex = 0;
    let currentModel = ordered[currentModelIndex];
    let consecutive503 = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs) + Math.floor(Math.random() * jitterMs);
      this.logger.info(`[AI][Gemini] Attempt ${attempt} model=${currentModel}`);
      try {
        const localModel = this.ensureModel(currentModel);
        const res: GenerateContentResult = await localModel.generateContent(payload);
        this.logger.info(`[AI][Gemini] success attempt=${attempt} model=${currentModel}`);
        return { result: res, modelUsed: currentModel };
      } catch (err: unknown) {
        const e = err as { status?: number; statusText?: string; message?: string };
        const status = typeof e?.status === 'number' ? e.status : undefined;
        const statusText = typeof e?.statusText === 'string' ? e.statusText : undefined;
        const msg = e?.message ?? String(err);
        const is429 = status === 429 || /\b429\b/.test(msg);
        const is503 = status === 503 || /\b503\b/.test(msg) || /overload|unavailable|temporarily/i.test(msg);

        if (is503) consecutive503++; else consecutive503 = 0;

        if (is429 || is503) {
          if (is503 && consecutive503 > 10 && currentModelIndex < ordered.length - 1) {
            const nextModel = ordered[++currentModelIndex];
            this.logger.warn(`[AI][Gemini] persistent 503 after ${consecutive503} attempts; switching model ${currentModel} -> ${nextModel}`);
            currentModel = nextModel;
          }
          this.logger.warn(`[AI][Gemini] retryable error status=${status ?? 'n/a'} text=${statusText ?? ''} message=${msg}`);
          this.logger.warn(`[AI][Gemini] will retry attempt=${attempt + 1} in ${delay}ms (exponential backoff + jitter)`);
          if (attempt >= maxAttempts) throw err;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        this.logger.warn(`[AI][Gemini] non-retryable error attempt=${attempt}: ${msg}`);
        throw err;
      }
    }
    throw new Error('Exhausted retry attempts for Gemini generateContent');
  }

  // Build or reuse model instance
  private ensureModel(name: string): LLMModel {
    if (this.currentModelName === name && this.currentModel) return this.currentModel;
    this.currentModel = this.buildModel(name);
    this.currentModelName = name;
    return this.currentModel;
  }

  // Provider adapter – encapsulates Gemini SDK specifics
  private buildModel(name: string): LLMModel {
    const client = new GoogleGenerativeAI(this.config.apiKey);
    const params: Parameters<GoogleGenerativeAI['getGenerativeModel']>[0] = {
      model: name,
      ...(this.supportsSystemInstruction(name) ? { systemInstruction: this.config.systemText } : {}),
    };
    return client.getGenerativeModel(params);
  }

  private supportsSystemInstruction(name: string): boolean {
    return name.toLowerCase().startsWith('gemini-2');
  }

  private concatCandidatePartsText(resp: EnhancedGenerateContentResponse): string {
    const parts = resp?.candidates?.[0]?.content?.parts || [];
    const buf: string[] = [];
    for (const p of parts as Array<{ text?: string }>) {
      if (typeof p?.text === 'string') buf.push(p.text);
    }
    if (buf.length === 0) {
      try { return resp.text()?.trim?.() || ''; } catch { /* ignore */ }
    }
    return buf.join('').trim();
  }

  private logUsageDiagnostics(usage: UsageMetadata | undefined, text: string): void {
    // Safe numeric extraction
    const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
    const prompt = num(usage?.promptTokenCount);
    const candidates = num(usage?.candidatesTokenCount);
    const total = num(usage?.totalTokenCount);
    const thoughtsReported = num((usage as any)?.thoughtsTokenCount);

    // Output tokens are total minus prompt (tokens generated by the model)
    const outputTotal = Math.max(0, total - prompt);

    // Approximate visible tokens from response text (roughly 4 chars per token)
    const approxVisibleRaw = Math.max(0, Math.ceil((text || '').length / 4));
    const visibleApprox = Math.min(approxVisibleRaw, outputTotal);

    // Determine "thoughts" (internal reasoning) with sensible precedence
    // 1) Prefer explicit thoughts from API if present
    // 2) Else if candidates reported, estimate thoughts = candidates - visibleApprox
    // 3) Else infer from outputTotal (everything not visible is considered thoughts)
    let thoughts = 0;
    let inferenceNote: string | null = null;

    if (thoughtsReported > 0) {
      thoughts = Math.min(thoughtsReported, outputTotal);
    } else if (candidates > 0) {
      thoughts = Math.max(0, Math.min(candidates - visibleApprox, outputTotal));
      inferenceNote = 'estimated from candidates − visible';
    } else {
      thoughts = Math.max(0, outputTotal - visibleApprox);
      if (outputTotal > 0) {
        inferenceNote = 'inferred from (total − prompt) − visible';
      }
    }

    // Guard against division by zero
    const denom = Math.max(1, outputTotal);
    const thoughtsRatio = thoughts / denom;
    const visibleRatio = Math.max(0, 1 - thoughtsRatio);

    // Pretty percentages
    const pct = (v: number) => `${Math.round(v * 100)}%`;

    // Structured logs
    this.logger.info('[AI][Gemini] Usage Summary');
    this.logger.info(`prompt=${prompt}  total=${total}  output=${outputTotal}  candidates=${candidates}${thoughtsReported ? `  thoughtsReported=${thoughtsReported}` : ''}`);
    if (inferenceNote) {
      this.logger.info(`notes=${inferenceNote}`);
    }
    this.logger.info(`⚠️ ${pct(thoughtsRatio)} internal reasoning, ✅ ${pct(visibleRatio)} visible output (as share of output tokens)`);

    // Recommendations
    if (outputTotal === 0) {
      this.logger.warn('[AI][Gemini] No output tokens reported by API; consider increasing maxOutputTokens if finishReason=MAX_TOKENS.');
    } else if (thoughtsRatio > 0.9) {
      this.logger.warn('[AI][Gemini] High thoughts/output token ratio (>90%). Consider increasing maxOutputTokens or tightening the prompt.');
    } else if (thoughtsRatio >= 0.2 && thoughtsRatio <= 0.3) {
      this.logger.info('✅ Balanced usage');
    }
  }
}

export default GeminiAIHelper;
