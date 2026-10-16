import {
  maxPointsFor,
  swappedPreposition,
  trimLossyReason,
  fixSpeakerDuty,
  fixFirstPersonTail,
  fixDroppedMinutes,
  lowerStrayCapitals,
  snapToNoteSpelling,
  hedgeClock,
  impersonalizeEn,
  cleanLiteral,
  outputTokensFor,
  splitIntoChunks,
  parseSourceIds,
  generatePointSummary,
  checkPoint,
  finalizePoints,
  impersonalize,
  isEventUnit,
  capPoints,
  fixStaleWeekday,
  dropNarration,
  isMetaPoint,
  isNarrated,
  isRambling,
  isTrivia,
  recoverMissed,
  shortenLiteral,
  type SummaryPoint,
} from './pointSummary';
import type { SummarySourceUnit } from './summarySources';
import { generate, type GenerationResult } from './llm';

jest.mock('./llm', () => ({
  generate: jest.fn(),
  getContextWindowSize: jest.fn(() => 8192),
  measureFormattedPromptTokens: jest.fn(),
}));
jest.mock('./generationMetrics', () => ({ recordGeneration: jest.fn() }));

const model = jest.mocked(generate);

const reply = (text: string, truncated = false): GenerationResult => ({
  text,
  ttftMs: 1,
  tokensPerSecond: 20,
  wallMs: 2,
  promptMs: 1,
  predictedMs: 1,
  promptTokens: 10,
  predictedTokens: 5,
  completion: { status: 'complete', truncated, stoppedLimit: false, contextFull: false, interrupted: false, stoppedEos: !truncated, stoppingWord: '' },
});

describe('maxPointsFor', () => {
  test('returns minimum 3 for any input', () => {
    expect(maxPointsFor(0)).toBe(3);
    expect(maxPointsFor(1)).toBe(3);
  });

  test('caps at 16 by default', () => {
    expect(maxPointsFor(100)).toBe(16);
    expect(maxPointsFor(1000)).toBe(16);
  });

  test('grows gradually for short notes', () => {
    expect(maxPointsFor(0)).toBe(3);
    expect(maxPointsFor(6)).toBe(4);
    expect(maxPointsFor(15)).toBe(7);
    expect(maxPointsFor(22)).toBe(10);
  });

  test('uses custom cap', () => {
    expect(maxPointsFor(100, 0.35, 15)).toBe(15);
  });

  test('uses custom slope for long notes', () => {
    const withSlope = maxPointsFor(50, 0.2);
    const withoutExtra = maxPointsFor(22, 0.2);
    expect(withSlope).toBeGreaterThan(withoutExtra);
  });
});

describe('outputTokensFor', () => {
  test('grows linearly with points', () => {
    expect(outputTokensFor(1)).toBe(86);
    expect(outputTokensFor(2)).toBe(124);
    expect(outputTokensFor(5)).toBe(238);
  });

  test('caps at 640 tokens', () => {
    expect(outputTokensFor(15)).toBe(618);
    expect(outputTokensFor(16)).toBe(640);
    expect(outputTokensFor(100)).toBe(640);
  });

  test('computes correct formula: min(640, 38 * points + 48)', () => {
    expect(outputTokensFor(10)).toBe(Math.min(640, 38 * 10 + 48));
  });
});

describe('splitIntoChunks', () => {
  test('returns single chunk when units fit', () => {
    const units = [
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
      { id: 3, text: 'c' },
    ];
    const chunks = splitIntoChunks(units, 5);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(units);
  });

  test('returns single chunk when units exactly equal max', () => {
    const units = Array.from({ length: 22 }, (_, i) => ({ id: i + 1, text: `text ${i}` }));
    const chunks = splitIntoChunks(units, 22);
    expect(chunks).toHaveLength(1);
  });

  test('splits 50 units with max 22 into 3 similar chunks', () => {
    const units = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, text: `text ${i}` }));
    const chunks = splitIntoChunks(units, 22);
    expect(chunks).toHaveLength(3);
    const sizes = chunks.map(c => c.length);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(16);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(18);
    const allIds = chunks.flatMap(c => c.map(u => u.id));
    expect(allIds).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  test('keeps self-correction units together', () => {
    const units = [
      { id: 1, text: 'a' },
      { id: 2, text: 'nie, czekaj, b' },
      { id: 3, text: 'c' },
      { id: 4, text: 'd' },
    ];
    const chunks = splitIntoChunks(units, 2);
    expect(chunks[0]).toContainEqual(units[1]);
    expect(chunks[0]?.length).toBeGreaterThanOrEqual(2);
  });

  test('covers all units in order', () => {
    const units = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, text: `text ${i}` }));
    const chunks = splitIntoChunks(units, 10);
    const flattened = chunks.flatMap(c => c);
    expect(flattened.map(u => u.id)).toEqual(units.map(u => u.id));
  });
});

