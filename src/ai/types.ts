export interface AIHelperInterface {
    createPullRequestDescription: (diffOutput: string, prompt: string) => Promise<string>
}

export interface AIHelperParams {
    aiName: string,
    apiKey: string,
    temperature: number,
    model?: string,
}

// Minimal logger interface to keep helpers testable and provider-agnostic
export interface Logger {
    info: (msg: string) => void,
    warn: (msg: string) => void,
    error: (msg: string) => void,
    debug?: (msg: string) => void,
}

// Strong, constructor-only configuration for Gemini helper
export interface GeminiConfig {
    apiKey: string,
    model: string,
    temperature: number,
    maxOutputTokens: number,
    systemText: string,
}
