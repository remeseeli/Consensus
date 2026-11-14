import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLocalizedWikipediaCitations } from './citationFormatter.js';

test('formats localized journal citations with DOI for fi, sv, ru, and en', () => {
  const result = formatLocalizedWikipediaCitations({
    title: 'Cross-lingual Wikipedia Consistency',
    authors: ['Jane Doe', 'John Smith'],
    publicationVenue: 'Journal of Open Knowledge',
    publicationYear: 2025,
    doi: '10.1000/jok.2025.01',
    sourceType: 'journal',
    accessDate: '2026-11-14',
  });

  assert.match(result.fi, /\{\{Lehtiviite \|/);
  assert.match(result.fi, /Doi = 10\.1000\/jok\.2025\.01/);
  assert.match(result.sv, /\{\{Tidskriftsref \|/);
  assert.match(result.ru, /\{\{Статья \|/);
  assert.match(result.en, /\{\{Cite journal \|/);
  assert.match(result.en, /<ref name="doe2025">/);
});

test('formats localized book citations with ISBN and escapes pipes/braces', () => {
  const result = formatLocalizedWikipediaCitations({
    title: 'Nordic History | Part {{One}}',
    authors: ['Aino Virtanen'],
    publicationVenue: 'Helsinki Press',
    publicationYear: 2020,
    isbn: '978-951-0-00000-1',
    sourceType: 'book',
    accessDate: '2026-11-14',
  });

  assert.match(result.fi, /\{\{Kirjaviite \|/);
  assert.match(result.fi, /Nordic History – Part \(One\)/);
  assert.match(result.sv, /\{\{Bokref \|/);
  assert.match(result.ru, /\{\{Книга \|/);
  assert.match(result.en, /\{\{Cite book \|/);
});