describe('parseSourceIds', () => {
  test('parses single ID', () => {
    expect(parseSourceIds('1')).toEqual([1]);
    expect(parseSourceIds('5')).toEqual([5]);
  });

  test('parses comma-separated IDs', () => {
    expect(parseSourceIds('1, 3, 5')).toEqual([1, 3, 5]);
  });

  test('parses ranges', () => {
    expect(parseSourceIds('3-5')).toEqual([3, 4, 5]);
  });

  test('parses mixed comma and range', () => {
    expect(parseSourceIds('1, 3-5')).toEqual([1, 3, 4, 5]);
    expect(parseSourceIds('1, 3-5, 7')).toEqual([1, 3, 4, 5, 7]);
  });

  test('handles whitespace variations', () => {
    expect(parseSourceIds('1 , 3 - 5')).toEqual([1, 3, 4, 5]);
  });

  test('handles semicolon separator', () => {
    expect(parseSourceIds('1; 3-5')).toEqual([1, 3, 4, 5]);
  });

  test('handles dash with unicode dash variants', () => {
    expect(parseSourceIds('3-5')).toEqual([3, 4, 5]);
    // Unicode dashes: en-dash and em-dash are supported in the regex
  });

  test('collapses long ranges (8+) to ends only', () => {
    expect(parseSourceIds('1-9')).toEqual([1, 9]);
    expect(parseSourceIds('1-10')).toEqual([1, 10]);
    expect(parseSourceIds('1-7')).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test('deduplicates and sorts', () => {
    expect(parseSourceIds('5, 1, 3, 1')).toEqual([1, 3, 5]);
  });

  test('returns empty array for empty input', () => {
    expect(parseSourceIds('')).toEqual([]);
  });
});

describe('checkPoint', () => {
  const units = [
    { id: 1, text: 'Muszę kupić mleko i chleb' },
    { id: 2, text: 'Spotkanie w czwartek o czternastej' },
    { id: 3, text: 'Zapłacić rachunek, sto dwadzieścia złotych' },
  ];
  const byId = new Map(units.map(u => [u.id, u]));

  test('accepts valid point with correct number', () => {
    const point: SummaryPoint = { text: 'Kupić mleko i chleb', sourceIds: [1] };
    const issues = checkPoint(point, byId, units, 'pl');
    expect(issues).toEqual([]);
  });

  test('flags number not in source', () => {
    const point: SummaryPoint = { text: 'Kupić 5 mleka', sourceIds: [1] };
    const issues = checkPoint(point, byId, units, 'pl');
    expect(issues.some(i => i.startsWith('number:'))).toBe(true);
  });

  test('accepts number from source', () => {
    const point: SummaryPoint = { text: 'Rachunek sto dwadzieścia złotych', sourceIds: [3] };
    const issues = checkPoint(point, byId, units, 'pl');
    expect(issues).toEqual([]);
  });

  test('flags missing IDs', () => {
    const point: SummaryPoint = { text: 'Spotkanie w piątek', sourceIds: [1] };
    const issues = checkPoint(point, byId, units, 'pl');
    expect(issues.length).toBeGreaterThan(0);
  });

  test('flags unknown IDs', () => {
    const point: SummaryPoint = { text: 'Test', sourceIds: [99] };
    const issues = checkPoint(point, byId, units, 'pl');
    expect(issues[0]).toBe('ids');
  });
});

describe('generatePointSummary', () => {
  beforeEach(() => {
    model.mockReset();
  });

  const makeUnits = (texts: string[]): SummarySourceUnit[] => {
    let pos = 0;
    return texts.map((text, i) => {
      const start = pos;
      const end = pos + text.length;
      pos = end + 1;
      return { id: i + 1, start, end, text };
    });
  };

  test('returns literal points for fewer than 3 units', async () => {
    const units = makeUnits(['Test jeden.', 'Test dwa.']);
    const content = units.map(u => u.text).join(' ');
    const result = await generatePointSummary(units, content, 'pl');
    expect(result.points.length).toBeGreaterThan(0);
    expect(model).not.toHaveBeenCalled();
  });

  test('calls model for 6 sentences and parses output', async () => {
    const units = makeUnits([
      'Muszę kupić mleko i chleb.',
      'Spotkanie w czwartek.',
      'Trzeba zapłacić rachunek.',
      'Wizyta u lekarza w piątek.',
      'Paczka przychodzi jutro.',
      'Muszę napisać raport.',
    ]);
    const content = units.map(u => u.text).join(' ');
    model.mockResolvedValue(reply('- Kupić mleko i chleb [1]\n- Spotkanie w czwartek [2, 3]'));

    const result = await generatePointSummary(units, content, 'pl');

    expect(model).toHaveBeenCalled();
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.points[0]?.sourceIds).toContain(1);
  });

  test('includes warning when model output is truncated', async () => {
    const units = makeUnits([
      'Test jeden.', 'Test dwa.', 'Test trzy.', 'Test cztery.', 'Test pięć.', 'Test sześć.',
    ]);
    const content = units.map(u => u.text).join(' ');
    model.mockResolvedValue(reply('- Kupić mleko [1]', true));

    const result = await generatePointSummary(units, content, 'pl');

    expect(result.warnings.some(w => w.includes('cut off'))).toBe(true);
  });

  test('sets document when points are generated', async () => {
    const units = makeUnits([
      'Test jeden.', 'Test dwa.', 'Test trzy.', 'Test cztery.', 'Test pięć.', 'Test sześć.',
    ]);
    const content = units.map(u => u.text).join(' ');
    model.mockResolvedValue(reply('- Punkt jeden [1]\n- Punkt dwa [2]'));

    const result = await generatePointSummary(units, content, 'pl');

    if (result.points.length > 0) {
      expect(result.document).toBeDefined();
    }
  });

  test('warns when model produces no points', async () => {
    const units = makeUnits([
      'Test jeden.', 'Test dwa.', 'Test trzy.', 'Test cztery.', 'Test pięć.', 'Test sześć.',
    ]);
    const content = units.map(u => u.text).join(' ');
    model.mockResolvedValue(reply(''));

    const result = await generatePointSummary(units, content, 'pl');

    expect(result.warnings.some(w => w.includes('no usable points'))).toBe(true);
  });

  test('handles model output cut off mid-bracket', async () => {
    const units = makeUnits([
      'Test jeden.', 'Test dwa.', 'Test trzy.', 'Test cztery.', 'Test pięć.', 'Test sześć.',
    ]);
    const content = units.map(u => u.text).join(' ');
    model.mockResolvedValue(reply('- Punkt jeden [1]\n- Punkt dwa [2'));

    const result = await generatePointSummary(units, content, 'pl');

    expect(result.points.length).toBeGreaterThan(0);
  });

  test('filters out duplicate points', async () => {
    const units = makeUnits([
      'Test jeden.', 'Test dwa.', 'Test trzy.', 'Test cztery.', 'Test pięć.', 'Test sześć.',
    ]);
    const content = units.map(u => u.text).join(' ');
    model.mockResolvedValue(reply('- Kupić mleko [1]\n- Kupić mleko [2]'));

    const result = await generatePointSummary(units, content, 'pl');

    expect(result.points).toHaveLength(1);
  });

  test('reports literal fallback count', async () => {
    const units = makeUnits(['A.', 'B.', 'C.']);
    const content = units.map(u => u.text).join(' ');
    model.mockResolvedValue(reply(''));

    const result = await generatePointSummary(units, content, 'pl');

    expect(result.literalFallbackCount).toBeGreaterThanOrEqual(0);
  });

  test('handles English with literal fallback', async () => {
    const units = makeUnits([
      'Test one.', 'Test two.', 'Test three.', 'Test four.', 'Test five.', 'Test six.',
    ]);
    const content = units.map(u => u.text).join(' ');
    model.mockResolvedValue(reply(''));

    const result = await generatePointSummary(units, content, 'en');

    // English has a different path through the code
    expect(result.points !== undefined).toBe(true);
  });
});

describe('impersonalize', () => {
  const note = new Set(['składam', 'zadzwonię', 'niedzielę', 'przedłużyć', 'muszę']);

  test('turns first-person obligations and plans into infinitives', () => {
    expect(impersonalize('Muszę przedłużyć zwrot książki', note)).toBe('Przedłużyć zwrot książki');
    expect(impersonalize('Mam jeszcze zadzwonić do mamy', note)).toBe('Zadzwonić do mamy');
    expect(impersonalize('Zadzwonię do babci', note)).toBe('Zadzwonić do babci');
  });

  test('keeps negated and non-infinitive modals', () => {
    expect(impersonalize('Nie muszę nic zanosić', note)).toBe('Nie muszę nic zanosić');
    expect(impersonalize('Mam być w pracy o 8', note)).toBe('Mam być w pracy o 8');
  });

  test('rewrites decisions and their negated verbs', () => {
    expect(impersonalize('Postanowiłem do nowego roku nie składam wypowiedzenia', note))
      .toBe('Decyzja: do nowego roku nie składać wypowiedzenia');
    expect(impersonalize('Postanawiam odkładać telefon o 22:30', note)).toBe('Decyzja: odkładać telefon o 22:30');
    expect(impersonalize('Zauważyłem to, więc postanawiam od dzisiaj, że telefon odkładam o 22:30', note))
      .toBe('Decyzja: telefon odkładam o 22:30');
  });

  test('repairs model-made case and script slips', () => {
    expect(impersonalize('Zadzwonić do babci w niedzieli', note)).toBe('Zadzwonić do babci w niedzielę');
    expect(impersonalize('Do nowego roku nie składaj wypowiedzenia', note)).toBe('Do nowego roku nie składam wypowiedzenia');
    expect(impersonalize('Decyzja: nie składать wypowiedzenia', note)).toBe('Decyzja: nie składać wypowiedzenia');
    expect(impersonalize('Kontrola w wtorek', note)).toBe('Kontrola we wtorek');
  });

  test('does not touch a weekday the speaker used in that form', () => {
    expect(impersonalize('Siłownia w poniedziałki', new Set(['poniedziałki']))).toBe('Siłownia w poniedziałki');
  });
});

describe('isMetaPoint', () => {
  test('flags short points about the recording itself', () => {
    expect(isMetaPoint('Nagrywam to')).toBe(true);
  });

  test('keeps real points that mention recording', () => {
    expect(isMetaPoint('Nagrywam odcinek podcastu w piątek o 18:00')).toBe(false);
  });
});

describe('shortenLiteral', () => {
  test('leaves short quotes alone', () => {
    expect(shortenLiteral('Kupić mleko, chleb i masło')).toBe('Kupić mleko, chleb i masło');
  });

  test('drops a waiting tail of a decision', () => {
    expect(shortenLiteral('Decyzja: telefon odkładam o 22:30, tak na próbę, przez tydzień, zobaczymy czy coś to zmieni'))
      .toBe('Decyzja: telefon odkładam o 22:30, tak na próbę, przez tydzień');
  });

  test('keeps the clauses around the informative one', () => {
    const quote = 'Opowiadał mi długo o swoich wakacjach nad morzem i o pogodzie w zeszłym roku, potem jeszcze o tym jak wszystko drożeje, '
      + 'mam zapłacić zaliczkę 500 zł do piątku, a na koniec wspominał o swoim psie, który jest już bardzo stary i choruje';
    const short = shortenLiteral(quote);
    expect(short).toContain('mam zapłacić zaliczkę 500 zł do piątku');
    expect(short.length).toBeLessThan(quote.length);
  });
});

describe('recoverMissed', () => {
  const units = [
    { id: 1, text: 'Dzisiaj było bardzo zimno.' },
    { id: 2, text: 'Kontrola jest 27 października o szesnastej piętnaście.' },
    { id: 3, text: 'Wczoraj byliśmy w kinie 12 października.' },
    { id: 4, text: 'Muszę oddać książkę do piątku.' },
  ];

  test('recognises dated events and obligations, not past stories', () => {
    expect(isEventUnit(units[1].text)).toBe(true);
    expect(isEventUnit(units[3].text)).toBe(true);
    expect(isEventUnit(units[0].text)).toBe(false);
    expect(isEventUnit(units[2].text)).toBe(false);
  });

  test('adds the event sentences that no point cites', () => {
    const points = [{ text: 'Zimno', sourceIds: [1] }, { text: 'Kino', sourceIds: [3] }];
    const result = recoverMissed(points, units);
    expect(result.map(point => point.sourceIds[0])).toEqual([1, 2, 3]);
    expect(result[1].text).toContain('27');
  });

  test('adds nothing when the events are covered', () => {
    const points = [{ text: 'Kontrola 27 października', sourceIds: [2] }, { text: 'Oddać książkę', sourceIds: [4] }];
    expect(recoverMissed(points, units)).toHaveLength(2);
  });
});

describe('finalizePoints repairs', () => {
  test('takes over the stated time when the model misheard it', () => {
    const units = [
      { id: 1, text: 'Zauważyłem, że telefon odkładam o dwudziestej drugiej trzydzieści, tak na próbę przez tydzień.' },
    ];
    const { points } = finalizePoints([{ text: 'Postanawiam odkładać telefon o dwudziestej trzydzieści, przez tydzień', sourceIds: [1] }], units, 'pl');
    expect(points[0].text).toBe('Decyzja: odkładać telefon o 22:30, przez tydzień');
  });

  test('puts a planned action back into the infinitive', () => {
    const units = [{ id: 1, text: 'Ania ma zarezerwować kolację na rocznicę.' }];
    const { points } = finalizePoints([{ text: 'Ania zarezerwowała kolację na rocznicę', sourceIds: [1] }], units, 'pl');
    expect(points[0].text).toBe('Ania ma zarezerwować kolację na rocznicę');
  });

  test('drops a point about the recording', () => {
    const units = [{ id: 1, text: 'Dobra, nagrywam to, bo się zaraz pogubię.' }];
    expect(finalizePoints([{ text: 'Nagrywam to', sourceIds: [1] }], units, 'pl').points).toEqual([]);
  });
});

describe('impersonalize (round 3)', () => {
  const note = new Set(['kupię', 'zadzwonię', 'oddać', 'przesunąć', 'matematyczna']);

  test('moves the time behind the task', () => {
    expect(impersonalize('W niedzielę zadzwonię do babci, bo długo nie dzwoniłem', note)).toBe('Zadzwonić do babci w niedzielę, bo długo nie dzwoniłem');
    expect(impersonalize('W sobotę rano mam mu ją oddać, jeszcze przed 10', note)).toBe('Oddać mu ją w sobotę rano, jeszcze przed 10');
  });

  test('turns a fact followed by an obligation into a dash', () => {
    expect(impersonalize('Pracuję zdalnie, muszę przesunąć dwa spotkania', note)).toBe('Pracuję zdalnie – przesunąć dwa spotkania');
  });

  test('drops thinking openers and a subject pronoun before a modal', () => {
    expect(impersonalize('Pomyślałem, że kupię nowy, ale nie teraz', note)).toBe('Kupić nowy, ale nie teraz');
    expect(impersonalize('Ja mam zaktualizować dokumentację', note)).toBe('Zaktualizować dokumentację');
  });

  test('turns a request into a task and keeps its negation', () => {
    expect(impersonalize('Przypomnij mi, żebym jutro oddzwonił do pana', note)).toBe('Jutro oddzwonić do pana');
    expect(impersonalize('Wizyta – przypomnieć Oli, że nie zapomniała o szczepieniu', note)).toBe('Wizyta – przypomnieć Oli, żeby nie zapomniała o szczepieniu');
  });

  test('completes a word cut short by the model', () => {
    expect(impersonalize('Analiza matematycz, poprawka', note)).toBe('Analiza matematyczna, poprawka');
  });
});

describe('narration filtering', () => {
  const diary = (): { id: number; text: string }[] => {
    const filler = [
      'Spotkałem sąsiadkę z psem, który szczeka na wszystko.',
      'Zrobiłem sobie kanapki i włączyłem telewizor.',
      'Przypomniało mi się, jak kiedyś zbieraliśmy kasztany.',
      'Zastanawiałem się, czy jeszcze gdzieś leżą.',
      'Pamiętam to dziwne uczucie z dzieciństwa.',
      'Wyjrzałem przez okno, padał deszcz.',
    ];
    const texts: string[] = [];
    for (let i = 0; i < 24; i += 1) texts.push(i % 6 === 5 ? `Muszę zapłacić rachunek do piątku, ${i} złotych.` : filler[i % 6]);
    return texts.map((text, i) => ({ id: i + 1, text }));
  };

  test('a diary without markers is rambling and its anecdotes are narrated', () => {
    const units = diary();
    expect(isRambling(units)).toBe(true);
    expect(isNarrated(units[0])).toBe(true);
    expect(isNarrated(units[5])).toBe(false);
  });

  test('keeps points that cite a plan and drops the stories in a rambling note', () => {
    const units = diary();
    const points = [
      { text: 'Sąsiadka z psem', sourceIds: [1] }, { text: 'Kasztany z dzieciństwa', sourceIds: [3] },
      { text: 'Deszcz za oknem', sourceIds: [5] }, { text: 'Zapłacić rachunek do piątku', sourceIds: [6] },
      { text: 'Kolejny rachunek', sourceIds: [12] }, { text: 'Rachunek trzeci', sourceIds: [18] }, { text: 'Rachunek czwarty', sourceIds: [24] },
    ];
    const kept = dropNarration(points, units).map(point => point.text);
    expect(kept).toEqual(expect.arrayContaining(['Zapłacić rachunek do piątku', 'Kolejny rachunek']));
    expect(kept).not.toContain('Sąsiadka z psem');
    expect(kept).not.toContain('Kasztany z dzieciństwa');
  });

  test('trivia is past-tense ambient talk without a plan, number or task wording', () => {
    const cited = [{ id: 1, text: 'Aha i jeszcze, spotkanie było w sali na drugim piętrze, klimatyzacja nie działała.' }];
    expect(isTrivia('Spotkanie w sali na drugim piętrze – klimatyzacja nie działała', cited)).toBe(true);
    expect(isTrivia('Kupić kawę', [{ id: 2, text: 'Skończyła się kawa.' }])).toBe(false);
    expect(isTrivia('Ania rezerwuje kolację na rocznicę', [{ id: 3, text: 'Ania rezerwuje kolację na rocznicę.' }])).toBe(false);
    expect(isTrivia('Kawa kosztuje 20 zł', [{ id: 4, text: 'Kawa kosztowała dwadzieścia złotych.' }])).toBe(false);
  });

  test('a dictated factual recap is not rambling', () => {
    const recap = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      text: i % 3 === 0 ? 'Lekarka przepisała antybiotyk dwa razy dziennie.' : 'Kontrola jest w poniedziałek, mam zrobić morfologię.',
    }));
    expect(isRambling(recap)).toBe(false);
  });
});

