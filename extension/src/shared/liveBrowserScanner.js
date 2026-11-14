/**
 * Fast Direct Browser Scanner (Fallback when localhost:4000 backend is not running).
 * Executes parallel MediaWiki + Wikidata CORS requests (&origin=*) in < 1s and
 * surfaces clear issues ("Different information", "Much fewer references",
 * "Missing reference", "Outdated information").
 */

const LANG_NAMES = {
  fi: 'Finnish',
  sv: 'Swedish',
  ru: 'Russian',
};

const CITATION_NEEDED_RE = {
  fi: /\{\{\s*(lähde|lähde\?|kenen mukaan|missä|milloin)\b[^}]*\}\}/gi,
  sv: /\{\{\s*(källa behövs|kb|vem|när|var)\b[^}]*\}\}/gi,
  ru: /\{\{\s*(нет аи|источник\?|кто|когда|откуда|проверить факты)\b[^}]*\}\}/gi,
};

const browserAnalysisCache = new Map();

function buildWikiUrl(lang, title) {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

async function fetchJsonFast(url, timeoutMs = 4500) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function searchQidsOnWiki(wikiHost, query) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '12',
    prop: 'pageprops',
    ppprop: 'wikibase_item',
    format: 'json',
    origin: '*',
  });
  try {
    const data = await fetchJsonFast(`https://${wikiHost}.wikipedia.org/w/api.php?${params}`);
    const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
    pages.sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
    return pages.map((p) => p?.pageprops?.wikibase_item).filter(Boolean);
  } catch {
    return [];
  }
}

function countInlineRefs(wikitext) {
  if (!wikitext) return 0;
  const fullTags = wikitext.match(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi) || [];
  const selfClosing = wikitext.match(/<ref\b[^>]*\/\s*>/gi) || [];
  const sfn = wikitext.match(/\{\{\s*(sfn|harvnb|källhänvisning)\b/gi) || [];
  return fullTags.length + Math.ceil(selfClosing.length * 0.5) + sfn.length;
}

function extractCitationNeededSnippet(wikitext, lang) {
  if (!wikitext) return null;
  const re = new RegExp(CITATION_NEEDED_RE[lang].source, 'gi');
  const m = re.exec(wikitext);
  if (!m || m.index === undefined) return null;
  const before = wikitext.slice(Math.max(0, m.index - 220), m.index);
  const cleaned = before
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<ref\b[^>]*\/\s*>/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = cleaned.split(/(?<=[.!?])\s+/);
  const last = (parts[parts.length - 1] || cleaned).trim();
  return last.length >= 15 ? last.slice(0, 180) : null;
}

async function fetchBatchEditions(lang, items) {
  const out = new Map();
  if (!items.length) return out;

  const titleToQid = new Map();
  for (const it of items) {
    titleToQid.set(it.title.toLowerCase(), it.qid);
  }

  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts|revisions',
    exintro: '1',
    explaintext: '1',
    exlimit: 'max',
    rvprop: 'timestamp|content',
    rvslots: 'main',
    redirects: '1',
    titles: items.map((i) => i.title).join('|'),
    format: 'json',
    origin: '*',
  });

  try {
    const data = await fetchJsonFast(`https://${lang}.wikipedia.org/w/api.php?${params}`, 5500);
    const normMap = new Map();
    for (const n of data?.query?.normalized || []) {
      normMap.set(n.to.toLowerCase(), n.from.toLowerCase());
    }
    for (const r of data?.query?.redirects || []) {
      const orig = normMap.get(r.from.toLowerCase()) || r.from.toLowerCase();
      normMap.set(r.to.toLowerCase(), orig);
    }

    for (const page of Object.values(data?.query?.pages || {})) {
      if (!page || page.missing !== undefined || !page.title) continue;
      const pLower = page.title.toLowerCase();
      const origLower = normMap.get(pLower) || pLower;
      const qid = titleToQid.get(origLower) || titleToQid.get(pLower);
      if (!qid) continue;

      const rev = page.revisions?.[0];
      const wikitext = rev?.slots?.main?.['*'] || rev?.['*'] || '';
      const cnMatches = wikitext.match(CITATION_NEEDED_RE[lang]) || [];

      out.set(qid, {
        qid,
        lang,
        title: page.title,
        url: buildWikiUrl(lang, page.title),
        extract: (page.extract || '').trim(),
        refCount: countInlineRefs(wikitext),
        citationNeededTags: cnMatches.length,
        cnSnippet: extractCitationNeededSnippet(wikitext, lang),
        lastRevAt: rev?.timestamp || null,
      });
    }
  } catch {
    // Ignore failed language batch
  }
  return out;
}

