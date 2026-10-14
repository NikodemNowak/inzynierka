import { generate, getContextWindowSize, measureFormattedPromptTokens, type GenerationResult } from './llm';
import { noteSourceSystem } from './sharedSourcePrompt';
import {
  TASK_LINES_PROMPT,
  applyCorrections,
  cleanDue,
  clockUnanchored,
  dedupeTasks,
  extractTaskLines,
  cancelledFilter,
  dropClosingDue,
  finalizeTasks,
  mergeVague,
  nominalListTasks,
  repairReminder,
  repairVerb,
  selectCandidates,
  splitCompound,
  hourValues,
  isOtherOwned,
  isDegenerate,
  isTaskCandidate,
  numbersAnchored,
  ownerFilter,
  parseTaskLines,
  postprocessTaskLines,
  recoverAmount,
  sourceNumbers,
  splitTitleDue,
  supersededFilter,
  taskNumbers,
  tidyTask,
  validateTasks,
  wordsToDigits,
  type TaskDraft,
} from './taskLines';

jest.mock('./llm', () => ({
  generate: jest.fn(),
  getContextWindowSize: jest.fn(() => 8192),
  measureFormattedPromptTokens: jest.fn(),
}));
jest.mock('./generationMetrics', () => ({ recordGeneration: jest.fn() }));

const model = jest.mocked(generate);
const measure = jest.mocked(measureFormattedPromptTokens);
const draft = (title: string, due: string | null, ...ids: number[]): TaskDraft => ({ title, due, sourceIds: ids, modelIds: [...ids] });
const units = (...texts: string[]) => texts.map((text, index) => ({ id: index + 1, text }));
const reply = (text: string, stoppedLimit = false): GenerationResult => ({
  text, ttftMs: 1, tokensPerSecond: 20, wallMs: 2, promptMs: 1, predictedMs: 1, promptTokens: 10, predictedTokens: 5,
  completion: { status: stoppedLimit ? 'stopped_limit' : 'complete', truncated: false, stoppedLimit, contextFull: false, interrupted: false, stoppedEos: !stoppedLimit, stoppingWord: '' },
});

describe('splitTitleDue', () => {
  test('splits on the first dash variant and capitalises the title', () => {
    expect(splitTitleDue('oddać raport — do czwartku')).toEqual({ title: 'Oddać raport', due: 'do czwartku' });
    expect(splitTitleDue('Oddać raport – środa')).toEqual({ title: 'Oddać raport', due: 'środa' });
    expect(splitTitleDue('Oddać raport - środa - rano')).toEqual({ title: 'Oddać raport', due: 'środa - rano' });
    expect(splitTitleDue('Oddać raport -- środa')).toEqual({ title: 'Oddać raport', due: 'środa' });
  });
  test('keeps hyphenated words and treats "brak" as no due', () => {
    expect(splitTitleDue('Kupić czarno-białe zdjęcia')).toEqual({ title: 'Kupić czarno-białe zdjęcia', due: null });
    expect(splitTitleDue('Kupić mleko — brak terminu')).toEqual({ title: 'Kupić mleko', due: null });
  });
  test('reads a trailing parenthesis as the due', () => {
    expect(splitTitleDue('Oddać książkę (sobota).')).toEqual({ title: 'Oddać książkę', due: 'sobota' });
  });
});

