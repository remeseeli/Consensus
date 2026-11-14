/**
 * Built-in offline fallback dataset covering FI, SV, RU, EN, ET, and ES Wikipedia
 * so the extension UI and Wikipedia DOM highlighting work immediately even when offline.
 */
export const OFFLINE_ARTICLES = [
  {
    qid: 'Q104318',
    canonicalLabel: 'Winter War',
    topicKeywords: 'winter war talvisota finska vinterkriget talvesõda guerra de invierno finland 1939 1940',
    editions: {
      fi: {
        title: 'Talvisota',
        url: 'https://fi.wikipedia.org/wiki/Talvisota',
        refCount: 148,
        lastRevAt: '2026-10-18T14:20:00Z',
      },
      sv: {
        title: 'Finska vinterkriget',
        url: 'https://sv.wikipedia.org/wiki/Finska_vinterkriget',
        refCount: 19,
        lastRevAt: '2025-02-11T09:15:00Z',
      },
      ru: {
        title: 'Советско-финляндская война (1939—1940)',
        url: 'https://ru.wikipedia.org/wiki/%D0%A1%D0%BE%D0%B2%D0%B5%D1%82%D1%81%D0%BA%D0%BE-%D1%84%D0%B8%D0%BD%D0%BB%D1%8F%D0%BD%D0%B4%D1%81%D0%BA%D0%B0%D1%8F_%D0%B2%D0%BE%D0%B9%D0%BD%D0%B0_(1939%E2%80%941940)',
        refCount: 112,
        lastRevAt: '2026-10-29T19:40:00Z',
      },
      en: {
        title: 'Winter War',
        url: 'https://en.wikipedia.org/wiki/Winter_War',
        refCount: 186,
        lastRevAt: '2026-11-02T12:10:00Z',
      },
      et: {
        title: 'Talvesõda',
        url: 'https://et.wikipedia.org/wiki/Talves%C3%B5da',
        refCount: 14,
        lastRevAt: '2025-07-15T10:00:00Z',
      },
      es: {
        title: 'Guerra de Invierno',
        url: 'https://es.wikipedia.org/wiki/Guerra_de_Invierno',
        refCount: 41,
        lastRevAt: '2026-08-22T18:05:00Z',
      },
      zh: {
        title: '冬季战争',
        url: 'https://zh.wikipedia.org/wiki/%E5%86%AC%E5%AD%A3%E6%88%98%E4%BA%89',
        refCount: 52,
        lastRevAt: '2026-09-10T10:15:00Z',
      },
      pl: {
        title: 'Wojna zimowa',
        url: 'https://pl.wikipedia.org/wiki/Wojna_zimowa',
        refCount: 68,
        lastRevAt: '2026-10-05T13:20:00Z',
      },
      hu: {
        title: 'Téli háború',
        url: 'https://hu.wikipedia.org/wiki/T%C3%A9li_h%C3%A1bor%C3%BA',
        refCount: 29,
        lastRevAt: '2026-06-18T12:00:00Z',
      },
    },
    editionCount: 9,
    sourceCount: 14,
    discrepancyCount: 2,
    discrepancySeverity: 89,
    issueBadges: [
      'Different information',
      'Much fewer references (ET: 14 vs EN: 186)',
    ],
    mismatchFlags: {
      hardFact: true,
      missingCitation: true,
      outdatedData: false,
      neutralityBias: false,
    },
    priorityScore: 86.4,
  },
  {
    qid: 'Q213293',
    canonicalLabel: 'Shelling of Mainila',
    topicKeywords: 'shelling of mainila mainilan laukaukset skotten i mainila mainila lasud incidente de mainila 1939',
    editions: {
      fi: {
        title: 'Mainilan laukaukset',
        url: 'https://fi.wikipedia.org/wiki/Mainilan_laukaukset',
        refCount: 22,
        lastRevAt: '2026-09-12T11:00:00Z',
      },
      sv: {
        title: 'Skotten i Mainila',
        url: 'https://sv.wikipedia.org/wiki/Skotten_i_Mainila',
        refCount: 4,
        lastRevAt: '2024-06-03T16:30:00Z',
      },
      ru: {
        title: 'Майнильский инцидент',
        url: 'https://ru.wikipedia.org/wiki/%D0%9C%D0%B0%D0%B9%D0%BD%D0%B8%D0%BB%D1%8C%D1%81%D0%BA%D0%B8%D0%B9_%D0%B8%D0%BD%D1%86%D0%B8%D0%B4%D0%B5%D0%BD%D1%82',
        refCount: 31,
        lastRevAt: '2026-10-04T20:10:00Z',
      },
      en: {
        title: 'Shelling of Mainila',
        url: 'https://en.wikipedia.org/wiki/Shelling_of_Mainila',
        refCount: 28,
        lastRevAt: '2026-10-10T09:00:00Z',
      },
      et: {
        title: 'Mainila lasud',
        url: 'https://et.wikipedia.org/wiki/Mainila_lasud',
        refCount: 6,
        lastRevAt: '2024-11-20T14:15:00Z',
      },
      es: {
        title: 'Incidente de Mainila',
        url: 'https://es.wikipedia.org/wiki/Incidente_de_Mainila',
        refCount: 8,
        lastRevAt: '2025-05-01T11:40:00Z',
      },
      zh: {
        title: '迈尼拉炮击事件',
        url: 'https://zh.wikipedia.org/wiki/%E8%BF%88%E5%B0%BC%E6%8B%89%E7%82%AE%E5%87%BB%E4%BA%8B%E4%BB%B6',
        refCount: 15,
        lastRevAt: '2025-11-12T08:30:00Z',
      },
      pl: {
        title: 'Incydent w Mainili',
        url: 'https://pl.wikipedia.org/wiki/Incydent_w_Mainili',
        refCount: 18,
        lastRevAt: '2026-03-14T11:10:00Z',
      },
      hu: {
        title: 'Mainilai incidens',
        url: 'https://hu.wikipedia.org/wiki/Mainilai_incidens',
        refCount: 9,
        lastRevAt: '2025-09-02T10:15:00Z',
      },
    },
    editionCount: 9,
    sourceCount: 4,
    discrepancyCount: 3,
    discrepancySeverity: 84,
    issueBadges: [
      'Much fewer references (SV: 4 vs RU: 31)',
      'Different information',
      'Not neutral (RU)',
    ],
    mismatchFlags: {
      hardFact: true,
      missingCitation: true,
      outdatedData: false,
      neutralityBias: true,
    },
    priorityScore: 84.1,
  },
  {
    qid: 'Q12791',
    canonicalLabel: 'Saimaa ringed seal',
    topicKeywords: 'saimaa ringed seal saimaannorppa saimenvikare saimaa viigerhüljes foca anillada del saimaa',
    editions: {
      fi: {
        title: 'Saimaannorppa',
        url: 'https://fi.wikipedia.org/wiki/Saimaannorppa',
        refCount: 64,
        lastRevAt: '2026-10-01T08:45:00Z',
      },
      sv: {
        title: 'Saimenvikare',
        url: 'https://sv.wikipedia.org/wiki/Saimenvikare',
        refCount: 6,
        lastRevAt: '2023-11-19T12:00:00Z',
      },
      ru: {
        title: 'Сайменская нерпа',
        url: 'https://ru.wikipedia.org/wiki/%D0%A1%D0%B0%D0%B9%D0%BC%D0%B5%D0%BD%D1%81%D0%BA%D0%B0%D1%8F_%D0%BD%D0%B5%D1%80%D0%BF%D0%B0',
        refCount: 5,
        lastRevAt: '2023-08-14T15:20:00Z',
      },
      en: {
        title: 'Saimaa ringed seal',
        url: 'https://en.wikipedia.org/wiki/Saimaa_ringed_seal',
        refCount: 34,
        lastRevAt: '2026-06-14T13:00:00Z',
      },
      et: {
        title: 'Saimaa viigerhüljes',
        url: 'https://et.wikipedia.org/wiki/Saimaa_viigerh%C3%BCljes',
        refCount: 3,
        lastRevAt: '2023-04-02T09:10:00Z',
      },
      es: {
        title: 'Foca anillada del Saimaa',
        url: 'https://es.wikipedia.org/wiki/Foca_anillada_del_Saimaa',
        refCount: 4,
        lastRevAt: '2024-02-18T16:45:00Z',
      },
      zh: {
        title: '塞马环斑海豹',
        url: 'https://zh.wikipedia.org/wiki/%E5%A1%9E%E9%A9%AC%E7%8E%AF%E6%96%91%E6%B5%B7%E8%B1%B9',
        refCount: 9,
        lastRevAt: '2025-01-20T14:00:00Z',
      },
      pl: {
        title: 'Nerpa saimaańska',
        url: 'https://pl.wikipedia.org/wiki/Nerpa_saimaa%C5%84ska',
        refCount: 7,
        lastRevAt: '2025-06-11T09:45:00Z',
      },
      hu: {
        title: 'Saimaa-gyűrűsfóka',
        url: 'https://hu.wikipedia.org/wiki/Saimaa-gy%C5%B1r%C5%B1sf%C3%B3ka',
        refCount: 5,
        lastRevAt: '2024-11-12T15:30:00Z',
      },
    },
    editionCount: 9,
    sourceCount: 3,
    discrepancyCount: 2,
    discrepancySeverity: 82,
    issueBadges: [
      'Different information',
      'Much fewer references (ET: 3 vs FI: 64)',
      'Outdated information (ET)',
    ],
    mismatchFlags: {
      hardFact: true,
      missingCitation: true,
      outdatedData: true,
      neutralityBias: false,
    },
    priorityScore: 81.5,
  },
];

