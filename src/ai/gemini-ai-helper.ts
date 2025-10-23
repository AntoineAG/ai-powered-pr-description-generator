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
      const modelName = this.model?.trim() || 'gemini-1.5-pro';
      const promptPreview = prompt.slice(0, 400).replace(/\n/g, '\\n');
      console.log('[AI][Gemini] request ->', { model: modelName, temperature: this.temperature, promptLength: prompt.length, promptPreview });
      const genAI = new GoogleGenerativeAI(this.apiKey);
      const model = genAI.getGenerativeModel({
        model: modelName,
        // Provide instructions via systemInstruction instead of an invalid role
        systemInstruction: "You are very good at reviewing code and can generate pull request descriptions"
      });
      const result = await model.generateContent({
        contents: [
          // Gemini only allows roles: 'user' and 'model'. Keep a single user turn.
          { role: "user", parts: [{ text: prompt }] }
        ],
        generationConfig: {
          temperature: this.temperature,
          maxOutputTokens: 2048,
        },
      });

      const response = result.response as any;
      let text = response.text();
      const usage = response.usageMetadata || (result as any).usageMetadata || undefined;
      const finishReason = response.candidates?.[0]?.finishReason || (result as any).candidates?.[0]?.finishReason;
      console.log('[AI][Gemini] response ->', { finishReason, usage, descriptionLength: text.length, descriptionPreview: text.slice(0, 200).replace(/\n/g, '\\n') });

      // If cut by MAX_TOKENS, request a continuation once
      if (finishReason === 'MAX_TOKENS') {
        console.log('[AI][Gemini] continuation: finishReason=MAX_TOKENS, requesting more...');
        const cont = await model.generateContent({
          contents: [
            { role: 'user', parts: [{ text: prompt }] },
            { role: 'model', parts: [{ text }] },
            { role: 'user', parts: [{ text: 'Continue from where you left off. Do not repeat earlier content. Keep the same structure and style.' }] },
          ],
          generationConfig: { temperature: this.temperature, maxOutputTokens: 1024 },
        });
        const contResp: any = cont.response;
        const more = contResp.text();
        const fr2 = contResp.candidates?.[0]?.finishReason;
        console.log('[AI][Gemini] continuation response ->', { finishReason: fr2, moreLength: more.length, morePreview: more.slice(0, 200).replace(/\n/g, '\\n') });
        text = (text + '\n\n' + more).trim();
      }

      return text;
    } catch (error) {
      console.error('[AI][Gemini] exception', { message: (error as Error).message });
      throw new Error(`Gemini API Error: ${(error as Error).message}`);
    }
  }
}

export default GeminiAIHelper;
