// Polish spoken-number machinery for summary points: compound numeral spans
// ("dwudziestego ósmego" = 28), the strict set of values a text states, and a
// deterministic words -> digits conversion for dates, clock times and amounts.

const NUMBER_WORDS: readonly (readonly [number, RegExp])[] = [
  [11, /^jedena[sś]/u], [12, /^(?:dwuna|dwana)[sś]/u], [13, /^trzyna[sś]/u], [14, /^czterna[sś]/u], [15, /^piętna[sś]/u],
  [16, /^szesna[sś]/u], [17, /^siedemna[sś]/u], [18, /^osiemna[sś]/u], [19, /^dziewiętna[sś]/u],
  [20, /^dw(?:a|u)dzie/u], [30, /^trzydzie/u], [40, /^czterdzie/u], [50, /^pięćdziesi/u], [60, /^sześćdziesi/u],
  [70, /^siedemdziesi/u], [80, /^osiemdziesi/u], [90, /^dziewięćdziesi/u],
  [100, /^(?:sto|stu|setk[\p{L}\p{N}_]*)$/u], [200, /^dw(?:ie[sś]c|ust)/u], [300, /^trzyst/u], [400, /^czteryst/u],
  [500, /^(?:pięćs|pięciuset)/u], [600, /^(?:sześćs|sześciuset)/u], [700, /^(?:siedems|siedmiuset)/u],
  [800, /^(?:osiems|ośmiuset)/u], [900, /^(?:dziewięćs|dziewięciuset)/u],
  [1000, /^tysi/u],
  [1, /^(?:jeden|jedna|jedno|jednego|jednej|jednym|pierwsz)/u], [2, /^(?:dwa|dwie|dwóch|dwu|dwoma|drug)/u],
  [3, /^(?:trzy|trzech|trzema|trzeci)/u], [4, /^(?:cztery|czterech|czterema|czwart(?!e?k))/u],
  [5, /^(?:pięć|pięci|piąt(?!e?k))/u], [6, /^(?:sześć|sześci|szóst)/u], [7, /^(?:siedem|siedmi|siódm)/u],
  [8, /^(?:osiem|ośmi|ósm)/u], [9, /^(?:dziewięć|dziewięci|dziewiąt)/u], [10, /^(?:dziesięć|dziesięci|dziesiąt)/u],
];
// Look-alikes: "jednak", weekdays, "dwór", "trzymać", "setki" as a noun root.
const NOT_NUMBER = /^(?:jednak|jednocze|jednost|jednoli|jednora|piątk|czwartk|dwór|dwor|trzyma|setki?n|ośmiorn|ósmak|dziesiątk|piątak)/u;

export const numberWordValue = (word: string): number | null => {
  const w = word.toLowerCase();
  if (!/^\p{L}+$/u.test(w) || NOT_NUMBER.test(w)) return null;
  for (const [value, pattern] of NUMBER_WORDS) if (pattern.test(w)) return value;
  return null;
};

const canExtend = (parts: readonly number[], v: number): boolean => {
  const last = parts[parts.length - 1];
  if (v === 1000) return true;
  if (parts.includes(1000)) return v < 1000 && (last >= 100 || last === 1000 || (last >= 20 && last % 10 === 0)) && v < (last < 1000 ? last : 1000);
  if (last >= 100 && last % 100 === 0) return v < 100;
  if (last >= 20 && last < 100 && last % 10 === 0) return v < 10;
  return false;
};

export interface NumberSpan {
  readonly start: number;
  readonly end: number;
  readonly value: number;
  readonly words: readonly string[];
}