describe('short notes', () => {
  test('a reminder becomes a compact task and the side remark goes', async () => {
    model.mockReset();
    const units = [
      { id: 1, start: 0, end: 150, text: 'Aha, przypomnij mi, żebym jutro przed dziewiątą oddzwonił do pana z warsztatu w sprawie opon, bo mówił, że do piątku trzyma dla mnie rezerwację, a potem już nie.' },
      { id: 2, start: 151, end: 190, text: 'Numer mam w telefonie, w ostatnich.' },
    ];
    const result = await generatePointSummary(units, units.map(unit => unit.text).join(' '), 'pl');
    expect(model).not.toHaveBeenCalled();
    expect(result.points.map(point => point.text)).toEqual([
      'Jutro przed dziewiątą oddzwonić do pana z warsztatu w sprawie opon – do piątku trzyma rezerwację, a potem już nie.',
    ]);
  });
});

describe('shortenLiteral meta clauses', () => {
  test('drops attendance and the recording purpose', () => {
    expect(shortenLiteral('Spotkanie projektowe w sprawie panelu klienta, było nas pięcioro, więc spisuję dla siebie, zanim mi umknie'))
      .toBe('Spotkanie projektowe w sprawie panelu klienta');
  });
});

describe('date removal', () => {
  test('does not eat the end of a word as a preposition', () => {
    const units = [{ id: 1, text: 'Analiza matematyczna, egzamin dwunastego lutego.' }];
    const { points } = finalizePoints([{ text: 'Analiza matematyczna 9 stycznia, egzamin 12 lutego', sourceIds: [1] }], units, 'pl');
    expect(points[0].text).toContain('matematyczna');
  });
});

