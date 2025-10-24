import * as core from '@actions/core';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIHelperInterface, AIHelperParams } from './types';

class GeminiAIHelper implements AIHelperInterface {
  private apiKey: string;
  private temperature: number;
  private model?: string;

    constructor(aiHelperParams: AIHelperParams) {
      Object.assign(this, aiHelperParams);
    }

  async createPullRequestDescription(diffOutput: string, prompt: string): Promise<string> {
    try {
      const modelName = this.model?.trim() || 'gemini-2.5-flash';
      const maxTokensEnv = Number.parseInt(process.env.MAX_OUTPUT_TOKENS || '', 10);
      // Enforce a sensible lower bound per requirements (768–1024). Use 1024 default if not provided.
      const initialMaxOutputTokens = Number.isFinite(maxTokensEnv) && maxTokensEnv > 0 ? Math.max(768, maxTokensEnv) : 1024;
      const promptPreview = prompt.length > 2000 ? `${prompt.slice(0, 2000)}[...]` : prompt;
      core.startGroup('[AI][Gemini] Request');
      core.info(`model=${modelName} temperature=${this.temperature} maxOutputTokens=${initialMaxOutputTokens}`);
      core.info(`promptLength=${prompt.length}`);
      core.info(`promptPreview:\n${promptPreview}`);
      core.endGroup();

      const systemText = 'You are very good at reviewing code and can generate pull request descriptions.';
      const genAI = new GoogleGenerativeAI(this.apiKey);

      // Cache model instances so retries/continuations reuse the same instance
      const modelCache = new Map<string, ReturnType<GoogleGenerativeAI['getGenerativeModel']>>();
      const getModel = (name: string) => {
        let m = modelCache.get(name);
        if (!m) {
          m = genAI.getGenerativeModel({
            model: name,
            ...(name.toLocaleLowerCase().startsWith('gemini-2') ? { systemInstruction: systemText } : {}),
          });
          modelCache.set(name, m);
        }
        return m;
      };

      // Robust retry with exponential backoff + jitter and optional model fallbacks
      const generateWithRetry = async (payload: any, initialModel: string) => {
        const maxAttempts = 100;
        const baseDelayMs = 1000; // 1s, then 2s, 4s, ...
        const maxDelayMs = 30000; // cap at 30s
        const jitterMs = 250;     // random 0..250ms

        const ladder = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-flash'];
        const ordered = [initialModel, ...ladder.filter(m => m !== initialModel)];
        let currentModelIndex = 0;
        let currentModel = ordered[currentModelIndex];
        let consecutive503 = 0;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs) + Math.floor(Math.random() * jitterMs);
          core.startGroup(`[AI][Gemini] Attempt ${attempt} model=${currentModel}`);
          try {
            const localModel = getModel(currentModel);
            const res = await localModel.generateContent(payload);
            core.info(`[AI][Gemini] success on attempt=${attempt} model=${currentModel}`);
            core.endGroup();
            return { result: res, modelUsed: currentModel };
          } catch (err: any) {
            const status = typeof err?.status === 'number' ? err.status as number : undefined;
            const statusText = typeof err?.statusText === 'string' ? err.statusText as string : undefined;
            const msg = (err && err.message) ? err.message : String(err);
            const is429 = status === 429 || /\b429\b/.test(msg);
            const is503 = status === 503 || /\b503\b/.test(msg) || /overload|unavailable|temporarily/i.test(msg);

            if (is503) consecutive503++; else consecutive503 = 0;

            if (is429 || is503) {
              if (is503 && consecutive503 > 10 && currentModelIndex < ordered.length - 1) {
                const nextModel = ordered[++currentModelIndex];
                core.warning(`[AI][Gemini] persistent 503 after ${consecutive503} attempts; switching model ${currentModel} -> ${nextModel}`);
                currentModel = nextModel;
              }
              core.warning(`[AI][Gemini] retryable error status=${status ?? 'n/a'} text=${statusText ?? ''} message=${msg}`);
              core.warning(`[AI][Gemini] will retry attempt=${attempt + 1} in ${delay}ms (exponential backoff + jitter)`);
              core.endGroup();
              if (attempt >= maxAttempts) throw err;
              await new Promise(r => setTimeout(r, delay));
              continue;
            }

            core.warning(`[AI][Gemini] non-retryable error on attempt=${attempt}: ${msg}`);
            core.endGroup();
            throw err;
          }
        }
        throw new Error('Exhausted retry attempts for Gemini generateContent');
      };

      const payload = {
        contents: [
          { role: "user", parts: [{ text: !modelName.toLocaleLowerCase().startsWith('gemini-2') ? `${systemText}\n\n${prompt}` : prompt }] }
        ],
        generationConfig: {
          temperature: this.temperature,
          maxOutputTokens: initialMaxOutputTokens,
        },
      };

      const { result, modelUsed } = await generateWithRetry(payload, modelName);

      const response = result.response as any;
      // Concatenate text from all parts (not just response.text())
      const concatCandidatePartsText = (resp: any): string => {
        try {
          const parts = resp?.candidates?.[0]?.content?.parts || [];
          const buf: string[] = [];
          for (const p of parts) {
            if (typeof p?.text === 'string') buf.push(p.text);
          }
          return buf.join('').trim();
        } catch {
          try { return response.text()?.trim?.() || ''; } catch { return ''; }
        }
      };

