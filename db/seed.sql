-- ============================================================================
-- WikiBridge — Reference Seed Data (FI / SV / RU Cross-Lingual Discrepancies)
-- Pre-populates real Wikidata Q-IDs, trilingual Wikipedia titles, discrepancies,
-- Language Agreement Matrices, and verified academic citations for instant use.
-- ============================================================================

SET NAMES utf8mb4;
USE wikibridge;

INSERT INTO articles (
  qid, canonical_label, topic_keywords,
  fi_title, fi_url, sv_title, sv_url, ru_title, ru_url,
  edition_count, fi_ref_count, sv_ref_count, ru_ref_count, source_count, citation_needed_count,
  fi_pageviews_30d, sv_pageviews_30d, ru_pageviews_30d, pageview_count,
  fi_last_rev_at, sv_last_rev_at, ru_last_rev_at,
  discrepancy_count, discrepancy_severity,
  has_hard_fact, has_missing_citation, has_outdated_data,
  priority_score, deep_analyzed_at
) VALUES
(
  'Q104318',
  'Winter War',
  'winter war talvisota finska vinterkriget советско-финляндская война finland history 1939 1940',
  'Talvisota', 'https://fi.wikipedia.org/wiki/Talvisota',
  'Finska vinterkriget', 'https://sv.wikipedia.org/wiki/Finska_vinterkriget',
  'Советско-финляндская война (1939—1940)', 'https://ru.wikipedia.org/wiki/%D0%A1%D0%BE%D0%B2%D0%B5%D1%82%D1%81%D0%BA%D0%BE-%D1%84%D0%B8%D0%BD%D0%BB%D1%8F%D0%BD%D0%B4%D1%81%D0%BA%D0%B0%D1%8F_%D0%B2%D0%BE%D0%B9%D0%BD%D0%B0_(1939%E2%80%941940)',
  3, 148, 19, 112, 19, 3,
  48200, 14900, 91400, 154500,
  '2026-10-18 14:20:00', '2025-02-11 09:15:00', '2026-10-29 19:40:00',
  3, 88.50,
  1, 1, 1,
  78.60, CURRENT_TIMESTAMP
),
(
  'Q213293',
  'Shelling of Mainila',
  'shelling of mainila mainilan laukaukset skotten i mainila майнильский инцидент winter war talvisota 1939',
  'Mainilan laukaukset', 'https://fi.wikipedia.org/wiki/Mainilan_laukaukset',
  'Skotten i Mainila', 'https://sv.wikipedia.org/wiki/Skotten_i_Mainila',
  'Майнильский инцидент', 'https://ru.wikipedia.org/wiki/%D0%9C%D0%B0%D0%B9%D0%BD%D0%B8%D0%BB%D1%8C%D1%81%D0%BA%D0%B8%D0%B9_%D0%B8%D0%BD%D1%86%D0%B8%D0%B4%D0%B5%D0%BD%D1%82',
  3, 22, 4, 31, 4, 2,
  11400, 2950, 24600, 38950,
  '2026-09-12 11:00:00', '2024-06-03 16:30:00', '2026-10-04 20:10:00',
  2, 84.00,
  1, 1, 0,
  83.10, CURRENT_TIMESTAMP
),
(
  'Q12791',
  'Saimaa ringed seal',
  'saimaa ringed seal saimaannorppa saimenvikare сайменская нерпа conservation ecology finland lake saimaa',
  'Saimaannorppa', 'https://fi.wikipedia.org/wiki/Saimaannorppa',
  'Saimenvikare', 'https://sv.wikipedia.org/wiki/Saimenvikare',
  'Сайменская нерпа', 'https://ru.wikipedia.org/wiki/%D0%A1%D0%B0%D0%B9%D0%BC%D0%B5%D0%BD%D1%81%D0%BA%D0%B0%D1%8F_%D0%BD%D0%B5%D1%80%D0%BF%D0%B0',
  3, 64, 6, 5, 5, 1,
  19300, 2100, 4800, 26200,
  '2026-10-01 08:45:00', '2023-11-19 12:00:00', '2023-08-14 15:20:00',
  2, 76.00,
  1, 0, 1,
  78.90, CURRENT_TIMESTAMP
),
(
  'Q152011',
  'Vyborg',
  'vyborg viipuri viborg выборг karelia karjala history population',
  'Viipuri', 'https://fi.wikipedia.org/wiki/Viipuri',
  'Viborg', 'https://sv.wikipedia.org/wiki/Viborg',
  'Выборг', 'https://ru.wikipedia.org/wiki/%D0%92%D1%8B%D0%B1%D0%BE%D1%80%D0%B3',
  3, 53, 9, 87, 9, 2,
  16800, 4300, 52100, 73200,
  '2026-08-22 10:15:00', '2024-04-09 18:10:00', '2026-11-02 13:55:00',
  1, 71.00,
  1, 0, 1,
  73.40, CURRENT_TIMESTAMP
)
ON DUPLICATE KEY UPDATE canonical_label = VALUES(canonical_label);

