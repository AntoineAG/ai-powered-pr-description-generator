import { EnhancedGenerateContentResponse, FinishReason, GenerateContentRequest, GenerateContentResult, GenerativeModel, GoogleGenerativeAI, UsageMetadata } from '@google/generative-ai';
import { buildUsageDiagnostics } from '../../core/diagnostics/usage-diagnostics';
import { AIError } from '../../core/errors/ai.error';
import { buildContinuationParts, buildGenerateRequest, buildUnifiedPRPrompt, buildUserPromptText, previewText, PROMPT_PREVIEW_LIMIT } from '../../core/prompt/prompt.builder';
import { AIHelperInterface, GeminiConfig, GeneratePRParams, Logger, PullRequestContentResult } from '../../core/types';
import { ModelCache } from '../../core/utils/cache';
import { generateWithRetry } from '../../core/utils/retry';

class GeminiAIHelper implements AIHelperInterface {
  private readonly cache: ModelCache<GenerativeModel>;
  private readonly client: GoogleGenerativeAI;
  private readonly config: GeminiConfig;
  private readonly logger: Logger;

  constructor(params: { config: GeminiConfig; logger: Logger; client?: GoogleGenerativeAI }) {
    this.config = params.config;
    this.logger = params.logger;
    this.client = params.client ?? new GoogleGenerativeAI(this.config.apiKey);

    this.cache = new ModelCache<GenerativeModel>((name) => {
      const supportsSystem = GeminiAIHelper.supportsSystemInstruction(name);
      return this.client.getGenerativeModel({
        model: name,
        ...(supportsSystem ? { systemInstruction: this.config.systemText } : {}),
      });
    });
  }

