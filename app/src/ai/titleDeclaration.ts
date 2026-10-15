export interface SourceTopicDeclaration {
  start: number;
  end: number;
  quote: string;
}

const explicitDeclaration = (text: string): boolean =>
  /^(?:(?:these\s+notes|this\s+note|the\s+note|this\s+recording|the\s+recording|this\s+text|the\s+text)\s+(?:concerns?|(?:is|are)\s+about)|(?:the\s+)?(?:central\s+object|main\s+subject|primary\s+subject|central\s+subject|main\s+topic|primary\s+topic)(?:\s+of\s+(?:this|the)\s+(?:note|recording|text))?\s+is)\s+\S[^.!?]*[.]?$/iu.test(text) ||
  /^(?:these\s+are\s+(?:the\s+)?(?:planning\s+)?notes|this\s+is\s+(?:a\s+|the\s+)(?:planning\s+)?note)\s+(?:for|about|on)\s+\S[^.!?]*[.]?$/iu.test(text) ||
  /^(?:(?:notatka|notatki|nagranie|tekst)\s+(?:dotyczy|dotyczą)|(?:główny\s+temat|głównym\s+tematem|centralny\s+przedmiot|centralnym\s+przedmiotem|główny\s+przedmiot|głównym\s+przedmiotem)(?:\s+(?:(?:tej|tych)\s+(?:notatki|notatek|nagrania|tekstu)|pracy))?\s+(?:jest|są))\s+\S[^.!?]*[.]?$/iu.test(text);

