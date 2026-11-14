import type { LocalizedCitations, SourceType } from '../types.js';

export interface CitationInputMetadata {
  title: string;
  authors: string[];
  publicationVenue?: string | null;
  publicationYear?: number | null;
  doi?: string | null;
  isbn?: string | null;
  sourceUrl?: string | null;
  archiveUrl?: string | null;
  sourceType: SourceType;
  accessDate?: string;
}

function escapeWikiParam(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\|/g, ' – ')
    .replace(/\{\{/g, '(')
    .replace(/\}\}/g, ')')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildRefTagName(authors: string[], year?: number | null, doi?: string | null): string {
  const firstAuthor = authors[0] || 'source';
  const surname = firstAuthor
    .split(/[,\s]+/)
    .filter(Boolean)
    .pop() || 'ref';
  const cleanSurname = surname
    .toLowerCase()
    .replace(/[^a-z0-9\u00e4\u00f6\u00e5]/gi, '')
    .slice(0, 14) || 'wiki';
  const suffix = year ? String(year) : doi ? doi.slice(-4).replace(/[^a-z0-9]/gi, '') : ' verify';
  return `${cleanSurname}${suffix}`.replace(/\s+/g, '');
}

export function formatLocalizedWikipediaCitations(meta: CitationInputMetadata): LocalizedCitations {
  const accessDate = meta.accessDate || new Date().toISOString().slice(0, 10);
  const title = escapeWikiParam(meta.title);
  const authorStr = escapeWikiParam(meta.authors.join(', '));
  const venue = escapeWikiParam(meta.publicationVenue);
  const year = meta.publicationYear ? String(meta.publicationYear) : '';
  const doi = escapeWikiParam(meta.doi);
  const isbn = escapeWikiParam(meta.isbn);
  const effectiveUrl = escapeWikiParam(
    meta.archiveUrl || meta.sourceUrl || (doi ? `https://doi.org/${doi}` : '')
  );

  const refName = buildRefTagName(meta.authors, meta.publicationYear, meta.doi);
  const isBookLike = meta.sourceType === 'book' || (Boolean(isbn) && !doi);
  const isJournalLike =
    meta.sourceType === 'journal' ||
    meta.sourceType === 'conference' ||
    meta.sourceType === 'dissertation' ||
    Boolean(doi);

  // 1. Finnish Wikipedia (fi): {{Kirjaviite}}, {{Lehtiviite}}, {{Verkkoviite}}
  let fiInner: string;
  if (isBookLike) {
    const parts = [
      'Kirjaviite',
      authorStr ? `Tekijä = ${authorStr}` : '',
      `Nimeke = ${title}`,
      venue ? `Julkaisija = ${venue}` : '',
      year ? `Vuosi = ${year}` : '',
      isbn ? `Isbn = ${isbn}` : '',
      effectiveUrl ? `Osoite = ${effectiveUrl}` : '',
      `Viitattu = ${accessDate}`,
    ].filter(Boolean);
    fiInner = `{{${parts.join(' | ')}}}`;
  } else if (isJournalLike) {
    const parts = [
      'Lehtiviite',
      authorStr ? `Tekijä = ${authorStr}` : '',
      `Otsikko = ${title}`,
      venue ? `Julkaisu = ${venue}` : '',
      year ? `Vuosi = ${year}` : '',
      doi ? `Doi = ${doi}` : '',
      effectiveUrl ? `Osoite = ${effectiveUrl}` : '',
      `Viitattu = ${accessDate}`,
    ].filter(Boolean);
    fiInner = `{{${parts.join(' | ')}}}`;
  } else {
    const parts = [
      'Verkkoviite',
      effectiveUrl ? `Osoite = ${effectiveUrl}` : '',
      `Nimeke = ${title}`,
      authorStr ? `Tekijä = ${authorStr}` : '',
      venue ? `Julkaisija = ${venue}` : '',
      year ? `Ajankohta = ${year}` : '',
      `Viitattu = ${accessDate}`,
    ].filter(Boolean);
    fiInner = `{{${parts.join(' | ')}}}`;
  }

  // 2. Swedish Wikipedia (sv): {{Bokref}}, {{Tidskriftsref}}, {{Webbref}}
  let svInner: string;
  if (isBookLike) {
    const parts = [
      'Bokref',
      authorStr ? `författare = ${authorStr}` : '',
      `titel = ${title}`,
      venue ? `utgivare = ${venue}` : '',
      year ? `år = ${year}` : '',
      isbn ? `isbn = ${isbn}` : '',
      effectiveUrl ? `url = ${effectiveUrl}` : '',
      `hämtdatum = ${accessDate}`,
    ].filter(Boolean);
    svInner = `{{${parts.join(' | ')}}}`;
  } else if (isJournalLike) {
    const parts = [
      'Tidskriftsref',
      authorStr ? `författare = ${authorStr}` : '',
      `titel = ${title}`,
      venue ? `tidskrift = ${venue}` : '',
      year ? `år = ${year}` : '',
      doi ? `doi = ${doi}` : '',
      effectiveUrl ? `url = ${effectiveUrl}` : '',
      `hämtdatum = ${accessDate}`,
    ].filter(Boolean);
    svInner = `{{${parts.join(' | ')}}}`;
  } else {
    const parts = [
      'Webbref',
      effectiveUrl ? `url = ${effectiveUrl}` : '',
      `titel = ${title}`,
      authorStr ? `författare = ${authorStr}` : '',
      venue ? `utgivare = ${venue}` : '',
      year ? `datum = ${year}` : '',
      `hämtdatum = ${accessDate}`,
    ].filter(Boolean);
    svInner = `{{${parts.join(' | ')}}}`;
  }

  // 3. Russian Wikipedia (ru): {{Книга}}, {{Статья}}, {{Cite web}}
  let ruInner: string;
  if (isBookLike) {
    const parts = [
      'Книга',
      authorStr ? `автор = ${authorStr}` : '',
      `заглавие = ${title}`,
      venue ? `издательство = ${venue}` : '',
      year ? `год = ${year}` : '',
      isbn ? `isbn = ${isbn}` : '',
      effectiveUrl ? `ссылка = ${effectiveUrl}` : '',
    ].filter(Boolean);
    ruInner = `{{${parts.join(' | ')}}}`;
  } else if (isJournalLike) {
    const parts = [
      'Статья',
      authorStr ? `автор = ${authorStr}` : '',
      `заглавие = ${title}`,
      venue ? `издание = ${venue}` : '',
      year ? `год = ${year}` : '',
      doi ? `doi = ${doi}` : '',
      effectiveUrl ? `ссылка = ${effectiveUrl}` : '',
      `дата обращения = ${accessDate}`,
    ].filter(Boolean);
    ruInner = `{{${parts.join(' | ')}}}`;
  } else {
    const parts = [
      'Cite web',
      effectiveUrl ? `url = ${effectiveUrl}` : '',
      `title = ${title}`,
      authorStr ? `author = ${authorStr}` : '',
      venue ? `publisher = ${venue}` : '',
      year ? `date = ${year}` : '',
      `access-date = ${accessDate}`,
    ].filter(Boolean);
    ruInner = `{{${parts.join(' | ')}}}`;
  }

  // 4. Standard English / International Wikipedia: {{Cite book}}, {{Cite journal}}, {{Cite web}}
  let enInner: string;
  if (isBookLike) {
    const parts = [
      'Cite book',
      authorStr ? `author = ${authorStr}` : '',
      `title = ${title}`,
      venue ? `publisher = ${venue}` : '',
      year ? `year = ${year}` : '',
      isbn ? `isbn = ${isbn}` : '',
      effectiveUrl ? `url = ${effectiveUrl}` : '',
      `access-date = ${accessDate}`,
    ].filter(Boolean);
    enInner = `{{${parts.join(' | ')}}}`;
  } else if (isJournalLike) {
    const parts = [
      'Cite journal',
      authorStr ? `author = ${authorStr}` : '',
      `title = ${title}`,
      venue ? `journal = ${venue}` : '',
      year ? `year = ${year}` : '',
      doi ? `doi = ${doi}` : '',
      effectiveUrl ? `url = ${effectiveUrl}` : '',
      `access-date = ${accessDate}`,
    ].filter(Boolean);
    enInner = `{{${parts.join(' | ')}}}`;
  } else {
    const parts = [
      'Cite web',
      effectiveUrl ? `url = ${effectiveUrl}` : '',
      `title = ${title}`,
      authorStr ? `author = ${authorStr}` : '',
      venue ? `publisher = ${venue}` : '',
      year ? `date = ${year}` : '',
      `access-date = ${accessDate}`,
    ].filter(Boolean);
    enInner = `{{${parts.join(' | ')}}}`;
  }

  return {
    fi: `<ref name="${refName}">${fiInner}</ref>`,
    sv: `<ref name="${refName}">${svInner}</ref>`,
    ru: `<ref name="${refName}">${ruInner}</ref>`,
    en: `<ref name="${refName}">${enInner}</ref>`,
  };
}