describe('parseTaskLines', () => {
  const allowed = new Set([1, 2, 3, 4, 5]);
  test('keeps only lines of the batch and skips dashes and BRAK', () => {
    const text = '[1] Oddać projekt — czwartek\n[2] -\n[3] —\n[4] BRAK\n[9] Kupić mleko\nnoise\n[5]   ';
    expect(parseTaskLines(text, allowed)).toEqual([{ title: 'Oddać projekt', due: 'czwartek', sourceIds: [1], modelIds: [] }]);
  });
  test('splits several tasks of one sentence on "|"', () => {
    const tasks = parseTaskLines('[2] Zadzwonić do lekarza — jutro | Kupić leki', allowed);
    expect(tasks.map(t => [t.title, t.due, t.sourceIds])).toEqual([['Zadzwonić do lekarza', 'jutro', [2]], ['Kupić leki', null, [2]]]);
  });
  test('repairs a placeholder title', () => {
    const tasks = parseTaskLines('[3] Czynność — zarezerwować nocleg – piątek', allowed);
    expect(tasks.map(t => [t.title, t.due])).toEqual([['Zarezerwować nocleg', 'piątek']]);
  });
  test('handles CRLF line endings', () => {
    expect(parseTaskLines('[1] Kupić chleb\r\n[2] Zapłacić rachunek', allowed)).toHaveLength(2);
  });
});

describe('cleanDue', () => {
  test('moves a condition into the title', () => {
    expect(cleanDue(draft('Zadzwonić do szefa', 'jeśli nie odpisze', 1))).toMatchObject({ title: 'Zadzwonić do szefa, jeśli nie odpisze', due: null });
  });
  test('keeps temporal dues and numeral dues', () => {
    expect(cleanDue(draft('Oddać projekt', ' czwartek ', 1)).due).toBe('czwartek');
    expect(cleanDue(draft('Zapłacić', 'do piętnastego', 1)).due).toBe('do piętnastego');
  });
  test('moves digit details into the title and drops other text', () => {
    expect(cleanDue(draft('Zapłacić rachunek', '50 zł', 1))).toMatchObject({ title: 'Zapłacić rachunek 50 zł', due: null });
    expect(cleanDue(draft('Kupić jajka', 'bio', 1)).due).toBeNull();
  });
});

describe('isTaskCandidate', () => {
  test.each([
    'Muszę zapłacić rachunek.',
    'Trzeba kupić mleko.',
    'Zadzwonię do mamy.',
    'Dentystę mam w środę.',
    'W piątek o ósmej jest spotkanie z klientem.',
    'Żeby nie zapomnieć o paczce.',
    'Do końca tygodnia oddam raport.',
    'Jeśli Igor nie przyśle umowy, napiszę do niego.',
    'Wyślę ofertę w czwartek.',
    'Ćwiczyć rano.',
  ])('accepts %s', (text) => expect(isTaskCandidate(text)).toBe(true));
  test.each([
    'Pogoda była ładna.',
    'Dobra, okej.',
    'Łódź jest piękna.',
    'To było fajne.',
  ])('rejects %s', (text) => expect(isTaskCandidate(text)).toBe(false));
  test('word boundaries respect Polish letters', () => {
    // "żmusze" must not match the modal "musze" and "łkupi" must not match "kupi".
    expect(isTaskCandidate('Łkupi żmusze.')).toBe(false);
  });
});

