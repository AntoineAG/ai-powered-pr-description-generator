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
      console.log('[AI][OpenAI] request ->', { model: modelName, temperature: this.temperature, promptLength: prompt.length, promptPreview });
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
          console.error('[AI][OpenAI] http_error', { status: response.status, bodyPreview: raw.slice(0, 400) });
          throw new Error(`OpenAI API HTTP ${response.status}: ${raw.slice(0, 200)}`);
        }
        let data: any;
        try { data = JSON.parse(raw); } catch (e) {
          console.error('[AI][OpenAI] parse_error', { rawPreview: raw.slice(0, 400) });
          throw e;
        }
        if (data.error) {
          console.error('[AI][OpenAI] api_error', { error: data.error });
          throw new Error(`OpenAI API Error: ${data.error.message}`);
        }
        let description = (data.choices?.[0]?.message?.content || '').trim();
        const finishReason = data.choices?.[0]?.finish_reason || data.choices?.[0]?.finishReason;
        const usage = data.usage || {};
        console.log('[AI][OpenAI] response ->', { finishReason, usage, descriptionLength: description.length, descriptionPreview: description.slice(0, 200).replace(/\n/g, '\\n') });

        // If output was cut by token limit, try a single continuation
        if (finishReason === 'length') {
          console.log('[AI][OpenAI] continuation: finish_reason=length, requesting more...');
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
            console.log('[AI][OpenAI] continuation response ->', { finishReason: fr2, moreLength: more.length, morePreview: more.slice(0, 200).replace(/\n/g, '\\n') });
            description = (description + '\n\n' + more).trim();
          } else {
            console.warn('[AI][OpenAI] continuation failed', { status: contResp.status, bodyPreview: contRaw.slice(0, 200) });
          }
        }

        return description;
    } catch (error) {
      console.error('[AI][OpenAI] exception', { message: (error as Error).message });
      throw new Error(`OpenAI API Error: ${(error as Error).message}`);
    }
  }
}

export default OpenAIHelper;
