import { generate, type GenerationResult } from './llm';
import { checkPoint } from './summaryChecks';
import { createSummarySources } from './summarySources';
import { FAST_SUMMARY_MIN_UNITS, chunkUnits, fastChunkPrompt, generateFastSummary, parseFastPoints } from './fastSummary';

jest.mock('./llm', () => ({ generate: jest.fn() }));
jest.mock('./generationMetrics', () => ({ recordGeneration: jest.fn() }));

const model = jest.mocked(generate);
const reply = (text: string): GenerationResult => ({
  text, ttftMs: 1, tokensPerSecond: 20, wallMs: 2, promptMs: 1, predictedMs: 1, promptTokens: 10, predictedTokens: 5,
  completion: { status: 'complete', truncated: false, stoppedLimit: false, contextFull: false, interrupted: false, stoppedEos: true, stoppingWord: '' },
});

const sentences = [
  'Dzisiaj rozmawiałem z promotorem o aplikacji.',
  'Pogoda była ładna i poszliśmy na spacer.',
  'Zapłaciłem trzysta złotych za plakat.',
  'Nie mam zajęć w piątek.',
  'Muszę wysłać raport do środy.',
  'Rozmawialiśmy jeszcze o książkach i kawie.',
  'Ola sprawdzi rozdział drugi do czwartku.',
  'Potem poszliśmy na obiad do stołówki.',
  'W sobotę kupiłem bilet na pociąg za 58 złotych.',
  'Tak naprawdę nie było nic więcej do omówienia.',
  'Kuba pożyczył książkę i odda ją w przyszłym miesiącu.',
  'To wszystko na dzisiaj.',
];
const content = sentences.join(' ');
const units = createSummarySources(content);

test('has enough sentences to take the fast path', () => {
  expect(units.length).toBeGreaterThanOrEqual(FAST_SUMMARY_MIN_UNITS);
});

describe('chunkUnits', () => {
  test('splits by sentence count and by characters without losing units', () => {
    const many = Array.from({ length: 60 }, (_, index) => ({ id: index + 1, start: index * 10, end: index * 10 + 9, text: 'Zdanie numer.' }));
    const chunks = chunkUnits(many);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat().map(unit => unit.id)).toEqual(many.map(unit => unit.id));
    expect(chunks.every(chunk => chunk.length <= 24)).toBe(true);
    const long = [{ id: 1, start: 0, end: 1500, text: 'a'.repeat(1500) }, { id: 2, start: 1500, end: 3000, text: 'b'.repeat(1500) }];
    expect(chunkUnits(long)).toHaveLength(2);
  });
});

describe('parseFastPoints', () => {
  const allowed = new Set([1, 2, 3, 4]);
  test('reads bullet lines with source numbers and drops everything else', () => {
    const text = [
      '- Zapłacono trzysta złotych za plakat [3]',
      '* Brak zajęć w piątek [4, 2].',
      'Nagłówek bez numeru',
      '- Punkt z obcym numerem [99]',
      '- Urwany punkt bez nawiasu',
      '- Zapłacono trzysta złotych za plakat [3]',
    ].join('\n');
    expect(parseFastPoints(text, allowed)).toEqual([
      { text: 'Zapłacono trzysta złotych za plakat', sourceIds: [3] },
      { text: 'Brak zajęć w piątek', sourceIds: [2, 4] },
    ]);
  });
  test('ignores reasoning blocks', () => {
    expect(parseFastPoints('<think>- ukryte [1]</think>\n- Widoczny punkt tutaj [1]', allowed)).toEqual([
      { text: 'Widoczny punkt tutaj', sourceIds: [1] },
    ]);
  });
});

test('prompt lists the important units and keeps the source first', () => {
  const prompt = fastChunkPrompt(units.slice(0, 3), [3], [], 'pl');
  expect(prompt.startsWith('/no_think\nSOURCE_START\n[1] ')).toBe(true);
  expect(prompt).toContain('WAŻNE (muszą być uwzględnione): 3');
});