describe('numerals', () => {
  test('sourceNumbers reads spoken numbers, sequences and half hours', () => {
    expect(sourceNumbers('sześćdziesiąt złotych').has(60)).toBe(true);
    expect(sourceNumbers('tysiąc dwieście złotych').has(1200)).toBe(true);
    expect(sourceNumbers('dwudziestego trzeciego').has(23)).toBe(true);
    expect(sourceNumbers('wpół do dwunastej').has(11)).toBe(true);
    expect(sourceNumbers('wpół do dwunastej').has(30)).toBe(true);
    expect(sourceNumbers('kwadrans po ósmej').has(15)).toBe(true);
    expect(sourceNumbers('w czwartek').size).toBe(0);
    expect(sourceNumbers('piątek rano').size).toBe(0);
    expect(sourceNumbers('38,5 stopnia').has(38.5)).toBe(true);
  });
  test('taskNumbers reads digits written by the model', () => {
    expect(taskNumbers('Wizyta o 14:00')).toEqual([14]);
    expect(taskNumbers('Zapłacić 1 200 zł')).toEqual([1200]);
    expect(taskNumbers('Zmierzyć 38,5')).toEqual([38.5]);
    expect(taskNumbers('Kupić 12 jajek i 3 chleby')).toEqual([12, 3]);
  });
  test('numbersAnchored flags numbers missing from the source', () => {
    expect(numbersAnchored('Kupić 12 jajek', 'Kupię dwanaście jajek.')).toEqual([]);
    expect(numbersAnchored('Kupić 15 jajek', 'Kupię dwanaście jajek.')).toEqual([15]);
  });
  test('hourValues and clockUnanchored', () => {
    expect([...hourValues('Spotkanie o dziesiątej, potem o szesnastej piętnaście.')].sort()).toEqual([10, 16]);
    expect(clockUnanchored('Wizyta 15:30', 'Wizyta o trzynastej.')).toEqual(['15:30']);
    expect(clockUnanchored('Wizyta 13:30', 'Wizyta o trzynastej.')).toEqual([]);
  });
  test('wordsToDigits converts numerals but keeps ordinal adjectives', () => {
    expect(wordsToDigits('Zapłacić osiemdziesiąt złotych')).toBe('Zapłacić 80 złotych');
    expect(wordsToDigits('do pierwszego listopada')).toBe('do 1 listopada');
    expect(wordsToDigits('o ósmej')).toBe('o 8:00');
    expect(wordsToDigits('Anulować drugą subskrypcję')).toBe('Anulować drugą subskrypcję');
  });
});

describe('tidyTask', () => {
  test('strips trailing punctuation and dangling prepositions', () => {
    expect(tidyTask(draft('oddać raport do -', 'czwartek.', 1))).toMatchObject({ title: 'Oddać raport', due: 'czwartek' });
  });
  test('turns a count-like due into digits in the title', () => {
    expect(tidyTask(draft('Zapłacić rachunek', 'osiemdziesiąt złotych', 1))).toMatchObject({ title: 'Zapłacić rachunek 80 złotych', due: null });
  });
  test('splits a glued infinitive', () => {
    expect(tidyTask(draft('Dokupićubezpieczenie', null, 1)).title).toBe('Dokupić ubezpieczenie');
  });
});

describe('finalizeTasks', () => {
  test('drops negations, placeholders and Name + infinitive', () => {
    const { kept, rejected } = finalizeTasks([
      draft('Nie kupować tortu', null, 1),
      draft('Czynność', null, 2),
      draft('Ewa przygotować prezentację', null, 3),
      draft('Oddać projekt', 'czwartek', 4),
      draft('Wizyta u fryzjera', '13:00', 5),
    ]);
    expect(kept.map(t => t.title)).toEqual(['Oddać projekt', 'Wizyta u fryzjera']);
    expect(rejected).toHaveLength(3);
  });
  test('merges tasks that contain each other and unions the sources', () => {
    const { kept } = finalizeTasks([draft('Kupić mleko', null, 1), draft('Kupić mleko i chleb', 'jutro', 2)]);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ title: 'Kupić mleko i chleb', due: 'jutro', sourceIds: [1, 2] });
  });
});

describe('applyCorrections', () => {
  test('the weekday after "nie, czekaj" wins', () => {
    const u = units('Raport oddam do środy, nie, czekaj, do czwartku.');
    expect(applyCorrections(draft('Oddać raport', 'środa', 1), u).due).toBe('czwartek');
  });
  test('the weekday after "przełożyli" wins and keeps the time of day', () => {
    const u = units('Lekarz był we wtorek, ale przełożyli na piątek rano.');
    expect(applyCorrections(draft('Wizyta u lekarza', 'wtorek', 1), u).due).toBe('piątek rano');
  });
  test('a number said before the correction is replaced by the later one', () => {
    const u = units('Zapłacić pięćdziesiąt złotych, nie, czekaj, sześćdziesiąt.');
    expect(applyCorrections(draft('Zapłacić 50 zł', null, 1), u).title).toBe('Zapłacić 60 zł');
  });
  test('without a cue nothing changes', () => {
    const task = draft('Oddać raport', 'środa', 1);
    expect(applyCorrections(task, units('Raport oddam do środy.'))).toBe(task);
  });
});