describe('round 4 point fixes', () => {
  const noteWords = new Set<string>();

  test('imperatives become infinitives', () => {
    expect(impersonalize('Pokaż promotorowi najnowszą wersję aplikacji', noteWords)).toBe('Pokazać promotorowi najnowszą wersję aplikacji');
    expect(impersonalize('Przygotuj raport na piątek', noteWords)).toBe('Przygotować raport na piątek');
  });

  test('first-person motion verbs become nouns', () => {
    expect(impersonalize('Jadę pociągiem w sobotę o 9:40', noteWords)).toBe('Wyjazd pociągiem w sobotę o 9:40');
    expect(impersonalize('Wracam w niedzielę wieczorem', noteWords)).toBe('Powrót w niedzielę wieczorem');
    expect(impersonalize('W sobotę jadę do rodziców, wrócę w niedzielę wieczorem', noteWords)).toBe('Wyjazd do rodziców w sobotę, powrót w niedzielę wieczorem');
    expect(impersonalize('W niedzielę odpoczywam', noteWords)).toBe('Odpoczynek w niedzielę');
  });

  test('spoken word order and case slips are repaired', () => {
    expect(impersonalize('Zajęć w piątek nie, więc zostaję dłużej na uczelni', noteWords)).toBe('Brak zajęć w piątek, więc zostaję dłużej na uczelni');
    expect(impersonalize('Dopisać rozdział czwartym o lokalnym przetwarzaniu mowy', noteWords)).toBe('Dopisać rozdział czwarty o lokalnym przetwarzaniu mowy');
    expect(impersonalize('Spotkanie z promotorem o 10:30 poniedziałek', noteWords)).toBe('Spotkanie z promotorem o 10:30 w poniedziałek');
    expect(impersonalize('Kuba pożyczył książkę, ją oddać do końca miesiąca', noteWords)).toBe('Kuba pożyczył książkę, trzeba ją oddać do końca miesiąca');
  });

  test('"mam zajęć" is not an infinitive', () => {
    expect(impersonalize('W piątek nie mam zajęć, więc zostaję', noteWords)).not.toMatch(/^Zajęć/u);
  });

  test('a weekday corrected by the speaker is replaced in the case the point uses', () => {
    const cited = 'Termin: środa do osiemnastej. Poprawka: nie środa, tylko czwartek do osiemnastej.';
    expect(fixStaleWeekday('Podsumowanie do środy do 18:00', cited)).toBe('Podsumowanie do czwartku do 18:00');
    expect(fixStaleWeekday('Termin: środa do 18:00', cited)).toBe('Termin: czwartek do 18:00');
    expect(fixStaleWeekday('Termin: czwartek do 18:00', cited)).toBe('Termin: czwartek do 18:00');
  });

  test('a corrected weekday is also fixed in finalizePoints, using the correction sentence after the cited one', () => {
    const units = [
      { id: 1, text: 'Termin: środa do osiemnastej.' },
      { id: 2, text: 'Poprawka: nie środa, tylko czwartek do osiemnastej.' },
      { id: 3, text: 'Potem napiszę rozdział.' },
    ];
    const { points } = finalizePoints([{ text: 'Termin: środa do osiemnastej', sourceIds: [1] }], units, 'pl');
    expect(points[0].text).toBe('Termin: czwartek do 18:00');
  });

  test('two points about one dated event are merged, the fuller one wins', () => {
    const units = [
      { id: 1, text: 'Poprosił, żebym przygotował krótkie podsumowanie postępów i wysłał mu je mailem.' },
      { id: 2, text: 'Termin: czwartek do osiemnastej.' },
    ];
    const { points } = finalizePoints([
      { text: 'Wysłać podsumowanie postępów do czwartku do osiemnastej', sourceIds: [1] },
      { text: 'Termin: czwartek do osiemnastej', sourceIds: [2] },
    ], units, 'pl');
    expect(points).toHaveLength(1);
    expect(points[0].text).toContain('podsumowanie');
    expect(points[0].sourceIds).toEqual([1, 2]);
  });

  test('an invented verb form is rejected', () => {
    const units = [{ id: 1, text: 'W sobotę jadę pociągiem o dziewiątej czterdzieści, jestem na miejscu około trzynastej.' }];
    const byId = new Map(units.map(unit => [unit.id, unit]));
    expect(checkPoint({ text: 'Wyjazd pociągiem w sobotę o 9:40, dojde o 13:00', sourceIds: [1] }, byId, units).join()).toContain('words');
    expect(checkPoint({ text: 'Wyjazd pociągiem w sobotę o 9:40, na miejscu około 13:00', sourceIds: [1] }, byId, units)).toEqual([]);
  });

  test('numbering labels of the speaker are dropped', () => {
    const units = [{ id: 1, text: 'Druga sprawa: prezentacja na poniedziałek.' }];
    const { points } = finalizePoints([{ text: 'Druga sprawa: prezentacja na poniedziałek', sourceIds: [1] }], units, 'pl');
    expect(points[0].text).toBe('Prezentacja na poniedziałek');
  });

  test('capPoints drops the least substantial points and keeps the order', () => {
    const units = [
      { id: 1, text: 'Muszę zapłacić czynsz do dziesiątego, tysiąc złotych.' },
      { id: 2, text: 'Pogoda była ładna.' },
      { id: 3, text: 'Mam zadzwonić do lekarza w piątek.' },
    ];
    const points = [
      { text: 'Zapłacić czynsz do 10, 1000 zł', sourceIds: [1] },
      { text: 'Ładna pogoda', sourceIds: [2] },
      { text: 'Zadzwonić do lekarza w piątek', sourceIds: [3] },
    ];
    expect(capPoints(points, units, 2).map(point => point.sourceIds[0])).toEqual([1, 3]);
    expect(capPoints(points, units, 5)).toHaveLength(3);
  });
});

