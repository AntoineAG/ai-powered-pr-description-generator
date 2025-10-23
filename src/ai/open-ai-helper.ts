import * as core from '@actions/core';
import { AIHelperInterface, AIHelperParams } from './types';

class OpenAIHelper implements AIHelperInterface {
  private apiKey: string;
  private temperature: number;
  private model?: string;

  constructor(aiHelperParams: AIHelperParams) {
    Object.assign(this, aiHelperParams);
  }

  async createPullRequestDescription(diffOutput: string, prompt: string): Promise<string> {
    try {
      const modelName = this.model?.trim() || 'gpt-4.1';
      const promptPreview = prompt.slice(0, 400).replace(/\n/g, '\\n');
        core.startGroup('[AI][OpenAI] Request');
        core.info(`model=${modelName} temperature=${this.temperature}`);
        // Keep prompt truncated because it contains the diff
        core.debug(`promptLength=${prompt.length} truncatedPreview=${promptPreview}`);
        core.endGroup();
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              {
                role: 'system',
                content: 'You are a super assistant, very good at reviewing code, and can generate the best pull request descriptions.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: this.temperature,
            max_tokens: 2048,
          }),
        });
        const raw = await response.text();
          if (!response.ok) {
            core.error(`[AI][OpenAI] http_error status=${response.status} body=${raw}`);
            throw new Error(`OpenAI API HTTP ${response.status}: ${raw}`);
          }
        let data: any;
          try { data = JSON.parse(raw); } catch (e) {
            core.error(`[AI][OpenAI] parse_error body=${raw}`);
            throw e;
          }
          if (data.error) {
            core.error(`[AI][OpenAI] api_error code=${data.error.code || ''} message=${data.error.message || ''}`);
            throw new Error(`OpenAI API Error: ${data.error.message}`);
          }
        let description = (data.choices?.[0]?.message?.content || '').trim();
        const finishReason = data.choices?.[0]?.finish_reason || data.choices?.[0]?.finishReason;
        const usage = data.usage || {};
          core.startGroup('[AI][OpenAI] Response');
          core.info(`finishReason=${finishReason}`);
          core.debug(`usage=${JSON.stringify(usage)} descLength=${description.length}`);
          core.debug(`description=${description.replace(/\n/g, '\\n')}`);
          core.endGroup();

        // If output was cut by token limit, try a single continuation
        if (finishReason === 'length') {
          core.info('[AI][OpenAI] continuation: finish_reason=length, requesting more...');
          const contResp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: modelName,
              messages: [
                { role: 'system', content: 'You are a super assistant, very good at reviewing code, and can generate the best pull request descriptions.' },
                { role: 'user', content: prompt },
                { role: 'assistant', content: description },
                { role: 'user', content: 'Continue from where you left off. Do not repeat earlier content. Keep the same structure and style.' }
              ],
              temperature: this.temperature,
              max_tokens: 1024,
            }),
          });
          const contRaw = await contResp.text();
          if (contResp.ok) {
            let contData: any;
            try { contData = JSON.parse(contRaw); } catch { contData = {}; }
            const more = (contData.choices?.[0]?.message?.content || '').trim();
            const fr2 = contData.choices?.[0]?.finish_reason || contData.choices?.[0]?.finishReason;
            core.startGroup('[AI][OpenAI] Continuation Response');
            core.info(`finishReason=${fr2}`);
            core.debug(`moreLength=${more.length}`);
            core.debug(`more=${more.replace(/\n/g, '\\n')}`);
            core.endGroup();
            description = (description + '\n\n' + more).trim();
          } else {
            core.warning(`[AI][OpenAI] continuation failed status=${contResp.status} body=${contRaw}`);
          }
        }

        return description;
    } catch (error) {
      core.error(`[AI][OpenAI] exception message=${(error as Error).message}`);
      throw new Error(`OpenAI API Error: ${(error as Error).message}`);
    }
  }
}

export default OpenAIHelper;