describe('validateTasks', () => {
  const u = units(
    'Muszę kupić dwanaście jajek na ciasto.',
    'Dentysta mam we wtorek o czternastej.',
    'Zapłacić rachunek za prąd do piętnastego.',
    'Pogoda była ładna.',
    'Potem napiszę maila do Igora.',
  );
  test('rejects unknown ids', () => {
    const { kept, rejected } = validateTasks([draft('Kupić jajka', null, 99)], u);
    expect(kept).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('no valid source ids');
  });
  test('rejects a title not anchored in the cited sentence or its neighbours', () => {
    const { kept, rejected } = validateTasks([draft('Zarezerwować hotel', null, 4)], u);
    expect(kept).toHaveLength(0);
    expect(rejected[0]?.reason).toBe('title not anchored in cited sentences');
  });
  test('accepts a title anchored in a neighbouring sentence and widens the ids', () => {
    const { kept } = validateTasks([draft('Napisać maila do Igora', null, 4)], u);
    expect(kept[0]?.sourceIds).toEqual([4, 5]);
  });
  test('checks numbers with the Polish numeral parser', () => {
    expect(validateTasks([draft('Kupić 12 jajek', null, 1)], u).kept).toHaveLength(1);
    const bad = validateTasks([draft('Kupić 15 jajek', null, 1)], u);
    expect(bad.kept).toHaveLength(0);
    expect(bad.rejected[0]?.reason).toBe('title value not in source');
  });
  test('removes a clock time that is not in the source from the title', () => {
    const { kept } = validateTasks([draft('Dentysta o 16:00', 'wtorek', 2)], u);
    expect(kept[0]?.title).toBe('Dentysta');
  });
  test('keeps an anchored clock time and weekday in the due', () => {
    const { kept } = validateTasks([draft('Dentysta', 'wtorek 14:00', 2)], u);
    expect(kept[0]?.due).toBe('wtorek 14:00');
  });
  test('drops an unanchored due but keeps the task', () => {
    const { kept } = validateTasks([draft('Zapłacić rachunek za prąd', 'grudzień', 3), draft('Dentysta', 'środa', 2)], u);
    expect(kept.map(t => t.due)).toEqual([null, null]);
  });
  test('days, months and "jutro" must occur in the sentence', () => {
    expect(validateTasks([draft('Zapłacić rachunek za prąd', 'jutro', 3)], u).kept[0]?.due).toBeNull();
    expect(validateTasks([draft('Zapłacić rachunek za prąd', 'do 15', 3)], u).kept[0]?.due).toBe('do 15');
  });
  test('a weekday-looking ordinal is not a weekday', () => {
    const ordinal = units('Zapłacić rachunek do piątego.');
    expect(validateTasks([draft('Zapłacić rachunek', 'do 5', 1)], ordinal).kept[0]?.due).toBe('do 5');
    expect(validateTasks([draft('Zapłacić rachunek', 'piątek', 1)], ordinal).kept[0]?.due).toBeNull();
  });
  test('an appointment noun may be anchored by its due alone', () => {
    const appointment = units('W środę o dziesiątej jestem umówiony.');
    expect(validateTasks([draft('Wizyta u lekarza', 'środa 10:00', 1)], appointment).kept).toHaveLength(1);
  });
});

