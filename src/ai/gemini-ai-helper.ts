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
      // const maxTokensEnv = Number.parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || '', 10);
      // const maxOutputTokens = Number.isFinite(maxTokensEnv) && maxTokensEnv > 0 ? maxTokensEnv : 2048;
      const maxOutputTokens = 20;
      const promptPreview = prompt.length > 2000 ? `${prompt.slice(0, 2000)}[...]` : prompt;
      core.startGroup('[AI][Gemini] Request');
      core.info(`model=${modelName} temperature=${this.temperature} maxOutputTokens=${maxOutputTokens}`);
      core.info(`promptLength=${prompt.length}`);
      core.info(`promptPreview:\n${promptPreview}`);
      core.endGroup();

      const systemText = 'You are very good at reviewing code and can generate pull request descriptions.';
      const genAI = new GoogleGenerativeAI(this.apiKey);
      const model = genAI.getGenerativeModel({
        model: modelName,
        ...(modelName.toLocaleLowerCase().startsWith('gemini-2') ? { systemInstruction: systemText } : {}),
      });
      const result = await model.generateContent({
        contents: [
          { role: "user", parts: [{ text: !modelName.toLocaleLowerCase().startsWith('gemini-2') ? `${systemText}\n\n${prompt}` : prompt }] }
        ],
        generationConfig: {
          temperature: this.temperature,
          maxOutputTokens,
        },
      });

      const response = result.response as any;
      let text = response.text();
      const usage = response.usageMetadata || (result as any).usageMetadata || undefined;
      const finishReason = response.candidates?.[0]?.finishReason || (result as any).candidates?.[0]?.finishReason;
      core.startGroup('[AI][Gemini] Response');
      core.info(`finishReason=${finishReason}`);
      core.info(`usage=${JSON.stringify(usage)} descLength=${text.length}`);
      core.info(`description:\n${text}`);
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
          generationConfig: { temperature: this.temperature, maxOutputTokens },
        });
        const contResp: any = cont.response;
        const more = contResp.text();
        const fr2 = contResp.candidates?.[0]?.finishReason;
        core.startGroup('[AI][Gemini] Continuation Response');
        core.info(`finishReason=${fr2}`);
        core.info(`moreLength=${more.length}`);
        core.info(`more:\n${more}`);
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
