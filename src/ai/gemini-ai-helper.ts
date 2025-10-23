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
      const modelName = this.model?.trim() || 'gemini-1.5-pro';
      const promptPreview = prompt.slice(0, 400).replace(/\n/g, '\\n');
      core.startGroup('[AI][Gemini] Request');
      core.info(`model=${modelName} temperature=${this.temperature}`);
      core.debug(`promptLength=${prompt.length} preview=${promptPreview}`);
      core.endGroup();
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
      core.startGroup('[AI][Gemini] Response');
      core.info(`finishReason=${finishReason}`);
      core.debug(`usage=${JSON.stringify(usage)} descLength=${text.length} preview=${text.slice(0, 200).replace(/\n/g, '\\n')}`);
      core.endGroup();

      // If cut by MAX_TOKENS, request a continuation once
      if (finishReason === 'MAX_TOKENS') {
        core.info('[AI][Gemini] continuation: finishReason=MAX_TOKENS, requesting more...');
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
        core.startGroup('[AI][Gemini] Continuation Response');
        core.info(`finishReason=${fr2}`);
        core.debug(`moreLength=${more.length} morePreview=${more.slice(0, 200).replace(/\n/g, '\\n')}`);
        core.endGroup();
        text = (text + '\n\n' + more).trim();
      }

      return text;
    } catch (error) {
      core.error(`[AI][Gemini] exception message=${(error as Error).message}`);
      throw new Error(`Gemini API Error: ${(error as Error).message}`);
    }
  }
}

export default GeminiAIHelper;