describe('ownerFilter and supersededFilter', () => {
  test('isOtherOwned recognises another subject but not the author', () => {
    expect(isOtherOwned('Ewa ma przygotować prezentację, to jej działka.')).toBe(true);
    expect(isOtherOwned('Kasia odbierze paczkę.')).toBe(true);
    expect(isOtherOwned('Ewa ma przygotować prezentację, a ja muszę ją przejrzeć.')).toBe(false);
    expect(isOtherOwned('Muszę kupić prezent.')).toBe(false);
  });
  test('ownerFilter judges the sentence the model cited', () => {
    const u = units('Ewa ma przygotować prezentację.', 'Muszę wysłać raport.');
    const { kept, rejected } = ownerFilter([draft('Przygotować prezentację', null, 1), draft('Wysłać raport', null, 2)], u);
    expect(kept.map(t => t.title)).toEqual(['Wysłać raport']);
    expect(rejected[0]?.reason).toBe('other person');
  });
  test('supersededFilter drops a replaced plan unless the sentence changes it', () => {
    const u = units('Spotkanie miało być w czwartek.', 'Spotkanie miało być w czwartek, ale jednak jest w piątek.');
    const { kept } = supersededFilter([draft('Spotkanie', 'czwartek', 1), draft('Spotkanie', 'piątek', 2)], u);
    expect(kept.map(t => t.due)).toEqual(['piątek']);
  });
});

describe('recoverAmount and dedupeTasks', () => {
  test('re-attaches the single amount of the cited sentence', () => {
    const u = units('Ratę za laptopa, tysiąc dwieście złotych, zapłacę w piątek.');
    expect(recoverAmount(draft('Zapłacić ratę za laptopa', 'piątek', 1), u).title).toBe('Zapłacić ratę za laptopa 1200 zł');
  });
  test('a later amount after a correction wins', () => {
    const u = units('Zapłacić za laptopa osiemdziesiąt złotych, nie, czekaj, sto złotych.');
    expect(recoverAmount(draft('Zapłacić za laptopa', null, 1), u).title).toBe('Zapłacić za laptopa 100 zł');
  });
  test('does nothing when the title has a number or the amount is ambiguous', () => {
    const u = units('Kupić mleko za trzy złote i chleb za pięć złotych.');
    expect(recoverAmount(draft('Kupić mleko', null, 1), u).title).toBe('Kupić mleko');
    expect(recoverAmount(draft('Kupić 2 mleka', null, 1), u).title).toBe('Kupić 2 mleka');
  });
  test('dedupeTasks ignores case and punctuation', () => {
    expect(dedupeTasks([draft('Kupić mleko', null, 1), draft('kupić  mleko!', null, 2), draft('Kupić chleb', null, 3)])).toHaveLength(2);
  });
});

describe('postprocessTaskLines', () => {
  test('runs the guards in order and reports rejections', () => {
    const u = units(
      'Oddam raport do środy, nie, czekaj, do czwartku.',
      'Ewa ma przygotować prezentację.',
      'Nie kupuję tortu.',
      'Muszę zarezerwować hotel w sierpniu.',
    );
    const raw = [
      draft('Oddać raport', 'środa', 1),
      draft('Przygotować prezentację', null, 2),
      draft('Nie kupować tortu', null, 3),
      draft('Zarezerwować hotel', 'wrzesień', 4),
      draft('Zarezerwować hotel', 'sierpień', 4),
    ];
    const { kept, rejected } = postprocessTaskLines(raw, u);
    expect(kept.map(t => [t.title, t.due])).toEqual([['Oddać raport', 'czwartek'], ['Zarezerwować hotel', null]]);
    expect(rejected.map(r => r.reason)).toEqual(expect.arrayContaining(['not an action', 'other person']));
  });
});

