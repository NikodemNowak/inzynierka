export interface SourceUnitPlan {
  readonly version: 1;
  readonly source: string;
  readonly identity: string;
  readonly ends: readonly number[];
}

export interface OriginalSourceUnit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

// A recognizer can separate clock digits with whitespace; punctuation recovery
// may join those same digits with a colon. Expand only this exact numeric pair
// back into its original words. Never normalize a value or an existing colon.
export const punctuationProposalWords = (content: string, proposal: string): string[] => {
  const original = content.match(/\S+/gu) ?? [];
  const words: string[] = [];
  for (const word of proposal.match(/\S+/gu) ?? []) {
    const pair = /^(\d+):(\d+)([.,!?;:]*)$/u.exec(word);
    if (pair && original[words.length] === pair[1] && original[words.length + 1] === pair[2])
      words.push(pair[1], pair[2] + pair[3]);
    else words.push(word);
  }
  return words;
};

const identity = (source: string, ends: readonly number[]): string =>
  JSON.stringify([1, source, ends]);

// Shared with the established task coverage grammar. A boundary proposal must
// not turn one of these governing scopes into an independent affirmative ID.
export const hasUnsupportedRequiredTaskContext = (text: string): boolean =>
  text.includes("?") ||
  /["“”„«»]|(?:^|\s)['‘]|['’](?:\s|[.,;!?]|$)/u.test(text) ||
  /(?:^|[^\p{L}])(?:if|unless|whether|provided|assuming|when|jeśli|jeżeli|gdyby|gdy|czy|said|says|recalled|remembered|reported|mentioned|asked|proposed|previously|formerly|wspomnia\p{L}*|powiedzia\p{L}*|przypomnia\p{L}*|pod\s+warunkiem|o\s+ile|w\s+razie|chyba\s+że|(?:old|previous|earlier|dawna|poprzednia|wcześniejsza)\s+(?:rule|policy|requirement|obligation|zasada|polityka))(?!\p{L})/iu.test(text);

// These parents have scopes that a punctuation proposal cannot prove. Hold the
// whole original source for review rather than manufacturing affirmative IDs.
const ambiguousParent = (source: string): boolean =>
  hasUnsupportedRequiredTaskContext(source) ||
  /["„“”«»]|(?:^|[^\p{L}\p{N}])['‘’]|['‘’](?=$|[^\p{L}\p{N}])/u.test(source) ||
  /\b(?:suppose|hypothetical|told|claimed|disputed|allegedly|example|according to|in case)\b|(?:^|\s)(?:kiedy|w przypadku|na przykład|według|rzekomo|podobno|powiedzieli|powiedziano|mówił(?:a|em|am)?|mówiono|twierdzi(?:ł|ła)?|relacjonował(?:a)?|nie jest prawdą|nieprawda|nie uzgodniono|nie ustalono)(?=\s|$)|\b(?:no assignment was agreed|not an assignment)\b/iu.test(source);

export const canProjectSourceUnits = (source: string): boolean => !ambiguousParent(source);

const correctionCue = (text: string): boolean => /^(?:poprawka|korekta|correction|update)[:,;]?$/iu.test(text);

const unsafeBoundary = (left: string, right: string): boolean => {
  if (/(?:^|\s)(?:nie|not|no|never|bez|without|if|unless|że|aby|żeby|bo|ponieważ|because|that|whether|do|przed|by|before|to|will|must|shall|would|could|might|may|ma|mam|masz|mamy|muszę|musimy|musisz|muszą)$/iu.test(left) ||
      /^(?:że|aby|żeby|because|that|unless|whether|will|must|shall|would|could|might|may|ma|mam|masz|mamy|muszę|musimy|musisz|muszą)(?:\s|$)/iu.test(right)) return true;
  // An added cut before a third-person predicate can strand its subject in
  // introductory text. Retain that original context without guessing a name
  // or owner; explicit next subjects and first-person statements stay intact.
  // An existing source sentence terminator supplies its own hard boundary.
  const finitePredicate = "(?:prześle|prześlą|wyśle|wyślą|przesyła|przesyłają|wysyła|wysyłają|sprawdzi|sprawdzą|sprawdza|sprawdzają|przejrzy|przejrzą|przygotuje|przygotują|uzupełni|uzupełnią|potwierdzi|potwierdzą|wykona|wykonają|zrobi|zrobią|dostarczy|dostarczą|przekaże|przekażą|sends|checks|prepares|reviews|confirms|completes|updates|delivers|forwards)";
  if (!/[.!?]$/u.test(left) &&
      new RegExp(`^${finitePredicate}(?:\\s|$)`, "iu").test(right)) return true;
  // These orphan heads can be qualifiers of the preceding action. Abstention
  // is deliberately conservative; it never supplies an owner or action.
  if (/^(?:z|ze|with|of|to)(?:\s|$)/iu.test(right) ||
      /^[\p{L}]+(?:czy|cza|cze|owy|owa|owe|nego|nej|alny|alna|alne)(?:\s|$)/iu.test(right)) return true;
  // A preposed closed deadline cannot become the end of introductory material.
  const date = "(?:[0-3]?\\d\\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)|(?:poniedziałku|wtorku|środy|czwartku|piątku|soboty|niedzieli)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:january|february|march|april|may|june|july|august|september|october|november|december)\\s+[0-3]?\\d)";
  const hasOwnAction = /(?:^|\s)(?:mam|ma|mamy|masz|muszę|musimy|musisz|muszą)\s+[\p{L}]+ć(?:\s|$)|\b(?:will|must|shall)\s+(?:not\s+)?[\p{L}]+(?:\s|$)/iu.test(left) ||
    new RegExp(`(?:^|\\s)${finitePredicate}(?:\\s|$)`, "iu").test(left);
  if (!hasOwnAction && new RegExp(`(?:^|\\s)(?:do|przed|by|before)\\s+${date}$`, "iu").test(left)) return true;
  if (hasOwnAction && new RegExp(`^(?:do|przed|by|before)\\s+${date}$`, "iu").test(right)) return true;
  return /\d$/u.test(left) && /^(?:zł|złotych|pln|eur|usd|dollars?|euros?|pounds?|kg|%|stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)(?:\s|$)/iu.test(right);
};

const rawUnits = (content: string, ends: readonly number[]): OriginalSourceUnit[] => {
  let start = 0;
  return ends.map((end) => {
    const raw = content.slice(start, end);
    const text = raw.trim();
    const offset = start + raw.indexOf(text);
    start = end;
    return { start: offset, end: offset + text.length, text };
  });
};

export const validateSourceUnitPlan = (
  content: string, value: unknown,
): SourceUnitPlan => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid source unit plan");
  const plan = value as Partial<SourceUnitPlan>;
  if (Object.keys(value).some((key) => !["version", "source", "identity", "ends"].includes(key)) ||
      plan.version !== 1 || plan.source !== content || !Array.isArray(plan.ends) ||
      plan.ends.length < 2 || plan.ends.length > 2048 || plan.ends.at(-1) !== content.length ||
      !plan.ends.every((end, index) => Number.isInteger(end) && end > (index ? plan.ends![index - 1] : 0) &&
        end <= content.length && (end === content.length || /\s/u.test(content[end]))) ||
      plan.identity !== identity(content, plan.ends) || ambiguousParent(content))
    throw new Error("Source unit plan identity does not match its source");
  const units = rawUnits(content, plan.ends);
  if (units.some((unit) => !unit.text || correctionCue(unit.text)) || units.some((unit, index) => index < units.length - 1 && unsafeBoundary(unit.text, units[index + 1].text)))
    throw new Error("Source unit plan cuts a protected scope");
  return Object.freeze({ version: 1, source: content, identity: plan.identity,
    ends: Object.freeze([...plan.ends]) });
};

export const projectSourceUnitPlan = (
  content: string, proposal: string,
): SourceUnitPlan | null => {
  if (ambiguousParent(content)) return null;
  const original = [...content.matchAll(/\S+/gu)];
  const proposed = [...proposal.matchAll(/\S+/gu)];
  if (!original.length || original.length !== proposed.length) return null;
  const ends: number[] = [];
  for (let index = 0; index < original.length; index += 1) {
    const sourceWord = original[index][0].toLowerCase();
    const proposedWord = proposed[index][0].toLowerCase();
    if (!proposedWord.startsWith(sourceWord)) return null;
    const added = proposedWord.slice(sourceWord.length);
    // Preserve every original punctuation character. Only appended boundary
    // punctuation and case changes may affect this alignment, never its quotes.
    if (!/^[.,!?;:]*$/u.test(added)) return null;
    if (/[.!?]/u.test(added)) ends.push(index === original.length - 1 ? content.length : original[index].index + original[index][0].length);
  }
  if (ends.at(-1) !== content.length) ends.push(content.length);
  const merged = [...ends];
  // A model-proposed cut can be dropped to retain more original context. Never
  // invent a replacement cut or soften validation of externally supplied plans.
  // Recheck the changed neighbours: one repair can expose another orphan head.
  while (merged.length > 1) {
    const units = rawUnits(content, merged);
    const unsafe = units.findIndex((unit, index) => index < units.length - 1 &&
      (correctionCue(unit.text) || unsafeBoundary(unit.text, units[index + 1].text)));
    if (unsafe < 0) break;
    merged.splice(unsafe, 1);
  }
  if (merged.at(-1) !== content.length) return null;
  try {
    return validateSourceUnitPlan(content, { version: 1, source: content,
      identity: identity(content, merged), ends: merged });
  } catch {
    return null;
  }
};

export const sourceUnitsFromPlan = (
  content: string, plan: SourceUnitPlan,
): OriginalSourceUnit[] => rawUnits(content, validateSourceUnitPlan(content, plan).ends);

export const sourceUnitsForRange = (
  text: string, start: number, plan: SourceUnitPlan,
): OriginalSourceUnit[] => {
  const all = sourceUnitsFromPlan(plan.source, plan);
  if (plan.source.slice(start, start + text.length) !== text)
    throw new Error("Source unit range has no original source identity");
  const intersecting = all.filter((unit) => unit.start < start + text.length && unit.end > start);
  if (intersecting.some((unit) => unit.start < start || unit.end > start + text.length))
    throw new Error("Source unit range cuts a planned statement");
  return intersecting.map((unit) => ({ start: unit.start - start, end: unit.end - start, text: unit.text }));
};

export const needsSourceUnitPlan = (content: string): boolean =>
  content.trim().split(/\s+/u).length >= 30 &&
  !/[.!?]+(?=\s|$)|\n\s*\n/u.test(content);
