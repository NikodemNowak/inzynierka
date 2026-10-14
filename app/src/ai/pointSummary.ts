import type { SummaryDocument } from '../domain/summary';
import type { Language } from '../i18n/language';
import { recordGeneration } from './generationMetrics';
import { generate } from './llm';
import { pointNumbers, statedNumbers, wordsToDigits } from './polishNumbers';
import { throwIfProcessingAborted, type ProcessingExecutionContext } from './processingContext';
import { noteSourceSystem, sourceFirstPrompt } from './sharedSourcePrompt';
import { documentFromSummaryDraft } from './summaryProtocol';
import { renderSummarySources, type SummarySourceUnit } from './summarySources';

// Point summary: one model call per chunk of the note produces "- text [ids]"
// lines (numbers stay spoken words, code converts them to digits); every point
// is then checked deterministically against the sentences it cites. A point
// that cannot be repaired is dropped when its sentences are already covered,
// otherwise replaced by the speaker's own cleaned words. Polish is the main
// path; English uses its own prompts and only language-agnostic checks.

export interface SummaryPoint { text: string; sourceIds: number[] }
export interface PointSummaryResult {
  points: SummaryPoint[];
  document: SummaryDocument | null;
  warnings: string[];
  literalFallbackCount: number;
}

interface Unit { readonly id: number; readonly text: string }
interface WorkPoint { text: string; sourceIds: number[]; literal?: boolean; issues?: string[]; replaced?: string }
export interface RejectedPoint { text: string; sourceIds: number[]; issues: string[] }

// ---------------------------------------------------------------- regex helpers
// JS \w and \b are ASCII-only. Patterns are written Python-style and expanded
// to Unicode-aware lookarounds; [^\W\d_] is a letter.
const WORD = '[\\p{L}\\p{N}_]';
const BOUNDARY = `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`;
const rx = (source: string, flags = ''): RegExp =>
  new RegExp(source.replace(/\[\^\\W\\d_\]/g, '\\p{L}').replace(/\\b/g, BOUNDARY).replace(/\\w/g, WORD), `${flags}u`);
const words = (text: string): string[] => text.toLowerCase().match(/\p{L}+/gu) ?? [];
const STEM = 4;
const stems = (text: string): string[] => words(text).filter(w => w.length >= 4).map(w => w.slice(0, STEM));
const stripChars = (text: string, chars: string): string => {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text.charAt(start))) start += 1;
  while (end > start && chars.includes(text.charAt(end - 1))) end -= 1;
  return text.slice(start, end);
};
const capitalize = (text: string): string => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);
const splitWs = (text: string): string[] => text.split(/\s+/u).filter(Boolean);
const stripDiacritics = (text: string): string =>
  text.replace(/[ąćęłńóśźż]/gu, c => 'acelnoszz'['ąćęłńóśźż'.indexOf(c)]);

// ---------------------------------------------------------------- lexicon (Polish)
const MONTH_PATTERNS = [
  'stycz', 'lut(?:y|ego|ym|ow)', 'mar(?:zec|ca|cu)', 'kwie(?:cie|tni)', 'maj(?:a|u|em)?(?![^\\W\\d_])', 'czerw(?:iec|ca|cu)',
  'lip(?:iec|ca|cu)', 'sierp', 'wrze[sś]', 'październik|października|październiku', 'listopad', 'grud(?:zie|ni)',
];
const WEEKDAY_PATTERNS = ['poniedział', 'wtor', 'środ|srod', 'czwart', 'piąt(?:e?k|ku|kiem)', 'sobot', 'niedziel', 'weeken'];
const DATE_PATTERNS = [...WEEKDAY_PATTERNS, ...MONTH_PATTERNS];
const DATE_SEARCH = DATE_PATTERNS.map(p => rx(`(?<![^\\W\\d_])(?:${p})`, 'i'));
const DATE_PREFIX = DATE_PATTERNS.map(p => rx(`^(?:${p})`, 'i'));

const NEG = rx(String.raw`(?<![^\W\d_])(?:nie|nigdy|ani|bez|brak\w*|żadn\w*|nic)(?![^\W\d_])`, 'i');
const NEG_WORD_PREFIX = rx(String.raw`(?<![^\W\d_])nie(\w{4,})`, 'gi');
const NEG_LIKE = rx(String.raw`(?<![^\W\d_])(?:nie\w*|nigdy|ani|bez|brak\w*|żadn\w*|nic|odwoł\w*|anul\w*|rezygn\w*|zrezygn\w*|zamiast|tylko|dopiero|odpada\w*|odrzuc\w*)(?![^\W\d_])`, 'i');
const HEDGE = rx(String.raw`(?<![^\W\d_])(?:jeśli|jeżeli|jak\s+będzie|o\s+ile|gdyby|może|chyba|prawdopodobnie|podobno|ewentualnie|raczej|zobaczymy|nie\s+wiem|albo)(?![^\W\d_])`, 'gi');
const HEDGE_POINT = rx(String.raw`(?<![^\W\d_])(?:jeśli|jeżeli|gdy|przy|o\s+ile|gdyby|może|możliwe|chyba|prawdopodobnie|podobno|ewentualnie|raczej|około|ok\.|ewent\.|albo|lub|lub/|zależ\w*|niepewn\w*|do\s+ustalenia|nie\s+wiadomo|nierozstrzygn\w*|zobaczy\w*|nie\s+wiem|rozważ\w*|pomysł\w*|plan\s+b|w\s+razie)(?![^\W\d_])|\?|/`, 'i');
const CHANGE_SRC = rx(String.raw`(?<![^\W\d_])(?:jednak|poprawi\w*|zmieni\w*|przesun\w*|przełoż\w*|przebukow\w*|dopóki|zanim)(?![^\W\d_])`, 'i');
const PAST_MODAL = rx(String.raw`(?<![^\W\d_])(?:musiał(?:em|am|o|y|iśmy|yśmy)?|miał(?:em|am|o|y|iśmy|yśmy)?|powinien|powinna)(?![^\W\d_])`, 'i');
const PRESENT_MODAL = rx(String.raw`(?<![^\W\d_])(?:muszę|musimy|musisz|musi|mam|mamy|masz|trzeba)(?![^\W\d_])`, 'i');
const CHANGE_MARK = rx(String.raw`(?<![^\W\d_])(?:zamiast|zmian\w*|zmienion\w*|przeniesion\w*|przełożon\w*|przebukow\w*|wcześniej|pierwotnie|odwołan\w*|poprawion\w*|nie\s+\w+\s*,?\s*(?:lecz|tylko|ale))|→|->`, 'i');
const CORRECTION_SRC = String.raw`(?:\bnie,?\s+(?:czekaj|nie|sorry|przepraszam|pomyli\w*|wróć|sprawdzi\w*|źle|jednak|to\s+było)\b|\bznaczy\s+nie\b|\bpoprawka\b|\bwróć\b|\bmiał[aoy]?\s+być\b)`;
const CORRECTION = rx(CORRECTION_SRC, 'gi');
const CORRECTION_START = rx(`^${CORRECTION_SRC}`, 'i');

// Words a summary may introduce without changing facts.
const SUMMARY_VOCAB = new Set(`
jeśli jeżeli gdy przy przeciwnym wypadku razie inaczej termin terminie terminem następne następny następna następnie kolejne kolejny kolejna decyzja decyzji zadanie zadania plan planu planie planowane planowany planowana spotkanie spotkania
koszt koszty kosztuje kosztem cena około razem łącznie oraz także również potrzebne potrzebny potrzebna konieczne
możliwe możliwy możliwa ewentualnie opcja opcje wariant wybór kwestia sprawa sprawy dotyczy dotyczące odnośnie
wcześniej później następnie potem przed najpóźniej najlepiej obowiązuje aktualnie aktualny aktualna ostatecznie
zmiana zmienione przeniesione przełożone zamiast powód powodu dlatego ponieważ przyczyna niepewne nieustalone ustalenia
ustalone ustalić sprawdzić zrobić załatwić kupić zadzwonić wysłać odebrać umówić zarezerwować przygotować pamiętać
brak brakuje tylko jedynie dopiero wyłącznie wizyta wizyty godzina godzinie godz dzień dnia osoba osoby osób
stwierdził stwierdziła stwierdzili zalecił zalecenie zalecenia rezerwacja rezerwacji leczenie leczeniu podział ustalenie
uwaga notatka zgłosić odpowiedzialna odpowiedzialny zajmuje zajmie zrobi rezerwuje organizuje zorganizować
`.split(/\s+/u).filter(Boolean));

// ---------------------------------------------------------------- stale values (self-corrections)
const staleWindows = (text: string, prevText: string | null): { kind: 'self' | 'prev'; from: number; to: number }[] => {
  const windows: { kind: 'self' | 'prev'; from: number; to: number }[] = [];
  for (const m of text.matchAll(CORRECTION)) {
    const index = m.index ?? 0;
    if (/^miał/iu.test(m[0])) {
      const rest = text.slice(index + m[0].length);
      const end = rx(String.raw`,\s*(?:ale|a|jednak)\b|\bjednak\b`).exec(rest);
      windows.push({ kind: 'self', from: index + m[0].length, to: index + m[0].length + (end ? end.index : Math.min(50, rest.length)) });
    } else if (index < 3 && prevText !== null) {
      windows.push({ kind: 'prev', from: 0, to: 0 });
    } else {
      const before = [...text.slice(0, index).matchAll(/\S+/gu)].slice(-6);
      if (before.length) windows.push({ kind: 'self', from: before[0].index ?? 0, to: index });
    }
  }
  return windows;
};

// Numbers stated in the corrected (old) part of a self-correction and not
// stated anywhere else in the cited sentences.
const staleNumbers = (ids: readonly number[], byId: ReadonlyMap<number, Unit>): Set<number> => {
  const stale = new Set<number>();
  const keep: string[] = [];
  for (const id of ids) {
    const text = byId.get(id)?.text ?? '';
    const prev = byId.get(id - 1)?.text ?? null;
    const mask = text.split('');
    for (const { kind, from, to } of staleWindows(text, prev)) {
      if (kind === 'prev' && prev !== null) {
        const tail = [...prev.matchAll(/\S+/gu)].slice(-6);
        for (const n of statedNumbers(tail.length ? prev.slice(tail[0].index ?? 0) : '')) stale.add(n);
      } else {
        for (const n of statedNumbers(text.slice(from, to))) stale.add(n);
        for (let k = from; k < to; k += 1) mask[k] = ' ';
      }
    }
    const next = byId.get(id + 1);
    if (next && CORRECTION_START.test(next.text)) {
      const tail = [...text.matchAll(/\S+/gu)].slice(-6);
      if (tail.length) {
        const nextNumbers = statedNumbers(next.text);
        for (const n of statedNumbers(text.slice(tail[0].index ?? 0))) if (!nextNumbers.has(n)) stale.add(n);
        for (let k = tail[0].index ?? 0; k < text.length; k += 1) mask[k] = ' ';
      }
    }
    keep.push(mask.join('').replace(CORRECTION, ' '));
  }
  const still = statedNumbers(keep.join(' '));
  return new Set([...stale].filter(n => !still.has(n)));
};