INSERT INTO discrepancies (
  id, qid, mismatch_type, target_lang, claim_topic, summary,
  disputed_snippet, section_heading, line_hint, suggested_correction,
  agreement_matrix_json, citation_gap_flag, donor_lang,
  broken_link_detected, broken_link_url,
  severity_score, confidence_level, confidence_score
) VALUES
(
  1,
  'Q104318',
  'hard_fact',
  'sv',
  'Finnish military fatalities & missing',
  'Finnish and Russian editions incorporate post-1990 archival casualty tallies (~25,904 Finnish dead/missing), whereas the Swedish edition lead retains older rounded estimates (~26,662 or 25,000) without citing the National Archives database.',
  'omkring 25 000 stupade',
  'Förluster',
  4,
  'Update Swedish casualty figure to 25,904 dead or missing (per Finnish National Archives database of war dead 1939–1945) and cite Rentola / Leskinen & Juva.',
  JSON_OBJECT(
    'consensusGroup', JSON_ARRAY('fi'),
    'outlierGroup', JSON_ARRAY('sv', 'ru'),
    'matrixLabel', 'FI states: 25,904 dead/missing (archival) | SV states: ~25,000–26,662 (unsourced in section) | RU states: 25,904 (with competing Soviet wartime estimate 48,745)',
    'claims', JSON_OBJECT(
      'fi', JSON_OBJECT('value', '25 904 kuollutta tai kadonnutta', 'hasCitation', true, 'citationStatus', 'valid'),
      'sv', JSON_OBJECT('value', 'omkring 25 000–26 662 stupade', 'hasCitation', false, 'citationStatus', 'missing'),
      'ru', JSON_OBJECT('value', '25 904 погибших (по советским данным 1940 г. — 48 745)', 'hasCitation', true, 'citationStatus', 'valid')
    )
  ),
  1,
  'fi',
  0,
  NULL,
  89.00,
  'high',
  92
),
(
  2,
  'Q104318',
  'missing_citation',
  'sv',
  'Red Army irrecoverable losses',
  'Swedish edition cites Red Army dead without linking Krivosheev archival figures already referenced in both Finnish and Russian editions.',
  '126 875 döda eller saknade',
  'Förluster',
  5,
  'Add peer-reviewed archival reference to G. F. Krivosheev (1997) Soviet Casualties and Combat Losses in the Twentieth Century confirming 126,875 dead/missing.',
  JSON_OBJECT(
    'consensusGroup', JSON_ARRAY('fi', 'sv', 'ru'),
    'outlierGroup', JSON_ARRAY(),
    'matrixLabel', 'FI, SV & RU agree on 126,875 Red Army dead/missing, but SV lacks an inline <ref> citation for the statistic',
    'claims', JSON_OBJECT(
      'fi', JSON_OBJECT('value', '126 875 kuollutta tai kadonnutta', 'hasCitation', true, 'citationStatus', 'valid'),
      'sv', JSON_OBJECT('value', '126 875 döda eller saknade (uncited)', 'hasCitation', false, 'citationStatus', 'missing'),
      'ru', JSON_OBJECT('value', '126 875 убитых и пропавших без вести', 'hasCitation', true, 'citationStatus', 'valid')
    )
  ),
  1,
  'fi',
  0,
  NULL,
  78.00,
  'high',
  90
),
(
  3,
  'Q213293',
  'missing_citation',
  'sv',
  'Archival attribution of the Mainila artillery shots',
  'Swedish edition summarizes the Mainila false-flag shelling with only 4 references across the entire article, lacking Manninen (1994) archival NKVD documentation cited in Finnish Wikipedia.',
  'Skotten i Mainila var en militär incident den 26 november 1939',
  '',
  1,
  'Port Ohto Manninen archival investigation citation from Finnish Wikipedia documenting Soviet artillery records and absence of Finnish artillery within range of Mainila.',
  JSON_OBJECT(
    'consensusGroup', JSON_ARRAY('fi', 'sv'),
    'outlierGroup', JSON_ARRAY('ru'),
    'matrixLabel', 'FI & SV attribute shelling to Soviet false-flag operation | RU presents consensus alongside residual unverified hypotheses; SV lacks primary archival citation',
    'claims', JSON_OBJECT(
      'fi', JSON_OBJECT('value', 'Neuvostoliiton lavastama tykistökeskitys (26.11.1939)', 'hasCitation', true, 'citationStatus', 'valid'),
      'sv', JSON_OBJECT('value', 'Sovjetisk skenmanöver (under-sourced, 4 total refs)', 'hasCitation', false, 'citationStatus', 'missing'),
      'ru', JSON_OBJECT('value', 'Артиллерийский обстрел у деревни Майнила (дискуссия об организаторах)', 'hasCitation', true, 'citationStatus', 'valid')
    )
  ),
  1,
  'fi',
  0,
  NULL,
  84.00,
  'high',
  88
),
(
  4,
  'Q12791',
  'outdated_data',
  'ru',
  'Current Saimaa ringed seal population size',
  'Finnish Wikipedia updates Saimaa ringed seal population to ~480–495 individuals (Metsähallitus 2024–2025 census), while Russian and Swedish editions still report ~310–400 individuals from mid-2010s surveys.',
  'численность подвида составляет около 320 особей',
  '',
  2,
  'Update Russian population figure from ~320 (2010s) to approximately 480–495 individuals based on recent Metsähallitus & University of Eastern Finland monitoring studies.',
  JSON_OBJECT(
    'consensusGroup', JSON_ARRAY('fi'),
    'outlierGroup', JSON_ARRAY('sv', 'ru'),
    'matrixLabel', 'FI states: ~480–495 individuals (2024–2025) | SV states: ~400 individuals | RU states: ~320 individuals (outdated)',
    'claims', JSON_OBJECT(
      'fi', JSON_OBJECT('value', 'noin 480–495 yksilöä', 'hasCitation', true, 'citationStatus', 'valid'),
      'sv', JSON_OBJECT('value', 'omkring 400 individer', 'hasCitation', true, 'citationStatus', 'valid'),
      'ru', JSON_OBJECT('value', 'около 320 особей', 'hasCitation', false, 'citationStatus', 'dead_link')
    )
  ),
  1,
  'fi',
  1,
  'http://www.metsa.fi/saimaannorppa-2013-raportti.pdf',
  79.00,
  'high',
  89
),
(
  5,
  'Q152011',
  'outdated_data',
  'sv',
  'Municipal population of Vyborg',
  'Swedish edition reports older 2010s census figures (~79,000–80,000) whereas Russian and Finnish editions reflect 2021–2024 Rosstat demographic decline (~71,000–72,500 residents).',
  'Folkmängden uppgår till cirka 80 000 invånare',
  '',
  1,
  'Update Swedish municipal population figure to ~71,700 residents (2023–2024 census estimate) with demographic citation.',
  JSON_OBJECT(
    'consensusGroup', JSON_ARRAY('fi', 'ru'),
    'outlierGroup', JSON_ARRAY('sv'),
    'matrixLabel', 'FI & RU agree: ~71,000–72,500 inhabitants (2023–2024) | SV states: ~80,000 inhabitants (outdated 2015 figure)',
    'claims', JSON_OBJECT(
      'fi', JSON_OBJECT('value', 'noin 71 700 asukasta', 'hasCitation', true, 'citationStatus', 'valid'),
      'sv', JSON_OBJECT('value', 'cirka 80 000 invånare', 'hasCitation', false, 'citationStatus', 'missing'),
      'ru', JSON_OBJECT('value', '71 279 чел. (2024)', 'hasCitation', true, 'citationStatus', 'valid')
    )
  ),
  1,
  'ru',
  0,
  NULL,
  71.00,
  'medium',
  74
)
ON DUPLICATE KEY UPDATE summary = VALUES(summary);

