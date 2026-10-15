import {
  mergedPercentForPrompt,
  spokenClockForPrompt,
  numberWordValue,
  numberSpans,
  statedNumbers,
  pointNumbers,
  wordsToDigits,
} from './polishNumbers';

describe('numberWordValue', () => {
  test('recognizes basic digit words', () => {
    expect(numberWordValue('jeden')).toBe(1);
    expect(numberWordValue('dwa')).toBe(2);
    expect(numberWordValue('trzy')).toBe(3);
    expect(numberWordValue('cztery')).toBe(4);
    expect(numberWordValue('pięć')).toBe(5);
    expect(numberWordValue('sześć')).toBe(6);
    expect(numberWordValue('siedem')).toBe(7);
    expect(numberWordValue('osiem')).toBe(8);
    expect(numberWordValue('dziewięć')).toBe(9);
    expect(numberWordValue('dziesięć')).toBe(10);
  });

  test('recognizes teen numbers', () => {
    expect(numberWordValue('jedenaście')).toBe(11);
    expect(numberWordValue('dwanaście')).toBe(12);
    expect(numberWordValue('trzynaście')).toBe(13);
    expect(numberWordValue('czternaście')).toBe(14);
    expect(numberWordValue('piętnaście')).toBe(15);
  });

  test('recognizes tens', () => {
    expect(numberWordValue('dwadzieścia')).toBe(20);
    expect(numberWordValue('trzydzieści')).toBe(30);
    expect(numberWordValue('czterdzieści')).toBe(40);
    expect(numberWordValue('pięćdziesiąt')).toBe(50);
    expect(numberWordValue('sześćdziesiąt')).toBe(60);
    expect(numberWordValue('siedemdziesiąt')).toBe(70);
    expect(numberWordValue('osiemdziesiąt')).toBe(80);
    expect(numberWordValue('dziewięćdziesiąt')).toBe(90);
  });

  test('recognizes hundreds', () => {
    expect(numberWordValue('sto')).toBe(100);
    expect(numberWordValue('dwieście')).toBe(200);
    expect(numberWordValue('trzysta')).toBe(300);
    expect(numberWordValue('czterysta')).toBe(400);
  });

  test('recognizes thousands', () => {
    expect(numberWordValue('tysiąc')).toBe(1000);
  });

  test('recognizes inflected forms', () => {
    expect(numberWordValue('jednym')).toBe(1);
    expect(numberWordValue('dwie')).toBe(2);
    expect(numberWordValue('trzech')).toBe(3);
  });

  test('recognizes ordinal words', () => {
    expect(numberWordValue('pierwszy')).toBe(1);
    expect(numberWordValue('drugi')).toBe(2);
    expect(numberWordValue('trzeci')).toBe(3);
  });

  test('rejects non-number words', () => {
    expect(numberWordValue('kot')).toBeNull();
    expect(numberWordValue('dom')).toBeNull();
    expect(numberWordValue('hello')).toBeNull();
  });

  test('rejects lookalike words', () => {
    expect(numberWordValue('jednak')).toBeNull();
    expect(numberWordValue('piątek')).toBeNull();
    expect(numberWordValue('czwartek')).toBeNull();
    expect(numberWordValue('dwór')).toBeNull();
  });

  test('is case-insensitive', () => {
    expect(numberWordValue('JEDEN')).toBe(1);
    expect(numberWordValue('Dwa')).toBe(2);
    expect(numberWordValue('TRZY')).toBe(3);
  });
});

describe('numberSpans', () => {
  test('finds single number words', () => {
    const spans = numberSpans('Muszę kupić dwa mleka');
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ value: 2, words: ['dwa'] });
  });

  test('combines adjoined number words', () => {
    const spans = numberSpans('dwadzieścia trzy');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.value).toBe(23);
    expect(spans[0]?.words).toEqual(['dwadzieścia', 'trzy']);
  });

  test('combines compound hundreds', () => {
    const spans = numberSpans('czterysta pięć');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.value).toBe(405);
  });

  test('combines thousands', () => {
    const spans = numberSpans('tysiąc czterysta');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.value).toBe(1400);
  });

  test('separates disconnected numbers', () => {
    const spans = numberSpans('mam osiem lat, za trzy dni');
    expect(spans).toHaveLength(2);
    expect(spans[0]?.value).toBe(8);
    expect(spans[1]?.value).toBe(3);
  });

  test('reports span positions', () => {
    const spans = numberSpans('On ma dwa koty i trzy psy');
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ start: 6, value: 2 });
    expect(spans[1]).toMatchObject({ start: 17, value: 3 });
  });

  test('handles text with lookalike words', () => {
    const spans = numberSpans('jednak trzy dni');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.value).toBe(3);
  });
});