// "dwudziestego ósmego" = 28 (8 alone is not stated), "siedemnastej trzydzieści"
// = 17 and 30 (a time), "tysiąc czterysta" = 1400, "dziewięć tysięcy" = 9000.
export const numberSpans = (text: string): NumberSpan[] => {
  const spans: NumberSpan[] = [];
  let cur: { start: number; end: number; value: number; parts: number[]; words: string[] } | null = null;
  let prevEnd: number | null = null;
  for (const m of text.matchAll(/\p{L}+/gu)) {
    const start = m.index ?? 0;
    const v = numberWordValue(m[0]);
    const gap = prevEnd !== null ? text.slice(prevEnd, start) : '';
    const joined = cur !== null && /^\s+$/u.test(gap === '' ? ' ' : gap);
    if (v === null) {
      if (cur) { spans.push(cur); cur = null; }
      prevEnd = start + m[0].length;
      continue;
    }
    if (cur && joined && canExtend(cur.parts, v)) {
      cur.value = v === 1000 ? Math.max(cur.value, 1) * 1000 : cur.value + v;
      cur.parts.push(v);
      cur.end = start + m[0].length;
      cur.words.push(m[0]);
    } else {
      if (cur) spans.push(cur);
      cur = { start, end: start + m[0].length, value: v, parts: [v], words: [m[0]] };
    }
    prevEnd = start + m[0].length;
  }
  if (cur) spans.push(cur);
  return spans.map(({ start, end, value, words }) => ({ start, end, value, words }));
};

const HALF_TO = /wpół\s+do\s*$/iu;

const digitValues = (text: string): number[] => (text.match(/\d+/gu) ?? []).map(token => Number.parseInt(token, 10));

// Strict set of values a text states: digits plus compound number-word values.
export const statedNumbers = (text: string): Set<number> => {
  const values = new Set([...digitValues(text), ...numberSpans(text).map(span => span.value)]);
  // "wpół do dziesiątej" states 9:30
  for (const span of numberSpans(text)) {
    if (HALF_TO.test(text.slice(0, span.start)) && span.value <= 24) { values.add(span.value - 1); values.add(30); }
  }
  return values;
};

// Values a summary point states (digits and words); zero is never checked.
export const pointNumbers = (text: string): Set<number> => {
  const values = new Set([...digitValues(text), ...numberSpans(text.replace(/\d+/gu, ' ')).map(span => span.value)]);
  values.delete(0);
  return values;
};

const ORDINAL_END = /(?:ego|ej|ym|emu|ymi|ych)$/u;
const HOUR_PREP = /(?:^|\s)(?:o|od|do|na|przed|po|około|koło|między|i)\s*$/iu;
const MONTH_AFTER = /^\s*(?:stycz|lut|mar|kwie|maj|czerw|lip|sierp|wrze|październik|listopad|grud)/iu;
// A compound or weekday-led genitive ordinal is a day of the month ("czwartek, dwudziestego dziewiątego").
const WEEKDAY_BEFORE = /(?:poniedziałk|wtork|środ|czwartk|piątk|sobot|niedziel|weekend)[\p{L}]*\s*,?\s*$/iu;
const COUNT_UNIT_AFTER = /^\s*(?:zł|złot|euro|osob|osób|godzin|minut|dni|dzień|tygodn|noc|kilo|kg|litr|stopni|sztuk|procent|%|raz)/iu;