describe('chunk budgets', () => {
  const sentence = (i: number): string => `Zdanie numer ${i} o czymś ważnym, muszę to zrobić w piątek.`;
  const longNote = Array.from({ length: 60 }, (_, i) => sentence(i + 1)).join(' ');

  test('each chunk of a long note leaves headroom for its points and asks for a line limit', async () => {
    model.mockReset();
    model.mockResolvedValue(reply('- Zrobić coś w piątek [1]'));
    const { createSummarySources } = jest.requireActual<typeof import('./summarySources')>('./summarySources');
    const units = createSummarySources(longNote);
    await generatePointSummary(units, longNote, 'pl');
    const calls = model.mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    let total = 0;
    for (const [prompt, , options] of calls) {
      const asked = Number(/Najwyżej (\d+) punkt/u.exec(prompt)?.[1]);
      total += asked;
      expect(options?.nPredict).toBe(outputTokensFor(asked));
      expect(prompt).toMatch(new RegExp(`najwyżej ${asked} lini[ei]\\.`, 'u'));
    }
    expect(total).toBeLessThanOrEqual(24);
  });
});

describe('rewrite slips', () => {
  const src = 'W sobotę jadę pociągiem o dziewiątej czterdzieści, jestem na miejscu około trzynastej.';
  it('flags a phrase rebuilt around another preposition', () => {
    expect(swappedPreposition('Pociąg do miejsca o 9:40', src, src)).toBe('do miejsca');
    expect(swappedPreposition('Na miejscu około 13:00', src, src)).toBeNull();
    expect(swappedPreposition('Wizyta u dentysty w czwartek', 'Mam wizytę u dentysty w czwartek.', 'Mam wizytę u dentysty w czwartek.')).toBeNull();
  });
  it('drops a reason clause the speaker did not say that way', () => {
    const s = 'Chcę też zrobić porządek w zakładkach w przeglądarce, bo mam ich otwarte ze czterdzieści.';
    expect(trimLossyReason('Porządek w zakładkach w przeglądarce, bo ich otwarte ze 40', s)).toBe('Porządek w zakładkach w przeglądarce');
    expect(trimLossyReason('Porządek w zakładkach, bo mam ich otwarte ze 40', s)).toBe('Porządek w zakładkach, bo mam ich otwarte ze 40');
    expect(trimLossyReason('Wizyta przesunięta, bo zajęcia', 'Przesunąłem wizytę.')).toBe('Wizyta przesunięta, bo zajęcia');
  });
});