function splitSentences(text) {
  return (text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 18);
}

function firstSentence(text, fallbackTitle) {
  const list = splitSentences(text);
  return list[0] ? list[0].slice(0, 165) : fallbackTitle;
}

function extractYearsAndFigures(text) {
  const lead = (text || '').slice(0, 1200);
  const years = new Set();
  const yearMatches = lead.match(/\b(1[5-9]\d{2}|20[0-2]\d)\b/g) || [];
  for (const y of yearMatches) years.add(y);

  const figures = new Map();
  const sents = splitSentences(lead);
  const numRe = /\b\d{1,3}(?:[\s\u00a0.,]\d{3})+\b|\b\d{3,7}\b/g;
  for (const s of sents) {
    const matches = s.match(numRe) || [];
    for (const raw of matches) {
      const digits = raw.replace(/[^\d]/g, '');
      const val = Number(digits);
      if (val >= 1500 && val <= 2035 && raw.length === 4) continue;
      if (digits.length >= 3 && !figures.has(digits)) {
        figures.set(digits, { raw: raw.trim(), sentence: s.slice(0, 165) });
      }
    }
  }
  return { years, figures, sents };
}

function scanEditionsForIssues(qid, canonicalLabel, editionsMap) {
  const langs = ['fi', 'sv', 'ru'].filter((l) => editionsMap.has(l));
  if (langs.length < 2) return { discrepancies: [], issueBadges: [], overallSummary: '' };

  const discrepancies = [];
  const issueBadges = [];

  const parsed = {};
  for (const l of langs) {
    parsed[l] = extractYearsAndFigures(editionsMap.get(l).extract);
  }

  // 1. DIFFERENT INFORMATION: Conflicting years or numerical figures across leads
  let foundFactDiff = false;
  const allYears = new Map();
  for (const l of langs) {
    for (const y of parsed[l].years) {
      if (!allYears.has(y)) allYears.set(y, []);
      allYears.get(y).push(l);
    }
  }

  // Find when two editions agree on a year in the lead that the 3rd edition lacks while stating another year
  if (langs.length === 3) {
    for (const [sharedYear, presentIn] of allYears.entries()) {
      if (presentIn.length === 2) {
        const outlier = langs.find((l) => !presentIn.includes(l));
        const outlierOtherYears = [...parsed[outlier].years].filter(
          (y) => !presentIn.some((p) => parsed[p].years.has(y))
        );
        if (outlierOtherYears.length > 0) {
          const altYear = outlierOtherYears[0];
          const outlierSent =
            parsed[outlier].sents.find((s) => s.includes(altYear)) ||
            firstSentence(editionsMap.get(outlier).extract, editionsMap.get(outlier).title);

          const claims = {};
          for (const code of ['fi', 'sv', 'ru']) {
            const ed = editionsMap.get(code);
            if (!ed) {
              claims[code] = { value: 'Edition missing', hasCitation: false, citationStatus: 'missing' };
            } else if (code === outlier) {
              claims[code] = {
                value: `States year ${altYear} (${ed.refCount} refs)`,
                hasCitation: ed.refCount > 0,
                citationStatus: ed.refCount > 0 ? 'valid' : 'missing',
              };
            } else {
              claims[code] = {
                value: `States year ${sharedYear} (${ed.refCount} refs)`,
                hasCitation: ed.refCount > 0,
                citationStatus: ed.refCount > 0 ? 'valid' : 'missing',
              };
            }
          }

          discrepancies.push({
            id: discrepancies.length + 1,
            qid,
            mismatchType: 'hard_fact',
            issueLabel: 'Different information',
            targetLang: outlier,
            claimTopic: `Different dates in intro (${altYear} vs. ${sharedYear})`,
            summary: `${presentIn.map((l) => l.toUpperCase()).join(' & ')} Wikipedia state ${sharedYear}, while ${LANG_NAMES[outlier]} Wikipedia states ${altYear}.`,
            disputedSnippet: outlierSent,
            sectionHeading: null,
            lineHint: 1,
            suggestedCorrection: `Different information: ${presentIn.map((l) => l.toUpperCase()).join(' & ')} state ${sharedYear}, whereas ${outlier.toUpperCase()} states ${altYear}.`,
            agreementMatrix: {
              consensusGroup: presentIn,
              outlierGroup: [outlier],
              matrixLabel: `${presentIn.map((l) => l.toUpperCase()).join(' & ')}: ${sharedYear} | ${outlier.toUpperCase()}: ${altYear}`,
              claims,
            },
            citationGapFlag: false,
            donorLang: presentIn[0],
            brokenLinkDetected: false,
            brokenLinkUrl: null,
            severityScore: 85,
            confidenceLevel: 'high',
            confidenceScore: 84,
            verifiedSources: [],
          });
          issueBadges.push('Different information');
          foundFactDiff = true;
          break;
        }
      }
    }
  }

  // Check conflicting multi-digit statistics/figures if no year conflict yet
  if (!foundFactDiff) {
    const langsWithFigs = langs.filter((l) => parsed[l].figures.size > 0);
    if (langsWithFigs.length >= 2) {
      const [lA, lB] = langsWithFigs;
      const figsA = [...parsed[lA].figures.keys()];
      const figsB = [...parsed[lB].figures.keys()];
      const shared = figsA.some((f) => parsed[lB].figures.has(f));
      if (!shared) {
        const edA = editionsMap.get(lA);
        const edB = editionsMap.get(lB);
        const target = edA.refCount <= edB.refCount ? lA : lB;
        const donor = target === lA ? lB : lA;
        const targetEntry = [...parsed[target].figures.values()][0];
        const donorEntry = [...parsed[donor].figures.values()][0];

        const claims = {};
        for (const code of ['fi', 'sv', 'ru']) {
          const ed = editionsMap.get(code);
          if (!ed) {
            claims[code] = { value: 'Edition missing', hasCitation: false, citationStatus: 'missing' };
          } else {
            const firstFig = [...parsed[code].figures.values()][0];
            claims[code] = {
              value: firstFig
                ? `${firstFig.raw} — "${firstFig.sentence.slice(0, 85)}"`
                : `No matching figure in lead (${ed.refCount} refs)`,
              hasCitation: ed.refCount > 0,
              citationStatus: ed.refCount > 0 ? 'valid' : 'missing',
            };
          }
        }

        discrepancies.push({
          id: discrepancies.length + 1,
          qid,
          mismatchType: 'hard_fact',
          issueLabel: 'Different information',
          targetLang: target,
          claimTopic: `Different figures in intro (${targetEntry.raw} vs. ${donorEntry.raw})`,
          summary: `${LANG_NAMES[target]} Wikipedia states "${targetEntry.raw}", whereas ${LANG_NAMES[donor]} Wikipedia states "${donorEntry.raw}".`,
          disputedSnippet: targetEntry.sentence,
          sectionHeading: null,
          lineHint: 1,
          suggestedCorrection: `Different information: Compare ${target.toUpperCase()} (${targetEntry.raw}) against ${donor.toUpperCase()} (${donorEntry.raw}).`,
          agreementMatrix: {
            consensusGroup: [donor],
            outlierGroup: [target],
            matrixLabel: `${donor.toUpperCase()}: ${donorEntry.raw} | ${target.toUpperCase()}: ${targetEntry.raw}`,
            claims,
          },
          citationGapFlag: edA.refCount !== edB.refCount,
          donorLang: donor,
          brokenLinkDetected: false,
          brokenLinkUrl: null,
          severityScore: 82,
          confidenceLevel: 'medium',
          confidenceScore: 78,
          verifiedSources: [],
        });
        issueBadges.push('Different information');
      }
    }
  }

  // 2. MUCH FEWER REFERENCES: Significant reference imbalance across editions
  const sortedByRefs = langs
    .map((l) => editionsMap.get(l))
    .sort((a, b) => a.refCount - b.refCount);
  const lowestEd = sortedByRefs[0];
  const highestEd = sortedByRefs[sortedByRefs.length - 1];

  if (
    highestEd.refCount >= 6 &&
    (highestEd.refCount >= lowestEd.refCount * 2.5 || highestEd.refCount - lowestEd.refCount >= 12)
  ) {
    const pctLess = Math.round(((highestEd.refCount - lowestEd.refCount) / highestEd.refCount) * 100);
    const claims = {};
    for (const code of ['fi', 'sv', 'ru']) {
      const ed = editionsMap.get(code);
      claims[code] = ed
        ? {
            value:
              code === lowestEd.lang
                ? `Only ${ed.refCount} references (${pctLess}% fewer than ${highestEd.lang.toUpperCase()})`
                : `${ed.refCount} references`,
            hasCitation: ed.refCount > 4,
            citationStatus: code === lowestEd.lang ? 'missing' : 'valid',
          }
        : { value: 'Edition missing', hasCitation: false, citationStatus: 'missing' };
    }

    discrepancies.push({
      id: discrepancies.length + 1,
      qid,
      mismatchType: 'missing_citation',
      issueLabel: 'Much fewer references',
      targetLang: lowestEd.lang,
      claimTopic: `${LANG_NAMES[lowestEd.lang]} Wikipedia has only ${lowestEd.refCount} references (vs. ${highestEd.refCount} in ${LANG_NAMES[highestEd.lang]})`,
      summary: `${LANG_NAMES[lowestEd.lang]} edition has ${pctLess}% fewer references (${lowestEd.refCount} vs. ${highestEd.refCount} in ${LANG_NAMES[highestEd.lang]}), leaving claims weakly sourced.`,
      disputedSnippet: lowestEd.cnSnippet || firstSentence(lowestEd.extract, lowestEd.title),
      sectionHeading: null,
      lineHint: 1,
      suggestedCorrection: `Much fewer references: ${lowestEd.lang.toUpperCase()} has only ${lowestEd.refCount} refs compared with ${highestEd.refCount} refs in ${highestEd.lang.toUpperCase()}.`,
      agreementMatrix: {
        consensusGroup: [highestEd.lang],
        outlierGroup: [lowestEd.lang],
        matrixLabel: `${highestEd.lang.toUpperCase()}: ${highestEd.refCount} refs | ${lowestEd.lang.toUpperCase()}: only ${lowestEd.refCount} refs`,
        claims,
      },
      citationGapFlag: true,
      donorLang: highestEd.lang,
      brokenLinkDetected: false,
      brokenLinkUrl: null,
      severityScore: Math.min(92, 68 + Math.round(pctLess / 4)),
      confidenceLevel: 'high',
      confidenceScore: 90,
      verifiedSources: [],
    });
    issueBadges.push(
      `Much fewer references (${lowestEd.lang.toUpperCase()}: ${lowestEd.refCount} vs ${highestEd.lang.toUpperCase()}: ${highestEd.refCount})`
    );
  }

  // 3. MISSING REFERENCE: Explicit [citation needed] tag
  for (const l of langs) {
    const ed = editionsMap.get(l);
    if (ed.citationNeededTags > 0) {
      const claims = {};
      for (const code of ['fi', 'sv', 'ru']) {
        const e = editionsMap.get(code);
        claims[code] = e
          ? {
              value:
                e.citationNeededTags > 0
                  ? `${e.citationNeededTags} [citation needed] tag(s) (${e.refCount} refs)`
                  : `No [citation needed] tags (${e.refCount} refs)`,
              hasCitation: e.citationNeededTags === 0 && e.refCount > 0,
              citationStatus: e.citationNeededTags > 0 ? 'missing' : 'valid',
            }
          : { value: 'Edition missing', hasCitation: false, citationStatus: 'missing' };
      }

      discrepancies.push({
        id: discrepancies.length + 1,
        qid,
        mismatchType: 'missing_citation',
        issueLabel: 'Missing reference',
        targetLang: l,
        claimTopic: `${ed.citationNeededTags} [citation needed] tag(s) in ${LANG_NAMES[l]} Wikipedia`,
        summary: `${LANG_NAMES[l]} edition explicitly marks ${ed.citationNeededTags} claim(s) as lacking a reliable source.`,
        disputedSnippet: ed.cnSnippet || firstSentence(ed.extract, ed.title),
        sectionHeading: null,
        lineHint: 1,
        suggestedCorrection: `Missing reference: Verify and cite the flagged passage using ${highestEd.lang.toUpperCase()} Wikipedia (${highestEd.refCount} refs).`,
        agreementMatrix: {
          consensusGroup: [highestEd.lang],
          outlierGroup: [l],
          matrixLabel: `${l.toUpperCase()} has ${ed.citationNeededTags} [citation needed] tag(s)`,
          claims,
        },
        citationGapFlag: true,
        donorLang: highestEd.lang,
        brokenLinkDetected: false,
        brokenLinkUrl: null,
        severityScore: 76,
        confidenceLevel: 'high',
        confidenceScore: 88,
        verifiedSources: [],
      });
      if (!issueBadges.some((b) => b.startsWith('Missing reference'))) {
        issueBadges.push(`Missing reference (${l.toUpperCase()})`);
      }
      break;
    }
  }

  // 4. OUTDATED INFORMATION: Revision age gap > 400 days
  const withDates = langs
    .map((l) => ({ ed: editionsMap.get(l), ts: Date.parse(editionsMap.get(l).lastRevAt || '') }))
    .filter((x) => Number.isFinite(x.ts))
    .sort((a, b) => a.ts - b.ts);

  if (withDates.length >= 2) {
    const oldest = withDates[0];
    const newest = withDates[withDates.length - 1];
    const daysGap = Math.round((newest.ts - oldest.ts) / (1000 * 60 * 60 * 24));
    if (daysGap >= 400 && oldest.ed.refCount < newest.ed.refCount) {
      const oldYear = new Date(oldest.ts).getUTCFullYear();
      const newYear = new Date(newest.ts).getUTCFullYear();
      const claims = {};
      for (const code of ['fi', 'sv', 'ru']) {
        const e = editionsMap.get(code);
        claims[code] = e
          ? {
              value: `Last edited ${e.lastRevAt ? e.lastRevAt.slice(0, 10) : 'unknown'} (${e.refCount} refs)`,
              hasCitation: e.refCount > 0,
              citationStatus: code === oldest.ed.lang ? 'missing' : 'valid',
            }
          : { value: 'Edition missing', hasCitation: false, citationStatus: 'missing' };
      }

      discrepancies.push({
        id: discrepancies.length + 1,
        qid,
        mismatchType: 'outdated_data',
        issueLabel: 'Outdated information',
        targetLang: oldest.ed.lang,
        claimTopic: `${LANG_NAMES[oldest.ed.lang]} edition not updated since ${oldYear}`,
        summary: `${LANG_NAMES[oldest.ed.lang]} Wikipedia has not been updated since ${oldYear}, while ${LANG_NAMES[newest.ed.lang]} Wikipedia was updated in ${newYear}.`,
        disputedSnippet: firstSentence(oldest.ed.extract, oldest.ed.title),
        sectionHeading: null,
        lineHint: 1,
        suggestedCorrection: `Outdated information: Review ${oldest.ed.lang.toUpperCase()} article against ${newest.ed.lang.toUpperCase()} (${newYear} revision).`,
        agreementMatrix: {
          consensusGroup: [newest.ed.lang],
          outlierGroup: [oldest.ed.lang],
          matrixLabel: `${newest.ed.lang.toUpperCase()} updated ${newYear} | ${oldest.ed.lang.toUpperCase()} last edited ${oldYear}`,
          claims,
        },
        citationGapFlag: false,
        donorLang: newest.ed.lang,
        brokenLinkDetected: false,
        brokenLinkUrl: null,
        severityScore: 72,
        confidenceLevel: 'medium',
        confidenceScore: 78,
        verifiedSources: [],
      });
      issueBadges.push(`Outdated information (${oldest.ed.lang.toUpperCase()})`);
    }
  }

  return {
    discrepancies,
    issueBadges,
    overallSummary:
      discrepancies[0]?.summary ||
      `Detected ${discrepancies.length} issue(s) across FI, SV, and RU editions of ${canonicalLabel}.`,
  };
}

