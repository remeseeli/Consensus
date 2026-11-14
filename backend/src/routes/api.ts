import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { getDbPool } from '../db/pool.js';
import { verifyClaimAgainstAcademicSources } from '../services/academicVerifier.js';
import { formatLocalizedWikipediaCitations } from '../services/citationFormatter.js';
import {
  analyzeArticleByQid,
  searchAndRankArticles,
} from '../services/orchestratorService.js';
import type { MismatchType, SourceType } from '../types.js';

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