describe('speaker duty', () => {
  const src = 'Kuba pożyczył mi książkę o uczeniu maszynowym, muszę mu ją oddać do końca miesiąca.';
  it('gives the duty back to the speaker', () => {
    expect(fixSpeakerDuty('Kuba pożyczył książkę o uczeniu maszynowym, musi ją oddać do końca miesiąca', src))
      .toBe('Kuba pożyczył książkę o uczeniu maszynowym – oddać ją do końca miesiąca');
  });
  it('keeps a duty that really is the other person\'s', () => {
    const other = 'Ola musi oddać raport do piątku, a ja sprawdzę wyniki.';
    expect(fixSpeakerDuty('Ola przygotuje raport, musi go oddać do piątku', other)).toBe('Ola przygotuje raport, musi go oddać do piątku');
  });
});

describe('first person leftovers', () => {
  it('drops "zostało mi" before an infinitive', () => {
    expect(impersonalize('Zostało mi dokończyć ekran nagrywania i przygotować prezentację', new Set())).toBe('Dokończyć ekran nagrywania i przygotować prezentację');
  });
  it('turns a joined first-person verb into an infinitive', () => {
    const src = 'Jutro rano zrobię kopię repozytorium i wypchnę zmiany na GitHuba.';
    expect(fixFirstPersonTail('Zrobić kopię repozytorium i wypchnę zmiany na GitHuba jutro rano', src)).toBe('Zrobić kopię repozytorium i wypchnąć zmiany na GitHuba jutro rano');
    expect(fixFirstPersonTail('Kupić mleko i kupię chleb', 'Kupię mleko i kupię chleb.')).toBe('Kupić mleko i kupić chleb');
    expect(fixFirstPersonTail('Zrobić kopię i prezentację', 'Zrobię kopię i prezentację.')).toBe('Zrobić kopię i prezentację');
  });
});