const qualifiedDeclaration = (text: string): boolean =>
  /[?"“”„«»]|(?:^|\s)['‘]|['’](?:\s|[.,;!?]|$)/u.test(text) ||
  /(?:^|[^\p{L}])(?:if|unless|whether|when|provided|assuming|would|could|might|may|said|says|told|reported|mentioned|claimed|quoted|previously|formerly|once|used\s+to|according\s+to|old\s+statement|earlier\s+declaration|wrong|incorrect|disputed|hypothetical|jeśli|jeżeli|gdy|gdyby|czy|warunk\p{L}*|powiedział\p{L}*|wspomniał\p{L}*|zacytowa\p{L}*|według|dawniej|wcześniej|poprzednio|rzekomo|hipotetyczn\p{L}*|błędn\p{L}*|nieprawidłow\p{L}*)(?!\p{L})/iu.test(text);

const insideQuotation = (source: string, start: number): boolean => {
  const previous = source.slice(0, start);
  if ((previous.match(/"/gu)?.length ?? 0) % 2 !== 0) return true;
  const opens = previous.match(/[“„«]/gu)?.length ?? 0;
  const closes = previous.match(/[”»]/gu)?.length ?? 0;
  if (opens > closes) return true;
  const singleQuotes: ("ascii" | "curly")[] = [];
  let ambiguous = false;
  const word = (character: string | undefined): boolean =>
    character !== undefined && /[\p{L}\p{N}]/u.test(character);
  for (let index = 0; index < start; index += 1) {
    const character = source[index];
    if (character !== "'" && character !== "‘" && character !== "’") continue;
    const before = source[index - 1];
    const after = source[index + 1];
    // In-word apostrophes (names, singular possessives and contractions) are
    // not delimiters. A bare word-final apostrophe outside a quote can be a
    // plural possessive and must not open a quotation across later sentences.
    if (word(before) && word(after) || word(before) && !singleQuotes.length)
      continue;
    if (character === "‘") {
      singleQuotes.push("curly");
      continue;
    }
    if (character === "'" && !word(before) && word(after)) {
      singleQuotes.push("ascii");
      continue;
    }
    const kind = character === "’" ? "curly" : "ascii";
    if (singleQuotes[singleQuotes.length - 1] !== kind) {
      // A mismatched or otherwise unexplained delimiter cannot prove that
      // an enclosing quotation ended; retain the conservative scope guard.
      ambiguous = true;
      continue;
    }
    if (word(before) && /\s/u.test(after ?? "") &&
      /^[\s]*[\p{L}\p{N}]/u.test(source.slice(index + 1))) {
      // Inside a quote, "authors' observations" may be a possessive rather
      // than its closing delimiter. Do not release scope on that ambiguity.
      continue;
    }
    if (word(after)) {
      ambiguous = true;
      continue;
    }
    singleQuotes.pop();
  }
  return ambiguous || singleQuotes.length > 0;
};

const changesExplicitTopic = (text: string): boolean => {
  const topic = /(?:^|[^\p{L}])(?:topic|subject|purpose|central\s+object|declaration|temat\p{L}*|przedmiot\p{L}*|cel|deklaracj\p{L}*)(?!\p{L})/iu.test(text);
  const change = /(?:^|[^\p{L}])(?:correction|actually|instead|wrong|incorrect|obsolete|disputed|no\s+longer|not|chang\p{L}*|replac\p{L}*|korekt\p{L}*|zamiast|błędn\p{L}*|nieprawidłow\p{L}*|nieaktualn\p{L}*|inny|inna|inne|zmian\p{L}*|zmien\p{L}*|poprzedni\p{L}*|wcześniejsz\p{L}*)(?!\p{L})/iu.test(text);
  const noteNegation = /(?:these\s+notes|this\s+note|the\s+note|this\s+recording|this\s+text)\s+(?:(?:do|does)\s+not|no\s+longer|never)\s+(?:concern|describe|cover)|(?:notatka|notatki|nagranie|tekst)\s+(?:już\s+)?nie\s+(?:dotyczy|dotyczą)/iu.test(text);
  const headingNegation = /(?:these\s+are\s+(?:not|no\s+longer|never)\s+(?:the\s+)?(?:planning\s+)?notes|this\s+is\s+(?:not|no\s+longer|never)\s+(?:a\s+|the\s+)(?:planning\s+)?note)\s+(?:for|about|on)\s+\S/iu.test(text);
  return topic && change || noteNegation || headingNegation;
};

const introducesNoncurrentStatement = (text: string): boolean => {
  const statement = /(?:^|[^\p{L}])(?:statement|declaration|sentence|claim|example|zdani\p{L}*|deklaracj\p{L}*|stwierdzeni\p{L}*|przykład\p{L}*|cytat\p{L}*)(?!\p{L})/iu.test(text);
  const noncurrent = /(?:^|[^\p{L}])(?:old|previous|earlier|historical|archived|quoted|reported|fictional|hypothetical|conditional|dawn\p{L}*|star\p{L}*|poprzedn\p{L}*|wcześniejsz\p{L}*|historyczn\p{L}*|archiwaln\p{L}*|cytow\p{L}*|zacytow\p{L}*|hipotetyczn\p{L}*|fikcyjn\p{L}*|warunkow\p{L}*)(?!\p{L})/iu.test(text);
  const setup = /(?:^|[^\p{L}])(?:follows|following|below|next|reads|said|says|quoted|example|poniż\p{L}*|następn\p{L}*|kolejn\p{L}*|następuj\p{L}*|brzmi\p{L}*|cytow\p{L}*|zacytow\p{L}*|przykład\p{L}*)(?!\p{L})/iu.test(text);
  const reportedSetup = /\b(?:said|says|told|quoted|reported|claimed)\b[^.!?]{0,100}\b(?:following|below|next|statement|declaration|sentence|example)\b|(?:^|[^\p{L}])(?:powiedział\p{L}*|zacytowa\p{L}*)\s+[^.!?]{0,100}(?:poniż\p{L}*|następując\p{L}*|deklaracj\p{L}*|zdani\p{L}*)/iu.test(text);
  return statement && noncurrent && setup || reportedSetup;
};

const rejectsPreviousStatement = (text: string): boolean => {
  const reference = /^(?:(?:that|this|the\s+(?:previous|preceding|earlier))\s+(?:statement|declaration|sentence|claim|example)\b|(?:ta|to|ten|tamta|tamto|poprzednia|poprzednie|poprzedni)\s+(?:deklaracj\p{L}*|zdani\p{L}*|stwierdzeni\p{L}*|przykład\p{L}*|cytat\p{L}*))/iu.test(text);
  const rejection = /(?:^|[^\p{L}])(?:fiction\p{L}*|hypothet\p{L}*|disput\p{L}*|reject\p{L}*|wrong|incorrect|untrue|false|obsolete|no\s+longer\s+valid|not\s+current|(?:only|just)\s+an?\s+example|fikcyjn\p{L}*|hipotetyczn\p{L}*|sporn\p{L}*|zakwestionowan\p{L}*|odrzucon\p{L}*|błędn\p{L}*|nieaktualn\p{L}*|nieprawdziw\p{L}*)(?!\p{L})/iu.test(text);
  return reference && rejection;
};

export const literalTopicDeclaration = (source: string, plan?: SourceUnitPlan): SourceTopicDeclaration | null => {
  // A proposal cannot establish a topic or its scope. Validate the complete
  // original parent and keep exact original spans before applying the same
  // declaration, quotation, ambiguity and retraction guards as normal prose.
  const statements: SourceTopicDeclaration[] = plan
    ? sourceUnitsFromPlan(source, plan).map(({ start, end, text }) => ({ start, end, quote: text }))
    : [];
  let start = 0;
  const append = (end: number): void => {
    const raw = source.slice(start, end);
    const quote = raw.trim();
    if (quote) {
      const position = start + raw.indexOf(quote);
      statements.push({ start: position, end: position + quote.length, quote });
    }
    start = end;
  };
  if (!plan) {
    for (const boundary of source.matchAll(/[.!?]+(?=\s|$)|\n\s*\n/gu))
      append(boundary.index + boundary[0].length);
    if (start < source.length) append(source.length);
  }
  const declarations = new Map<string, SourceTopicDeclaration>();
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    if (!explicitDeclaration(statement.quote) || qualifiedDeclaration(statement.quote) ||
      insideQuotation(source, statement.start)) continue;
    // Adjacent explicit setup/rejection can scope over this complete quote.
    // Never infer a link from distant shared words or ordinary amount/room
    // corrections; these guards do not pick a replacement topic.
    if (index > 0 && introducesNoncurrentStatement(statements[index - 1].quote) ||
      index + 1 < statements.length && rejectsPreviousStatement(statements[index + 1].quote))
      continue;
    // Repeated identical data is one declaration. Distinct complete quotes
    // cannot establish one unambiguous current topic locally.
    if (!declarations.has(statement.quote)) declarations.set(statement.quote, statement);
  }
  if (declarations.size !== 1) return null;
  const declaration = [...declarations.values()][0];
  if (statements.some((statement) => statement.start > declaration.start &&
    changesExplicitTopic(statement.quote))) return null;
  return declaration;
};
import { sourceUnitsFromPlan, type SourceUnitPlan } from "./sourceUnits";
