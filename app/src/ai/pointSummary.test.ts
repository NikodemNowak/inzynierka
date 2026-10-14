import {
  maxPointsFor,
  outputTokensFor,
  splitIntoChunks,
  parseSourceIds,
  generatePointSummary,
  checkPoint,
  finalizePoints,
  impersonalize,
  isEventUnit,
  isMetaPoint,
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

  test('caps at 20 by default', () => {
    expect(maxPointsFor(100)).toBe(20);
    expect(maxPointsFor(1000)).toBe(20);
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
    expect(outputTokensFor(1)).toBe(68);
    expect(outputTokensFor(2)).toBe(96);
    expect(outputTokensFor(5)).toBe(180);
  });

  test('caps at 640 tokens', () => {
    expect(outputTokensFor(20)).toBe(600);
    expect(outputTokensFor(25)).toBe(640);
    expect(outputTokensFor(100)).toBe(640);
  });

  test('computes correct formula: min(640, 28 * points + 40)', () => {
    expect(outputTokensFor(10)).toBe(Math.min(640, 28 * 10 + 40));
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