export async function searchLiveFromBrowser(query) {
  const q = query.trim();
  if (!q) return null;

  const [enQids, fiQids, svQids, ruQids] = await Promise.all([
    searchQidsOnWiki('en', q),
    searchQidsOnWiki('fi', q),
    searchQidsOnWiki('sv', q),
    searchQidsOnWiki('ru', q),
  ]);

  const uniqueQids = [];
  const seen = new Set();
  const maxLen = Math.max(enQids.length, fiQids.length, svQids.length, ruQids.length);
  for (let i = 0; i < maxLen && uniqueQids.length < 15; i++) {
    for (const arr of [fiQids, svQids, ruQids, enQids]) {
      const id = arr[i];
      if (id && !seen.has(id)) {
        seen.add(id);
        uniqueQids.push(id);
        if (uniqueQids.length >= 15) break;
      }
    }
  }

  if (!uniqueQids.length) return [];

  const wdParams = new URLSearchParams({
    action: 'wbgetentities',
    ids: uniqueQids.join('|'),
    props: 'sitelinks|labels',
    sitefilter: 'fiwiki|svwiki|ruwiki|enwiki',
    languages: 'en|fi|sv|ru',
    format: 'json',
    origin: '*',
  });

  const wdData = await fetchJsonFast(`https://www.wikidata.org/w/api.php?${wdParams}`, 4500);
  const entities = wdData?.entities || {};

  const candidates = [];
  for (const qid of uniqueQids) {
    const ent = entities[qid];
    if (!ent?.sitelinks) continue;
    const fiT = ent.sitelinks.fiwiki?.title || null;
    const svT = ent.sitelinks.svwiki?.title || null;
    const ruT = ent.sitelinks.ruwiki?.title || null;
    const count = [fiT, svT, ruT].filter(Boolean).length;
    if (count < 2) continue;

    const label =
      ent.labels?.en?.value ||
      ent.labels?.fi?.value ||
      ent.labels?.sv?.value ||
      ent.labels?.ru?.value ||
      fiT ||
      svT ||
      ruT ||
      qid;

    candidates.push({ qid, canonicalLabel: label, titles: { fi: fiT, sv: svT, ru: ruT } });
  }

  if (!candidates.length) return [];

  const [fiMap, svMap, ruMap] = await Promise.all([
    fetchBatchEditions(
      'fi',
      candidates.filter((c) => c.titles.fi).map((c) => ({ qid: c.qid, title: c.titles.fi }))
    ),
    fetchBatchEditions(
      'sv',
      candidates.filter((c) => c.titles.sv).map((c) => ({ qid: c.qid, title: c.titles.sv }))
    ),
    fetchBatchEditions(
      'ru',
      candidates.filter((c) => c.titles.ru).map((c) => ({ qid: c.qid, title: c.titles.ru }))
    ),
  ]);

  const articles = [];
  for (const cand of candidates) {
    const edMap = new Map();
    if (fiMap.has(cand.qid)) edMap.set('fi', fiMap.get(cand.qid));
    if (svMap.has(cand.qid)) edMap.set('sv', svMap.get(cand.qid));
    if (ruMap.has(cand.qid)) edMap.set('ru', ruMap.get(cand.qid));
    if (edMap.size < 2) continue;

    const scan = scanEditionsForIssues(cand.qid, cand.canonicalLabel, edMap);
    if (scan.discrepancies.length === 0) continue;

    const maxSev = Math.max(...scan.discrepancies.map((d) => d.severityScore));
    const refs = [...edMap.values()].map((e) => e.refCount);
    const minRef = Math.min(...refs);

    const fiEd = edMap.get('fi');
    const svEd = edMap.get('sv');
    const ruEd = edMap.get('ru');

    const articleSummary = {
      qid: cand.qid,
      canonicalLabel: cand.canonicalLabel,
      editions: {
        fi: {
          title: fiEd?.title || null,
          url: fiEd?.url || null,
          refCount: fiEd?.refCount ?? 0,
          lastRevAt: fiEd?.lastRevAt || null,
        },
        sv: {
          title: svEd?.title || null,
          url: svEd?.url || null,
          refCount: svEd?.refCount ?? 0,
          lastRevAt: svEd?.lastRevAt || null,
        },
        ru: {
          title: ruEd?.title || null,
          url: ruEd?.url || null,
          refCount: ruEd?.refCount ?? 0,
          lastRevAt: ruEd?.lastRevAt || null,
        },
      },
      editionCount: edMap.size,
      sourceCount: minRef,
      discrepancyCount: scan.discrepancies.length,
      discrepancySeverity: maxSev,
      issueBadges: scan.issueBadges,
      priorityScore: maxSev + Math.max(0, 20 - minRef),
    };

    browserAnalysisCache.set(cand.qid, {
      article: articleSummary,
      overallSummary: scan.overallSummary,
      discrepancies: scan.discrepancies,
    });

    articles.push(articleSummary);
  }

  articles.sort((a, b) => b.priorityScore - a.priorityScore);
  return articles;
}

export function getCachedBrowserAnalysis(qid) {
  return browserAnalysisCache.get(qid) || null;
}