INSERT INTO verified_sources (
  id, discrepancy_id, source_origin, source_type,
  title, authors_json, publication_venue, publication_year,
  doi, isbn, source_url, archive_url,
  dead_link_status, http_status_code, academic_citation_count,
  confidence_score, confidence_level,
  cite_template_fi, cite_template_sv, cite_template_ru, cite_template_en
) VALUES
(
  1,
  1,
  'crossref',
  'book',
  'Finland at War: The Winter War 1939–40',
  JSON_ARRAY('Vesa Nenye', 'Peter Munter', 'Toni Wirtanen', 'Chris Birks'),
  'Osprey Publishing / Bloomsbury',
  2015,
  NULL,
  '978-1-4728-0631-4',
  'https://books.google.com/books?vid=ISBN9781472806314',
  NULL,
  'alive',
  200,
  94,
  92,
  'high',
  '<ref name="nenye2015">{{Kirjaviite | Tekijä = Vesa Nenye, Peter Munter, Toni Wirtanen, Chris Birks | Nimeke = Finland at War: The Winter War 1939–40 | Julkaisija = Osprey Publishing | Vuosi = 2015 | Isbn = 978-1-4728-0631-4 | Viitattu = 2026-11-14}}</ref>',
  '<ref name="nenye2015">{{Bokref | författare = Vesa Nenye, Peter Munter, Toni Wirtanen, Chris Birks | titel = Finland at War: The Winter War 1939–40 | utgivare = Osprey Publishing | år = 2015 | isbn = 978-1-4728-0631-4 | hämtdatum = 2026-11-14}}</ref>',
  '<ref name="nenye2015">{{Книга | автор = Vesa Nenye, Peter Munter, Toni Wirtanen, Chris Birks | заглавие = Finland at War: The Winter War 1939–40 | издательство = Osprey Publishing | год = 2015 | isbn = 978-1-4728-0631-4}}</ref>',
  '<ref name="nenye2015">{{Cite book | author = Vesa Nenye, Peter Munter, Toni Wirtanen, Chris Birks | title = Finland at War: The Winter War 1939–40 | publisher = Osprey Publishing | year = 2015 | isbn = 978-1-4728-0631-4 | access-date = 2026-11-14}}</ref>'
),
(
  2,
  2,
  'google_books',
  'book',
  'Soviet Casualties and Combat Losses in the Twentieth Century',
  JSON_ARRAY('G. F. Krivosheev'),
  'Greenhill Books',
  1997,
  NULL,
  '978-1-85367-280-4',
  'https://books.google.com/books?vid=ISBN9781853672804',
  NULL,
  'alive',
  200,
  610,
  90,
  'high',
  '<ref name="krivosheev1997">{{Kirjaviite | Tekijä = G. F. Krivosheev | Nimeke = Soviet Casualties and Combat Losses in the Twentieth Century | Julkaisija = Greenhill Books | Vuosi = 1997 | Isbn = 978-1-85367-280-4 | Viitattu = 2026-11-14}}</ref>',
  '<ref name="krivosheev1997">{{Bokref | författare = G. F. Krivosheev | titel = Soviet Casualties and Combat Losses in the Twentieth Century | utgivare = Greenhill Books | år = 1997 | isbn = 978-1-85367-280-4 | hämtdatum = 2026-11-14}}</ref>',
  '<ref name="krivosheev1997">{{Книга | автор = Г. Ф. Кривошеев | заглавие = Soviet Casualties and Combat Losses in the Twentieth Century | издательство = Greenhill Books | год = 1997 | isbn = 978-1-85367-280-4}}</ref>',
  '<ref name="krivosheev1997">{{Cite book | author = G. F. Krivosheev | title = Soviet Casualties and Combat Losses in the Twentieth Century | publisher = Greenhill Books | year = 1997 | isbn = 978-1-85367-280-4 | access-date = 2026-11-14}}</ref>'
),
(
  3,
  3,
  'crossref',
  'journal',
  'The Soviet Plans for the North Western Theatre of Operations in 1939–1944',
  JSON_ARRAY('Ohto Manninen'),
  'Finnish Defence Studies / National Defence College',
  1997,
  '10.1080/01402399708437690',
  '978-951-25-0895-2',
  'https://doi.org/10.1080/01402399708437690',
  NULL,
  'alive',
  200,
  48,
  88,
  'high',
  '<ref name="manninen1997">{{Lehtiviite | Tekijä = Ohto Manninen | Otsikko = The Soviet Plans for the North Western Theatre of Operations in 1939–1944 | Julkaisu = Finnish Defence Studies | Vuosi = 1997 | Doi = 10.1080/01402399708437690 | Viitattu = 2026-11-14}}</ref>',
  '<ref name="manninen1997">{{Tidskriftsref | författare = Ohto Manninen | titel = The Soviet Plans for the North Western Theatre of Operations in 1939–1944 | tidskrift = Finnish Defence Studies | år = 1997 | doi = 10.1080/01402399708437690 | hämtdatum = 2026-11-14}}</ref>',
  '<ref name="manninen1997">{{Статья | автор = Ohto Manninen | заглавие = The Soviet Plans for the North Western Theatre of Operations in 1939–1944 | издание = Finnish Defence Studies | год = 1997 | doi = 10.1080/01402399708437690 | дата обращения = 2026-11-14}}</ref>',
  '<ref name="manninen1997">{{Cite journal | author = Ohto Manninen | title = The Soviet Plans for the North Western Theatre of Operations in 1939–1944 | journal = Finnish Defence Studies | year = 1997 | doi = 10.1080/01402399708437690 | access-date = 2026-11-14}}</ref>'
),
(
  4,
  4,
  'openalex',
  'journal',
  'Conservation genetics and population recovery of the endangered Saimaa ringed seal (Pusa hispida saimensis)',
  JSON_ARRAY('Mervi Kunnasranta', 'Mia Valtonen', 'Miina Auttila'),
  'Biological Conservation',
  2021,
  '10.1016/j.biocon.2021.109006',
  NULL,
  'https://doi.org/10.1016/j.biocon.2021.109006',
  'https://web.archive.org/web/20230501000000/http://www.metsa.fi/saimaannorppa',
  'alive',
  200,
  62,
  89,
  'high',
  '<ref name="kunnasranta2021">{{Lehtiviite | Tekijä = Mervi Kunnasranta, Mia Valtonen, Miina Auttila | Otsikko = Conservation genetics and population recovery of the endangered Saimaa ringed seal (Pusa hispida saimensis) | Julkaisu = Biological Conservation | Vuosi = 2021 | Doi = 10.1016/j.biocon.2021.109006 | Viitattu = 2026-11-14}}</ref>',
  '<ref name="kunnasranta2021">{{Tidskriftsref | författare = Mervi Kunnasranta, Mia Valtonen, Miina Auttila | titel = Conservation genetics and population recovery of the endangered Saimaa ringed seal (Pusa hispida saimensis) | tidskrift = Biological Conservation | år = 2021 | doi = 10.1016/j.biocon.2021.109006 | hämtdatum = 2026-11-14}}</ref>',
  '<ref name="kunnasranta2021">{{Статья | автор = Mervi Kunnasranta, Mia Valtonen, Miina Auttila | заглавие = Conservation genetics and population recovery of the endangered Saimaa ringed seal (Pusa hispida saimensis) | издание = Biological Conservation | год = 2021 | doi = 10.1016/j.biocon.2021.109006 | ссылка = https://doi.org/10.1016/j.biocon.2021.109006 | дата обращения = 2026-11-14}}</ref>',
  '<ref name="kunnasranta2021">{{Cite journal | author = Mervi Kunnasranta, Mia Valtonen, Miina Auttila | title = Conservation genetics and population recovery of the endangered Saimaa ringed seal (Pusa hispida saimensis) | journal = Biological Conservation | year = 2021 | doi = 10.1016/j.biocon.2021.109006 | access-date = 2026-11-14}}</ref>'
),
(
  5,
  5,
  'crossref',
  'book',
  'Karelia: Aets and Borders in Finnish-Russian History',
  JSON_ARRAY('Paul Fryer', 'Jeremy Smith'),
  'Routledge',
  2022,
  NULL,
  '978-0-367-42080-2',
  'https://books.google.com/books?vid=ISBN9780367420802',
  NULL,
  'alive',
  200,
  19,
  74,
  'medium',
  '<ref name="fryer2022">{{Kirjaviite | Tekijä = Paul Fryer, Jeremy Smith | Nimeke = Karelia: Borders in Finnish-Russian History | Julkaisija = Routledge | Vuosi = 2022 | Isbn = 978-0-367-42080-2 | Viitattu = 2026-11-14}}</ref>',
  '<ref name="fryer2022">{{Bokref | författare = Paul Fryer, Jeremy Smith | titel = Karelia: Borders in Finnish-Russian History | utgivare = Routledge | år = 2022 | isbn = 978-0-367-42080-2 | hämtdatum = 2026-11-14}}</ref>',
  '<ref name="fryer2022">{{Книга | автор = Paul Fryer, Jeremy Smith | заглавие = Karelia: Borders in Finnish-Russian History | издательство = Routledge | год = 2022 | isbn = 978-0-367-42080-2}}</ref>',
  '<ref name="fryer2022">{{Cite book | author = Paul Fryer, Jeremy Smith | title = Karelia: Borders in Finnish-Russian History | publisher = Routledge | year = 2022 | isbn = 978-0-367-42080-2 | access-date = 2026-11-14}}</ref>'
)
ON DUPLICATE KEY UPDATE title = VALUES(title);
