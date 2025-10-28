import { EnhancedGenerateContentResponse, FinishReason, GenerateContentRequest, GenerateContentResult, GenerativeModel, GoogleGenerativeAI, ObjectSchema, Part, SchemaType, UsageMetadata } from '@google/generative-ai';
import { buildUsageDiagnostics } from '../../core/diagnostics/usage-diagnostics';
import { AIError } from '../../core/errors/ai.error';
import { buildGenerateRequest, buildUnifiedPRPrompt, buildUserPromptText, previewText, PROMPT_PREVIEW_LIMIT } from '../../core/prompt/prompt.builder';
import { AIHelperInterface, GeminiConfig, GeneratePRParams, Logger, PullRequestContentResult } from '../../core/types';
import { ModelCache } from '../../core/utils/cache';
import { generateWithRetry } from '../../core/utils/retry';

interface TitleObj {
  subject?: string;
  type?: string | null;
  scope?: string | null;
  conventional?: string;
}

interface UnifiedObj {
  title?: TitleObj;
  description?: string;
}

interface TailResponse {
  description_tail: string;
}

const DESC_EXCERPT_CHARS = 500;
const TAIL_OVERLAP_CHARS = 200;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

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

  async generatePullRequestContent(diffOutput: string, params?: GeneratePRParams): Promise<PullRequestContentResult> {
    try {
      const { model: modelName, temperature, maxOutputTokens, systemText } = this.config;
      const supportsSystem = GeminiAIHelper.supportsSystemInstruction(modelName);
      const unifiedPrompt = buildUnifiedPRPrompt({ diff: diffOutput, currentTitle: params?.currentTitle, creator: params?.creator });
      const promptPreview = previewText(unifiedPrompt, PROMPT_PREVIEW_LIMIT);

      this.logger.info(`[AI][Gemini]`);
      this.logger.startGroup(`Request`);
      this.logger.info(`[AI][Gemini] model=${modelName} temperature=${temperature} maxOutputTokens=${maxOutputTokens}`);
      this.logger.info(`[AI][Gemini] promptLength=${unifiedPrompt.length}`);
      this.logger.info(`[AI][Gemini] promptPreview:\n${promptPreview}`);
      this.logger.endGroup();

      const userText = buildUserPromptText(systemText, unifiedPrompt, supportsSystem);
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
      const usage: UsageMetadata | undefined = response.usageMetadata;
      const finishReason: FinishReason | undefined = response.candidates?.[0]?.finishReason;

      this.logger.info(`[AI][Gemini]`);
      this.logger.startGroup(`Response`);
      this.logger.info(`[AI][Gemini] finishReason=${finishReason}`);
      this.logger.info(`[AI][Gemini] usage=${JSON.stringify(usage)} rawLength=${text.length}`);
      this.logger.info(`[AI][Gemini] raw:\n${text}`);
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

      // First, try to parse strict JSON result
      let parsed: PullRequestContentResult | null = null;
      try {
        parsed = this.parseUnifiedContent(text);
      } catch (_) {
        parsed = null;
      }

      // If we have an empty output from MAX_TOKENS, retry with a bump
      if (!parsed && finishReason === FinishReason.MAX_TOKENS && (!text || text.trim().length === 0)) {
        const bumped = Math.ceil(maxOutputTokens * 1.5);
        this.logger.info(`[AI][Gemini] MAX_TOKENS with empty output; retry maxOutputTokens=${bumped}`);
        const retryOutcome2 = await generateWithRetry<GenerateContentResult>(
          async (activeModelName) => {
            const model = this.cache.getOrBuild(activeModelName);
            const rp: GenerateContentRequest = buildGenerateRequest({ userText, temperature, maxOutputTokens: bumped });
            return model.generateContent(rp);
          },
          { logger: this.logger, provider: 'Gemini', initialModel: retryOutcome.modelUsed, retry: this.config.retry }
        );
        const retryResp: EnhancedGenerateContentResponse = retryOutcome2.value.response;
        text = this.concatCandidatePartsText(retryResp);
        try {
          parsed = this.parseUnifiedContent(text);
        } catch (_) {
          parsed = null;
        }
      }

      // If still unparsed (likely truncated JSON), attempt a JSON-mode tail continuation
      if (!parsed) {
        const cleaned = this.stripCodeFences(text);
        const titleObj = this.extractTitleObject(cleaned);
        const partialDesc = this.extractDescriptionPrefix(cleaned);
        if (!titleObj || !partialDesc) {
          throw new AIError('Gemini unified content parse error: non-JSON output', { provider: 'Gemini' });
        }

        const partialDescUnescaped = this.unescapeJsonStringFragment(partialDesc);
        const tailMax = Math.min(Math.ceil(maxOutputTokens * 1.5), 4096);
        this.logger.info('[AI][Gemini] continuation: truncated JSON detected; requesting JSON tail only...');
        const retryOutcome3 = await generateWithRetry<GenerateContentResult>(
          async (activeModelName) => {
            const model = this.cache.getOrBuild(activeModelName);
            const contPayload: GenerateContentRequest = this.buildTailContinuationRequest(partialDescUnescaped, temperature, tailMax);
            return model.generateContent(contPayload);
          },
          { logger: this.logger, provider: 'Gemini', initialModel: retryOutcome.modelUsed, retry: this.config.retry }
        );
        const contResp: EnhancedGenerateContentResponse = retryOutcome3.value.response;
        const contText: string = this.concatCandidatePartsText(contResp);
        this.logger.info(`[AI][Gemini] Tail raw:\n${contText}`);
        const tailObj = this.tryParseJson<TailResponse>(contText);
        if (!this.isTailResponse(tailObj)) {
          throw new AIError('Gemini unified content parse error: continuation did not return description_tail', { provider: 'Gemini' });
        }
        const finalDescription = this.appendTailWithOverlap(partialDescUnescaped, tailObj.description_tail);
        parsed = {
          title: (titleObj.conventional || titleObj.subject || '').toString().trim(),
          description: finalDescription,
          meta: {
            type: titleObj.type || undefined,
            scope: titleObj.scope || undefined,
            subject: titleObj.subject || undefined,
          },
        };
      }

      // Parsed successfully at this point
      this.logger.info(`[AI][Gemini] content: titleLength=${parsed.title.length} descLength=${parsed.description.length}`);
      return parsed;
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : undefined;
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[AI][Gemini] ❌ exception status=${status ?? 'n/a'} message=${msg}`);
      throw AIError.wrap(`Gemini API Error: ${msg}`, { provider: 'Gemini', statusCode: status });
    }
  }

  private static supportsSystemInstruction(name: string): boolean {
    return name.toLowerCase().startsWith('gemini-2');
  }

  private concatCandidatePartsText(resp: EnhancedGenerateContentResponse): string {
    const partsMaybe = resp?.candidates?.[0]?.content?.parts;
    const buf: string[] = [];
    if (Array.isArray(partsMaybe)) {
      for (const p of partsMaybe as Part[]) {
        if (isRecord(p) && 'text' in p && isString((p as { text?: unknown }).text)) {
          buf.push((p as { text: string }).text);
        }
      }
    }
    if (buf.length === 0) {
      try { return resp.text()?.trim?.() || ''; } catch { /* ignore */ }
    }
    return buf.join('').trim();
  }

  private stripCodeFences(text: string): string {
    if (!text) return '';
    return text
      .replace(/^```[a-zA-Z]*\s*$/gm, '')
      .replace(/```\s*$/gm, '')
      .trim();
  }

  private tryParseJson<T>(s: string): T | null {
    try { return JSON.parse(s) as T; } catch { /* ignore */ }
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const sliced = s.slice(start, end + 1);
      try { return JSON.parse(sliced) as T; } catch { /* ignore */ }
    }
    return null;
  }

  private extractTitleObject(text: string): TitleObj | null {
    const m = /"title"\s*:\s*\{([\s\S]*?)\}/m.exec(text);
    if (!m) return null;
    const objRaw = '{' + m[1] + '}';
    const rec = this.tryParseJson<Record<string, unknown>>(objRaw);
    if (!isRecord(rec)) return null;
    return {
      subject: isString(rec.subject) ? rec.subject : undefined,
      type: isString(rec.type) ? rec.type : rec.type === null ? null : undefined,
      scope: isString(rec.scope) ? rec.scope : rec.scope === null ? null : undefined,
      conventional: isString(rec.conventional) ? rec.conventional : undefined,
    };
  }

  private extractDescriptionPrefix(text: string): string | null {
    const re = /"description"\s*:\s*"/m;
    const m = re.exec(text);
    if (!m) return null;
    const start = (m.index || 0) + m[0].length;
    return text.slice(start);
  }

  private unescapeJsonStringFragment(s: string): string {
    if (!s) return '';
    // Do a best-effort unescape for common sequences, even if the string is truncated
    let out = s;
    out = out.replace(/\\\\/g, '\\'); // \\ -> \
    out = out.replace(/\\"/g, '"');    // \" -> "
    out = out.replace(/\\n/g, '\n');    // \n -> newline char
    out = out.replace(/\\r/g, '');       // drop \r
    out = out.replace(/\\t/g, '\t');    // \t -> tab
    return out;
  }

  private buildTailContinuationRequest(prefix: string, temperature: number, maxOutputTokens: number): GenerateContentRequest {
    const excerpt = prefix.length > DESC_EXCERPT_CHARS ? prefix.slice(-DESC_EXCERPT_CHARS) : prefix;
    const tailSchema: ObjectSchema = {
      type: SchemaType.OBJECT,
      properties: { description_tail: { type: SchemaType.STRING } },
      required: ['description_tail'],
    };
    const instruction = [
      'The previous JSON response was truncated due to token limits.',
      'You already produced the beginning of the "description".',
      'Continue EXACTLY from where it stopped and return only the missing remainder.',
      '',
      'Output STRICT JSON only with this shape:',
      '{ "description_tail": string }',
      '',
      'Rules:',
      '- Do NOT repeat any part already produced.',
      '- Keep the same style and structure (continue the Markdown list if it was started).',
      '- Do not re-emit the "title".',
      '- No code fences, no commentary.',
      '- Stay within the original limits: max 5 items, each ≤ 12 words, total ≤ 180 words.',
    ].join('\n');
    const contextMsg = 'Here is the last ' + String(DESC_EXCERPT_CHARS) + ' characters of the description you already produced:\n' + excerpt;
    return {
      contents: [
        { role: 'user', parts: [{ text: instruction }] },
        { role: 'user', parts: [{ text: contextMsg }] },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens,
        responseMimeType: 'application/json',
        responseSchema: tailSchema,
      },
    };
  }

  private appendTailWithOverlap(base: string, tail: string, overlap: number = TAIL_OVERLAP_CHARS): string {
    const b = base || '';
    const t = tail || '';
    if (!b) return (b + t).trim();
    const suffix = b.slice(-overlap);
    if (t.startsWith(suffix)) {
      return (b + t.slice(suffix.length)).trim();
    }
    return (b + t).trim();
  }

  private isTailResponse(obj: unknown): obj is TailResponse {
    return isRecord(obj) && isString(obj.description_tail);
  }

  private parseUnifiedContent(text: string): PullRequestContentResult {
    const tryParse = (s: string): UnifiedObj | null => { try { return JSON.parse(s) as UnifiedObj; } catch { return null; } };
    let objUnknown: UnifiedObj | null = tryParse(text);
    if (!objUnknown) {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        objUnknown = tryParse(text.slice(start, end + 1));
      }
    }
    if (!isRecord(objUnknown)) {
      throw new AIError('Gemini unified content parse error: non-JSON output', { provider: 'Gemini' });
    }
    const obj = objUnknown as UnifiedObj;
    const titleObj: TitleObj = obj.title || {};
    const subject: string = isString(titleObj.subject) ? titleObj.subject : String(titleObj.subject ?? '');
    const type: string | undefined = isString(titleObj.type) ? titleObj.type : undefined;
    const scope: string | undefined = isString(titleObj.scope) ? titleObj.scope : undefined;
    const conventional: string | undefined = isString(titleObj.conventional) ? titleObj.conventional : undefined;
    const description: string = isString(obj.description) ? obj.description : String(obj.description ?? '');

    const title: string = (conventional || subject || '').toString().trim();
    return {
      title,
      description: description || '',
      meta: {
        type: type || undefined,
        scope: scope || undefined,
        subject: subject || undefined,
      },
    };
  }
}

export default GeminiAIHelper;