// ---------------------------------------------------------------- substance score
// Cheap lexical estimate of how much a sentence carries something to act on or
// remember (plan, obligation, decision, date, number) versus plain narration.
const PLAN_SIGNAL = rx(String.raw`(?<![^\W\d_])(?:postanowi(?:ł\w*|my|ć)|postanaw\w*|zdecyduj\w*|zdecydowa\w*|musz\w*|musi\w*|trzeba|mam(?:y)?\s+(?:\w+\s+){0,2}\w+ć|powinn?\w*|zamierz\w*|planuj\w*|plan(?:ujemy)?|umówi\w*|ustali\w*|termin\w*|chc(?:ę|emy)|nie\s+będ\w*|(?:dzwoni|zadzwoni|robi|zrobi|kupi|zamówi|załatwi|sprawdz|napisz|zapłac|przedłuż|wyśl|odbior|zarezerwuj|przyjad|zawioz|zorganizuj|odłoż|zanotuj|zapisz|oddam|oddać)\w*(?:ę|my))(?![^\W\d_])`, 'i');
const PAST_FIRST = rx(String.raw`(?<![^\W\d_])\w{3,}(?:łem|łam|liśmy|łyśmy)(?![^\W\d_])`, 'i');
const SOON = rx(String.raw`(?<![^\W\d_])(?:jutro|pojutrze|przyszł\w+|za\s+(?:tydzień|miesiąc|dwa|trzy)|do\s+końca|od\s+jutra|od\s+dziś|od\s+dzisiaj)(?![^\W\d_])`, 'i');

export const substanceScore = (text: string): number => {
  let score = 0;
  const plan = PLAN_SIGNAL.test(text);
  if (plan) score += 2;
  if (DATE_SEARCH.some(p => p.test(text)) || SOON.test(text)) score += 1;
  if (/\d/u.test(text) || statedNumbers(text).size) score += 0.5;
  if (!plan && PAST_FIRST.test(text)) score -= 1.5;
  return score;
};

// Thoughts, feelings and memories, as opposed to things that happened or must happen.
const REFLECTION = rx(String.raw`(?<![^\W\d_])(?:myśl\w*|pomyśla\w*|czuj\w*|czuł\w*|wrażeni\w*|pamiętam|wspomin\w*|wspomnie\w*|przypomnia\w*|wydawał\w*|dziwn\w*|melanchol\w*|tęsk\w*|cieszę|szkoda|zmęcz\w*|smut\w*|nastr\w+|kiedyś|swoją\s+drogą|w\s+sumie|w\s+ogóle|matko|zafascyn\w*|marginesie|trudno|serio|szczerze|wtedy|nostalg\w*|traum\w*|stres\w*|wmawiam|uświadomi\w*|zauważy\w*)(?![^\W\d_])`, 'i');

const SUBSTANTIVE = 1;
const MIN_RAMBLING_UNITS = 24;
const RAMBLING_DENSITY = 0.4;
const RAMBLING_REFLECTION = 0.3;
const FILLER_WEIGHT = 0.35;
const MIN_LITERAL_SUBSTANCE = 0.5;

// A long reflective note where few sentences carry anything to act on (a diary
// entry, a stream of thoughts) needs far fewer points than its length suggests.
export const isRambling = (units: readonly Unit[]): boolean =>
  units.length >= MIN_RAMBLING_UNITS &&
  units.filter(unit => substanceScore(unit.text) >= SUBSTANTIVE).length / units.length < RAMBLING_DENSITY &&
  units.filter(unit => REFLECTION.test(unit.text)).length / units.length >= RAMBLING_REFLECTION;

// Unit count for budgeting: sentences without substance weigh less in rambling notes.
const unitWeight = (unit: Unit, rambling: boolean): number =>
  rambling && substanceScore(unit.text) < SUBSTANTIVE ? FILLER_WEIGHT : 1;

// In a rambling note, a point with no plan, decision, date or number is
// narration; it goes unless that would leave too few points.
const MIN_KEPT_POINTS = 3;
export const dropNarration = (points: readonly SummaryPoint[], units: readonly Unit[]): SummaryPoint[] => {
  if (!isRambling(units)) return [...points];
  const kept = points.filter(point => substanceScore(point.text) >= SUBSTANTIVE);
  return kept.length >= MIN_KEPT_POINTS ? kept : [...points];
};

// ---------------------------------------------------------------- point checks (Polish)
const PAST_VERB = /(?<!\p{L})(\p{L}{4,}?)(?:ł|ła|ło|li|ły|liśmy|łem|łam|liście)(?!\p{L})/giu;
const PLAN_MODAL = rx(String.raw`(?<![^\W\d_])(?:ma|mam|mamy|masz|mają|muszę|musimy|musi|trzeba|chcę|chcemy|zamierzam|planuję|powinienem|powinnam)(?![^\W\d_])`, 'i');
const plannedAsDone = (text: string, src: string): boolean => {
  if (!PLAN_MODAL.test(src)) return false;
  const srcWords = words(src);
  for (const m of text.matchAll(PAST_VERB)) {
    const stem = m[1].toLowerCase();
    if (stem.length < 5) continue;
    const planned = srcWords.some(w => w === `${stem}ć`);
    const done = srcWords.some(w => w.startsWith(stem) && w !== `${stem}ć`);
    if (planned && !done) return true;
  }
  return false;
};
const NIE = rx(String.raw`(?<![^\W\d_])nie(?![^\W\d_])`, 'gi');
// "czy dowód nie traci ważności", "dopóki prawnicy nie przejrzą" are not negated facts;
// "nie razem z antybiotykiem, tylko dwie godziny po": the positive part may stand alone.
const NIE_QUESTION = rx(String.raw`(?<![^\W\d_])(?:czy|dopóki|zanim)(?:\s+\S+){0,3}\s*$`, 'i');
const NIE_BUT_ONLY = rx(String.raw`^[^.;]{0,50}?,\s*(?:tylko|lecz|a\s+tylko|ale\s+tylko)\b`, 'i');
const HALF = rx(String.raw`(?<![^\W\d_])(?:pół|półtor\w*)(?![^\W\d_])`, 'i');
// Endings of an inflected name, including the vocative ("Kubo").
const NAME_ENDING = rx(String.raw`(?:a|y|i|ie|ę|ą|o|owi|em|u|om|ami|ach|ów|ego|ej|emu|ym)$`);
const NAME_AT = '(?<=[\\s(,;:–-])';
const UPPER = 'A-ZĄĆĘŁŃÓŚŹŻ';
const CURRENCIES: readonly (readonly [string, RegExp])[] = [
  ['zł', /zł|złot/iu], ['euro', /euro|€|eur\b/iu], ['usd', /dolar|\$/iu],
];
const ANY_CURRENCY = /zł|złot|euro|€|dolar|\$/iu;

