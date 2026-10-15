import { generate, getContextWindowSize, measureFormattedPromptTokens, type GenerationResult } from './llm';
import { noteSourceSystem } from './sharedSourcePrompt';
import {
  answeredCount,
  completeObjectClause,
  dueFromSentenceLead,
  continuationHint,
  modalTask,
  cutLine,
  withWeekday,
  dativeName,
  dativeOf,
  perfective,
  TASK_LINES_PROMPT,
  applyCorrections,
  cleanDue,
  clockUnanchored,
  dedupeTasks,
  extractTaskLines,
  cancelledFilter,
  dropClosingDue,
  foldScripts,
  groundTasks,
  groundVerb,
  keepCondition,
  meetingToAction,
  repairDueDate,
  repairNumberUnits,
  finalizeTasks,
  mergeVague,
  nominalListTasks,
  repairReminder,
  repairVerb,
  selectCandidates,
  splitCompound,
  candidateScore,
  cutAnswer,
  dueFromOwnSentence,
  isDateOnlySentence,
  isMergedEvents,
  isPastNarration,
  isVagueTitle,
  limitCandidates,
  MAX_CANDIDATES_LONG,
  toInfinitive,
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
    expect(options).toMatchObject({ system: noteSourceSystem('pl'), temperature: 0.1, topP: 0.8, topK: 20, minP: 0, nPredict: 40 + 18 * 2 });
    expect(result.rendered).toEqual(['Oddać raport — do czwartku', 'Zapłacić za internet 60 zł']);
    expect(result.tasks[0]).toEqual({ title: 'Oddać raport', due: 'do czwartku', sourceIds: [2] });
    expect(result.warnings).toEqual([]);
  });

  test('splits into batches of 24 when 64 sentences would not fit the context', async () => {
    const many = manyUnits(40);
    measure.mockImplementation(async ({ userPrompt }) => 5000 + 80 * (userPrompt.split('ZDANIA:\n')[2]!.split('\n').length - 1));
    model.mockImplementation(async (prompt) => {
      const ids = [...prompt.split('ZDANIA:\n')[2]!.matchAll(/^\[(\d+)\]/gmu)].map(match => Number(match[1]));
      return reply(ids.map(id => `[${id}] Kupić ${word(id)} — jutro`).join('\n') + '\n[999] Kupić nic');
    });
    const result = await extractTaskLines(many, 'pl');
    expect(model.mock.calls.map(call => (call[2]?.nPredict))).toEqual([40 + 18 * 24, 40 + 18 * 16]);
    expect(result.tasks).toHaveLength(40);
    expect(result.tasks.every(task => task.due === 'jutro')).toBe(true);
  });

  test('ids outside the current batch are ignored', async () => {
    const many = manyUnits(40);
    measure.mockImplementation(async ({ userPrompt }) => 5000 + 80 * (userPrompt.split('ZDANIA:\n')[2]!.split('\n').length - 1));
    model.mockResolvedValue(reply(`[1] Kupić ${word(1)}\n[40] Kupić ${word(40)}\n[99] Kupić ${word(99)}`));
    const result = await extractTaskLines(many, 'pl');
    expect(result.tasks.some(task => task.sourceIds.includes(99))).toBe(false);
    // Sentences the model skipped come back from their own "muszę + verb + object".
    expect(result.tasks.map(task => task.sourceIds[0])).toEqual(many.map(unit => unit.id));
  });

  test('warns when even one sentence does not fit', async () => {
    measure.mockResolvedValue(8180);
    const result = await extractTaskLines(noteUnits, 'pl');
    expect(model).not.toHaveBeenCalled();
    expect(result.warnings).toHaveLength(1);
  });

  test('warns when a cut answer makes no progress in its follow-up call', async () => {
    model.mockResolvedValue(reply('[2] Oddać raport — do czwartku\n[5] Zapłacić za int', true));
    const result = await extractTaskLines(noteUnits, 'pl');
    expect(model).toHaveBeenCalledTimes(2);
    // The unanswered "Trzeba zapłacić za internet" is recovered from its own wording.
    expect(result.tasks.map(task => task.title)).toEqual(['Oddać raport', 'Zapłacić za internet 60 zł']);
    expect(result.warnings).toHaveLength(1);
  });

  test('sentences left unanswered by a cut answer go to a follow-up call', async () => {
    model
      .mockResolvedValueOnce(reply('[2] Oddać raport — do czwartku\n[5] Zapłacić za int', true))
      .mockResolvedValueOnce(reply('[5] Zapłacić za internet 60 zł'));
    const result = await extractTaskLines(noteUnits, 'pl');
    const tail = model.mock.calls[1]![0].split('ZDANIA:\n')[2]!;
    expect(tail.startsWith('[5] Trzeba zapłacić')).toBe(true);
    expect(tail).not.toContain('[2]');
    expect(result.rendered).toEqual(['Oddać raport — do czwartku', 'Zapłacić za internet 60 zł']);
    expect(result.warnings).toEqual([]);
  });

  test('answeredCount follows the last answered id of the batch', () => {
    const batch = [{ id: 2 }, { id: 5 }, { id: 9 }];
    expect(answeredCount('[2] -\n[5] Kupić mleko', batch)).toBe(2);
    expect(answeredCount('', batch)).toBe(0);
    expect(answeredCount('[7] Coś', batch)).toBe(0);
  });

  test('a long note sends only its most binding sentences', async () => {
    const filler = Array.from({ length: 60 }, (_, index) => ({ id: index + 1, text: `W piątek ${word(index + 1)} zajęcia ${'słowo '.repeat(14)}.` }));
    const binding = Array.from({ length: 40 }, (_, index) => ({ id: 61 + index, text: `Muszę kupić ${word(100 + index)} jutro.` }));
    model.mockResolvedValue(reply('[61] Kupić coś'));
    await extractTaskLines([...filler, ...binding], 'pl');
    const sent = [...model.mock.calls[0]![0].split('ZDANIA:\n')[2]!.matchAll(/^\[(\d+)\]/gmu)].map(match => Number(match[1]));
    expect(sent).toEqual(binding.slice(0, MAX_CANDIDATES_LONG).map(unit => unit.id));
    expect(model.mock.calls[0]![2]!.nPredict).toBe(360);
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

describe('round 4 task fixes', () => {
  test('past narration is not a candidate, a plan or an appointment change is', () => {
    expect(isPastNarration('Zapłaciłem trzysta złotych za druk plakatu.')).toBe(true)
    expect(isPastNarration('W poniedziałek o dziesiątej miałem spotkanie z promotorem.')).toBe(true)
    expect(isPastNarration('Kupiłem bilet na pociąg w sobotę.')).toBe(true)
    expect(isPastNarration('Kuba pożyczył mi książkę, muszę mu ją oddać do końca miesiąca.')).toBe(false)
    expect(isPastNarration('Mama prosiła, żebym przywiózł dysk.')).toBe(false)
    expect(isPastNarration('Fryzjer był na jedenastą, ale jednak na trzynastą.')).toBe(false)
    expect(isPastNarration('Kontrola jest we wtorek, lekarka powiedziała, że o szesnastej.')).toBe(false)
    expect(selectCandidates(units('Zapłaciłem trzysta złotych w piątek.', 'Muszę zapłacić rachunek.')).map(u => u.id)).toEqual([2])
    expect(selectCandidates(units('Druga sprawa: prezentacja na poniedziałek.', 'Ola przygotuje listę uwag do piątku.')).map(u => u.id)).toEqual([])
  })
  test('limitCandidates keeps the most binding sentences in note order', () => {
    const u = [{ id: 1, text: 'W piątek zajęcia.' }, { id: 2, text: 'Muszę oddać raport.' }, { id: 3, text: 'W sobotę rano zrobię przegląd.' }]
    expect(limitCandidates(u, 2).map(x => x.id)).toEqual([2, 3])
    expect(limitCandidates(u, 5).map(x => x.id)).toEqual([1, 2, 3])
    expect(candidateScore('Muszę oddać raport w piątek.')).toBeGreaterThan(candidateScore('W piątek zajęcia.'))
  })
  test('cutAnswer drops a half-written last line only for a cut answer', () => {
    expect(cutAnswer('[1] Kupić mleko\n[2] Zapł', true)).toBe('[1] Kupić mleko')
    expect(cutAnswer('[1] Kupić mleko\n[2] Zapł', false)).toBe('[1] Kupić mleko\n[2] Zapł')
    expect(cutAnswer('[1] Kupić mleko\n', true)).toBe('[1] Kupić mleko\n')
  })
  test('imperatives and gerunds become infinitives', () => {
    expect(toInfinitive('Wyślij wyniki')).toBe('Wysłać wyniki')
    expect(toInfinitive('Wzywając serwisanta')).toBe('Wzywać serwisanta')
    expect(toInfinitive('Zarezerwuj nocleg')).toBe('Zarezerwować nocleg')
    expect(toInfinitive('Wysłać wyniki')).toBe('Wysłać wyniki')
    expect(toInfinitive('Wizyta u dentysty')).toBe('Wizyta u dentysty')
    expect(tidyTask(draft('Wyślij wyniki', null, 1)).title).toBe('Wysłać wyniki')
  })
  test('vague and merged tasks are rejected, a past time is not a due', () => {
    expect(isVagueTitle('Pokazać 3 rzeczy')).toBe(true)
    expect(isVagueTitle('Zakończyć zadania')).toBe(true)
    expect(isVagueTitle('Pokazać schemat przepływu')).toBe(false)
    expect(isMergedEvents('Spotkanie z Oliwią, dentysta i serwisant')).toBe(true)
    expect(isMergedEvents('Spotkanie z Oliwią i Markiem')).toBe(false)
    expect(finalizeTasks([draft('Pokazać 3 rzeczy', null, 1), draft('Kupić mleko', null, 2)]).kept.map(t => t.title)).toEqual(['Kupić mleko'])
    expect(cleanDue(draft('Zapłacić karę', 'tydzień temu', 1)).due).toBeNull()
  })
  test('another person with a future verb owns the task', () => {
    expect(isOtherOwned('Ola sprawdzi rozdział drugi do czwartku.')).toBe(true)
    expect(isOtherOwned('Ola sprawdzi rozdział, a ja wyślę link.')).toBe(false)
  })
  test('a deadline comes from the task sentence, not from the next task', () => {
    const u = units(
      'Po spotkaniu muszę poprawić ekran eksportu i wysłać mu link.',
      'Ola sprawdzi rozdział drugi do czwartku.',
      'Muszę oddać raport.',
      'Termin: środa do osiemnastej.',
    )
    expect(isDateOnlySentence('Termin: środa do osiemnastej.')).toBe(true)
    expect(isDateOnlySentence('Ola sprawdzi rozdział drugi do czwartku.')).toBe(false)
    expect(dueFromOwnSentence(draft('Poprawić ekran eksportu', 'do czwartku', 1), u).due).toBeNull()
    expect(dueFromOwnSentence({ ...draft('Oddać raport', 'środa', 3), sourceIds: [3, 4] }, u).due).toBe('środa')
    expect(dueFromOwnSentence(draft('Oddać raport', 'do obrony', 3), u).due).toBeNull()
    const kept = postprocessTaskLines([draft('Poprawić ekran eksportu', 'do czwartku', 1)], u).kept
    expect(kept.map(t => [t.title, t.due])).toEqual([['Poprawić ekran eksportu', null]])
  })
  test('a weekday corrected in the next sentence replaces the stated one', () => {
    const u = units('Poprosił, żebym wysłał mu podsumowanie.', 'Termin: środa do osiemnastej.', 'Poprawka: nie środa, tylko czwartek do osiemnastej, bo w środę mam zajęcia.')
    const kept = postprocessTaskLines([draft('Wysłać podsumowanie', 'środa do 18:00', 1)], u).kept
    expect(kept.map(t => t.due)).toEqual(['czwartek do 18:00'])
  })
  test('a verb without its own object shares the next one', () => {
    expect(splitCompound(draft('Przygotować i wysłać podsumowanie', null, 1)).map(t => t.title)).toEqual(['Przygotować i wysłać podsumowanie'])
  })
  test('an invented amount is replaced by the stated one', () => {
    const u = units('Czynsz za listopad to tysiąc sto pięćdziesiąt złotych, muszę zapłacić do dziesiątego.')
    const kept = postprocessTaskLines([draft('Zapłacić czynsz 1050 zł', 'do 10', 1)], u).kept
    expect(kept.map(t => t.title)).toEqual(['Zapłacić czynsz 1150 zł'])
  })
  test('a nominal list needs no past purchase or hearsay', () => {
    const u = units('Bilet kupiłem wcześniej.', 'Dwa terabajty, kosztował czterysta dziewięćdziesiąt złotych, przyszło etui i kabel.')
    expect(nominalListTasks(u)).toEqual([])
  })
})

describe('grounding guards', () => {
  test('foldScripts maps lookalikes and Russian infinitives, rejects other scripts', () => {
    expect(foldScripts('Zapisаться na kurs')).toBe('Zapisać się na kurs')
    expect(foldScripts('Kupić ser')).toBe('Kupić ser')
    expect(foldScripts('Kupić хлеб')).toBeNull()
    expect(foldScripts('Kupić 牛奶')).toBeNull()
  })
  test('repairNumberUnits rebinds a number that the source ties to another unit', () => {
    const cited = 'Antybiotyk, pięć mililitrów dwa razy dziennie, przez siedem dni.'
    expect(repairNumberUnits('Stosować antybiotyk 5 ml 7 razy dziennie', cited)).toBe('Stosować antybiotyk 5 ml 2 razy dziennie')
    expect(repairNumberUnits('Stosować antybiotyk 5 ml 2 razy dziennie', cited)).toBe('Stosować antybiotyk 5 ml 2 razy dziennie')
    expect(repairNumberUnits('Brać 3 razy dziennie', 'Brać rano, przez trzy dni.')).toBe('Brać')
  })
  test('repairNumberUnits keeps a number the source states without a unit (spoken correction)', () => {
    const cited = 'Przelewam tysiąc złotych, nie, czekaj, tysiąc dwieście, bo nadrabiam.'
    expect(repairNumberUnits('Przelać 1200 zł', cited)).toBe('Przelać 1200 zł')
  })
  test('repairDueDate never invents D.M from a day number', () => {
    expect(repairDueDate('20.5', 'Rezygnację trzeba złożyć do dwudziestego piątego.')).toBe('do 25')
    expect(repairDueDate('20.5', 'Termin mija w sobotę.')).toBeNull()
    expect(repairDueDate('20.5', 'Termin mija dwudziestego maja.')).toBe('20.5')
    expect(repairDueDate('piątek', 'Do piątku.')).toBe('piątek')
  })
  test('groundVerb swaps a payment verb without money for a neutral one, or drops it', () => {
    const dose = 'Antybiotyk, pięć mililitrów dwa razy dziennie.'
    expect(groundVerb(draft('Zapłacić amoksycylinę 5 ml', null, 1), dose)?.title).toBe('Stosować amoksycylinę 5 ml')
    expect(groundVerb(draft('Zapłacić rachunek', null, 1), 'Rachunek za prąd, sto złotych.')?.title).toBe('Zapłacić rachunek')
    expect(groundVerb(draft('Zapłacić Oli', null, 1), 'Ola dzwoniła.')).toBeNull()
    expect(groundVerb(draft('Biorć 2 ładowarki', null, 1), 'Biorę dwie ładowarki.')?.title).toBe('Brać 2 ładowarki')
    expect(groundVerb(draft('Odbierć kurtkę', null, 1), 'W pralni odebrać kurtkę.')?.title).toBe('Odebrać kurtkę')
  })
  test('meetingToAction turns an event with a stated speaker action into that action', () => {
    const u = units('Kolejne spotkanie za tydzień we wtorek o dziesiątej, tam mam krótko zreferować stan listy błędów.', 'Spotkanie z klientem, mam to wpisać do kalendarza.')
    expect(meetingToAction(draft('Spotkanie za tydzień we wtorek o 10:00', null, 1), u)).toMatchObject({
      title: 'Zreferować stan listy błędów',
      due: 'za tydzień we wtorek o 10:00',
    })
    expect(meetingToAction(draft('Spotkanie z klientem', 'piątek', 2), u).title).toBe('Spotkanie z klientem')
  })
  test('groundTasks rejects leftover foreign scripts and fixes the dose task', () => {
    const u = units('Lekarka przepisała amoksycylinę, pięć mililitrów dwa razy dziennie, przez siedem dni.', 'Mam kupić хлеб.')
    const { kept, rejected } = groundTasks([draft('Zapłacić amoksycylinę 5 ml 7 razy dziennie', null, 1), draft('Kupić хлеб', null, 2)], u)
    expect(kept.map(task => task.title)).toEqual(['Stosować amoksycylinę 5 ml 2 razy dziennie'])
    expect(rejected.map(task => task.reason)).toEqual(['foreign script'])
  })
  test('ownerFilter rejects the task of a named doer even when a neighbouring sentence is cited', () => {
    const u = units('Agnieszka mówi, że termin jest ostateczny.', 'Po drugie, testy płatności robi Tomek, ma je skończyć do środy.', 'Ja mam przygotować listę błędów.')
    expect(isOtherOwned(u[1]!.text)).toBe(true)
    const { kept, rejected } = ownerFilter([draft('Skończyć testy płatności', 'środa', 1, 2), draft('Przygotować listę błędów', null, 3)], u)
    expect(kept.map(task => task.title)).toEqual(['Przygotować listę błędów'])
    expect(rejected).toHaveLength(1)
  })
  test('cancelledFilter honours a later rejection of the same thing', () => {
    const u = units('Zapiszę się na kurs fotografii.', 'Weekendowa odpada, bo soboty mam zajęte.', 'Z kursu fotografii jednak rezygnuję, za drogo.')
    const { kept } = cancelledFilter([draft('Zapisać się na kurs fotografii', null, 1)], u)
    expect(kept).toHaveLength(0)
    const only = units('Zapiszę się na kurs fotografii.', 'Weekendowy kurs odpada, bo soboty mam zajęte.')
    expect(cancelledFilter([draft('Zapisać się na kurs fotografii', null, 1)], only).kept).toHaveLength(1)
  })
  test('dropClosingDue keeps the day but not the closing hour', () => {
    const u = units('Jutro po pracy muszę wstąpić po okulary, czynne mają do osiemnastej.')
    expect(dropClosingDue(draft('Odebrać okulary', 'jutro o 18:00', 1), u).due).toBe('jutro')
  })
  test('keepCondition drops open plans and keeps the condition of plain conditionals', () => {
    const u = units('Jeśli zdam analizę w pierwszym terminie, to jadę na narty, ale jeszcze nic nie rezerwujemy.', 'Jeśli kolokwium wyjdzie słabo, to idę na dodatkowe zajęcia.')
    expect(keepCondition(draft('Jechać na narty', null, 1), u)).toBeNull()
    expect(keepCondition(draft('Iść na dodatkowe zajęcia', null, 2), u)?.title).toBe('Iść na dodatkowe zajęcia, jeśli kolokwium wyjdzie słabo')
  })
})

describe('aspect and recipient case', () => {
  const t = (title: string, due: string | null = null) => ({ title, due, sourceIds: [1], modelIds: [] })
  it('turns a one-off imperfective task into a perfective infinitive', () => {
    expect(perfective(t('Wzywać serwisanta', 'czwartek')).title).toBe('Wezwać serwisanta')
    expect(perfective(t('Przelewać na oszczędności 500 zł')).title).toBe('Przelać na oszczędności 500 zł')
    expect(perfective(t('Pisać rozdział o ograniczeniach', 'środa')).title).toBe('Napisać rozdział o ograniczeniach')
    expect(perfective(t('Jechać do rodziców')).title).toBe('Pojechać do rodziców')
  })
  it('keeps habits imperfective', () => {
    expect(perfective(t('Pisać pracę codziennie')).title).toBe('Pisać pracę codziennie')
    expect(perfective(t('Czytać artykuły', 'co tydzień')).title).toBe('Czytać artykuły')
    expect(perfective(t('Ćwiczyć rano')).title).toBe('Ćwiczyć rano')
  })
  it('puts the recipient name in the dative', () => {
    expect(dativeName(t('Oddać Kuba książkę')).title).toBe('Oddać Kubie książkę')
    expect(dativeName(t('Wysłać Ola listę')).title).toBe('Wysłać Oli listę')
    expect(dativeName(t('Pokazać Oliwia schemat')).title).toBe('Pokazać Oliwii schemat')
    expect(dativeName(t('Oddać Kubie książkę')).title).toBe('Oddać Kubie książkę')
    expect(dativeName(t('Odebrać Kuba ze szkoły')).title).toBe('Odebrać Kuba ze szkoły')
    expect(dativeName(t('Oddać książkę Kuba')).title).toBe('Oddać książkę Kubie')
    expect(dativeName(t('Wysłać zdjęcia do Ola')).title).toBe('Wysłać zdjęcia do Ola')
    expect(dativeName(t('Oddać książkę do Biblioteka')).title).toBe('Oddać książkę do Biblioteka')
    expect(['Kasia', 'Ania', 'Marta', 'Monika', 'Ewa', 'Anna', 'Maja', 'Natasza', 'Olga'].map(dativeOf))
      .toEqual(['Kasi', 'Ani', 'Marcie', 'Monice', 'Ewie', 'Annie', 'Mai', 'Nataszy', 'Oldze'])
  })
})

describe('cut lines and weekdays', () => {
  test('cutLine keeps the half-written line of the next sentence', () => {
    expect(cutLine('[72] Pisać rozdział — środa\n[75] Jechać', 75)).toBe('[75] Jechać')
    expect(cutLine('[72] Pisać rozdział — środa\n[75] Jechać', 78)).toBeNull()
    expect(cutLine('[72] Pisać rozdział — środa\n[75', 75)).toBeNull()
    expect(continuationHint('[75] Jechać')).toContain('[75] Jechać')
  })
  test('adds the weekday that the hour sentence names', () => {
    const u = [
      { id: 48, text: 'Była zaplanowana na wtorek, ale mam wtedy zajęcia.' },
      { id: 49, text: 'Nowy termin to czwartek piętnastego o szesnastej trzydzieści.' },
    ]
    const t = (due: string | null, ids = [48, 49]) => ({ title: 'Wizyta u dentysty', due, sourceIds: ids, modelIds: [] })
    expect(withWeekday(t('16:30'), u).due).toBe('czwartek 16:30')
    expect(withWeekday(t('czwartek 16:30'), u).due).toBe('czwartek 16:30')
    expect(withWeekday(t('jutro 16:30'), u).due).toBe('jutro 16:30')
    expect(withWeekday(t(null), u).due).toBeNull()
    const two = [{ id: 1, text: 'We wtorek albo w czwartek o szesnastej.' }]
    expect(withWeekday(t('16:00', [1]), two).due).toBe('16:00')
  })
})

describe('sentence lead day and object clause', () => {
  const t = (title: string, due: string | null, id: number) => ({ title, due, sourceIds: [id], modelIds: [id] })
  const u = [
    { id: 72, text: 'W środę zajęcia i fizjoterapia, wieczorem piszę rozdział o ograniczeniach.' },
    { id: 73, text: 'W środę albo w czwartek oddam raport.' },
    { id: 74, text: 'Kiedyś napiszę bloga.' },
    { id: 10, text: 'Muszę też dopisać w rozdziale czwartym, jak dokładnie działa lokalne przetwarzanie mowy i skąd bierze się model, bo recenzent zapyta.' },
  ]
  test('takes the weekday that opens the sentence', () => {
    expect(dueFromSentenceLead(t('Napisać rozdział o ograniczeniach', null, 72), u).due).toBe('środa wieczorem')
    expect(dueFromSentenceLead(t('Oddać raport', null, 73), u).due).toBeNull()
    expect(dueFromSentenceLead(t('Napisać bloga', null, 74), u).due).toBeNull()
    expect(dueFromSentenceLead(t('Napisać rozdział', 'piątek', 72), u).due).toBe('piątek')
  })
  test('adds the clause that is the missing object', () => {
    expect(completeObjectClause(t('Dopisać w rozdziale czwartym', null, 10), u).title)
      .toBe('Dopisać w rozdziale czwartym, jak dokładnie działa lokalne przetwarzanie mowy')
    expect(completeObjectClause(t('Napisać rozdział o ograniczeniach', null, 72), u).title).toBe('Napisać rozdział o ograniczeniach')
  })
})

describe('relative day in clock dues', () => {
  const u = [{ id: 3, text: 'Poza tym O osiemnastej jutro jadę do psychologa' }]
  const t = (due: string | null) => ({ title: 'Wizyta u psychologa', due, sourceIds: [3], modelIds: [3] })
  test('adds jutro and turns a bare hour into a clock time', () => {
    expect(withWeekday(t('18:00'), u).due).toBe('jutro 18:00')
    expect(withWeekday(t('18'), u).due).toBe('jutro 18:00')
    expect(withWeekday(t('jutro 18:00'), u).due).toBe('jutro 18:00')
    expect(withWeekday(t('7'), u).due).toBe('7')
  })
})

test('modal duty recovery keeps only the plain present duty of the speaker', () => {
  expect(modalTask({ id: 1, text: 'Jutro mam zajęcia trzeba pokazać plany testów jest to gotowe' })?.title).toBe('Pokazać plany testów')
  expect(modalTask({ id: 1, text: 'Jutro mam zajęcia trzeba pokazać plany testów' })?.due).toBe('jutro')
  expect(modalTask({ id: 2, text: 'Nie muszę kupować biletu' })).toBeNull()
  expect(modalTask({ id: 3, text: 'Może trzeba będzie kiedyś zmienić opony' })).toBeNull()
  expect(modalTask({ id: 4, text: 'Muszę to dzisiaj przejrzeć' })).toBeNull()
})
