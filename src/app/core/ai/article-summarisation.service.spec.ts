import { TestBed } from '@angular/core/testing';
import { ArticleSummarisationService, SummaryError, SUMMARY_ERROR_MESSAGES } from './article-summarisation.service';
import { LlmError, LocalLLMService } from './local-llm';
import { MemorySummaryCache, SummaryCache } from './summary-cache';
import { ARTICLE_HTML, FakeLlm, LONG_PARAGRAPH } from './testing';

describe('ArticleSummarisationService', () => {
  let llm: FakeLlm;
  let cache: MemorySummaryCache;
  let service: ArticleSummarisationService;
  const input = { articleId: 'a1', title: 'Budget plan', html: ARTICLE_HTML };

  beforeEach(() => {
    llm = new FakeLlm();
    cache = new MemorySummaryCache();
    TestBed.configureTestingModule({ providers: [{ provide: LocalLLMService, useValue: llm }, { provide: SummaryCache, useValue: cache }] });
    service = TestBed.inject(ArticleSummarisationService);
  });

  async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof SummaryError ? e.code : 'raw'; } }

  it('summarises clean text, streams and reports phases', async () => {
    const phases: string[] = []; const partials: string[] = [];
    const result = await service.summarise(input, { onPhase: p => phases.push(p.phase), onPartial: t => partials.push(t) });
    expect(result).toEqual(expect.objectContaining({ summary: 'The council approved the **new plan** on Monday.', fromCache: false, model: llm.model.id }));
    expect(phases).toEqual(['preparing', 'generating']);
    expect(partials).toEqual(['The council', 'The council approved the', 'The council approved the **new plan** on Monday.']);
    const user = llm.calls[0][1].content;
    expect(user).toContain('Title: Budget plan');
    expect(user).not.toContain('<p>');
    expect(llm.calls[0][0].content).toContain('Only include information contained in the article.');
  });

  it('reports an unavailable device without loading anything', async () => {
    llm.availability = { available: false, downloaded: false, reason: 'no-wasm' };
    expect(await code(service.summarise(input))).toBe('unavailable');
    expect(llm.loads).toBe(0);
    expect(await service.isAvailable()).toBe(false);
  });

  it('maps a model download failure', async () => {
    llm.loadError = new LlmError('download', 'network');
    expect(await code(service.summarise(input))).toBe('download');
  });

  it('maps a generation failure and never exposes the raw error', async () => {
    llm.generateError = new Error('RuntimeError: memory access out of bounds');
    let message = '';
    try { await service.summarise(input); } catch (e) { message = (e as Error).message; }
    expect(message).toBe(SUMMARY_ERROR_MESSAGES.generation);
  });

  it('treats an empty model answer as a generation failure', async () => {
    llm.tokens = ['<think>…</think>'];
    expect(await code(service.summarise(input))).toBe('generation');
  });

  it('cancels mid-generation without caching or streaming late output', async () => {
    let release!: () => void;
    llm.gate = new Promise(r => { release = r; });
    const controller = new AbortController();
    const partials: string[] = [];
    const run = service.summarise(input, { signal: controller.signal, onPartial: t => partials.push(t) });
    await new Promise(r => setTimeout(r));
    controller.abort();
    release();
    expect(await code(run)).toBe('cancelled');
    expect(partials).toEqual([]);
    expect(await cache.count()).toBe(0);
  });

  it('refuses articles with too little content', async () => {
    expect(await code(service.summarise({ ...input, html: '<p>Read more on our site.</p>' }))).toBe('insufficient');
    expect(llm.loads).toBe(0);
  });

  it('refuses oversized articles instead of truncating them', async () => {
    const huge = Array.from({ length: 30 }, () => `<p>${LONG_PARAGRAPH}</p>`).join('');
    expect(await code(service.summarise({ ...input, html: huge }))).toBe('too-large');
    expect(llm.calls.length).toBe(0);
  });

  it('summarises long articles part by part, then combines', async () => {
    const long = Array.from({ length: 8 }, () => `<p>${LONG_PARAGRAPH}</p>`).join('');
    const phases: string[] = [];
    await service.summarise({ ...input, html: long }, { onPhase: p => phases.push(p.phase === 'generating' ? `${p.part}/${p.parts}` : p.phase) });
    expect(llm.calls.length).toBeGreaterThan(2);
    expect(llm.calls.at(-1)![0].content).toContain('Combine these partial summaries');
    expect(phases.at(-1)).toBe(`${llm.calls.length}/${llm.calls.length}`);
  });

  it('serves the cache for the same article and content', async () => {
    await service.summarise(input);
    const again = await service.summarise(input);
    expect(again.fromCache).toBe(true);
    expect(llm.calls.length).toBe(1);
    expect((await service.cached(input))?.summary).toBe(again.summary);
  });

  it('regenerates when the article content changed', async () => {
    await service.summarise(input);
    const changed = await service.summarise({ ...input, html: ARTICLE_HTML + '<p>Update: the vote was delayed until Friday afternoon.</p>' });
    expect(changed.fromCache).toBe(false);
    expect(llm.calls.length).toBe(2);
  });

  it('invalidates the summary when the article title changes', async () => {
    await service.summarise(input);
    const corrected = { ...input, title: 'Corrected budget plan' };
    expect(await service.cached(corrected)).toBeUndefined();
    expect((await service.summarise(corrected)).fromCache).toBe(false);
    expect(llm.calls.length).toBe(2);
  });

  it('keeps summaries of different articles independent', async () => {
    await service.summarise(input);
    const other = await service.summarise({ ...input, articleId: 'a2' });
    expect(other.fromCache).toBe(false);
    await service.clearCache('a1');
    expect(await service.cached(input)).toBeUndefined();
    expect((await service.cached({ ...input, articleId: 'a2' }))?.summary).toBeTruthy();
  });

  it('bypasses the cache on regenerate', async () => {
    await service.summarise(input);
    const again = await service.summarise(input, { force: true });
    expect(again.fromCache).toBe(false);
    expect(llm.calls.length).toBe(2);
  });

  it('clears all summaries and deletes the model on request', async () => {
    await service.summarise(input);
    expect(await service.clearCache()).toBe(1);
    await service.deleteModel();
    expect(llm.deletes).toBe(1);
  });
});