const checkPointPl = (
  text: string, src: string, ids: readonly number[], allUnits: readonly Unit[] | null, minOverlap: number,
): string[] => {
  const issues: string[] = [];
  // 1. numbers: whole compound numerals stated by the cited sentences
  const have = statedNumbers(src);
  const thousands = /tysi/iu.test(src);
  const half = HALF.test(src);
  const ntext = half ? text.replace(/(\d+)[,.]5(?!\d)/gu, '$1') : text;
  const okNum = (n: number): boolean => have.has(n) || (thousands && n % 1000 === 0 && have.has(n / 1000)) ||
    (thousands && half && n % 1000 === 500 && have.has(Math.trunc(n / 1000))) ||
    (have.has(n * 1000) && /\btys/u.test(text));
  const badNums = [...pointNumbers(ntext)].filter(n => !okNum(n)).sort((a, b) => a - b);
  if (badNums.length) issues.push(`number:${badNums.join(',')}`);
  for (const [label, pattern] of CURRENCIES) {
    if (pattern.test(text) && !pattern.test(src) && ANY_CURRENCY.test(src)) { issues.push(`currency:${label}`); break; }
  }
  // 2. weekdays and months must be in the cited sentences
  const noteText = allUnits ? allUnits.map(u => u.text).join(' ') : src;
  for (const pattern of DATE_SEARCH) {
    const hit = pattern.exec(text);
    if (hit && !pattern.test(src)) { issues.push(`date:${hit[0]}`); break; }
  }
  // 3. negation
  if (NEG.test(text) && !(NEG_LIKE.test(src) || CHANGE_SRC.test(src))) issues.push('negation+');
  const srcNoCorr = src.replace(CORRECTION, ' ');
  const pstems = new Set(stems(text));
  for (const m of srcNoCorr.matchAll(NIE)) {
    const index = m.index ?? 0;
    const end = index + m[0].length;
    if (NIE_QUESTION.test(srcNoCorr.slice(Math.max(0, index - 30), index))) continue;
    if (NIE_BUT_ONLY.test(srcNoCorr.slice(end))) continue;
    const clause = srcNoCorr.slice(end, end + 40).split(/[,.;:]/u)[0];
    const after = words(clause).slice(0, 3);
    const before = words(srcNoCorr.slice(Math.max(0, index - 30), index)).slice(-2);
    const tail = srcNoCorr.slice(end, end + 2);
    const scope = !/^\s*[,.;]/u.test(tail)
      ? after.filter(w => w.length >= 4).slice(0, 2)
      : before.filter(w => w.length >= 4).slice(-1);
    if (scope.length && scope.some(w => pstems.has(w.slice(0, STEM))) && !NEG_LIKE.test(text)) {
      issues.push(`negation-:${scope[0]}`);
      break;
    }
  }
  for (const m of src.matchAll(NEG_WORD_PREFIX)) {
    const base = m[1].toLowerCase();
    if (words(text).some(w => w.startsWith(base.slice(0, 5)) && !w.startsWith('nie')) && !NEG_LIKE.test(text)) {
      issues.push(`polarity:${base}`);
      break;
    }
  }
  // 4. hedge/condition: a point repeating what the hedge governs must keep one
  const pnums = new Set([...pointNumbers(text)].map(String));
  for (const m of src.matchAll(HEDGE)) {
    const end = (m.index ?? 0) + m[0].length;
    const cond = /^(?:jeśli|jeżeli|jak\s+będzie|o\s+ile|gdyby)/iu.test(m[0]);
    const scope = new Set(stems((src.slice(end, end + 80).match(/\p{L}+|\d+/gu) ?? []).slice(0, cond ? 6 : 4).join(' ')));
    for (const n of statedNumbers(splitWs(src.slice(end, end + 40)).slice(0, 3).join(' '))) scope.add(String(n));
    let overlap = 0;
    for (const item of scope) if (pstems.has(item) || pnums.has(item)) overlap += 1;
    if (overlap >= (cond ? 1 : 2) && !HEDGE_POINT.test(text)) { issues.push(`hedge:${m[0]}`); break; }
  }
  // 5. tense
  if (PRESENT_MODAL.test(text) && PAST_MODAL.test(src) && !PRESENT_MODAL.test(src)) issues.push('tense');
  // 5b. a planned or obligatory action must not become a finished one ("ma zarezerwować" -> "zarezerwowała")
  if (plannedAsDone(text, src)) issues.push('tense');
  // 6. content words must come from the cited sources; a word found elsewhere counts half
  const wanted = words(text).filter(w => w.length >= 4 && !SUMMARY_VOCAB.has(w) && !DATE_PREFIX.some(p => p.test(w)));
  const haveStems = new Set(stems(src));
  const noteStems = new Set(stems(noteText));
  if (wanted.length) {
    const missing = wanted.filter(w => !haveStems.has(w.slice(0, STEM)));
    const weight = missing.reduce((sum, w) => sum + (noteStems.has(w.slice(0, STEM)) ? 0.5 : 1), 0);
    if (weight > Math.max(1, Math.trunc(wanted.length * (1 - minOverlap)))) issues.push(`words:${missing.slice(0, 4).join(',')}`);
  }
  // proper names must occur in the note (any sentence)
  const noteWords = new Set(words(noteText));
  const names = [...text.matchAll(rx(`${NAME_AT}([${UPPER}][^\\W\\d_]{1,})`, 'g'))].map(m => m[1]);
  const first = rx(`^([${UPPER}][^\\W\\d_]{2,})`).exec(text);
  // A sentence-initial word counts as a name only when the note capitalises it mid-sentence too.
  if (first && !/ć$/u.test(first[1]) && new RegExp(`(?<=[^.!?\\s]\\s+)${first[1].slice(0, 3)}`, 'u').test(noteText)) names.unshift(first[1]);
  for (const name of names) {
    const lw = name.toLowerCase();
    const pref = lw.slice(0, Math.max(3, Math.min(STEM, lw.length - 2)));
    const inflected = [...noteWords].some(w => w.startsWith(pref)) && NAME_ENDING.test(lw);
    if (!(noteWords.has(lw) || inflected) && !SUMMARY_VOCAB.has(lw)) { issues.push(`name:${name}`); break; }
  }
  // 7. missing diacritics inside a word ("frustrujace")
  const srcWords = new Set(words(src));
  const srcPlain = new Map<string, string>();
  for (const w of srcWords) srcPlain.set(stripDiacritics(w), w);
  for (const w of words(text)) {
    const original = srcPlain.get(w);
    if (w.length >= 4 && !srcWords.has(w) && original !== undefined && original !== w) {
      let firstDiff = -1;
      for (let k = 0; k < Math.min(w.length, original.length); k += 1) if (w[k] !== original[k]) { firstDiff = k; break; }
      if (firstDiff >= 0 && firstDiff < w.length - 1) { issues.push(`typo:${w}`); break; }
    }
  }
  // 8. stale value from a self-correction
  if (allUnits && !CHANGE_MARK.test(text)) {
    const stale = staleNumbers(ids, new Map(allUnits.map(u => [u.id, u])));
    const hit = [...pointNumbers(text)].filter(n => stale.has(n)).sort((a, b) => a - b);
    if (hit.length) issues.push(`stale:${hit.join(',')}`);
  }
  return issues;
};

// ---------------------------------------------------------------- point checks (English)
const EN_MONTHS = /\b(?:january|february|march|april|june|july|august|september|october|november|december)\b/giu;
const EN_DAYS = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)\b/giu;
const EN_NUMBER_WORD = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|teen|thirteen|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|half|quarter|dozen|first|second|third|fifth|ninth)\b/iu;
const EN_NEG = /(?:\b(?:not|no|never|without|none|nothing|nobody|cannot)\b|n't)/iu;
const EN_HEDGE = /\b(?:if|maybe|might|perhaps|probably|possibly|unless|depends|not sure|i guess)\b/giu;
const EN_VOCAB = new Set('task tasks plan plans meeting decision deadline total about around approximately note need needs'.split(' '));

const checkPointEn = (text: string, src: string, allUnits: readonly Unit[] | null, minOverlap: number): string[] => {
  const issues: string[] = [];
  const srcNumbers = new Set((src.match(/\d+/gu) ?? []).map(Number));
  if (!EN_NUMBER_WORD.test(src)) {
    const bad = [...new Set((text.match(/\d+/gu) ?? []).map(Number))].filter(n => n !== 0 && !srcNumbers.has(n));
    if (bad.length) issues.push(`number:${bad.join(',')}`);
  }
  for (const pattern of [EN_MONTHS, EN_DAYS]) {
    for (const m of text.matchAll(pattern)) {
      if (!src.toLowerCase().includes(m[0].toLowerCase())) { issues.push(`date:${m[0]}`); break; }
    }
  }
  if (EN_NEG.test(text) && !EN_NEG.test(src)) issues.push('negation+');
  const pstems = new Set(stems(text));
  if (EN_NEG.test(src) && !EN_NEG.test(text)) {
    const neg = EN_NEG.exec(src);
    const scope = neg ? stems(src.slice((neg.index ?? 0) + neg[0].length, (neg.index ?? 0) + neg[0].length + 40).split(/[,.;]/u)[0]) : [];
    if (scope.some(s => pstems.has(s))) issues.push('negation-');
  }
  for (const m of src.matchAll(EN_HEDGE)) {
    const scope = stems(src.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 60).split(/[,.;]/u)[0]);
    if (scope.some(s => pstems.has(s)) && !new RegExp(EN_HEDGE.source, 'iu').test(text)) { issues.push(`hedge:${m[0]}`); break; }
  }
  const noteText = allUnits ? allUnits.map(u => u.text).join(' ') : src;
  const wanted = words(text).filter(w => w.length >= 4 && !EN_VOCAB.has(w));
  const haveStems = new Set(stems(src));
  const noteStems = new Set(stems(noteText));
  if (wanted.length) {
    const missing = wanted.filter(w => !haveStems.has(w.slice(0, STEM)));
    const weight = missing.reduce((sum, w) => sum + (noteStems.has(w.slice(0, STEM)) ? 0.5 : 1), 0);
    if (weight > Math.max(1, Math.trunc(wanted.length * (1 - minOverlap)))) issues.push(`words:${missing.slice(0, 4).join(',')}`);
  }
  const noteWords = new Set(words(noteText));
  const names = [...text.matchAll(rx(`${NAME_AT}([${UPPER}][^\\W\\d_]{1,})`, 'g'))].map(m => m[1]);
  for (const name of names) {
    const lw = name.toLowerCase();
    if (!noteWords.has(lw) && ![...noteWords].some(w => w.startsWith(lw.slice(0, Math.max(3, lw.length - 2))))) { issues.push(`name:${name}`); break; }
  }
  return issues;
};

const FOREIGN_SCRIPT = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;

export const checkPoint = (
  point: { readonly text: string; readonly sourceIds: readonly number[] },
  byId: ReadonlyMap<number, Unit>,
  allUnits: readonly Unit[] | null = null,
  language: Language = 'pl',
  minOverlap = 0.75,
): string[] => {
  const cited = point.sourceIds.map(id => byId.get(id));
  if (!cited.length || cited.some(unit => unit === undefined)) return ['ids'];
  // The model sometimes slips into another script mid-word ("składать").
  if (FOREIGN_SCRIPT.test(point.text)) return ['script'];
  const src = cited.map(unit => unit?.text ?? '').join(' ');
  return language === 'pl'
    ? checkPointPl(point.text, src, point.sourceIds, allUnits, minOverlap)
    : checkPointEn(point.text, src, allUnits, minOverlap);
};

// ---------------------------------------------------------------- repairs
const REPAIRABLE = ['words', 'name', 'date', 'number'];
const issueKind = (issue: string): string => issue.split(':')[0];
const DATE_STRIP = rx(String.raw`(?:\s*,?\s*(?:w|we|na|do|od)?\s*(?:poniedziałek|wtorek|środę|środa|czwartek|piątek|sobotę|sobota|niedzielę|niedziela)(?![^\W\d_]))|(?<=\d)\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)(?:\s+\d{4})?`, 'gi');
const MONTH_NAMES = String.raw`(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)`;
const WEEKDAY_PHRASE_SRC = String.raw`(?<![^\W\d_])(?:w|we)\s+(?:poniedziałek|wtorek|środę|czwartek|piątek|sobotę|niedzielę|weekend)(?:\s+(?:rano|wieczorem|po\s+południu|po\s+pracy))?(?![^\W\d_])`;
const SPAN_PATTERNS = [
  String.raw`(?:,\s*)?(?:(?:do|od|na|w|we|przed|po)\s+)?\d{1,2}(?:\.\d{1,2})?\s+${MONTH_NAMES}(?:\s+\d{4})?`,
  String.raw`(?:,\s*)?(?:(?:o|od|do|około|ok\.|na)\s+)?\d{1,2}:\d{2}(?:\s*[–-]\s*\d{1,2}(?::\d{2})?)?`,
  String.raw`(?:,\s*)?\(\s*\d{1,2}\.\d{1,2}\.?\s*\)`,
];

// The core of each span pattern (date, clock time), used to take over a stated value.
const SPAN_CORES: readonly (string | null)[] = [
  String.raw`\d{1,2}(?:\.\d{1,2})?\s+${MONTH_NAMES}(?:\s+\d{4})?`,
  String.raw`\d{1,2}:\d{2}`,
  null,
];

const citedText = (ids: readonly number[], byId: ReadonlyMap<number, Unit>): string =>
  ids.map(id => byId.get(id)?.text ?? '').join(' ');