describe('checkPoint', () => {
  const unit = (text: string) => [{ id: 1, start: 0, end: text.length, text }];
  const issues = (point: string, source: string) => checkPoint({ text: point, sourceIds: [1] }, unit(source));
  test('accepts a faithful compression', () => {
    expect(issues('Zapłaciłem trzysta złotych za plakat', 'Zapłaciłem trzysta złotych za plakat.')).toEqual([]);
  });
  test('rejects a changed number', () => {
    expect(issues('Zapłaciłem 350 złotych za plakat', 'Zapłaciłem trzysta złotych za plakat.')).toContain('number');
  });
  test('rejects a lost or invented negation', () => {
    expect(issues('Mam zajęcia w piątek', 'Nie mam zajęć w piątek.')).toContain('negation');
    expect(issues('Nie wysłałem raportu', 'Wysłałem raport.')).toContain('negation');
  });
  test('rejects a past duty turned into a present one', () => {
    expect(issues('Muszę złożyć podanie', 'Musiałem złożyć podanie.')).toContain('tense');
  });
  test('rejects a dropped hedge', () => {
    expect(issues('Spotkanie odbędzie się w piątek', 'Spotkanie odbędzie się w piątek jeśli sala będzie wolna.')).toContain('hedge');
  });
  test('rejects invented words', () => {
    expect(issues('Spotkanie z dziekanem o budżecie uczelni', 'Idziemy na obiad do stołówki.')).toContain('words');
  });
  test('rejects a point that states only the replaced value', () => {
    const earlier = { id: 'a', start: 0, end: 10, quote: 'x', kind: 'active' as const, importance: 2 as const };
    const later = { id: 'b', start: 20, end: 30, quote: 'y', kind: 'active' as const, importance: 2 as const };
    const proof = { tasks: [], evidence: [], superseded: [{ earlier, later }], warnings: [] };
    const cited = [{ id: 1, start: 0, end: 10, text: 'Plakat kosztuje stówkę.' }, { id: 2, start: 20, end: 30, text: 'Poprawka plakat kosztuje dwie stówki.' }];
    expect(checkPoint({ text: 'Plakat kosztuje stówkę', sourceIds: [1] }, cited, proof)).toContain('superseded');
    expect(checkPoint({ text: 'Plakat kosztuje stówkę', sourceIds: [1, 2] }, cited, proof)).not.toContain('superseded');
  });
});

describe('generateFastSummary', () => {
  const execution = {};
  beforeEach(() => model.mockReset());

  test('keeps checked model points and completes skipped essence verbatim', async () => {
    model.mockResolvedValue(reply([
      '- Rozmowa z promotorem o aplikacji [1]',
      '- Ola sprawdzi rozdział drugi do czwartku [7]',
    ].join('\n')));
    const result = await generateFastSummary(units, content, 'pl', execution);
    const texts = result.document!.points.map(point => point.text);
    expect(texts).toContain('Rozmowa z promotorem o aplikacji');
    expect(texts).toContain('Ola sprawdzi rozdział drugi do czwartku');
    // The dated amount sentence was skipped by the model, so it is added literally.
    expect(texts.some(text => text.includes('58 złotych'))).toBe(true);
    expect(result.modelPoints).toBe(2);
    expect(result.literalPoints).toBeGreaterThan(0);
    expect(result.document!.format).toBe('bullets');
    expect(result.document!.source).toBe(content);
  });

  test('replaces a point with a changed number by the literal source sentence', async () => {
    model.mockResolvedValue(reply('- Zapłacono 350 złotych za plakat [3]'));
    const result = await generateFastSummary(units, content, 'pl', execution);
    const texts = result.document!.points.map(point => point.text);
    expect(texts).not.toContain('Zapłacono 350 złotych za plakat');
    expect(texts).toContain('Zapłaciłem trzysta złotych za plakat.');
  });

  test('stops calling the model once the time budget is spent and keeps verbatim essence', async () => {
    let clock = 0;
    model.mockImplementation(async () => { clock += 1_000_000; return reply('- Rozmowa z promotorem o aplikacji [1]'); });
    const chunks = chunkUnits(units).length;
    const result = await generateFastSummary(units, content, 'pl', execution, undefined, () => clock);
    expect(model.mock.calls.length).toBeLessThanOrEqual(chunks);
    expect(result.budgetExceeded).toBe(chunks > 1);
    expect(result.document).not.toBeNull();
  });

  test('returns no document when nothing can be said', async () => {
    model.mockResolvedValue(reply('nic'));
    const filler = Array.from({ length: 14 }, () => 'To było bardzo ogólne zdanie bez treści.').join(' ');
    const result = await generateFastSummary(createSummarySources(filler), filler, 'pl', execution);
    expect(result.document).toBeNull();
  });
});