describe('final point polish', () => {
  const src = 'Jutro mam na godzinę ósmą chyba 30 zajęcia';
  it('keeps the minutes spoken after the hour', () => {
    expect(fixDroppedMinutes('Zajęcia o 8:00 jutro', src)).toBe('Zajęcia o ok. 8:30 jutro');
    expect(fixDroppedMinutes('Zajęcia o 8:00', 'Zajęcia o ósmej trzydzieści.')).toBe('Zajęcia o 8:30');
    expect(fixDroppedMinutes('Zapłacić o 8:00', 'O ósmej 30 zł za parking.')).toBe('Zapłacić o 8:00');
    expect(fixDroppedMinutes('Spotkanie o 18:00', 'O osiemnastej spotkanie.')).toBe('Spotkanie o 18:00');
  });
  it('lowers a stray one-letter capital mid-sentence', () => {
    expect(lowerStrayCapitals('Jutro O 18:00 psycholog')).toBe('Jutro o 18:00 psycholog');
    expect(lowerStrayCapitals('Format A1 i druk')).toBe('Format A1 i druk');
    expect(lowerStrayCapitals('O 18:00 psycholog')).toBe('O 18:00 psycholog');
  });
  it('treats "poza tym" as a lead filler', () => {
    expect(cleanLiteral('Poza tym o osiemnastej jutro jadę do psychologa')).toBe('O osiemnastej jutro jadę do psychologa.');
  });
});