// Remove unsupported dates/times from an otherwise good point; a removed date
// is replaced by the one weekday phrase the cited sentences contain. Then
// append a lost hedge word.
const surgicalRepair = (
  point: WorkPoint, byId: ReadonlyMap<number, Unit>, allUnits: readonly Unit[], language: Language,
): { point: WorkPoint; issues: string[] } => {
  let current = point;
  let issues = checkPoint(current, byId, allUnits, language);
  if (!issues.length || language !== 'pl') return { point: current, issues };
  let kinds = new Set(issues.map(issueKind));
  const src = citedText(current.sourceIds, byId);
  if ([...kinds].every(k => ['number', 'date', 'hedge'].includes(k)) && (kinds.has('number') || kinds.has('date'))) {
    const bad = new Set<number>();
    for (const issue of issues) {
      if (issue.startsWith('number:')) for (const n of issue.split(':')[1].split(',')) if (/^\d+$/u.test(n)) bad.add(Number(n));
    }
    let text = current.text;
    let removedDate = false;
    const srcDigits = wordsToDigits(src);
    SPAN_PATTERNS.forEach((source, patternIndex) => {
      text = text.replace(rx(source, 'gi'), span => {
        const nums = (span.match(/\d+/gu) ?? []).map(Number);
        const month = rx(MONTH_NAMES, 'i').exec(span);
        const monthBad = month !== null && !new RegExp(month[0].slice(0, 5), 'iu').test(src);
        if (nums.some(n => bad.has(n)) || monthBad) {
          // A misheard time or date is better replaced by the one the sentences state.
          const core = SPAN_CORES[patternIndex];
          const stated = core ? new Set(srcDigits.match(rx(core, 'gi')) ?? []) : new Set<string>();
          if (core && stated.size === 1) return span.replace(rx(core, 'i'), [...stated][0]);
          removedDate = removedDate || month !== null || span.includes('(');
          return '';
        }
        return span;
      });
    });
    text = stripChars(text.replace(/\s+([,;.])/gu, '$1').replace(/\s{2,}/gu, ' '), ' ,;–-');
    text = text.replace(/\(\s*\)/gu, '').trim();
    if (removedDate && !rx(WEEKDAY_PHRASE_SRC, 'i').test(text)) {
      const weekdays = new Set([...src.matchAll(rx(WEEKDAY_PHRASE_SRC, 'gi'))].map(m => m[0].toLowerCase()));
      if (weekdays.size === 1) text = `${text} ${[...weekdays][0]}`;
    }
    if (text !== current.text && words(text).length >= 2) {
      current = { ...current, text };
      issues = checkPoint(current, byId, allUnits, language);
      kinds = new Set(issues.map(issueKind));
    }
  }
  if (issues.length && kinds.size === 1 && kinds.has('hedge')) {
    const hedgeWord = issues[0].split(':').slice(1).join(':').toLowerCase();
    if (['chyba', 'może', 'podobno', 'prawdopodobnie', 'raczej'].includes(hedgeWord)) {
      const trial = { ...current, text: `${current.text.replace(/\.+$/u, '')} (${hedgeWord})` };
      if (!checkPoint(trial, byId, allUnits, language).length) return { point: trial, issues: [] };
    }
  }
  return { point: current, issues };
};

// Neighbour sentences (within +-radius) that contribute at least two of the
// point's otherwise unsupported content stems (guards against coincidences).
const neighbourIds = (point: WorkPoint, byId: ReadonlyMap<number, Unit>, radius: number): number[] => {
  const ids = new Set(point.sourceIds);
  if (point.sourceIds.some(id => !byId.has(id))) return [];
  const citedStems = new Set(stems(citedText(point.sourceIds, byId)));
  const missing = new Set(stems(point.text).filter(s => !citedStems.has(s)));
  if (!missing.size) return [];
  const near = new Set<number>();
  for (const id of ids) for (let j = id - radius; j <= id + radius; j += 1) if (!ids.has(j)) near.add(j);
  return [...near].sort((a, b) => a - b).filter(c => {
    const unit = byId.get(c);
    if (!unit) return false;
    const have = new Set(stems(unit.text));
    return [...missing].filter(s => have.has(s)).length >= Math.min(2, missing.size);
  });
};

const withIds = (point: WorkPoint, extra: readonly number[]): WorkPoint =>
  ({ ...point, sourceIds: [...new Set([...point.sourceIds, ...extra])].sort((a, b) => a - b) });

const repairByCitation = (
  point: WorkPoint, byId: ReadonlyMap<number, Unit>, allUnits: readonly Unit[], language: Language, radius: number,
): { point: WorkPoint; issues: string[] } => {
  const issues = checkPoint(point, byId, allUnits, language);
  if (issues.length && issues.every(issue => issue.startsWith('date:'))) {
    // unsupported month/weekday: drop the date word instead of the whole point
    const stripped = stripChars(point.text.replace(DATE_STRIP, '').replace(/\s{2,}/gu, ' '), ' ,');
    if (stripped !== point.text && stripped.length > 8) {
      const trial = { ...point, text: stripped };
      if (!checkPoint(trial, byId, allUnits, language).length) return { point: trial, issues: [] };
    }
  }
  if (!issues.length || !issues.every(issue => REPAIRABLE.includes(issueKind(issue)))) return { point, issues };
  const near = neighbourIds(point, byId, radius);
  for (const c of near) {
    const trial = withIds(point, [c]);
    if (!checkPoint(trial, byId, allUnits, language).length) return { point: trial, issues: [] };
  }
  for (const a of near) {
    for (const b of near) {
      if (b <= a) continue;
      const trial = withIds(point, [a, b]);
      if (!checkPoint(trial, byId, allUnits, language).length) return { point: trial, issues: [] };
    }
  }
  return { point, issues };
};

// "Ania zarezerwowała kolację" where the speaker says "Ania ma zarezerwować":
// put the planned action back into the infinitive.
const undoPlannedAsDone = (text: string, src: string): string | null => {
  const modal = PLAN_MODAL.exec(src)?.[0].toLowerCase();
  if (!modal) return null;
  const srcWords = words(src);
  for (const m of text.matchAll(PAST_VERB)) {
    const stem = m[1].toLowerCase();
    const infinitive = `${stem}ć`;
    if (stem.length < 5 || !srcWords.includes(infinitive) || srcWords.some(w => w.startsWith(stem) && w !== infinitive)) continue;
    const before = text.slice(0, m.index ?? 0).trim();
    const after = text.slice((m.index ?? 0) + m[0].length);
    if (!before) return `${capitalize(infinitive)}${after}`;
    if (modal === 'ma' || modal === 'mają') return `${before} ${modal} ${infinitive}${after}`;
  }
  return null;
};

// Citation repair, then surgical repair (also on each re-cited variant).
export const repairPoint = (
  start: WorkPoint, byId: ReadonlyMap<number, Unit>, allUnits: readonly Unit[], language: Language = 'pl', radius = 2,
): { point: WorkPoint; issues: string[] } => {
  let point = start;
  if (language === 'pl' && checkPoint(point, byId, allUnits, language).join() === 'tense') {
    const text = undoPlannedAsDone(point.text, citedText(point.sourceIds, byId));
    if (text !== null) point = { ...point, text };
  }
  const first = repairByCitation(point, byId, allUnits, language, radius);
  if (!first.issues.length) return first;
  const candidates = [point, ...neighbourIds(point, byId, radius).map(c => withIds(point, [c]))];
  for (const candidate of candidates) {
    const fixed = surgicalRepair(candidate, byId, allUnits, language);
    if (!fixed.issues.length) return fixed;
  }
  return { point, issues: first.issues };
};

// ---------------------------------------------------------------- literal cleaner
const LEAD_FILLERS_PL = [
  String.raw`no\s+(?:więc|dobra|i|to|ale|tak|nic)`, 'dobra', 'okej', 'ok', String.raw`aha(?:\s+i)?(?:\s+jeszcze)?`, String.raw`i\s+jeszcze`, 'jeszcze',
  String.raw`a\s+propos(?:\s+\w+)?`, String.raw`swoją\s+drogą`, String.raw`w\s+ogóle`, 'generalnie', 'znaczy', 'tak', 'no', 'a', 'i', 'oraz',
  'czyli', String.raw`w\s+sumie`, 'ogólnie', 'ale', 'więc', String.raw`tak\s+serio`, 'serio', 'słuchaj', 'wiesz', 'kurczę', 'matko', String.raw`ostatnia\s+rzecz`, 'dalej', String.raw`chyba\s+wszystko`, String.raw`to\s+chyba\s+tyle`,
  String.raw`i\s+ostatnia\s+rzecz`, String.raw`no\s+i\s+ostatnia\s+rzecz`, 'najważniejsze', String.raw`po\s+pierwsze`, String.raw`po\s+drugie`, String.raw`potem\s+jeszcze`,
];
const LEAD_RE_PL = rx(`^(?:(?:${LEAD_FILLERS_PL.join('|')})\\s*[,:]?\\s+)+`, 'i');
const LEAD_RE_EN = rx(String.raw`^(?:(?:so|well|okay|ok|um|uh|oh|and|also|then|anyway|right|like|you\s+know|and\s+then)\s*[,:]?\s+)+`, 'i');
const INNER_FILLERS_PL = rx(
  String.raw`,?\s*(?<![^\W\d_])(?:znaczy|w\s+sumie|tak\s+na\s+szybko|no\s+wiesz|wiesz|serio|fuj|masakra|trudno|ha\s+ha|kurczę|matko(?:\s+ile\s+to\s+lat)?|jakby|tak\s+jakby|szczerze\s+mówiąc|powiem\s+szczerze|że\s+tak\s+powiem|no)(?![^\W\d_])\s*,?`,
  'gi',
);
const INNER_FILLERS_EN = rx(String.raw`,?\s*(?<![^\W\d_])(?:you\s+know|i\s+mean|honestly|basically|literally|um|uh)(?![^\W\d_])\s*,?`, 'gi');
const CORRECTION_CUT = rx(String.raw`,?\s*\bnie,?\s+(?:czekaj|nie|sorry|przepraszam|wróć|pomyli\w*|sprawdzi\w*(?:\s+jeszcze\s+raz)?(?:\s+w\s+\w+)?)\s*,?\s*`, 'i');
const HEDGE_PLAIN = new RegExp(HEDGE.source, 'iu');

// "do dwudziestu osób, nie, czekaj, do trzydziestu" -> "do trzydziestu osób".
const fixCorrection = (input: string): string => {
  let text = input;
  for (let round = 0; round < 3; round += 1) {
    const m = CORRECTION_CUT.exec(text);
    if (!m) break;
    const before = text.slice(0, m.index);
    const after = text.slice(m.index + m[0].length);
    if (m.index === 0) { text = after; continue; }
    const first = words(after)[0] ?? '';
    const idx = first ? before.toLowerCase().lastIndexOf(` ${first} `) : -1;
    if (first && idx >= 0 && splitWs(before.slice(idx)).length <= 8) {
      const old = before.slice(idx + 1);
      const newHead = after.split(/[,.;]/u)[0];
      const rest = after.slice(newHead.length);
      const oldWords = splitWs(old);
      const newWords = splitWs(newHead);
      const tail = newWords.length < oldWords.length ? oldWords.slice(newWords.length).join(' ') : '';
      text = before.slice(0, idx + 1) + newHead.trim() + (tail ? ` ${stripChars(tail, ' ,')}` : '') + rest;
    } else {
      text = `${before.replace(/[ ,]+$/u, '')}, ${after}`;
    }
  }
  return text;
};

