import { EnhancedGenerateContentResponse, FinishReason, GenerateContentRequest, GenerateContentResult, GenerativeModel, GoogleGenerativeAI, UsageMetadata } from '@google/generative-ai';
import { AIError } from '../../core/errors/ai.error';
import { ModelCache } from '../../core/utils/cache';
import { buildContinuationParts, buildGenerateRequest, buildUserPromptText, previewText, PROMPT_PREVIEW_LIMIT } from '../../core/prompt/prompt.builder';
import { generateWithRetry } from '../../core/utils/retry';
import { AIHelperInterface, GeminiConfig, Logger } from '../../core/types';
import { buildUsageDiagnostics } from '../../core/diagnostics/usage-diagnostics';

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

  async createPullRequestDescription(_diffOutput: string, prompt: string): Promise<string> {
    try {
      const { model: modelName, temperature, maxOutputTokens, systemText } = this.config;
      const supportsSystem = GeminiAIHelper.supportsSystemInstruction(modelName);
      const promptPreview = previewText(prompt, PROMPT_PREVIEW_LIMIT);

      this.logger.info(`[AI][Gemini]`);
      this.logger.startGroup(`Request`);
      this.logger.info(`[AI][Gemini] model=${modelName} temperature=${temperature} maxOutputTokens=${maxOutputTokens}`);
      this.logger.info(`[AI][Gemini] promptLength=${prompt.length}`);
      this.logger.info(`[AI][Gemini] promptPreview:\n${promptPreview}`);
      this.logger.endGroup();

      const userText = buildUserPromptText(systemText, prompt, supportsSystem);
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
      this.logger.info(`[AI][Gemini] usage=${JSON.stringify(usage)} descLength=${text.length}`);
      this.logger.info(`[AI][Gemini] description:\n${text}`);
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
          const retryPayload: GenerateContentRequest = buildGenerateRequest({ userText, temperature, maxOutputTokens: bumped });
          const res = await this.cache.getOrBuild(retryOutcome.modelUsed).generateContent(retryPayload);
          const retryResp: EnhancedGenerateContentResponse = res.response;
          const retryText = this.concatCandidatePartsText(retryResp);
          const frRetry: FinishReason | undefined = retryResp.candidates?.[0]?.finishReason;
          this.logger.info(`[AI][Gemini] Retry finishReason=${frRetry} length=${retryText.length}`);
          text = retryText;
        } else {
          this.logger.info('[AI][Gemini] continuation: MAX_TOKENS with non-empty output, requesting continuation...');
          const contPayload: GenerateContentRequest = {
            contents: buildContinuationParts(text, prompt),
            generationConfig: { temperature, maxOutputTokens },
          };
          const cont = await this.cache.getOrBuild(retryOutcome.modelUsed).generateContent(contPayload);
          const contResp: EnhancedGenerateContentResponse = cont.response;
          const more = this.concatCandidatePartsText(contResp);
          const fr2: FinishReason | undefined = contResp.candidates?.[0]?.finishReason;
          this.logger.info(`[AI][Gemini] Continuation finishReason=${fr2} moreLength=${more.length}`);
          this.logger.info(`[AI][Gemini] more:\n${more}`);
          text = (text + '\n\n' + more).trim();
        }
      }

      return text;
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
}

export default GeminiAIHelper;
