import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { getDbPool } from '../db/pool.js';
import { verifyClaimAgainstAcademicSources } from '../services/academicVerifier.js';
import { formatLocalizedWikipediaCitations } from '../services/citationFormatter.js';
import { analyzeEditionsSemantically } from '../services/llmDiscrepancyService.js';
import { fetchLeadExtractForEdition } from '../services/mediawikiService.js';
import {
  analyzeArticleByQid,
  searchAndRankArticles,
} from '../services/orchestratorService.js';
import type { MismatchType, MultiLangEditionInput, SourceType } from '../types.js';

export const apiRouter = Router();

apiRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const pool = getDbPool();
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      database: 'mariadb_connected',
      llmEnabled: config.llmEnabled,
      geminiModel: config.geminiModel,
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      database: 'mariadb_unreachable',
      llmEnabled: config.llmEnabled,
      geminiModel: config.geminiModel,
      error: err instanceof Error ? err.message : 'Database connection error',
    });
  }
});

apiRouter.get('/search', async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const rawFilter = typeof req.query.filter === 'string' ? req.query.filter : 'all';
    const validFilters = new Set(['all', 'hard_fact', 'missing_citation', 'outdated_data']);
    const filter = (validFilters.has(rawFilter) ? rawFilter : 'all') as MismatchType | 'all';
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

    const result = await searchAndRankArticles({
      query: q,
      filter,
      forceRefresh,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to search and rank articles.',
    });
  }
});

apiRouter.get('/articles/:qid/analyze', async (req: Request, res: Response) => {
  try {
    const qid = String(req.params.qid || '').trim();
    if (!/^Q\d+$/i.test(qid)) {
      res.status(400).json({ error: 'Invalid Wikidata Q-ID parameter (expected e.g. Q104318).' });
      return;
    }
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const analysis = await analyzeArticleByQid(qid, forceRefresh);
    res.json(analysis);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Article analysis failed.';
    const status = msg.includes('not found') ? 404 : 500;
    res.status(status).json({ error: msg });
  }
});

apiRouter.post('/analyze/semantic', async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const canonicalLabel =
      typeof body.canonicalLabel === 'string' ? body.canonicalLabel.trim() : '';
    const qid = typeof body.qid === 'string' ? body.qid.trim() : '';
    const forceRefresh = Boolean(body.forceRefresh);
    const rawEditions: unknown[] = Array.isArray(body.editions) ? body.editions : [];

    if (!canonicalLabel) {
      res.status(400).json({ error: 'Field "canonicalLabel" is required.' });
      return;
    }

    const editions: MultiLangEditionInput[] = rawEditions
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => ({
        lang: typeof item.lang === 'string' ? item.lang.trim().toLowerCase() : '',
        langName: typeof item.langName === 'string' ? item.langName.trim() : undefined,
        title: typeof item.title === 'string' ? item.title.trim() : '',
        url: typeof item.url === 'string' ? item.url : null,
        extract: typeof item.extract === 'string' ? item.extract.trim() : '',
        refCount: typeof item.refCount === 'number' ? item.refCount : undefined,
        citationNeededTags:
          typeof item.citationNeededTags === 'number' ? item.citationNeededTags : undefined,
        hasNpovTemplate: Boolean(item.hasNpovTemplate),
        lastRevAt: typeof item.lastRevAt === 'string' ? item.lastRevAt : null,
      }))
      .filter((e) => Boolean(e.lang && e.title));

    if (editions.length < 2) {
      res.status(400).json({ error: 'At least two language editions are required.' });
      return;
    }

    // Hydrate any editions missing extract text (e.g. offline/bookmarked entries)
    await Promise.all(
      editions.map(async (ed) => {
        if (ed.extract.length >= 60) return;
        const fetched = await fetchLeadExtractForEdition(ed.lang, ed.title);
        if (fetched) {
          if (!ed.extract) ed.extract = fetched.extract;
          if (ed.refCount === undefined) ed.refCount = fetched.refCount;
          if (!ed.lastRevAt) ed.lastRevAt = fetched.lastRevAt;
        }
      })
    );

    const result = await analyzeEditionsSemantically({
      qid,
      canonicalLabel,
      editions,
      forceRefresh,
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Semantic cross-lingual analysis failed.',
    });
  }
});

apiRouter.post('/verify-claim', async (req: Request, res: Response) => {
  try {
    const { articleLabel, claimTopic, hasCrossLingualConsensus } = req.body ?? {};
    if (typeof claimTopic !== 'string' || !claimTopic.trim()) {
      res.status(400).json({ error: 'Field "claimTopic" is required.' });
      return;
    }
    const sources = await verifyClaimAgainstAcademicSources({
      articleLabel: typeof articleLabel === 'string' ? articleLabel : '',
      claimTopic: claimTopic.trim(),
      hasCrossLingualConsensus: Boolean(hasCrossLingualConsensus),
    });
    res.json({ sources });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'External claim verification failed.',
    });
  }
});

apiRouter.post('/citations/format', (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    if (typeof body.title !== 'string' || !body.title.trim()) {
      res.status(400).json({ error: 'Citation "title" is required.' });
      return;
    }
    const sourceType: SourceType = [
      'journal',
      'book',
      'dissertation',
      'conference',
      'web',
      'archive',
    ].includes(body.sourceType)
      ? body.sourceType
      : 'journal';

    const templates = formatLocalizedWikipediaCitations({
      title: body.title,
      authors: Array.isArray(body.authors) ? body.authors.map(String) : [],
      publicationVenue: body.publicationVenue || null,
      publicationYear: body.publicationYear ? Number(body.publicationYear) : null,
      doi: body.doi || null,
      isbn: body.isbn || null,
      sourceUrl: body.sourceUrl || null,
      archiveUrl: body.archiveUrl || null,
      sourceType,
      accessDate: typeof body.accessDate === 'string' ? body.accessDate : undefined,
    });

    res.json({ citations: templates });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to format Wikipedia citations.',
    });
  }
});