export const OFFLINE_ANALYSES = {
  Q104318: {
    overallSummary:
      'Estonian (14 refs) and Swedish (19 refs) editions have far fewer references than English (186) and Finnish (148), and Swedish reports older casualty estimates.',
    discrepancies: [
      {
        id: 1,
        qid: 'Q104318',
        mismatchType: 'hard_fact',
        issueLabel: 'Different information',
        targetLang: 'sv',
        claimTopic: 'Conflicting Finnish casualty numbers across editions',
        summary:
          'Finnish, English, and Russian editions report 25,904 dead or missing, whereas Swedish Wikipedia reports ~25,000–26,662.',
        disputedSnippet: '25 000–26 662',
        highlightPhrase: '25 000',
        sectionHeading: 'Förluster',
        suggestedCorrection:
          'Different information: FI, EN & RU report 25,904 dead/missing, while SV states ~25,000–26,662.',
        agreementMatrix: {
          claims: {
            fi: { value: '25 904 kuollutta tai kadonnutta (148 refs)' },
            sv: { value: 'omkring 25 000–26 662 stupade (19 refs)' },
            ru: { value: '25 904 погибших и пропавших без вести (112 refs)' },
            en: { value: '25,904 dead or missing (186 refs)' },
            et: { value: '25 904 langenut ja teadmata kadunut (14 refs)' },
            es: { value: '25 904 muertos o desaparecidos (41 refs)' },
          },
        },
      },
      {
        id: 2,
        qid: 'Q104318',
        mismatchType: 'missing_citation',
        issueLabel: 'Much fewer references',
        targetLang: 'et',
        claimTopic: 'Estonian Wikipedia has only 14 references (vs. 186 in English)',
        summary:
          'Estonian edition has 92% fewer references than English Wikipedia (14 vs. 186) and 91% fewer than Finnish Wikipedia (148).',
        disputedSnippet: 'Talvesõda',
        highlightPhrase: null,
        sectionHeading: null,
        suggestedCorrection:
          'Much fewer references: Estonian has 14 refs compared with 186 in English and 148 in Finnish.',
        agreementMatrix: {
          claims: {
            fi: { value: '148 references' },
            sv: { value: '19 references (low)' },
            ru: { value: '112 references' },
            en: { value: '186 references' },
            et: { value: 'Only 14 references (92% fewer than EN)' },
            es: { value: '41 references' },
          },
        },
      },
    ],
  },
  Q213293: {
    overallSummary:
      'Swedish (4 refs), Estonian (6 refs), and Spanish (8 refs) have much fewer references than Russian (31) and English (28), and Russian frames responsibility differently.',
    discrepancies: [
      {
        id: 3,
        qid: 'Q213293',
        mismatchType: 'missing_citation',
        issueLabel: 'Much fewer references',
        targetLang: 'sv',
        claimTopic: 'Swedish Wikipedia has only 4 references (vs. 31 in Russian)',
        summary:
          'Swedish edition has only 4 inline citations compared with 31 in Russian, 28 in English, and 22 in Finnish Wikipedia.',
        disputedSnippet: 'Skotten i Mainila',
        highlightPhrase: null,
        sectionHeading: null,
        suggestedCorrection:
          'Much fewer references: Add archival sources cited in FI, EN, and RU editions.',
        agreementMatrix: {
          claims: {
            fi: { value: '22 references' },
            sv: { value: 'Only 4 references across entire article' },
            ru: { value: '31 references' },
            en: { value: '28 references' },
            et: { value: '6 references' },
            es: { value: '8 references' },
          },
        },
      },
      {
        id: 4,
        qid: 'Q213293',
        mismatchType: 'hard_fact',
        issueLabel: 'Different information',
        targetLang: 'ru',
        claimTopic: 'Different framing of responsibility for the November 26, 1939 shelling',
        summary:
          'Finnish, Swedish, English, Estonian, Spanish, and Chinese editions state it was a staged Soviet false-flag operation, while Russian Wikipedia frames organizer attribution as disputed.',
        disputedSnippet: 'Майнильский инцидент',
        highlightPhrase: 'дискуссионным',
        sectionHeading: null,
        suggestedCorrection:
          'Different information: FI, SV, EN, ET, ES & ZH state staged Soviet operation; RU presents attribution as disputed.',
        agreementMatrix: {
          claims: {
            fi: { value: 'Neuvostoliiton lavastama tykistökeskitys' },
            sv: { value: 'Sovjetisk iscensatt gränsincident' },
            ru: { value: 'Вопрос о виновнике остаётся дискуссионным' },
            en: { value: 'False flag artillery shelling by the Soviet Union' },
            et: { value: 'Nõukogude Liidu lavastatud piiriintsident' },
            es: { value: 'Ataque de falsa bandera soviético' },
            zh: { value: '苏联自导自演的炮击事件' },
          },
        },
      },
      {
        id: 5,
        qid: 'Q213293',
        mismatchType: 'neutrality_bias',
        issueLabel: 'Not neutral (emotional tone)',
        targetLang: 'ru',
        claimTopic: 'Emotional or non-neutral point of view in Russian Wikipedia',
        summary:
          'Russian edition contains non-neutral / loaded framing compared with the matter-of-fact encyclopedic tone in sibling editions.',
        disputedSnippet: 'Майнильский инцидент',
        highlightPhrase: 'Майнильский инцидент',
        sectionHeading: null,
        suggestedCorrection:
          'Rewrite passage in neutral encyclopedic tone attributing competing historical claims without loaded wording.',
        agreementMatrix: {
          claims: {
            fi: { value: 'Neutral encyclopedic tone (22 refs)' },
            sv: { value: 'Neutral encyclopedic tone (4 refs)' },
            ru: { value: 'Non-neutral / loaded framing detected' },
            en: { value: 'Neutral encyclopedic tone (28 refs)' },
            et: { value: 'Neutral encyclopedic tone (6 refs)' },
            es: { value: 'Neutral encyclopedic tone (8 refs)' },
            zh: { value: 'Neutral encyclopedic tone (15 refs)' },
          },
        },
      },
    ],
  },
  Q12791: {
    overallSummary:
      'Estonian (3 refs), Spanish (4 refs), and Russian (5 refs) have far fewer references than Finnish (64 refs), and report outdated population counts.',
    discrepancies: [
      {
        id: 5,
        qid: 'Q12791',
        mismatchType: 'outdated_data',
        issueLabel: 'Outdated information',
        targetLang: 'ru',
        claimTopic: 'Outdated Saimaa ringed seal population count (~320 vs. ~480–495)',
        summary:
          'Russian edition states ~320 individuals from older surveys, whereas Finnish Wikipedia reports ~480–495 individuals.',
        disputedSnippet: 'около 320 особей',
        highlightPhrase: '320',
        sectionHeading: null,
        suggestedCorrection:
          'Outdated information: Update population figure from ~320 to ~480–495 individuals.',
        agreementMatrix: {
          claims: {
            fi: { value: 'noin 480–495 yksilöä (64 refs)' },
            sv: { value: 'omkring 400 individer (6 refs)' },
            ru: { value: 'около 320 особей (5 refs — outdated)' },
            en: { value: 'around 480 individuals (34 refs)' },
            et: { value: 'umbes 400 isendit (3 refs)' },
            es: { value: 'alrededor de 400 individuos (4 refs)' },
          },
        },
      },
    ],
  },
};