// Dates ("dwudziestego ósmego listopada" -> "28 listopada"), clock times
// ("o szesnastej trzydzieści" -> "o 16:30", "wpół do ósmej" -> "7:30") and
// amounts/counts ("pięćset złotych" -> "500 zł"). Ordinals that are neither
// dates nor times ("rozdział drugi") stay words.
export const wordsToDigits = (text: string): string => {
  const spans = numberSpans(text);
  const out: string[] = [];
  let pos = 0;
  let i = 0;
  while (i < spans.length) {
    let { start: s, end: e } = spans[i];
    const { value: v, words } = spans[i];
    const before = text.slice(0, s);
    const after = text.slice(e);
    const lastWord = words[words.length - 1].toLowerCase();
    const ordinal = ORDINAL_END.test(lastWord) || ['pierwszy', 'drugi', 'trzeci'].includes(lastWord);
    let rep: string | null = null;
    const half = HALF_TO.exec(before);
    if (half && v <= 24) {
      rep = `${v - 1}:30`;
      s = half.index;
    } else if (MONTH_AFTER.test(after) && v <= 31) {
      rep = String(v);
    } else if (ordinal && lastWord.endsWith('ej') && v <= 24 && HOUR_PREP.test(before)) {
      rep = `${v}:00`;
      const next = spans[i + 1];
      if (next && /^\s+$/u.test(text.slice(e, next.start)) && next.value < 60 &&
        !ORDINAL_END.test(next.words[next.words.length - 1].toLowerCase())) {
        rep = `${v}:${String(next.value).padStart(2, '0')}`;
        e = next.end;
        i += 1;
      }
    } else if (ordinal && lastWord.endsWith('ego') && v <= 31 && (
      (words.length > 1 && v > 20) || WEEKDAY_BEFORE.test(before))) {
      rep = String(v);
    } else if (!ordinal && (v >= 10 || words.length > 1 || /^\s*[–-]\s*\S/u.test(after) ||
      /\d\s*[–-]\s*$/u.test(out.join('') + text.slice(pos, s)) || COUNT_UNIT_AFTER.test(after))) {
      rep = String(v);
    }
    if (rep === null) { i += 1; continue; }
    out.push(text.slice(pos, s), rep);
    pos = e;
    i += 1;
  }
  out.push(text.slice(pos));
  return out.join('')
    .replace(/(\d)\s+złot[\p{L}\p{N}_]*/gu, '$1 zł')
    .replace(/(\d)\s+(?:1000|tysi[\p{L}\p{N}_]*)(?!\d)/gu, '$1 tys.')
    .replace(/(\d+)\s+i\s+pół(?![\p{L}\p{N}_])/gu, '$1,5')
    .replace(/(\d+),5 1000/gu, '$1,5 tys.')
    .replace(/\b(\d{1,3})\s*([–-])\s*(\d{1,3})000\b/gu, '$1$2$3 tys.');
};

// Model-facing view of a spoken clock time: "ósmą chyba 30 zajęcia" reads to the
// model like thirty classes. "ok. 8:30" keeps the value and the speaker's hedge.
// Only the prompt changes; the note and every check keep the original words.
const CLOCK_HEDGE = /^(?:chyba|może|około|koło|jakoś)$/iu;
const CLOCK_UNIT_AFTER = /^(?:zł|złot\p{L}*|euro|osób|osoby|minut\p{L}*|procent\p{L}*|razy|stopni|kilo|km)$/iu;
const minuteValue = (token: string | undefined): number | null => {
  if (!token) return null;
  const value = /^\d{1,2}$/u.test(token) ? Number(token) : numberWordValue(token);
  return value !== null && Number.isInteger(value) && value >= 1 && value <= 59 ? value : null;
};
export const spokenClockForPrompt = (text: string): string => {
  const tokens = [...text.matchAll(/\S+/gu)];
  const out: string[] = [];
  let index = 0;
  let last = 0;
  while (index < tokens.length) {
    const word = tokens[index][0];
    const hour = /(?:ej|ą)$/u.test(word) ? numberWordValue(word) : null;
    if (hour !== null && hour >= 1 && hour <= 24) {
      let next = index + 1;
      const hedged = CLOCK_HEDGE.test(tokens[next]?.[0] ?? '');
      if (hedged) next += 1;
      let minutes = minuteValue(tokens[next]?.[0]);
      let end = next;
      // "trzydzieści pięć" -> 35
      const unit = minutes !== null && minutes % 10 === 0 && minutes >= 20 ? minuteValue(tokens[next + 1]?.[0]) : null;
      if (minutes !== null && unit !== null && unit < 10 && !/^\d/u.test(tokens[next][0])) { minutes += unit; end = next + 1; }
      // "dwudziestej 2" is 22, not 20:02.
      if (minutes !== null && hour === 20 && minutes < 10) minutes = null;
      if (minutes !== null && !CLOCK_UNIT_AFTER.test(tokens[end + 1]?.[0] ?? '')) {
        out.push(text.slice(last, tokens[index].index), `${hedged ? 'ok. ' : ''}${hour}:${String(minutes).padStart(2, '0')}`);
        last = tokens[end].index! + tokens[end][0].length;
        index = end + 1;
        continue;
      }
    }
    index += 1;
  }
  out.push(text.slice(last));
  return out.join('');
};