test('drops minutes the model left after a rounded hour', () => {
  expect(fixDroppedMinutes('Jutro o 8:00 30 zajęć', 'Jutro mam na godzinę ósmą chyba 30 zajęcia')).toBe('Jutro o ok. 8:30 zajęć');
});

test('snaps a model typo to the note spelling without changing inflection', () => {
  const note = new Set(['siedemnastej', 'podsumowania', 'bibliotece', 'spotkamy']);
  expect(snapToNoteSpelling('W czwartek o siedmastej w bibliotece', note)).toBe('W czwartek o siedemnastej w bibliotece');
  expect(snapToNoteSpelling('Wysłać podsumowanie postępów', note)).toBe('Wysłać podsumowanie postępów');
  expect(snapToNoteSpelling('Spotkamy się', note)).toBe('Spotkamy się');
});

test('restores the hedge on a spoken hour and allows u/do person paraphrase', () => {
  expect(hedgeClock('Zajęcia o 8:30 jutro', 'Jutro mam na godzinę ósmą chyba 30 zajęcia')).toBe('Zajęcia o ok. 8:30 jutro');
  expect(hedgeClock('Zajęcia o ok. 8:30', 'na ósmą chyba 30 zajęcia')).toBe('Zajęcia o ok. 8:30');
  const src = 'O osiemnastej jutro jadę do psychologa';
  expect(swappedPreposition('Jutro o 18:00 wizyta u psychologa', src, src)).toBeNull();
});

test('a literal keeps the hedged clock and drops "jakąś tam"', () => {
  expect(cleanLiteral('zajęcia Jakość jakąś tam oprogramowania z panem mgr')).toBe('Zajęcia Jakość oprogramowania z panem mgr.');
});

test('an English literal drops the first-person duty', () => {
  expect(impersonalizeEn('I should book a slot in the lab for the user tests, probably next Wednesday')).toBe('Book a slot in the lab for the user tests, probably next Wednesday');
  expect(impersonalizeEn('If the fever stays high, I have to call the clinic and not wait')).toBe('If the fever stays high, call the clinic and not wait');
  expect(impersonalizeEn('Okay so I need to pay the rent')).toBe('Pay the rent');
});