      let text = concatCandidatePartsText(response);
      const usage = response.usageMetadata || (result as any).usageMetadata || undefined;
      const finishReason = response.candidates?.[0]?.finishReason || (result as any).candidates?.[0]?.finishReason;
      core.startGroup('[AI][Gemini] Response');
      core.info(`finishReason=${finishReason}`);
      core.info(`usage=${JSON.stringify(usage)} descLength=${text.length}`);
      core.info(`description:\n${text}`);
      core.endGroup();

      // Diagnostics: token usage breakdown and efficiency
      const safeNum = (n: any) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
      const promptTokenCount = safeNum(usage?.promptTokenCount);
      const candidatesTokenCount = safeNum(usage?.candidatesTokenCount);
      let totalTokenCount = safeNum(usage?.totalTokenCount);
      if (!totalTokenCount) totalTokenCount = promptTokenCount + candidatesTokenCount;

      const approxVisibleTokens = Math.max(1, Math.ceil((text || '').length / 4)); // rough heuristic
      const thoughtsTokenCount = Math.max(0, candidatesTokenCount - approxVisibleTokens);
      const outputDen = Math.max(1, candidatesTokenCount);
      const thoughtsRatioOutput = thoughtsTokenCount / outputDen; // ratio over output tokens
      const thoughtsRatioTotal = totalTokenCount > 0 ? (thoughtsTokenCount / totalTokenCount) : 0;
      const visibleRatioOutput = Math.max(0, 1 - thoughtsRatioOutput);

      core.startGroup('[AI][Gemini] Usage Diagnostics');
      core.info(`promptTokenCount=${promptTokenCount}`);
      core.info(`candidatesTokenCount=${candidatesTokenCount}`);
      core.info(`thoughtsTokenCount=${thoughtsTokenCount}`);
      core.info(`totalTokenCount=${totalTokenCount}`);
      const percent = (v: number) => `${Math.round(v * 100)}%`;
      const thoughtsPct = percent(thoughtsRatioOutput);
      const visiblePct = percent(visibleRatioOutput);
      core.warning(`⚠️ ${thoughtsPct} of output tokens spent on internal reasoning (thoughts)`);
      core.info(`✅ ${visiblePct} used for visible content`);
      if (thoughtsRatioTotal > 0.9) {
        core.warning('[AI][Gemini] High thoughts/total token ratio (>90%). Consider increasing maxOutputTokens.');
      } else if (thoughtsRatioOutput >= 0.2 && thoughtsRatioOutput <= 0.3) {
        core.info('[AI][Gemini] Balanced usage: ~20–30% thoughts vs output tokens.');
      }
      core.endGroup();

      // MAX_TOKENS handling
      if (finishReason === 'MAX_TOKENS') {
        if (!text || text.trim().length === 0) {
          // Empty content: retry once with increased maxOutputTokens
          const bumped = Math.ceil(initialMaxOutputTokens * 1.5);
          core.info(`[AI][Gemini] finishReason=MAX_TOKENS with empty output; retrying once with maxOutputTokens=${bumped}`);
          const retryPayload = {
            contents: [
              { role: 'user', parts: [{ text: !modelName.toLocaleLowerCase().startsWith('gemini-2') ? `${systemText}\n\n${prompt}` : prompt }] },
            ],
            generationConfig: { temperature: this.temperature, maxOutputTokens: bumped },
          };
          // Reuse the same model instance used previously
          const res = await getModel(modelUsed).generateContent(retryPayload as any);
          const retryResp: any = res.response;
          const retryText = concatCandidatePartsText(retryResp);
          const frRetry = retryResp.candidates?.[0]?.finishReason;
          core.startGroup('[AI][Gemini] Retry (Increased maxOutputTokens)');
          core.info(`finishReason=${frRetry}`);
          core.info(`descLength=${retryText.length}`);
          core.endGroup();
          text = retryText;
        } else {
          // Non-empty: request a continuation
          core.info('[AI][Gemini] continuation: finishReason=MAX_TOKENS with non-empty output, requesting continuation...');
          const contPayload = {
            contents: [
              { role: 'user', parts: [{ text: prompt }] },
              { role: 'model', parts: [{ text }] },
              { role: 'user', parts: [{ text: 'Continue from where you left off. Do not repeat earlier content. Keep the same structure and style.' }] },
            ],
            generationConfig: { temperature: this.temperature, maxOutputTokens: initialMaxOutputTokens },
          };
          const cont = await getModel(modelUsed).generateContent(contPayload as any);
          const contResp: any = cont.response;
          const more = concatCandidatePartsText(contResp);
          const fr2 = contResp.candidates?.[0]?.finishReason;
          core.startGroup('[AI][Gemini] Continuation Response');
          core.info(`finishReason=${fr2}`);
          core.info(`moreLength=${more.length}`);
          core.info(`more:\n${more}`);
          core.endGroup();
          text = (text + more).trim();
        }
      }

      return text;
    } catch (error) {
      core.error(`[AI][Gemini] exception message=${(error as Error).message}`);
      throw new Error(`Gemini API Error: ${(error as Error).message}`);
    }
  }
}

export default GeminiAIHelper;
