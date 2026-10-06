import { Injectable, inject } from '@angular/core';
import { LlmError, LocalLLMService } from './local-llm';
import { SummaryCache } from './summary-cache';
import { DEFAULT_SUMMARY_OPTIONS, SummaryOptions, buildChunkMessages, buildCombineMessages, buildSummaryMessages, maxTokensFor } from './summary-config';
import { cleanModelOutput } from './summary-markdown';
import { planSummary } from './summary-plan';
import { articleTextForSummary, contentHash } from './summary-text';

export type SummaryErrorCode = 'unavailable' | 'download' | 'insufficient' | 'too-large' | 'generation' | 'cancelled';

/** User-facing copy for every failure. Raw exceptions never reach the UI. Cancelled shows nothing. */
export const SUMMARY_ERROR_MESSAGES: Record<SummaryErrorCode, string> = {
  'unavailable': "AI summarisation isn't available on this device.",
  'download': "Couldn't prepare the AI model. Please try again.",
  'insufficient': "There isn't enough article content to summarise.",
  'too-large': 'This article is too large to summarise on this device.',
  'generation': "Couldn't generate the summary. Please try again.",
  'cancelled': '',
};

export class SummaryError extends Error {
  constructor(public readonly code: SummaryErrorCode) { super(SUMMARY_ERROR_MESSAGES[code] || code); this.name = 'SummaryError'; }
}

export interface SummaryInput { articleId: string; title?: string; html: string | undefined; }

export type SummaryPhase =
  | { phase: 'preparing' }
  | { phase: 'generating'; part?: number; parts?: number };

export interface SummariseOptions {
  signal?: AbortSignal;
  /** Skip the cache (Regenerate). */
  force?: boolean;
  onPhase?: (phase: SummaryPhase) => void;
  /** Streamed summary text so far (already cleaned). */
  onPartial?: (text: string) => void;
  options?: SummaryOptions;
}

export interface SummaryResult { summary: string; fromCache: boolean; model: string; createdAt: number; }

/** Article -> clean text -> (cache | local model) -> summary. The article page only talks to this service. */
@Injectable({ providedIn: 'root' })
export class ArticleSummarisationService {
  private llm = inject(LocalLLMService);
  private cache = inject(SummaryCache);

  get model() { return this.llm.model; }
  get status() { return this.llm.status; }
  get progress() { return this.llm.progress; }

  async isAvailable(): Promise<boolean> { return (await this.llm.checkAvailability()).available; }

  /** The cached summary for this exact article content and model, if any. Never starts the model. */
  async cached(input: SummaryInput): Promise<SummaryResult | undefined> {
    const text = articleTextForSummary(input.html);
    if (!text) return undefined;
    const hit = await this.cache.get(input.articleId, contentHash(JSON.stringify([input.title ?? '', text])), this.llm.model.id);
    return hit ? { summary: hit.summary, fromCache: true, model: hit.model, createdAt: hit.createdAt } : undefined;
  }

  async summarise(input: SummaryInput, opts: SummariseOptions = {}): Promise<SummaryResult> {
    const { signal } = opts;
    const options = opts.options ?? DEFAULT_SUMMARY_OPTIONS;
    const text = articleTextForSummary(input.html);
    const plan = planSummary(text);
    if (plan.kind === 'insufficient') throw new SummaryError('insufficient');
    if (plan.kind === 'too-large') throw new SummaryError('too-large');
    const hash = contentHash(JSON.stringify([input.title ?? '', text]));
    const model = this.llm.model.id;
    if (!opts.force) {
      const hit = await this.cache.get(input.articleId, hash, model);
      if (hit) return { summary: hit.summary, fromCache: true, model: hit.model, createdAt: hit.createdAt };
    }
    this.throwIfCancelled(signal);
    if (!(await this.llm.checkAvailability()).available) throw new SummaryError('unavailable');

    opts.onPhase?.({ phase: 'preparing' });
    try { await this.llm.load(signal); }
    catch (error) { throw this.mapError(error, signal, 'download'); }
    this.throwIfCancelled(signal);

    let raw: string;
    try {
      const maxTokens = maxTokensFor(options);
      const stream = (t: string) => { if (!signal?.aborted) opts.onPartial?.(cleanModelOutput(t)); };
      if (plan.kind === 'direct') {
        opts.onPhase?.({ phase: 'generating' });
        raw = await this.llm.generate(buildSummaryMessages(plan.text, input.title, options), { maxTokens, signal, onText: stream });
      } else {
        const partials: string[] = [];
        for (let i = 0; i < plan.chunks.length; i++) {
          opts.onPhase?.({ phase: 'generating', part: i + 1, parts: plan.chunks.length + 1 });
          const part = cleanModelOutput(await this.llm.generate(buildChunkMessages(plan.chunks[i], i, plan.chunks.length, input.title), { maxTokens: 160, signal }));
          this.throwIfCancelled(signal);
          if (part) partials.push(part);
        }
        if (!partials.length) throw new SummaryError('generation');
        opts.onPhase?.({ phase: 'generating', part: plan.chunks.length + 1, parts: plan.chunks.length + 1 });
        raw = await this.llm.generate(buildCombineMessages(partials, input.title, options), { maxTokens, signal, onText: stream });
      }
    } catch (error) { throw this.mapError(error, signal, 'generation'); }
    this.throwIfCancelled(signal);

    const summary = cleanModelOutput(raw);
    if (summary.length < 20) throw new SummaryError('generation');
    const createdAt = Date.now();
    await this.cache.put({ articleId: input.articleId, contentHash: hash, model, summary, createdAt }).catch(() => undefined);
    return { summary, fromCache: false, model, createdAt };
  }

  clearCache(articleId?: string): Promise<number> { return this.cache.clear(articleId); }
  cachedCount(): Promise<number> { return this.cache.count(); }
  /** Release the model's memory now (e.g. when leaving the article). */
  release(): Promise<void> { return this.llm.status() === 'generating' ? Promise.resolve() : this.llm.unload(); }
  deleteModel(): Promise<void> { return this.llm.deleteModel(); }

  private throwIfCancelled(signal?: AbortSignal) { if (signal?.aborted) throw new SummaryError('cancelled'); }

  private mapError(error: unknown, signal: AbortSignal | undefined, fallback: SummaryErrorCode): SummaryError {
    if (error instanceof SummaryError) return error;
    if (signal?.aborted || (error instanceof LlmError && error.code === 'aborted')) return new SummaryError('cancelled');
    if (error instanceof LlmError && error.code === 'unavailable') return new SummaryError('unavailable');
    if (error instanceof LlmError && (error.code === 'download' || error.code === 'load')) return new SummaryError('download');
    return new SummaryError(fallback);
  }
}
