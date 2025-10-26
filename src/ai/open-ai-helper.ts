import { AIError } from './ai-error';
import { PROMPT_PREVIEW_LIMIT, previewText } from './prompt-utils';
import { generateWithRetry } from './retry-utils';
import { AIHelperInterface, Logger, OpenAIConfig } from './types';
import { buildUsageDiagnostics } from './usage-diagnostics';

class OpenAIHelper implements AIHelperInterface {
  private readonly config: OpenAIConfig;
  private readonly logger: Logger;

  constructor(params: { config: OpenAIConfig; logger: Logger }) {
    this.config = params.config;
    this.logger = params.logger;
  }

  async createPullRequestDescription(_diffOutput: string, prompt: string): Promise<string> {
    const { model, temperature, systemText } = this.config;
    const promptPreview = previewText(prompt, PROMPT_PREVIEW_LIMIT);
    try {
      this.logger.info(`[AI][OpenAI] ::group::Request`);
      this.logger.info(`[AI][OpenAI] model=${model} temperature=${temperature}`);
      this.logger.info(`[AI][OpenAI] promptLength=${prompt.length}`);
      this.logger.info(`[AI][OpenAI] promptPreview:\n${promptPreview}`);
      this.logger.info(`::endgroup::`);

      const perform = async (activeModel: string) => {
        const response = await fetch((this.config.baseUrl || 'https://api.openai.com') + '/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: activeModel,
            messages: [
              { role: 'system', content: systemText },
              { role: 'user', content: prompt },
            ],
            temperature,
            max_tokens: this.config.maxOutputTokens,
          }),
        });
        const raw = await response.text();
        if (!response.ok) {
          throw new AIError(`OpenAI API HTTP ${response.status}: ${raw}`, { provider: 'OpenAI', model: activeModel, statusCode: response.status });
        }
        let data: any;
        try { data = JSON.parse(raw); } catch (e) {
          throw new AIError('OpenAI API parse error', { provider: 'OpenAI', model: activeModel }, e);
        }
        if (data.error) {
          throw new AIError(`OpenAI API Error: ${data.error.message}`, { provider: 'OpenAI', model: activeModel, statusCode: data.error?.code });
        }
        return data;
      };

      const retryOutcome = await generateWithRetry<any>(perform, {
        logger: this.logger,
        provider: 'OpenAI',
        initialModel: model,
        retry: this.config.retry,
      });

      let description = (retryOutcome.value.choices?.[0]?.message?.content || '').trim();
      const finishReason = retryOutcome.value.choices?.[0]?.finish_reason || retryOutcome.value.choices?.[0]?.finishReason;
      const usage = retryOutcome.value.usage || {};

      this.logger.info(`[AI][OpenAI] ::group::Response`);
      this.logger.info(`[AI][OpenAI] finishReason=${finishReason}`);
      this.logger.info(`[AI][OpenAI] usage=${JSON.stringify(usage)} descLength=${description.length}`);
      this.logger.info(`[AI][OpenAI] description:\n${description}`);
      this.logger.info(`::endgroup::`);

      const diag = buildUsageDiagnostics(usage, description);
      this.logger.info(`[AI][OpenAI] ::group::Usage Diagnostics`);
      this.logger.info(`[AI][OpenAI] prompt=${diag.promptTokens} total=${diag.totalTokens} output=${Math.max(0, diag.totalTokens - diag.promptTokens)} candidates=${diag.candidateTokens}`);
      if (diag.inferenceNote) this.logger.info(`[AI][OpenAI] notes=${diag.inferenceNote}`);
      this.logger.info(`[AI][OpenAI] ⚠️ ${Math.round(diag.thoughtsRatio * 100)}% internal reasoning, ✅ ${Math.round(diag.visibleRatio * 100)}% visible output`);
      this.logger.info(`::endgroup::`);

      // If output was cut by token limit, try a single continuation
      if (finishReason === 'length') {
        this.logger.info('[AI][OpenAI] continuation: finish_reason=length, requesting more...');
        const contResp = await fetch((this.config.baseUrl || 'https://api.openai.com') + '/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemText },
              { role: 'user', content: prompt },
              { role: 'assistant', content: description },
              { role: 'user', content: 'Continue from where you left off. Do not repeat earlier content. Keep the same structure and style.' },
            ],
            temperature,
            max_tokens: Math.floor(this.config.maxOutputTokens / 2),
          }),
        });
        const contRaw = await contResp.text();
        if (contResp.ok) {
          let contData: any;
          try { contData = JSON.parse(contRaw); } catch { contData = {}; }
          const more = (contData.choices?.[0]?.message?.content || '').trim();
          const fr2 = contData.choices?.[0]?.finish_reason || contData.choices?.[0]?.finishReason;
          this.logger.info(`[AI][OpenAI] Continuation finishReason=${fr2} moreLength=${more.length}`);
          this.logger.info(`[AI][OpenAI] more:\n${more}`);
          description = (description + '\n\n' + more).trim();
        } else {
          this.logger.warn(`[AI][OpenAI] continuation failed status=${contResp.status} body=${contRaw}`);
        }
      }

      return description;
    } catch (error) {
      const status = (error as any)?.statusCode || (error as any)?.status;
      const msg = (error as any)?.message ? String((error as any).message) : String(error);
      this.logger.error(`[AI][OpenAI] ❌ exception status=${status ?? 'n/a'} message=${msg}`);
      throw AIError.wrap(`OpenAI API Error: ${msg}`, { provider: 'OpenAI', statusCode: status });
    }
  }
}

export default OpenAIHelper;