describe('class fixes', () => {
  test('selectCandidates adds a list fragment only shortly after a shopping cue', () => {
    const u = units('Lista zakupów na weekend.', 'Marchewki, jogurt, mąka, olej.', 'Pogoda była ładna.', 'Było miło.', 'Ryż, szynka, ser, mleko.')
    expect(selectCandidates(u).map(x => x.id)).toEqual([1, 2])
    expect(selectCandidates(units('Marchewki, jogurt, mąka, olej.')).map(x => x.id)).toEqual([])
  })
  test('"marchewki" is not the month of March', () => {
    expect(isTaskCandidate('Marchewki, jogurt i mąka.')).toBe(false)
    expect(isTaskCandidate('W marcu mam egzamin.')).toBe(true)
  })
  test('new candidate cues: reminders, "po pierwsze", "pamiętaj"', () => {
    for (const t of ['Przypomnij mi o urodzinach cioci.', 'Po drugie wysłać skan umowy.', 'Pamiętaj, żeby wziąć klucze.'])
      expect(isTaskCandidate(t)).toBe(true)
  })
  test('nominalListTasks turns verbless lists after a cue into one "Kupić:" task', () => {
    const u = units('Dobra, lista zakupów.', 'Pomidory pół kilo, makaron dwie paczki, ser feta, papier toaletowy.', 'Do tego szampon i pasta.', 'Idę do domu.')
    expect(nominalListTasks(u).map(t => [t.title, t.sourceIds])).toEqual([
      ['Kupić: pomidory pół kilo, makaron 2 paczki, ser feta, papier toaletowy, szampon i pasta', [2, 3]],
    ])
  })
  test('nominalListTasks ignores negations, verbs and uncued sentences', () => {
    expect(nominalListTasks(units('Lista zakupów.', 'Mleka nie trzeba, jeszcze są dwa kartony.', 'Tak, Okęcie, 17, sprawdzałem rano.'))).toEqual([])
    expect(nominalListTasks(units('Pomidory, makaron, ser, olej.'))).toEqual([])
  })
  test('repairReminder rebuilds a garbled "Zapomnieć" title from the sentence', () => {
    const u = units('Przypomnij mi, żebym jutro przed dziewiątą oddzwonił do pana z warsztatu.')
    const fixed = repairReminder(draft('Zapomnijć o zadzwonieniu do pana', null, 1), u)
    expect(fixed).toMatchObject({ title: 'Oddzwonić do pana z warsztatu', due: 'jutro przed 9' })
    expect(repairReminder(draft('Zapomnieć o czymś', null, 1), units('Pogoda.'))).toBeNull()
    expect(repairReminder(draft('Kupić chleb', null, 1), u)).toMatchObject({ title: 'Kupić chleb' })
  })
  test('repairReminder handles "przypomnij mi o X w sobotę"', () => {
    const fixed = repairReminder(draft('Zapomnienie, żebym', null, 1), units('Przypomnij mi też o urodzinach cioci w sobotę.'))
    expect(fixed).toMatchObject({ title: 'Pamiętać o urodzinach cioci', due: 'w sobotę' })
  })
  test('repairVerb swaps an invented infinitive for a close one used in the sentence', () => {
    const u = units('Mam odebrać Stasia ze szkoły.')
    expect(repairVerb(draft('Odbić Stasia', null, 1), u).title).toBe('Odebrać Stasia')
    expect(repairVerb(draft('Odebrać Stasia', null, 1), u).title).toBe('Odebrać Stasia')
    expect(repairVerb(draft('Zadzwonić do Ewy', null, 1), u).title).toBe('Zadzwonić do Ewy')
  })
  test('dropClosingDue removes an opening-hours time but keeps real deadlines', () => {
    const u = units('Muszę wstąpić do apteki, zamykają o dwudziestej.', 'Muszę wstąpić do poczty, zamykają o dwudziestej, najlepiej w piątek.')
    expect(dropClosingDue(draft('Wstąpić do apteki', 'do 20:00', 1), u).due).toBeNull()
    expect(dropClosingDue(draft('Wstąpić do poczty', 'piątek', 2), u).due).toBe('piątek')
  })
  test('wordsToDigits writes "do osiemnastej" as a clock time', () => {
    expect(wordsToDigits('do osiemnastej')).toBe('do 18:00')
    expect(wordsToDigits('do piętnastego')).toBe('do 15')
  })
  test('cancelledFilter drops tasks whose own clause is cancelled', () => {
    const u = units('Kawy nie trzeba kupować, mam jeszcze pół paczki.', 'Soku nie trzeba, chleb kupić.')
    const { kept, rejected } = cancelledFilter([draft('Kupić kawę', null, 1), draft('Kupić chleb', null, 2)], u)
    expect(kept.map(t => t.title)).toEqual(['Kupić chleb'])
    expect(rejected.map(r => r.reason)).toEqual(['cancelled'])
  })
  test('ownerFilter rejects "Ola zajmuje się ..." and "mama bierze ..."', () => {
    expect(isOtherOwned('Ola zajmuje się rezerwacją sali.')).toBe(true)
    expect(isOtherOwned('Mama bierze dzieci na weekend.')).toBe(true)
    expect(isOtherOwned('Ola zajmuje się salą, a ja zadzwonię do firmy.')).toBe(false)
  })
  test('splitCompound makes one task per infinitive and shares the due', () => {
    expect(splitCompound(draft('Sprawdzić opony, dolać płynu i zatankować', 'piątek', 1)).map(t => [t.title, t.due])).toEqual([
      ['Sprawdzić opony', 'piątek'], ['Dolać płynu', 'piątek'], ['Zatankować', 'piątek'],
    ])
    expect(splitCompound(draft('Kupić: ryż, ser', null, 1))).toHaveLength(1)
  })
  test('mergeVague moves the due of "Kupić wszystko" onto the list task', () => {
    const merged = mergeVague([draft('Kupić: farba, wałek', null, 2), draft('Kupić wszystko', 'środa', 3)])
    expect(merged.map(t => [t.title, t.due])).toEqual([['Kupić: farba, wałek', 'środa']])
  })
  test('tidyTask drops a bare month as a due', () => {
    expect(tidyTask(draft('Odpisać Markowi', 'wrzesień', 1)).due).toBeNull()
    expect(tidyTask(draft('Zapłacić', 'do 15 września', 1)).due).toBe('do 15 września')
  })
  test('isDegenerate detects a looping answer', () => {
    expect(isDegenerate('[1] -\n[2] Kupić x\n[3] Kupić x\n[4] Kupić x')).toBe(true)
    expect(isDegenerate('[1] -\n[2] -\n[3] -\n[4] -')).toBe(false)
  })
})