  async generatePullRequestContent(diffOutput: string, params?: GeneratePRParams): Promise<PullRequestContentResult> {
    try {
      const { model: modelName, temperature, maxOutputTokens, systemText } = this.config;
      const supportsSystem = GeminiAIHelper.supportsSystemInstruction(modelName);
      const unifiedPrompt = buildUnifiedPRPrompt({ diff: diffOutput, currentTitle: params?.currentTitle, creator: params?.creator });
      const promptPreview = previewText(unifiedPrompt, PROMPT_PREVIEW_LIMIT);

      this.logger.info(`[AI][Gemini]`);
      this.logger.startGroup(`Request`);
      this.logger.info(`[AI][Gemini] model=${modelName} temperature=${temperature} maxOutputTokens=${maxOutputTokens}`);
      this.logger.info(`[AI][Gemini] promptLength=${unifiedPrompt.length}`);
      this.logger.info(`[AI][Gemini] promptPreview:\n${promptPreview}`);
      this.logger.endGroup();

      const userText = buildUserPromptText(systemText, unifiedPrompt, supportsSystem);
      const payload = buildGenerateRequest({ userText, temperature, maxOutputTokens });

      const retryOutcome = await generateWithRetry<GenerateContentResult>(
        async (activeModelName) => {
          const model = this.cache.getOrBuild(activeModelName);
          return model.generateContent(payload);
        },
        { logger: this.logger, provider: 'Gemini', initialModel: modelName, retry: this.config.retry }
      );

      const response: EnhancedGenerateContentResponse = retryOutcome.value.response;
      let text = this.concatCandidatePartsText(response);
      const usage: UsageMetadata | undefined = response.usageMetadata || (retryOutcome.value as any).usageMetadata || undefined;
      const finishReason: FinishReason | undefined = response.candidates?.[0]?.finishReason;

      this.logger.info(`[AI][Gemini]`);
      this.logger.startGroup(`Response`);
      this.logger.info(`[AI][Gemini] finishReason=${finishReason}`);
      this.logger.info(`[AI][Gemini] usage=${JSON.stringify(usage)} rawLength=${text.length}`);
      this.logger.info(`[AI][Gemini] raw:\n${text}`);
      this.logger.endGroup();

      const diag = buildUsageDiagnostics(usage, text);
      this.logger.info(`[AI][Gemini]`);
      this.logger.startGroup(`Usage Diagnostics`);
      this.logger.info(`[AI][Gemini] prompt=${diag.promptTokens} total=${diag.totalTokens} output=${Math.max(0, diag.totalTokens - diag.promptTokens)} candidates=${diag.candidateTokens}`);
      if (diag.inferenceNote) this.logger.info(`[AI][Gemini] notes=${diag.inferenceNote}`);
      this.logger.info(`[AI][Gemini] ⚠️ ${Math.round(diag.thoughtsRatio * 100)}% internal reasoning, ✅ ${Math.round(diag.visibleRatio * 100)}% visible output`);
      this.logger.endGroup();
      if (diag.totalTokens - diag.promptTokens === 0) {
        this.logger.warn('[AI][Gemini] No output tokens reported by API; consider increasing maxOutputTokens if finishReason=MAX_TOKENS.');
      } else if (diag.thoughtsRatio > 0.9) {
        this.logger.warn('[AI][Gemini] High thoughts/output token ratio (>90%). Consider increasing maxOutputTokens or tightening the prompt.');
      }

      if (finishReason === FinishReason.MAX_TOKENS) {
        if (!text || text.trim().length === 0) {
          const bumped = Math.ceil(maxOutputTokens * 1.5);
          this.logger.info(`[AI][Gemini] MAX_TOKENS with empty output; retry maxOutputTokens=${bumped}`);
          const retryOutcome2 = await generateWithRetry<GenerateContentResult>(
            async (activeModelName) => {
              const model = this.cache.getOrBuild(activeModelName);
              const rp: GenerateContentRequest = buildGenerateRequest({ userText, temperature, maxOutputTokens: bumped });
              return model.generateContent(rp);
            },
            { logger: this.logger, provider: 'Gemini', initialModel: retryOutcome.modelUsed, retry: this.config.retry }
          );
          const retryResp: EnhancedGenerateContentResponse = retryOutcome2.value.response;
          const retryText = this.concatCandidatePartsText(retryResp);
          const frRetry: FinishReason | undefined = retryResp.candidates?.[0]?.finishReason;
          this.logger.info(`[AI][Gemini] Retry finishReason=${frRetry} length=${retryText.length}`);
          text = retryText;
        } else {
          this.logger.info('[AI][Gemini] continuation: MAX_TOKENS with non-empty output, requesting continuation...');
          const retryOutcome3 = await generateWithRetry<GenerateContentResult>(
            async (activeModelName) => {
              const model = this.cache.getOrBuild(activeModelName);
              const contPayload: GenerateContentRequest = {
                contents: buildContinuationParts(text, unifiedPrompt),
                generationConfig: { temperature, maxOutputTokens },
              };
              return model.generateContent(contPayload);
            },
            { logger: this.logger, provider: 'Gemini', initialModel: retryOutcome.modelUsed, retry: this.config.retry }
          );
          const contResp: EnhancedGenerateContentResponse = retryOutcome3.value.response;
          const more = this.concatCandidatePartsText(contResp);
          const fr2: FinishReason | undefined = contResp.candidates?.[0]?.finishReason;
          this.logger.info(`[AI][Gemini] Continuation finishReason=${fr2} moreLength=${more.length}`);
          this.logger.info(`[AI][Gemini] more:\n${more}`);
          text = (text + '\n\n' + more).trim();
        }
      }
      const parsed = this.parseUnifiedContent(text);
      this.logger.info(`[AI][Gemini] content: titleLength=${parsed.title.length} descLength=${parsed.description.length}`);
      return parsed;
    } catch (error) {
      const status = (error as any)?.status as number | undefined;
      const msg = (error as any)?.message ? String((error as any).message) : String(error);
      this.logger.error(`[AI][Gemini] ❌ exception status=${status ?? 'n/a'} message=${msg}`);
      throw AIError.wrap(`Gemini API Error: ${msg}`, { provider: 'Gemini', statusCode: status });
    }
  }

  private static supportsSystemInstruction(name: string): boolean {
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

  private parseUnifiedContent(text: string): PullRequestContentResult {
    const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
    let obj: any = tryParse(text);
    if (!obj) {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        obj = tryParse(text.slice(start, end + 1));
      }
    }
    if (!obj || typeof obj !== 'object') {
      throw new AIError('Gemini unified content parse error: non-JSON output', { provider: 'Gemini' });
    }
    const titleObj = obj.title || {};
    const subject: string = (titleObj.subject || '').toString();
    const type: string | undefined = titleObj.type ? String(titleObj.type) : undefined;
    const scope: string | undefined = titleObj.scope ? String(titleObj.scope) : undefined;
    const conventional: string | undefined = titleObj.conventional ? String(titleObj.conventional) : undefined;
    const description: string = (obj.description || '').toString();

    const title: string = (conventional || subject || '').toString().trim();
    return {
      title,
      description: description || '',
      meta: {
        type: type || undefined,
        scope: scope || undefined,
        subject: subject || undefined,
      },
    };
  }
}

export default GeminiAIHelper;