export const cleanLiteral = (input: string, language: Language = 'pl', dropBo = true): string => {
  const pl = language === 'pl';
  const lead = pl ? LEAD_RE_PL : LEAD_RE_EN;
  let t = input.trim();
  if (pl) t = fixCorrection(t);
  t = t.replace(lead, '');
  t = t.replace(pl ? INNER_FILLERS_PL : INNER_FILLERS_EN, match => {
    const trimmed = match.trim();
    return trimmed.startsWith(',') && trimmed.endsWith(',') ? ', ' : ' ';
  });
  if (dropBo && pl) {
    // justification clauses without facts: ", bo <no digits/number words/names>"
    const upper = new RegExp(`[${UPPER}]`, 'u');
    t = t.replace(/,\s*bo\s+[^,.;]+/gu, clause => (pointNumbers(clause).size || upper.test(clause.slice(2)) ? clause : ''));
  }
  t = t.replace(/\s+([,.;!?])/gu, '$1').replace(/,\s*,+/gu, ',').replace(/\s{2,}/gu, ' ');
  t = stripChars(t, ' ,');
  t = stripChars(t.replace(lead, ''), ' ,');
  if (!t) return input.trim();
  if (!/[.!?]$/u.test(t)) t += '.';
  return capitalize(t);
};

// Fallback for a rejected point: the speaker's own words, cleaned of fillers
// and trimmed to the clauses that carry the point's content (plus an adjacent
// negation/condition clause). Never adds words.
const MAX_LITERAL_JOINED = 140;
const WHOLE_SENTENCE_CHARS = 150;
const clauseLiteral = (
  point: { readonly text: string; readonly sourceIds: readonly number[] }, byId: ReadonlyMap<number, Unit>, language: Language, maxIds = 2,
): string => {
  const pst = new Set(stems(point.text));
  const pnums = pointNumbers(point.text);
  const parts: string[] = [];
  for (const id of point.sourceIds.slice(0, maxIds)) {
    const full = cleanLiteral(byId.get(id)?.text ?? '', language);
    const clauses = full.replace(/\.+$/u, '').split(/(?<=[,;])\s+/u).map(c => c.trim()).filter(Boolean);
    const keep = clauses.map(c => stems(c).some(s => pst.has(s)) || [...statedNumbers(c)].some(n => pnums.has(n)));
    const hedged = (c: string): boolean => (language === 'pl' ? NEG.test(c) || HEDGE_PLAIN.test(c) : EN_NEG.test(c));
    clauses.forEach((c, k) => {
      if (!keep[k] && hedged(c) && ((k > 0 && keep[k - 1]) || (k + 1 < keep.length && keep[k + 1]))) keep[k] = true;
    });
    clauses.forEach((c, k) => {
      if (keep[k] && k > 0 && /^(?:że|gdzie|który|która|które|czy|żeby|bo|więc|to)(?![\p{L}\p{N}_])/iu.test(c)) keep[k - 1] = true;
    });
    const all = full.length <= WHOLE_SENTENCE_CHARS;
    const selected = clauses.filter((_, k) => all || keep[k]);
    let text = selected.length ? stripChars(selected.join(' '), ' ,;') : full;
    if (text.length < 15) text = full;
    parts.push(text.replace(/\.+$/u, ''));
  }
  // Two long clauses together read as a transcript: keep the first.
  const joined = (parts.join('; ').length > MAX_LITERAL_JOINED ? parts.slice(0, 1) : parts).join('; ').replace(/,\s*$/u, '');
  return capitalize(joined);
};

const similarity = (a: string, b: string): number => {
  const sa = new Set(stems(a));
  const sb = new Set(stems(b));
  if (!sa.size || !sb.size) return 0;
  return [...sa].filter(s => sb.has(s)).length / Math.min(sa.size, sb.size);
};

// ---------------------------------------------------------------- parsing
const LINE = /^\s*(?:[-•*]|\d+[.)])?\s*(.+?)\s*\[\s*(\d+(?:\s*[,;\-–]\s*\d+)*)\s*\]\s*[.]?\s*$/u;
const LINE_IDS_FIRST = /^\s*(?:[-•*]|\d+[.)])?\s*\[\s*(\d+(?:\s*[,;\-–]\s*\d+)*)\s*\]\s*[:\-–]?\s*(.+?)\s*$/u;

// "1, 3-5" -> [1, 3, 4, 5]; a span of eight or more sentences keeps only its ends.
export const parseSourceIds = (text: string): number[] => {
  const ids = new Set<number>();
  for (const raw of text.split(/[,;]/u)) {
    const part = raw.trim();
    const range = /^(\d+)\s*[-–]\s*(\d+)$/u.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (b - a > 0 && b - a < 8) for (let id = a; id <= b; id += 1) ids.add(id);
      else { ids.add(a); ids.add(b); }
    } else if (/^\d+$/u.test(part)) ids.add(Number(part));
  }
  return [...ids].sort((a, b) => a - b);
};

const LINE_PAREN = /^\s*(?:[-•*]|\d+[.)])?\s*(.+?)\s*\(\s*(\d+(?:\s*[,;\-–]\s*\d+)*)\s*\)\s*[.]?\s*$/u;

const parseLines = (text: string, allowed: ReadonlySet<number>, paren: boolean): SummaryPoint[] => {
  const points: SummaryPoint[] = [];
  const seen = new Set<string>();
  for (const line of text.replace(/<think>[\s\S]*?(?:<\/think>|$)/giu, '').split('\n')) {
    let body: string;
    let idText: string;
    const idsFirst = paren ? null : LINE_IDS_FIRST.exec(line);
    if (idsFirst) {
      idText = idsFirst[1];
      body = idsFirst[2];
    } else {
      const match = (paren ? LINE_PAREN : LINE).exec(line);
      if (!match) continue;
      body = match[1];
      idText = match[2];
    }
    body = body.replace(/\s*\[[^\]]*\]\s*/gu, ' ').replace(/\s+/gu, ' ').trim().replace(/[;,]+$/u, '');
    const ids = parseSourceIds(idText).filter(id => allowed.has(id));
    if (body.length < 6 || !ids.length) continue;
    const key = body.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ text: capitalize(body), sourceIds: ids });
  }
  return points;
};

// A line cut off by the token limit has no closing bracket and is dropped.
// When no line has "[ids]", the model may have used "(ids)" for the whole list.
export const parsePoints = (text: string, allowed: ReadonlySet<number>): SummaryPoint[] => {
  const points = parseLines(text, allowed, false);
  return points.length ? points : parseLines(text, allowed, true);
};

// ---------------------------------------------------------------- finalize
const FILLER_LEAD = rx(String.raw`^(?:no\s+(?:więc|dobra|i)|dobra|aha(?:\s+i\s+jeszcze)?|znaczy|i\s+jeszcze)\s*[,:]?\s+`, 'i');

const tidy = (text: string, language: Language): string => {
  let t = text.trim();
  if (language === 'pl') t = t.replace(FILLER_LEAD, '');
  t = stripChars(t.replace(/\s+/gu, ' ').trim(), ' ;,').replace(/\.+$/u, '');
  return capitalize(t);
};

// "do piątku, 23" -> "do piątku 23" (the month was never spoken).
const WEEKDAY_COMMA_DAY = rx(String.raw`(?<![^\W\d_])((?:poniedział|wtor|środ|czwart|piąt|sobot|niedziel)[^\W\d_]*)\s*,\s*(\d{1,2})(?![\d:.])`, 'gi');
const convert = (text: string, language: Language): string =>
  (language === 'pl' ? wordsToDigits(text).replace(WEEKDAY_COMMA_DAY, '$1 $2') : text);

// "Kubo" -> "Kuba": a capitalised word in -o that the note only has in -a.
const fixVocative = (text: string, noteWords: ReadonlySet<string>): string =>
  text.replace(rx(String.raw`(?<![^\W\d_])([${UPPER}][^\W\d_]{2,})o(?![^\W\d_])`, 'g'), (match, stem: string) => {
    const lower = match.toLowerCase();
    return !noteWords.has(lower) && noteWords.has(`${stem.toLowerCase()}a`) ? `${stem}a` : match;
  });

// ---------------------------------------------------------------- impersonal style
// Points read as notes, not as the speaker's diary: obligations and plans become
// infinitives, decisions start with "Decyzja:". Only word forms are changed.
const DECISION_OPENER = rx(String.raw`^(?:postanowi(?:łem|łam|liśmy|łyśmy)|postanawiam|postanawiamy|zdecydowałem|zdecydowałam|zdecydowaliśmy|postanowił(?=\s+(?:do|że|nie|przez|od|na)(?![^\W\d_])))(?![^\W\d_])(?:\s*,)?(?:\s*,?\s+(?:dzisiaj|dziś|tak|serio|teraz|już|ostatecznie|jednak|postanowiłem|postanowiłam|postanawiam))*\s*,?\s*(?:że\s+)?`, 'i');
// "..., więc postanawiam od dzisiaj, że X": the decision is what follows.
const DECISION_INSIDE = rx(String.raw`^[^.]{10,}?,\s*(?:więc\s+|i\s+)?(?:postanowiłem|postanowiłam|postanawiam|zdecydowałem|zdecydowałam)(?![^\W\d_])(?:\s*,)?(?:\s*,?\s+(?:dzisiaj|dziś|od\s+dzisiaj|od\s+dziś|teraz|już|ostatecznie))*\s*,?\s*(?:że\s+)?`, 'i');
const MODAL_OPENER = rx(String.raw`^(?:muszę|musimy|mam|mamy|trzeba|powinienem|powinnam|powinniśmy)\s+(?:(?:jeszcze|też|także|koniecznie|kiedyś|na\s+pewno|w\s+końcu)\s+)?(?!(?:być|mieć)(?![^\W\d_]))([^\W\d_]{3,}ć)(?![^\W\d_])`, 'i');
const FIRST_FUTURE = rx(String.raw`^([^\W\d_]{4,})ię(?![^\W\d_])`, 'i');
const NOT_VERBS = new Set(['plemię', 'brzemię', 'strzemię', 'nasienię']);
const FIRST_PERSON_NEGATED = rx(String.raw`(?<![^\W\d_])nie\s+([^\W\d_]{4,})am(?![^\W\d_])`, 'gi');
const WEEKDAY_ACCUSATIVE: readonly (readonly [RegExp, string])[] = [
  [/^poniedział\p{L}*$/iu, 'poniedziałek'], [/^wtor\p{L}*$/iu, 'wtorek'], [/^środ\p{L}*$/iu, 'środę'],
  [/^czwart\p{L}*$/iu, 'czwartek'], [/^piąt\p{L}*$/iu, 'piątek'], [/^sobot\p{L}*$/iu, 'sobotę'], [/^niedziel\p{L}*$/iu, 'niedzielę'],
];
const AFTER_W = rx(String.raw`(?<![^\W\d_])(w|we)\s+([^\W\d_]+)(?![^\W\d_])`, 'gi');