// Distinct 4-letter stems, so the duplicate merge does not join the tasks.
const word = (n: number): string => `zx${String.fromCharCode(97 + Math.floor(n / 26))}${String.fromCharCode(97 + (n % 26))}ak`;
const manyUnits = (count: number) => Array.from({ length: count }, (_, index) => ({ id: index + 1, text: `Muszę kupić ${word(index + 1)} jutro.` }));

describe('extractTaskLines', () => {
  const noteUnits = [
    { id: 1, text: 'Pogoda była ładna.' },
    { id: 2, text: 'Muszę oddać raport do czwartku.' },
    { id: 3, text: 'Ewa ma przygotować prezentację.' },
    { id: 4, text: 'Dobra, okej.' },
    { id: 5, text: 'Trzeba zapłacić za internet, sześćdziesiąt złotych.' },
  ];
  beforeEach(() => {
    model.mockReset();
    measure.mockReset().mockResolvedValue(3000);
    jest.mocked(getContextWindowSize).mockReturnValue(8192);
  });

  test('English returns an empty result without calling the model', async () => {
    expect(await extractTaskLines(noteUnits, 'en')).toEqual({ tasks: [], rendered: [], warnings: [] });
    expect(model).not.toHaveBeenCalled();
  });

  test('a note without candidate sentences makes no model call', async () => {
    const result = await extractTaskLines([{ id: 1, text: 'Pogoda była ładna.' }, { id: 2, text: 'Dobra, okej.' }], 'pl');
    expect(result.tasks).toEqual([]);
    expect(model).not.toHaveBeenCalled();
  });

  test('sends the full numbered source once and the candidate sentences in the tail', async () => {
    model.mockResolvedValue(reply('[2] Oddać raport — do czwartku\n[5] Zapłacić za internet 60 zł'));
    const result = await extractTaskLines(noteUnits, 'pl');
    expect(model).toHaveBeenCalledTimes(1);
    const [prompt, , options] = model.mock.calls[0]!;
    expect(prompt.startsWith('/no_think\nSOURCE_START\n[1] Pogoda była ładna.\n[2] Muszę')).toBe(true);
    expect(prompt).toContain('\nSOURCE_END\n' + TASK_LINES_PROMPT + '\n\nTeraz zdania tej notatki.\nZDANIA:\n[2] Muszę oddać raport do czwartku.\n[5] Trzeba zapłacić');
    expect(prompt.endsWith('\nODPOWIEDŹ:\n')).toBe(true);
    expect(prompt.split('ZDANIA:\n')[2]).not.toContain('[1]');
    expect(options).toMatchObject({ system: noteSourceSystem('pl'), temperature: 0.1, topP: 0.8, topK: 20, minP: 0, nPredict: 40 + 22 * 2 });
    expect(result.rendered).toEqual(['Oddać raport — do czwartku', 'Zapłacić za internet 60 zł']);
    expect(result.tasks[0]).toEqual({ title: 'Oddać raport', due: 'do czwartku', sourceIds: [2] });
    expect(result.warnings).toEqual([]);
  });

  test('splits into batches of 24 when 64 sentences would not fit the context', async () => {
    const many = manyUnits(70);
    measure.mockImplementation(async ({ userPrompt }) => 5000 + 60 * (userPrompt.split('ZDANIA:\n')[2]!.split('\n').length - 1));
    model.mockImplementation(async (prompt) => {
      const ids = [...prompt.split('ZDANIA:\n')[2]!.matchAll(/^\[(\d+)\]/gmu)].map(match => Number(match[1]));
      return reply(ids.map(id => `[${id}] Kupić ${word(id)} — jutro`).join('\n') + '\n[999] Kupić nic');
    });
    const result = await extractTaskLines(many, 'pl');
    expect(model.mock.calls.map(call => (call[2]?.nPredict))).toEqual([40 + 22 * 24, 40 + 22 * 24, 40 + 22 * 22]);
    expect(result.tasks).toHaveLength(70);
    expect(result.tasks.every(task => task.due === 'jutro')).toBe(true);
  });

  test('ids outside the current batch are ignored', async () => {
    const many = manyUnits(70);
    measure.mockImplementation(async ({ userPrompt }) => 5000 + 60 * (userPrompt.split('ZDANIA:\n')[2]!.split('\n').length - 1));
    model.mockResolvedValue(reply(`[1] Kupić ${word(1)}\n[70] Kupić ${word(70)}`));
    const result = await extractTaskLines(many, 'pl');
    expect(result.tasks.map(task => task.sourceIds)).toEqual([[1], [70]]);
  });

  test('warns when even one sentence does not fit', async () => {
    measure.mockResolvedValue(8180);
    const result = await extractTaskLines(noteUnits, 'pl');
    expect(model).not.toHaveBeenCalled();
    expect(result.warnings).toHaveLength(1);
  });

  test('warns when the answer hit the token limit', async () => {
    model.mockResolvedValue(reply('[2] Oddać raport — do czwartku', true));
    const result = await extractTaskLines(noteUnits, 'pl');
    expect(result.tasks).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  test('guards drop invented and foreign tasks', async () => {
    model.mockResolvedValue(reply('[2] Oddać raport — do piątku\n[3] Przygotować prezentację\n[5] Zarezerwować hotel'));
    const result = await extractTaskLines(noteUnits, 'pl');
    expect(result.rendered).toEqual(['Oddać raport']);
  });

  test('an aborted run does not call the model', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(extractTaskLines(noteUnits, 'pl', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(model).not.toHaveBeenCalled();
  });

  test('an interrupted generation throws', async () => {
    const interrupted = reply('[2] Oddać raport');
    model.mockResolvedValue({ ...interrupted, completion: { ...interrupted.completion!, interrupted: true } });
    await expect(extractTaskLines(noteUnits, 'pl')).rejects.toThrow('Generation interrupted');
  });
});
