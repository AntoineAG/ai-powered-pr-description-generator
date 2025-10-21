import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIHelperInterface, AIHelperParams } from './types';

class GeminiAIHelper implements AIHelperInterface {
  private apiKey: string;
  private temperature: number;
  private geminiModel?: string;

    constructor(aiHelperParams: AIHelperParams) {
      Object.assign(this, aiHelperParams);
    }

  async createPullRequestDescription(diffOutput: string, prompt: string): Promise<string> {
    try {
      console.log('call gemini Ai');
      const genAI = new GoogleGenerativeAI(this.apiKey);
      const modelName = this.geminiModel && this.geminiModel.trim().length > 0
        ? this.geminiModel
        : "gemini-1.5-pro";
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent({
        contents: [
          { role: "user", parts: [{ text: prompt }] },
          { role: 'assistant', parts: [{ text: 'You are very good at reviewing code and can generate pull request descriptions' }] }
        ],
        generationConfig: {
          temperature: this.temperature,
          maxOutputTokens: 1024,
        },
      });

      const response = result.response;
      return response.text();
    } catch (error) {
      throw new Error(`Gemini API Error: ${error.message}`);
    }
  }
}

export default GeminiAIHelper;