describe('statedNumbers', () => {
  test('finds digits in text', () => {
    expect(statedNumbers('Zapłacić 50 zł').has(50)).toBe(true);
    expect(statedNumbers('123 złotych').has(123)).toBe(true);
  });

  test('finds compound number words', () => {
    expect(statedNumbers('dwadzieścia trzy').has(23)).toBe(true);
    expect(statedNumbers('tysiąc dwieście').has(1200)).toBe(true);
  });

  test('combines digits and words', () => {
    const nums = statedNumbers('Między 5 a 10 osób, czyli pięć do dziesięciu');
    expect(nums.has(5)).toBe(true);
    expect(nums.has(10)).toBe(true);
  });

  test('handles wpół do construct for half-hours', () => {
    const nums = statedNumbers('wpół do dziesiątej');
    expect(nums.has(9)).toBe(true);
    expect(nums.has(30)).toBe(true);
  });

  test('handles wpół do with hours above 24', () => {
    const nums = statedNumbers('wpół do dwunastej');
    expect(nums.has(11)).toBe(true);
    expect(nums.has(30)).toBe(true);
  });

  test('ignores wpół do hour for non-valid hours', () => {
    const nums = statedNumbers('wpół do czterdziestej');
    expect(nums.has(30)).toBe(false);
  });

  test('does not include 0', () => {
    expect(statedNumbers('zero').has(0)).toBe(false);
  });
});

describe('pointNumbers', () => {
  test('extracts digits from point text', () => {
    expect(pointNumbers('Kupić 5 jajek').has(5)).toBe(true);
    expect(pointNumbers('Wizyta o 14:30').has(14)).toBe(true);
    expect(pointNumbers('Wizyta o 14:30').has(30)).toBe(true);
  });

  test('extracts number words with digits removed', () => {
    const nums = pointNumbers('Kupić dwadzieścia trzy jajka i 5 chleby');
    expect(nums.has(23)).toBe(true);
    expect(nums.has(5)).toBe(true);
  });

  test('excludes 0', () => {
    expect(pointNumbers('Test zero value').has(0)).toBe(false);
  });

  test('returns empty set for text without numbers', () => {
    expect(pointNumbers('Bez liczb').size).toBe(0);
  });
});

describe('wordsToDigits', () => {
  test('converts simple date: dwudziestego ósmego', () => {
    const result = wordsToDigits('Operacja dwudziestego ósmego listopada');
    expect(result).toContain('28');
    expect(result).toContain('listopada');
  });

  test('converts clock time with hour ordinal', () => {
    const result = wordsToDigits('Spotkanie o szesnastej');
    expect(result).toContain('16:00');
  });

  test('converts clock time with hour and minutes', () => {
    const result = wordsToDigits('o szesnastej trzydzieści');
    expect(result).toContain('16:30');
  });

  test('converts wpół do time', () => {
    const result = wordsToDigits('wpół do ósmej');
    expect(result).toContain('7:30');
  });

  test('converts amounts with currency', () => {
    const result = wordsToDigits('sto dwadzieścia złotych');
    expect(result).toMatch(/120\s+zł/);
  });

  test('converts amounts with thousands', () => {
    const result = wordsToDigits('trzy tysiące złotych');
    expect(result).toMatch(/3000\s+zł/);
  });

  test('keeps ordinal adjectives that are not dates/times', () => {
    const result = wordsToDigits('rozdział drugi');
    expect(result).toContain('drugi');
    expect(result).not.toContain('2');
  });

  test('converts numbers in ranges', () => {
    const result = wordsToDigits('zarabiać między tysiąc a dwa tysiące');
    expect(result).toContain('1000');
    expect(result).toContain('2000');
  });

  test('handles text without numbers', () => {
    const result = wordsToDigits('Spotkanie w czwartek');
    expect(result).toBe('Spotkanie w czwartek');
  });

  test('does not convert day-of-month without month context', () => {
    const result = wordsToDigits('mam piątego w domu');
    // "piątego" alone is ambiguous, should stay as word
    expect(result).toContain('piąt');
  });

  test('converts standalone 1000 to tys.', () => {
    const result = wordsToDigits('koszt tysiąc pięćset złotych');
    expect(result).toMatch(/1500\s+zł/);
  });
});

describe('spoken clock for prompts', () => {
  it('joins the hour and minutes, keeping a hedge', () => {
    expect(spokenClockForPrompt('Jutro mam na godzinę ósmą chyba 30 zajęcia')).toBe('Jutro mam na godzinę ok. 8:30 zajęcia');
    expect(spokenClockForPrompt('o szesnastej trzydzieści u dentysty')).toBe('o 16:30 u dentysty');
    expect(spokenClockForPrompt('o osiemnastej czterdzieści pięć')).toBe('o 18:45');
  });
  it('leaves amounts, compound hours and plain ordinals alone', () => {
    expect(spokenClockForPrompt('o ósmej 30 zł za parking')).toBe('o ósmej 30 zł za parking');
    expect(spokenClockForPrompt('siedziałem do dwudziestej 2 nad testami')).toBe('siedziałem do dwudziestej 2 nad testami');
    expect(spokenClockForPrompt('rozdział drugi do czwartku')).toBe('rozdział drugi do czwartku');
  });
});

test('splits a recognizer-merged amount and percent for the model', () => {
  expect(mergedPercentForPrompt('mamy 12 025% dla nich')).toBe('mamy 12 000, 25% dla nich');
  expect(mergedPercentForPrompt('stałych 25% czyli')).toBe('stałych 25% czyli');
  expect(mergedPercentForPrompt('kosztuje 3 000 zł')).toBe('kosztuje 3 000 zł');
});