// Cyrillic letters that look like Latin ones, which the model sometimes emits mid-word.
const CYRILLIC_TWINS: Readonly<Record<string, string>> = { а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y' };

// "Przedłużę zwrot" -> "Przedłużyć": the first word is a first-person future in -ę and
// the note itself has its infinitive.
const firstPersonFuture = (text: string, noteWords: ReadonlySet<string>): { infinitive: string; length: number } | null => {
  const first = /^\p{L}{6,}ę(?![\p{L}])/u.exec(text)?.[0];
  if (!first) return null;
  const prefix = first.slice(0, -2).toLowerCase();
  const infinitive = [...noteWords].find(w => w.endsWith('ć') && w.startsWith(prefix) && w.length - first.length <= 3);
  return infinitive ? { infinitive, length: first.length } : null;
};

export const impersonalize = (input: string, noteWords: ReadonlySet<string>): string => {
  let text = input.replace(/ть(?![\p{L}])/gu, 'ć').replace(/[аеорсху]/gu, c => CYRILLIC_TWINS[c] ?? c);
  // "nie składaj" where the speaker said "nie składam"
  text = text.replace(/(?<![\p{L}])([\p{L}]{4,})aj(?![\p{L}])/gu, (match, stem: string) =>
    (!noteWords.has(match.toLowerCase()) && noteWords.has(`${stem.toLowerCase()}am`) ? `${stem}am` : match));
  const decision = DECISION_OPENER.exec(text) ?? DECISION_INSIDE.exec(text);
  if (decision && text.length > decision[0].length + 8) {
    text = `Decyzja: ${text.slice(decision[0].length)}`;
  } else if (!/^decyzja:/iu.test(text)) {
    const modal = MODAL_OPENER.exec(text);
    if (modal) text = capitalize(modal[1]) + text.slice(modal[0].length);
    else {
      const future = FIRST_FUTURE.exec(text);
      const infinitive = firstPersonFuture(text, noteWords);
      if (infinitive) text = capitalize(infinitive.infinitive) + text.slice(infinitive.length);
      else if (future && !NOT_VERBS.has(future[0].toLowerCase()) && noteWords.has(future[0].toLowerCase())) text = `${capitalize(future[1])}ić${text.slice(future[0].length)}`;
    }
  }
  if (/^decyzja:/iu.test(text)) {
    text = text.replace(FIRST_PERSON_NEGATED, (match, stem: string) => (noteWords.has(`${stem.toLowerCase()}am`) ? `nie ${stem}ać` : match));
  }
  text = text.replace(/(?<![\p{L}])w(\s+wtor)/giu, 'we$1');
  // A weekday in the wrong case: "w niedzieli" -> "w niedzielę".
  text = text.replace(AFTER_W, (match, prep: string, day: string) => {
    if (noteWords.has(day.toLowerCase())) return match;
    const hit = WEEKDAY_ACCUSATIVE.find(([pattern]) => pattern.test(day));
    return hit ? `${prep} ${hit[1]}` : match;
  });
  return text;
};

// A point about the recording itself ("Nagrywam to") is not part of the note.
const META_POINT = rx(String.raw`^(?:nagrywam|nagrywamy|dyktuję|dyktuje)(?![^\W\d_])(?:\s*,|\s+(?:to|się|notatk\w+|dla|bo|że)(?![^\W\d_]))|^(?:nagrywam|dyktuję)\s*$|(?<![^\W\d_])test\s+mikrofonu`, 'i');
export const isMetaPoint = (text: string): boolean =>
  META_POINT.test(text) && !/\d/u.test(text) && !DATE_SEARCH.some(pattern => pattern.test(text));

// Prompt example phrases the model sometimes emits for a sentence with nothing to say.
const PROMPT_ECHOES = ['umyć okna na balkonie', 'pociąg do lublina w sobotę rano'];
const isPromptEcho = (text: string): boolean => PROMPT_ECHOES.some(phrase => text.toLowerCase().includes(phrase));

// A long literal quote shrinks to the clauses around its most informative one.
const CONTINUATION = rx(String.raw`^(?:że|żeby|ale|lub|albo|oraz|czyli|więc|bo|a|i)(?![^\W\d_])`, 'i');
const MAX_SHORT_LITERAL = 120;
const MIN_CLAUSE_START = 18;
const LEADING_CONNECTIVE = rx(String.raw`^(?:więc|bo|że|żeby|ale|i|a|czyli)\s+`, 'i');
const clauseWeight = (clause: string): number =>
  (COMMITMENT.test(clause) || PLAN_SIGNAL.test(clause) ? 2 : 0) + (hasDate(clause) ? 1 : 0) + (hasNumber(clause) ? 1 : 0) +
  (NEG.test(clause) || HEDGE_PLAIN.test(clause) ? 0.5 : 0) + (new RegExp(`[${UPPER}]`, 'u').test(clause.slice(1)) ? 0.5 : 0);
const TRAILING_WAIT = rx(String.raw`^(?:zobaczymy|zobaczę|pomyślę|zobaczy\s+się)(?![^\W\d_])`, 'i');
export const shortenLiteral = (input: string): string => {
  const clauses = input.replace(/[.]+$/u, '').split(/(?<=,)\s+/u);
  // "..., zobaczymy czy coś to zmieni" adds nothing to a decision.
  if (clauses.length > 2 && TRAILING_WAIT.test(clauses[clauses.length - 1])) clauses.pop();
  const trimmed = clauses.join(' ').replace(/[,;]+$/u, '');
  if (trimmed.length <= MAX_SHORT_LITERAL || clauses.length < 2) return trimmed === input.replace(/[.]+$/u, '') ? input : trimmed;
  const weights = clauses.map(clauseWeight);
  let from = weights.indexOf(Math.max(...weights));
  let to = from;
  const length = (): number => clauses.slice(from, to + 1).join(' ').length;
  for (let grown = true; grown;) {
    grown = false;
    const next = clauses[to + 1];
    if (next !== undefined && (weights[to + 1] > 0 || CONTINUATION.test(next)) && length() + next.length < MAX_SHORT_LITERAL) { to += 1; grown = true; }
    const prev = clauses[from - 1];
    if (!grown && prev !== undefined && weights[from - 1] > 0 && length() + prev.length < MAX_SHORT_LITERAL) { from -= 1; grown = true; }
  }
  // The sentence opening usually names the subject; keep it when it fits.
  if (from > 0 && clauses.slice(0, to + 1).join(' ').length <= MAX_SHORT_LITERAL * 1.2) from = 0;
  // Never start on a fragment ("że nie," / "jednak 10 dni,").
  while (from > 0 && (CONTINUATION.test(clauses[from]) || clauses[from].length < MIN_CLAUSE_START) &&
    clauses.slice(from - 1, to + 1).join(' ').length <= MAX_SHORT_LITERAL * 1.6) from -= 1;
  const kept = clauses.slice(from, to + 1).join(' ').replace(LEADING_CONNECTIVE, '');
  return stripChars(kept, ' ,;');
};

// Validate every point; repair what can be repaired; a point that still fails
// is dropped when its sentences are already covered, otherwise replaced by the
// cleaned literal clauses of at most two of them. Output is in note order.
export const finalizePoints = (
  points: readonly SummaryPoint[], units: readonly Unit[], language: Language = 'pl',
): { points: WorkPoint[]; rejected: RejectedPoint[] } => {
  const byId = new Map(units.map(unit => [unit.id, unit]));
  const kept: WorkPoint[] = [];
  const rejected: RejectedPoint[] = [];
  const noteWords = new Set(units.flatMap(unit => words(unit.text)));
  const rambling = isRambling(units);
  for (const raw of points) {
    const text = convert(tidy(raw.text, language), language);
    const prepared: WorkPoint = { text: language === 'pl' ? impersonalize(fixVocative(text, noteWords), noteWords) : text, sourceIds: [...raw.sourceIds] };
    if (language === 'pl' && isMetaPoint(prepared.text)) continue;
    const { point, issues } = repairPoint(prepared, byId, units, language);
    if (issues.length) rejected.push({ text: point.text, sourceIds: point.sourceIds, issues });
    else kept.push(point);
  }
  const covered = new Set(kept.flatMap(point => point.sourceIds));
  for (const reject of rejected) {
    const rest = reject.sourceIds.filter(id => !covered.has(id));
    if (!rest.length) continue;
    const quoted = convert(clauseLiteral({ text: reject.text, sourceIds: rest }, byId, language), language);
    const literal = language === 'pl' ? capitalize(shortenLiteral(impersonalize(quoted, noteWords))) : quoted;
    // Narration with nothing to act on is not worth quoting.
    if (language === 'pl' && (rambling || REFLECTION.test(literal)) && substanceScore(literal) < MIN_LITERAL_SUBSTANCE) continue;
    if (language === 'pl' && (isMetaPoint(literal) || isPromptEcho(reject.text))) continue;
    kept.push({ text: literal, sourceIds: rest.slice(0, 2), literal: true, replaced: reject.text, issues: reject.issues });
    for (const id of rest.slice(0, 2)) covered.add(id);
  }
  return { points: orderPoints(kept), rejected };
};

// Note order, without near-duplicates citing the same sentences.
const orderPoints = (points: readonly WorkPoint[]): WorkPoint[] => {
  const ordered = points.map((point, index) => ({ point, index }))
    .sort((a, b) => Math.min(...a.point.sourceIds) - Math.min(...b.point.sourceIds) || a.index - b.index)
    .map(entry => entry.point);
  const out: WorkPoint[] = [];
  for (const point of ordered) {
    const duplicate = out.some(other => point.sourceIds.some(id => other.sourceIds.includes(id)) && similarity(point.text, other.text) >= 0.6);
    if (!duplicate) out.push(point);
  }
  return out;
};

// A sentence with a plan or a dated event that no point cites was most likely
// skipped by the model; its cleaned words are added (at most 15% of the
// points), so appointments and obligations do not depend on sampling luck.
const RECOVER_SHARE = 0.15;
const BIG_NUMBER = 10;
const hasDate = (text: string): boolean => DATE_SEARCH.some(pattern => pattern.test(text));
const hasNumber = (text: string): boolean => /\d/u.test(text) || statedNumbers(text).size > 0;
const PAST_ANY = rx(String.raw`(?<![^\W\d_])\w{2,}(?:ł|ła|ło|li|ły|łem|łam|liśmy|łyśmy|liście)(?![^\W\d_])`, 'i');
const COMMITMENT = rx(String.raw`(?<![^\W\d_])(?:postanowi(?:ł\w*|my|ć)|postanaw\w*|zdecyduj\w*|musz\w*|musi\w*|trzeba|mam(?:y)?\s+(?:\w+\s+){0,2}\w+ć|powinn?\w*|zamierz\w*|planuj\w*|termin\w*)(?![^\W\d_])`, 'i');
// Obligations and decisions, or a dated event that is not a story about the past.
export const isEventUnit = (text: string): boolean => {
  if (COMMITMENT.test(text)) return hasDate(text) || SOON.test(text) || /\d/u.test(text) || [...statedNumbers(text)].some(n => n >= BIG_NUMBER);
  if (PAST_ANY.test(text) || REFLECTION.test(text)) return false;
  return (hasDate(text) && hasNumber(text)) || (PLAN_SIGNAL.test(text) && (hasDate(text) || SOON.test(text)));
};

export const recoverMissed = (points: readonly WorkPoint[], units: readonly Unit[]): WorkPoint[] => {
  const covered = new Set(points.flatMap(point => point.sourceIds));
  const budget = Math.max(1, Math.round(points.length * RECOVER_SHARE));
  const byId = new Map(units.map(unit => [unit.id, unit]));
  const noteWords = new Set(units.flatMap(unit => words(unit.text)));
  const added: WorkPoint[] = [];
  for (const unit of units) {
    if (added.length >= budget) break;
    if (covered.has(unit.id) || !isEventUnit(unit.text)) continue;
    const quoted = convert(clauseLiteral({ text: unit.text, sourceIds: [unit.id] }, byId, 'pl'), 'pl');
    const literal = capitalize(shortenLiteral(impersonalize(quoted, noteWords)));
    if (isMetaPoint(literal)) continue;
    added.push({ text: literal, sourceIds: [unit.id], literal: true, issues: ['missed'] });
  }
  return added.length ? orderPoints([...points, ...added]) : [...points];
};

// ---------------------------------------------------------------- prompts
const EXAMPLES_PL = `Przykład 1 (inna notatka):
[1] No więc dzwoniłam dzisiaj do weterynarza, bo Reks od trzech dni nie chce jeść, znaczy je, ale bardzo mało.
[2] Wizyta jest w czwartek o piętnastej, nie, czekaj, o szesnastej czterdzieści.
[3] Pani w rejestracji mówiła, że konsultacja kosztuje sto dwadzieścia złotych, a jak trzeba będzie zrobić USG, to dojdzie jeszcze około trzystu.
[4] Swoją drogą ta pani była strasznie miła, aż się zdziwiłam, normalnie tam wszyscy są naburmuszeni.
[5] Pod lecznicą nie ma gdzie zaparkować, więc zamówię taksówkę.
[6] Aha i jeszcze muszę wziąć książeczkę szczepień, leży w szufladzie w przedpokoju.
[7] Wojtek odbierze Julkę ze świetlicy, bo ja nie zdążę.
[8] I Reks nie może jeść nic na cztery godziny przed wizytą.
Wynik:
- Wizyta u weterynarza w czwartek o szesnastej czterdzieści (Reks od trzech dni mało je) [1, 2]
- Konsultacja sto dwadzieścia złotych; jeśli potrzebne USG, dodatkowo około trzystu [3]
- Do lecznicy taksówką – nie ma gdzie zaparkować [5]
- Wziąć książeczkę szczepień (szuflada w przedpokoju) [6]
- Wojtek odbiera Julkę ze świetlicy [7]
- Reks nie je nic cztery godziny przed wizytą [8]

Przykład 2 (inna notatka):
[1] Dobra, krótko o weekendzie, bo zaraz zapomnę.
[2] W sobotę byliśmy u Igi na ogrodzie, słońce cały dzień, a Iga upiekła ten swój placek.
[3] Iga mówiła, że sprzedaje pianino, bo nikt na nim nie gra, i pytała, czy nie znam kogoś chętnego.
[4] Mogę zapytać Szymona z pracy, on chyba czegoś takiego szukał, ale nic nie obiecywałem.
[5] W niedzielę miałem jechać na rolki, ale padało, więc przełożyłem to na przyszły weekend.
[6] Pamiętam, jak kiedyś na rolkach wywróciłem się przed całą klasą, to były czasy.
[7] Postanowiłem, że do końca miesiąca nie kupuję już żadnych gadżetów, bo wydałem za dużo.
Wynik:
- Iga sprzedaje pianino, szuka chętnego [3]
- Zapytać Szymona z pracy, czy szuka pianina – chyba tak; nic nie obiecane [4]
- Rolki przełożone z niedzieli na przyszły weekend (deszcz) [5]
- Decyzja: do końca miesiąca nie kupować gadżetów [7]`;

const RULES_PL = [
  'Zasady:',
  '1. Styl telegraficzny jak w dobrej aplikacji do notatek: punkt ma 4–14 słów. Bez „mam”, „muszę”, „trzeba” – zadania w bezokoliczniku („Umyć okna na balkonie”), fakty równoważnikiem zdania („Pociąg do Lublina w sobotę rano”).',
  '2. Jeden punkt = jedna sprawa. Zdania o tej samej sprawie połącz w jeden punkt i podaj numery wszystkich.',
  '3. Liczby, godziny, daty i kwoty przepisz dokładnie tymi słowami, jakie są w zdaniu („trzeciego marca”, „o ósmej piętnaście”, „sto dwadzieścia złotych”) – nie zamieniaj ich na cyfry i nic nie przeliczaj. Nie dopisuj miesiąca, roku, dnia tygodnia, waluty, osoby ani miejsca, których nie ma w zdaniach.',
  '4. Gdy mówiący się poprawia („nie, czekaj”, „jednak”, „przełożyłem”), podaj tylko ostateczną wersję.',
  '5. Zachowaj zaprzeczenia („nie”, „bez”), warunki („jeśli pada – kino”) i niepewność („chyba”, „może”).',
  '6. Gdy coś robi inna osoba, napisz kto („Iga kupuje bilety”).',
  '7. Pomiń wstępy, wypełniacze („no więc”, „znaczy”, „aha i jeszcze”), dygresje, wspomnienia, anegdoty, pogodę, emocje i komentarze bez decyzji.',
  '8. Pisz poprawną polszczyzną, słowami z notatki.',
].join('\n');

const HEAD_PL = 'ZADANIE: streszczenie notatki jako lista najważniejszych punktów.\n\nFormat: każda linia to "- treść [numery zdań]". Numery to numery zdań źródła, z których wynika punkt.';

const EXAMPLES_EN = `Example 1 (another note):
[1] So I called the vet today because Rex hasn't wanted to eat for three days, well, he eats, but very little.
[2] The appointment is on Thursday at three, no, wait, at four forty.
[3] The lady at reception said the consultation costs one hundred twenty zloty, and if they need an ultrasound it will be about three hundred more.
[4] By the way, that lady was really nice, I was surprised, everyone there is usually grumpy.
[5] There is nowhere to park near the clinic, so I will take a taxi.
[6] Oh and I still have to take the vaccination booklet, it is in the drawer in the hallway.
[7] Wojtek will pick Julka up from after-school care because I won't make it.
[8] And Rex can't eat anything for four hours before the appointment.
Output:
- Vet appointment on Thursday at 4:40 (Rex has eaten little for 3 days) [1, 2]
- Consultation 120 zloty; if an ultrasound is needed, about 300 more [3]
- Taxi to the clinic - nowhere to park [5]
- Take the vaccination booklet (drawer in the hallway) [6]
- Wojtek picks Julka up from after-school care [7]
- Rex eats nothing for 4 hours before the appointment [8]

Example 2 (another note):
[1] Okay, quickly about the weekend, before I forget.
[2] On Saturday we were at Iga's garden, sunny all day, and Iga baked that cake of hers.
[3] Iga said she is selling her piano because nobody plays it, and asked if I know anyone who wants it.
[4] I could ask Simon from work, he was probably looking for something like that, but I didn't promise anything.
[5] On Sunday I was going rollerblading, but it rained, so I moved it to next weekend.
[6] I remember how I once fell over on rollerblades in front of the whole class, those were the days.
[7] I decided that until the end of the month I am not buying any more gadgets, because I spent too much.
Output:
- Iga is selling her piano, looking for a buyer [3]
- Ask Simon from work whether he wants a piano - probably yes; nothing promised [4]
- Rollerblading moved from Sunday to next weekend (rain) [5]
- Decision: no gadgets until the end of the month [7]`;

const RULES_EN = [
  'Rules:',
  '1. Telegraphic style, like a good notes app: a point has 4-14 words. No "I have to", "I need to" - tasks as imperatives ("Wash the balcony windows"), facts as noun phrases ("Train to Lublin on Saturday morning").',
  '2. One point = one matter. Merge sentences about the same matter into one point and list the numbers of all of them.',
  '3. Write numbers, times, dates and amounts as digits, converted exactly from the words in the sentence ("quarter to five" = 4:45, "one hundred twenty zloty" = 120 zloty). Do not add a month, year, weekday, currency, person or place that is not in the sentences.',
  '4. When the speaker corrects themselves ("no, wait", "actually", "I moved it"), give only the final version.',
  '5. Keep negations ("not", "without"), conditions ("if it rains - cinema") and uncertainty ("maybe", "probably").',
  '6. When someone else does something, say who ("Iga buys the tickets").',
  '7. Skip introductions, fillers ("so", "um", "oh and one more thing"), digressions, memories, anecdotes, weather, emotions and comments without a decision.',
  '8. Write correct English using words from the note.',
].join('\n');

const HEAD_EN = 'TASK: summarize the note as a list of the most important points.\n\nFormat: each line is "- text [sentence numbers]". The numbers are the numbers of the source sentences the point comes from.';

export type PromptVariant = 'base' | 'v2' | 'v3';

const EXAMPLE_DIARY_PL = `

Przykład 3 (inna notatka):
[1] Dobra, zapis z czwartku, żeby nie zapomnieć, co się działo.
[2] Rano zaspałem, w autobusie była taka ciasnota, że ledwo wysiadłem, a w biurze drukarka znowu się zacięła.
[3] Na obiad zjadłem makaron z sosem pomidorowym, trochę za słony, ale dało się zjeść.
[4] Basia z działu kadr napisała, że szkolenie BHP jest przeniesione na przyszły wtorek na dziewiątą, więc muszę to wpisać do kalendarza.
[5] Wieczorem oglądałem film o wulkanach, ciekawy, ale długi.
[6] Postanowiłem, że od poniedziałku wstaję o szóstej i idę na spacer przed pracą, tak na próbę przez dwa tygodnie.
[7] Mam jeszcze zapłacić rachunek za internet, termin jest w piątek, sto dziesięć złotych.
[8] Przypomniał mi się dziadek i jak uczył mnie łowić ryby nad jeziorem, to były czasy.
Wynik:
- Szkolenie BHP przeniesione na przyszły wtorek na dziewiątą – wpisać do kalendarza (Basia z kadr) [4]
- Decyzja: od poniedziałku wstawać o szóstej i chodzić na spacer przed pracą, na próbę dwa tygodnie [6]
- Zapłacić rachunek za internet do piątku, sto dziesięć złotych [7]`;

const RULE1_V2 = '1. Styl telegraficzny jak w dobrej aplikacji do notatek: punkt ma 4–14 słów. Bez „mam”, „muszę”, „trzeba” – zadania zawsze z czasownikiem w bezokoliczniku („Umyć okna na balkonie”, nie „Okna na balkonie”), fakty równoważnikiem zdania („Pociąg do Lublina w sobotę rano”).';
const RULE7_V2 = '7. Pomiń wstępy, wypełniacze („no więc”, „znaczy”, „aha i jeszcze”), dygresje, wspomnienia, anegdoty, pogodę, jedzenie, filmy i opisy zdarzeń dnia, z których nic nie wynika (żadnego zadania, decyzji, terminu ani ustalenia).';
const EXAMPLE_SHORT_PL = `

Przykład 4 (inna notatka):
[1] Byłam dzisiaj w urzędzie gminy, u pani Majewskiej, kolejka na pół godziny, ale ogólnie poszło sprawnie, dokumenty są kompletne.
[2] Wniosek o dowód mam odebrać w czwartek przed południem.
[3] Aha i jeszcze opłatę mam wpłacić za dwie osoby, nie, czekaj, za trzy.
[4] Kolejna wizyta w poniedziałek o ósmej trzydzieści.
[5] A winda w urzędzie znowu się zepsuła, tragedia.
Wynik:
- Wizyta w urzędzie gminy u pani Majewskiej: dokumenty kompletne [1]
- Odebrać wniosek o dowód w czwartek przed południem [2]
- Wpłacić opłatę za trzy osoby [3]
- Kolejna wizyta w poniedziałek o ósmej trzydzieści [4]`;

const RULE_TOPIC_V2 = '10. Gdy pierwsze zdanie podaje temat notatki, pierwszy punkt zaczyna się od tego tematu i łączy go z najważniejszym faktem.';

// The examples live in the system prompt, which is identical for every chunk
// and every note, so llama.rn keeps its KV cache.
export const pointSummarySystem = (language: Language, variant: PromptVariant = 'base'): string => language === 'pl'
  ? `${noteSourceSystem('pl')}\n\nWzorzec streszczenia (gdy zadanie prosi o streszczenie):\n${EXAMPLES_PL}${variant === 'base' ? '' : EXAMPLE_DIARY_PL}${variant === 'v3' ? EXAMPLE_SHORT_PL : ''}`
  : `${noteSourceSystem('en')}\n\nSummary pattern (when the task asks for a summary):\n${EXAMPLES_EN}`;

export const pointSummaryInstructions = (language: Language, maxPoints: number, variant: PromptVariant = 'base'): string => language === 'pl'
  ? [
    HEAD_PL, variant !== 'base' ? RULES_PL.replace(/^1\. .*$/mu, RULE1_V2).replace(/^7\. .*$/mu, RULE7_V2) : RULES_PL,
    `9. Najwyżej ${maxPoints} punktów, w kolejności z notatki. Ważne sprawy (zadania, terminy, decyzje, kwoty, zmiany planów) mają pierwszeństwo przed szczegółami.${variant !== 'base' ? `\n${RULE_TOPIC_V2}` : ''}`,
    'Postępuj jak we wzorcu z instrukcji systemowej. Teraz streść notatkę z SOURCE_START…SOURCE_END. Zwróć wyłącznie listę.',
  ].join('\n\n')
  : [
    HEAD_EN, RULES_EN,
    `9. At most ${maxPoints} points, in the order of the note. Important matters (tasks, deadlines, decisions, amounts, plan changes) take precedence over details.`,
    'Follow the pattern from the system instructions. Now summarize the note between SOURCE_START and SOURCE_END. Return only the list.',
  ].join('\n\n');

// ---------------------------------------------------------------- chunking and budgets
// Points for a whole note: roughly one per three sentences, more slowly for
// long notes. The model follows the limit inside a chunk but ignores it above
// ~25 sentences, so long notes are split and each chunk gets its share.
export const maxPointsFor = (unitCount: number, longSlope = 0.35, cap = 20): number =>
  Math.max(3, Math.min(cap, Math.round(2 + 0.35 * Math.min(unitCount, 22) + longSlope * Math.max(0, unitCount - 22))));
export const outputTokensFor = (points: number): number => Math.min(640, 28 * points + 40);

export interface PointSummaryOptions {
  readonly chunkMaxUnits: number;
  readonly minUnitsForModel: number;
  readonly promptVariant: PromptVariant;
  readonly pointsForNote: (unitCount: number) => number;
}
export const DEFAULT_POINT_SUMMARY_OPTIONS: PointSummaryOptions = {
  chunkMaxUnits: 22,
  minUnitsForModel: 3,
  promptVariant: 'v3',
  pointsForNote: unitCount => maxPointsFor(unitCount),
};

// Consecutive chunks of similar size; a sentence that opens with a spoken
// self-correction stays with the sentence it corrects.
export const splitIntoChunks = <T extends Unit>(units: readonly T[], maxUnits: number): T[][] => {
  if (units.length <= maxUnits) return [[...units]];
  const count = Math.ceil(units.length / maxUnits);
  const size = Math.ceil(units.length / count);
  const chunks: T[][] = [];
  let start = 0;
  while (start < units.length) {
    let end = Math.min(units.length, start + size);
    while (end < units.length && end - start < size + 3 && CORRECTION_START.test(units[end].text)) end += 1;
    chunks.push(units.slice(start, end));
    start = end;
  }
  return chunks;
};

// ---------------------------------------------------------------- generation
export interface PointSummaryCall { readonly units: number; readonly maxPoints: number; readonly nPredict: number; readonly output: string; readonly truncated: boolean }
export interface PointSummaryDetail extends PointSummaryResult {
  readonly literalPoints: readonly { text: string; sourceIds: number[]; literal: boolean }[];
  readonly rawPoints: readonly SummaryPoint[];
  readonly rejected: readonly RejectedPoint[];
  readonly calls: readonly PointSummaryCall[];
}

const documentFor = (content: string, points: readonly SummaryPoint[], units: readonly SummarySourceUnit[]): SummaryDocument | null =>
  points.length ? documentFromSummaryDraft(content, { format: 'bullets', points }, units) : null;

export const generatePointSummaryDetailed = async (
  units: readonly SummarySourceUnit[], content: string, language: Language, execution?: ProcessingExecutionContext,
  options: PointSummaryOptions = DEFAULT_POINT_SUMMARY_OPTIONS,
): Promise<PointSummaryDetail> => {
  const warnings: string[] = [];
  const calls: PointSummaryCall[] = [];
  const rawPoints: SummaryPoint[] = [];
  let finalPoints: WorkPoint[];
  let rejected: RejectedPoint[] = [];
  if (units.length < options.minUnitsForModel) {
    // Nothing to compress: the speaker's own words, cleaned.
    finalPoints = units.map(unit => ({
      text: convert(cleanLiteral(unit.text, language), language), sourceIds: [unit.id], literal: true,
    })).filter(point => point.text.length > 0);
  } else {
    const system = pointSummarySystem(language, options.promptVariant);
    let cut = false;
    const rambling = isRambling(units);
    const noteWeight = units.reduce((sum, unit) => sum + unitWeight(unit, rambling), 0);
    for (const chunk of splitIntoChunks(units, options.chunkMaxUnits)) {
      throwIfProcessingAborted(execution);
      const weightOf = (list: readonly Unit[]): number => list.reduce((sum, unit) => sum + unitWeight(unit, rambling), 0);
      const maxPoints = Math.max(rambling ? 2 : 3, Math.round(options.pointsForNote(Math.round(noteWeight)) * weightOf(chunk) / noteWeight));
      const nPredict = outputTokensFor(maxPoints);
      const prompt = sourceFirstPrompt(renderSummarySources(chunk), pointSummaryInstructions(language, maxPoints, options.promptVariant));
      const result = await generate(prompt, () => undefined, {
        system, nPredict, temperature: 0.1, topP: 0.8, topK: 20, minP: 0, ...(execution?.signal ? { signal: execution.signal } : {}),
      });
      recordGeneration('summary-points', prompt.length, result, chunk.reduce((sum, unit) => sum + unit.text.length, 0));
      throwIfProcessingAborted(execution);
      if (result.completion?.interrupted) throw new Error('Generation interrupted');
      const truncated = Boolean(result.completion?.truncated || result.completion?.stoppedLimit);
      cut = cut || truncated;
      calls.push({ units: chunk.length, maxPoints, nPredict, output: result.text, truncated });
      rawPoints.push(...parsePoints(result.text, new Set(chunk.map(unit => unit.id))));
    }
    if (cut) warnings.push('Summary model output was cut off; the last points may be missing.');
    const finalized = finalizePoints(language === 'pl' ? dropNarration(rawPoints, units) : rawPoints, units, language);
    finalPoints = language === 'pl' ? recoverMissed(finalized.points, units) : finalized.points;
    rejected = finalized.rejected;
  }
  const points = finalPoints.map(point => ({ text: point.text, sourceIds: point.sourceIds }));
  const document = documentFor(content, points, units);
  if (points.length && !document) warnings.push('Summary points could not be linked to the note source.');
  if (!points.length) warnings.push('Summary model produced no usable points.');
  const literalFallbackCount = units.length < options.minUnitsForModel ? 0 : finalPoints.filter(point => point.literal).length;
  return {
    points, document, warnings, literalFallbackCount,
    literalPoints: finalPoints.map(point => ({ text: point.text, sourceIds: point.sourceIds, literal: point.literal === true })),
    rawPoints, rejected, calls,
  };
};

export const generatePointSummary = async (
  units: readonly SummarySourceUnit[], content: string, language: Language, execution?: ProcessingExecutionContext,
): Promise<PointSummaryResult> => {
  const { points, document, warnings, literalFallbackCount } = await generatePointSummaryDetailed(units, content, language, execution);
  return { points, document, warnings, literalFallbackCount };
};
