import {
  documentFromSummaryDraft, isCompleteSummaryVerification, parseSummaryDraft,
  parseSummaryVerification, summaryDraftRequest, summaryDraftSchema,
  summaryVerificationRequest, summaryVerificationSchema,
  type SummaryDraft,
} from './summaryProtocol';
import * as protocol from './summaryProtocol';
import { parseSummaryDocument, renderSummaryDocument } from '../domain/summary';
import type { SummarySourceUnit } from './summarySources';

// Dependency-free evaluator for the JSON Schema subset emitted here. Unknown
// keywords fail the test instead of silently claiming grammar compatibility.
const schemaAccepts = (schema: Readonly<Record<string, unknown>>, value: unknown): boolean => {
  const keywords = ['type', 'properties', 'required', 'additionalProperties', 'anyOf', 'const', 'enum',
    'items', 'minItems', 'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'minimum'];
  for (const key of Object.keys(schema)) if (!keywords.includes(key)) throw new Error(`Untested schema keyword: ${key}`);
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some(branch => schemaAccepts(branch, value))) return false;
  if ('const' in schema && value !== schema.const) return false;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const properties = schema.properties as Record<string, Readonly<Record<string, unknown>>>;
    if ((schema.required as string[]).some(key => !(key in record))) return false;
    if (schema.additionalProperties === false && Object.keys(record).some(key => !(key in properties))) return false;
    return Object.entries(record).every(([key, entry]) => !properties[key] || schemaAccepts(properties[key], entry));
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return false;
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return false;
    if (schema.uniqueItems && new Set(value.map(entry => JSON.stringify(entry))).size !== value.length) return false;
    const items = schema.items as Readonly<Record<string, unknown>> | readonly Readonly<Record<string, unknown>>[];
    return value.every((entry, index) => schemaAccepts(Array.isArray(items) ? items[index] : items, entry));
  }
  if (schema.type === 'string') return typeof value === 'string' && value.length >= Number(schema.minLength ?? 0) && value.length <= Number(schema.maxLength ?? Infinity);
  if (schema.type === 'integer') return typeof value === 'number' && Number.isInteger(value) && value >= Number(schema.minimum ?? -Infinity);
  return true;
};

const units: readonly SummarySourceUnit[] = [
  { id: 4, start: 0, end: 9, text: 'Anna: 20.' },
  { id: 9, start: 10, end: 21, text: 'Brak zajęć.' },
];
const draft: SummaryDraft = { format: 'bullets', points: [
  { text: 'Anna: 20.', sourceIds: [4] },
  { text: 'Brak zajęć.', sourceIds: [9] },
] };
const verdict = () => ({
  points: [
    { pointId: 1, status: 'supported', issues: [] as string[] },
    { pointId: 2, status: 'supported', issues: [] as string[] },
  ],
  units: [
    { sourceId: 4, status: 'covered', pointIds: [1], supersededBy: [] as number[] },
    { sourceId: 9, status: 'covered', pointIds: [2], supersededBy: [] as number[] },
  ],
});

describe('draft wire protocol', () => {
  test('retains global IDs instead of renumbering a reduced context', () => {
    expect(parseSummaryDraft(JSON.stringify(draft), units)).toEqual(draft);
  });
  test.each(['bullets', 'paragraph', 'grouped'] as const)('accepts %s with the matching group rules', format => {
    const point = { text: 'Anna: 20.', sourceIds: [4], ...(format === 'grouped' ? { group: 'Budżet' } : {}) };
    expect(parseSummaryDraft(JSON.stringify({ format, points: [point] }), units)).toEqual({ format, points: [point] });
  });
  test.each([
    { ...draft, quote: 'invented' },
    { format: 'bullets', points: [{ text: 'X', sourceIds: [4], start: 0 }] },
    { format: 'bullets', points: [{ text: 'X', sourceIds: [666] }] },
    { format: 'bullets', points: [{ text: 'X', sourceIds: [4, 4] }] },
    { format: 'bullets', points: [{ text: 'X', sourceIds: [] }] },
    { format: 'bullets', points: [{ text: ' ', sourceIds: [4] }] },
    { format: 'bullets', points: [{ text: 'X', sourceIds: [4], group: 'G' }] },
    { format: 'grouped', points: [{ text: 'X', sourceIds: [4] }] },
    { format: 'grouped', points: [{ text: 'X', sourceIds: [4], group: ' ' }] },
    { format: 'list', points: [] },
  ])('rejects invalid draft %#', candidate => {
    expect(parseSummaryDraft(JSON.stringify(candidate), units)).toBeNull();
  });
  test('allows no points without inventing a filler summary', () => {
    expect(parseSummaryDraft('{"format":"bullets","points":[]}', units)).toEqual({ format: 'bullets', points: [] });
    expect(documentFromSummaryDraft('Anna: 20. Brak zajęć.', { format: 'bullets', points: [] }, units)).toBeNull();
  });
  test.each(['', '{', '```json\n{}\n```', ' '.repeat(1_048_577)])('rejects malformed or oversize output %#', raw => {
    expect(parseSummaryDraft(raw, units)).toBeNull();
    expect(parseSummaryVerification(raw, units, draft)).toBeNull();
  });
  test('rejects duplicate catalog identities', () => {
    expect(parseSummaryDraft(JSON.stringify(draft), [...units, units[0]])).toBeNull();
  });
  test('rejects valid JSON exceeding the response budget', () => {
    const raw = JSON.stringify({ format: 'bullets', points: [{ text: 'x'.repeat(1_048_577), sourceIds: [4] }] });
    expect(parseSummaryDraft(raw, units)).toBeNull();
    const rawVerdict = `${JSON.stringify(verdict())}${' '.repeat(1_048_577)}`;
    expect(parseSummaryVerification(rawVerdict, units, draft)).toBeNull();
  });
});

describe('independent semantic verdict protocol', () => {
  test('accepts fully checked facts and permits unordered verdict entries', () => {
    const candidate = verdict();
    candidate.points.reverse(); candidate.units.reverse();
    const parsed = parseSummaryVerification(JSON.stringify(candidate), units, draft);
    expect(parsed).toEqual(candidate);
    expect(isCompleteSummaryVerification(parsed!, draft)).toBe(true);
  });
  test('does not confuse a valid link with coverage of the last non-task negative', () => {
    const candidate = {
      points: [{ pointId: 1, status: 'supported', issues: [] }],
      units: [
        { sourceId: 4, status: 'covered', pointIds: [1], supersededBy: [] },
        { sourceId: 9, status: 'missing', pointIds: [], supersededBy: [] },
      ],
    };
    const partial: SummaryDraft = { format: 'bullets', points: [draft.points[0]] };
    const parsed = parseSummaryVerification(JSON.stringify(candidate), units, partial);
    expect(parsed).not.toBeNull();
    expect(isCompleteSummaryVerification(parsed!, partial)).toBe(false);
  });
  test.each([
    ['Brak zajęć.', 'Cały dzień wolny.', 'negation'],
    ['Może we wtorek.', 'We wtorek.', 'uncertainty'],
    ['Wysłałem raport.', 'Wyślę raport.', 'completion'],
    ['Anna wysyła, Jan drukuje.', 'Jan wysyła, Anna drukuje.', 'actor'],
    ['Koszt wynosi 20.', 'Koszt wynosi 30.', 'number'],
    ['Spotkanie 8 maja.', 'Spotkanie 9 maja.', 'date'],
    ['Wyślę, jeśli zatwierdzisz.', 'Wyślę.', 'condition'],
    ['Spotkanie odwołane.', 'Spotkanie odbędzie się.', 'correction'],
    ['Anna drukuje raport.', 'Anna wysyła raport.', 'action'],
  ] as const)('keeps authored %s -> %s verdict as failure (%s)', (source, text, issue) => {
    const context = [{ id: 7, start: 0, end: source.length, text: source }];
    const candidate: SummaryDraft = { format: 'bullets', points: [{ text, sourceIds: [7] }] };
    const raw = JSON.stringify({
      points: [{ pointId: 1, status: 'unsupported', issues: [issue] }],
      units: [{ sourceId: 7, status: 'missing', pointIds: [], supersededBy: [] }],
    });
    const parsed = parseSummaryVerification(raw, context, candidate);
    expect(parsed?.points[0]).toEqual({ pointId: 1, status: 'unsupported', issues: [issue] });
    expect(isCompleteSummaryVerification(parsed!, candidate)).toBe(false);
  });
  test('uncertainty does not pass either verdict dimension', () => {
    const candidate = verdict();
    candidate.points[0] = { pointId: 1, status: 'uncertain', issues: ['other'] };
    candidate.units[0] = { sourceId: 4, status: 'uncertain', pointIds: [], supersededBy: [] };
    const parsed = parseSummaryVerification(JSON.stringify(candidate), units, draft);
    expect(parsed).not.toBeNull();
    expect(isCompleteSummaryVerification(parsed!, draft)).toBe(false);
  });
  test.each([
    (v: ReturnType<typeof verdict>) => { v.points.pop(); },
    (v: ReturnType<typeof verdict>) => { v.units.pop(); },
    (v: ReturnType<typeof verdict>) => { v.points[1].pointId = 1; },
    (v: ReturnType<typeof verdict>) => { v.units[1].sourceId = 4; },
    (v: ReturnType<typeof verdict>) => { v.points[0].pointId = 99; },
    (v: ReturnType<typeof verdict>) => { v.units[0].sourceId = 99; },
    (v: ReturnType<typeof verdict>) => { v.points[0].issues = ['negation']; },
    (v: ReturnType<typeof verdict>) => { v.points[0].status = 'trusted'; },
    (v: ReturnType<typeof verdict>) => { v.points[0].issues = ['invented']; },
    (v: ReturnType<typeof verdict>) => { v.units[0].pointIds = []; },
    (v: ReturnType<typeof verdict>) => { v.units[0].pointIds = [2]; },
    (v: ReturnType<typeof verdict>) => { v.units[0].pointIds = [1, 1]; },
    (v: ReturnType<typeof verdict>) => { v.units[0].status = 'context'; },
    (v: ReturnType<typeof verdict>) => { v.units[0].supersededBy = [9]; },
  ])('rejects structurally inconsistent verifier %#', mutate => {
    const candidate = verdict(); mutate(candidate);
    expect(parseSummaryVerification(JSON.stringify(candidate), units, draft)).toBeNull();
  });
  test.each([
    { ...verdict(), reasoning: 'private chain' },
    { ...verdict(), points: [{ ...verdict().points[0], explanation: 'extra' }, verdict().points[1]] },
    { ...verdict(), units: [{ ...verdict().units[0], quote: 'invented' }, verdict().units[1]] },
    { points: [], units: [] },
  ])('rejects extra properties or an absent response %#', candidate => {
    expect(parseSummaryVerification(JSON.stringify(candidate), units, draft)).toBeNull();
  });
  test('accepts filler/context without fabricated points', () => {
    const empty: SummaryDraft = { format: 'bullets', points: [] };
    const parsed = parseSummaryVerification(JSON.stringify({ points: [], units: [
      { sourceId: 4, status: 'context', pointIds: [], supersededBy: [] },
      { sourceId: 9, status: 'context', pointIds: [], supersededBy: [] },
    ] }), units, empty);
    expect(parsed).not.toBeNull();
    expect(isCompleteSummaryVerification(parsed!, empty)).toBe(true);
  });
  test('requires later present correction evidence and forbids resurrecting superseded sources', () => {
    const corrected: SummaryDraft = { format: 'bullets', points: [{ text: 'Poprawka: 30.', sourceIds: [9] }] };
    const candidate = { points: [{ pointId: 1, status: 'supported', issues: [] }], units: [
      { sourceId: 4, status: 'superseded', pointIds: [], supersededBy: [9] },
      { sourceId: 9, status: 'covered', pointIds: [1], supersededBy: [] },
    ] };
    expect(isCompleteSummaryVerification(parseSummaryVerification(JSON.stringify(candidate), units, corrected)!, corrected)).toBe(true);
    const anchoredCorrection: SummaryDraft = { ...corrected, points: [{ text: 'Anna: poprawka z 20 na 30.', sourceIds: [4, 9] }] };
    expect(parseSummaryVerification(JSON.stringify(candidate), units, anchoredCorrection)).not.toBeNull();
    const resurrected: SummaryDraft = { ...corrected, points: [{ text: 'Anna: 20.', sourceIds: [4] }] };
    expect(parseSummaryVerification(JSON.stringify(candidate), units, resurrected)).toBeNull();
    candidate.units[0].supersededBy = [4];
    expect(parseSummaryVerification(JSON.stringify(candidate), units, corrected)).toBeNull();
    candidate.units[0].supersededBy = [666];
    expect(parseSummaryVerification(JSON.stringify(candidate), units, corrected)).toBeNull();
    candidate.units[0].supersededBy = [];
    expect(parseSummaryVerification(JSON.stringify(candidate), units, corrected)).toBeNull();
  });
  test('rejects backwards corrections and cycles', () => {
    const candidate = { points: [], units: [
      { sourceId: 4, status: 'superseded', pointIds: [], supersededBy: [9] },
      { sourceId: 9, status: 'superseded', pointIds: [], supersededBy: [4] },
    ] };
    expect(parseSummaryVerification(JSON.stringify(candidate), units, { format: 'bullets', points: [] })).toBeNull();
  });
  test('handles a long later-correction chain without recursion overflow', () => {
    const count = 6000;
    const context = Array.from({ length: count }, (_, index) => ({ id: index + 1, start: index * 2, end: index * 2 + 1, text: 'x' }));
    const candidate: SummaryDraft = { format: 'bullets', points: [{ text: 'Final correction.', sourceIds: [1, count] }] };
    const raw = JSON.stringify({
      points: [{ pointId: 1, status: 'supported', issues: [] }],
      units: context.map(unit => ({ sourceId: unit.id, status: unit.id === count ? 'covered' : 'superseded',
        pointIds: unit.id === count ? [1] : [], supersededBy: unit.id === count ? [] : [unit.id + 1] })),
    });
    expect(parseSummaryVerification(raw, context, candidate)?.units).toHaveLength(count);
  });
});

describe('schemas and canonical document boundary', () => {
  test.each([
    [{ format: 'bullets', points: [{ text: 'Anna: 20.', sourceIds: [4] }] }, true],
    [{ format: 'paragraph', points: [{ text: 'Anna: 20.', sourceIds: [4] }] }, true],
    [{ format: 'grouped', points: [{ text: 'Anna: 20.', sourceIds: [4], group: 'Budget' }] }, true],
    [{ format: 'grouped', points: [{ text: 'Anna: 20.', sourceIds: [4] }] }, false],
    [{ format: 'grouped', points: [{ text: 'Anna: 20.', sourceIds: [4], group: '' }] }, false],
    [{ format: 'bullets', points: [{ text: 'Anna: 20.', sourceIds: [4], group: 'Budget' }] }, false],
    [{ format: 'paragraph', points: [{ text: 'Anna: 20.', sourceIds: [4], group: 'Budget' }] }, false],
    [{ format: 'grouped', points: [{ text: 'Anna: 20.', sourceIds: [4], group: 'Budget', quote: 'extra' }] }, false],
    [{ format: 'bullets', points: [{ text: 'Anna: 20.', sourceIds: [666] }] }, false],
  ])('draft schema admits only the format-specific point shape %#', (candidate, accepted) => {
    expect(schemaAccepts(summaryDraftSchema(units), candidate)).toBe(accepted);
    expect(parseSummaryDraft(JSON.stringify(candidate), units) !== null).toBe(accepted);
  });
  test.each(['pl', 'en'] as const)('labels local points and global citation relationships explicitly (%s)', language => {
    const context = [...units, { id: 17, start: 22, end: 31, text: 'Anna: 20.' }];
    const repeated: SummaryDraft = { format: 'grouped', points: [
      { text: 'Anna: 20.', sourceIds: [4, 17], group: 'Budget' },
      { text: 'Brak zajęć.', sourceIds: [9], group: 'Availability' },
    ] };
    const payload = JSON.parse(summaryVerificationRequest(context, repeated, language).prompt('')) as Record<string, unknown>;
    expect(payload.draftData).toEqual({ format: 'grouped', points: [
      { pointId: 1, text: 'Anna: 20.', sourceIds: [4, 17], group: 'Budget' },
      { pointId: 2, text: 'Brak zajęć.', sourceIds: [9], group: 'Availability' },
    ] });
    expect(payload.sourcePointLinksData).toEqual([
      { sourceId: 4, citingPointIds: [1] }, { sourceId: 9, citingPointIds: [2] }, { sourceId: 17, citingPointIds: [1] },
    ]);
    expect(repeated.points[0]).not.toHaveProperty('pointId');
  });
  test('verifier schema blocks ID substitution and mismatched citations but allows semantic failure', () => {
    const schema = summaryVerificationSchema(units, draft);
    expect(schemaAccepts(schema, verdict())).toBe(true);
    const wrongLink = verdict(); wrongLink.units[0].pointIds = [2];
    expect(schemaAccepts(schema, wrongLink)).toBe(false);
    const duplicatePoint = verdict(); duplicatePoint.points[1].pointId = 1;
    expect(schemaAccepts(schema, duplicatePoint)).toBe(false);
    const duplicateSource = verdict(); duplicateSource.units[1].sourceId = 4;
    expect(schemaAccepts(schema, duplicateSource)).toBe(false);
    const supportedIssue = verdict(); supportedIssue.points[0].issues = ['actor'];
    expect(schemaAccepts(schema, supportedIssue)).toBe(false);
    const missing = verdict(); missing.units[0] = { sourceId: 4, status: 'missing', pointIds: [], supersededBy: [] };
    // P0-4a: unit 4 is cited by point 1, so the grammar no longer offers 'missing' there.
    expect(schemaAccepts(schema, missing)).toBe(false);
    const uncertain = verdict(); uncertain.points[0] = { pointId: 1, status: 'uncertain', issues: ['actor'] };
    uncertain.units[0] = { sourceId: 4, status: 'uncertain', pointIds: [], supersededBy: [] };
    expect(schemaAccepts(schema, uncertain)).toBe(true);
    expect(isCompleteSummaryVerification(parseSummaryVerification(JSON.stringify(uncertain), units, draft)!, draft)).toBe(false);
  });
  test('verifier schema preserves paired correction references and requires later supersession', () => {
    const correction: SummaryDraft = { format: 'bullets', points: [{ text: 'Anna: 30.', sourceIds: [4, 9] }] };
    const schema = summaryVerificationSchema(units, correction);
    const candidate = { points: [{ pointId: 1, status: 'supported', issues: [] }], units: [
      { sourceId: 4, status: 'superseded', pointIds: [], supersededBy: [9] },
      { sourceId: 9, status: 'covered', pointIds: [1], supersededBy: [] },
    ] };
    expect(schemaAccepts(schema, candidate)).toBe(true);
    expect(parseSummaryVerification(JSON.stringify(candidate), units, correction)).not.toBeNull();
    candidate.units[0].supersededBy = [4];
    expect(schemaAccepts(schema, candidate)).toBe(false);
  });
  test('repeated source 3 may cover point 1 but cannot cover unrelated point 3', () => {
    const context = [
      { id: 1, start: 0, end: 15, text: 'Ada: inventory.' },
      { id: 2, start: 16, end: 31, text: 'Ben: delivery.' },
      { id: 3, start: 32, end: 47, text: 'Ada: inventory.' },
      { id: 4, start: 48, end: 65, text: 'Ben: by 18 June.' },
    ];
    const repeated: SummaryDraft = { format: 'bullets', points: [
      { text: 'Ada: inventory.', sourceIds: [1, 3] },
      { text: 'Ben: delivery.', sourceIds: [2] },
      { text: 'Ben: by 18 June.', sourceIds: [4] },
    ] };
    const candidate = { points: [1, 2, 3].map(pointId => ({ pointId, status: 'supported', issues: [] })), units: [
      { sourceId: 1, status: 'covered', pointIds: [1], supersededBy: [] },
      { sourceId: 2, status: 'covered', pointIds: [2], supersededBy: [] },
      { sourceId: 3, status: 'covered', pointIds: [1], supersededBy: [] },
      { sourceId: 4, status: 'covered', pointIds: [3], supersededBy: [] },
    ] };
    const schema = summaryVerificationSchema(context, repeated);
    expect(schemaAccepts(schema, candidate)).toBe(true);
    expect(parseSummaryVerification(JSON.stringify(candidate), context, repeated)).not.toBeNull();
    candidate.units[2].pointIds = [3];
    expect(schemaAccepts(schema, candidate)).toBe(false);
    expect(parseSummaryVerification(JSON.stringify(candidate), context, repeated)).toBeNull();
    candidate.units[2] = { sourceId: 3, status: 'uncertain', pointIds: [], supersededBy: [] };
    expect(schemaAccepts(schema, candidate)).toBe(true);
    expect(isCompleteSummaryVerification(parseSummaryVerification(JSON.stringify(candidate), context, repeated)!, repeated)).toBe(false);
  });
  test('empty context/draft schemas permit empty arrays without invalid empty enums', () => {
    const empty: SummaryDraft = { format: 'bullets', points: [] };
    const generator = summaryDraftSchema([]);
    const checker = summaryVerificationSchema([], empty);
    expect(JSON.stringify(generator)).not.toContain('"enum":[]');
    expect(JSON.stringify(checker)).not.toContain('"enum":[]');
    expect(JSON.stringify(summaryVerificationSchema(units, empty))).not.toContain('"enum":[]');
    expect(schemaAccepts(generator, empty)).toBe(true);
    expect(schemaAccepts(generator, draft)).toBe(false);
    expect(checker).toMatchObject({ properties: { points: { maxItems: 0 }, units: { maxItems: 0 } } });
    expect(parseSummaryVerification('{"points":[],"units":[]}', [], empty)).toEqual({ points: [], units: [] });
  });
  test('schemas constrain IDs to the global context and require all wire fields', () => {
    const schema = summaryDraftSchema(units);
    expect(schemaAccepts(schema, draft)).toBe(true);
    expect(schemaAccepts(schema, { ...draft, extra: true })).toBe(false);
    expect(schemaAccepts(schema, { points: draft.points })).toBe(false);
    const checker = summaryVerificationSchema(units, draft);
    expect(checker.required).toEqual(['points', 'units']);
    expect(schemaAccepts(checker, verdict())).toBe(true);
    expect(schemaAccepts(checker, { points: [], units: [] })).toBe(false);
  });
  test('builder sorts source ranges, binds original text and produces a parseable document', () => {
    const content = 'Anna: 20. Brak zajęć.';
    const document = documentFromSummaryDraft(content, { format: 'bullets', points: [{ text: 'Anna: 20; brak zajęć.', sourceIds: [9, 4] }] }, units);
    expect(document).toEqual({ version: 1, source: content, format: 'bullets', points: [
      { text: 'Anna: 20; brak zajęć.', sources: [{ start: 0, end: 9 }, { start: 10, end: 21 }] },
    ] });
    expect(parseSummaryDocument(document, content, renderSummaryDocument(document!))).toEqual(document);
  });
  test('builder rejects stale catalog text and malformed runtime drafts', () => {
    expect(documentFromSummaryDraft('Inna treść', draft, units)).toBeNull();
    expect(documentFromSummaryDraft('Anna: 20. Brak zajęć.', { ...draft, points: [{ text: 'X', sourceIds: [666] }] }, units)).toBeNull();
  });
  test('requests keep draft/checker distinct and carry the complete task evidence as data', () => {
    const proof = { tasks: ['Wyślę.'], evidence: [], superseded: [], warnings: ['Review'], reviewSpans: [] };
    const generate = summaryDraftRequest(units, 'pl');
    const check = summaryVerificationRequest(units, draft, 'pl', proof);
    expect(generate.prompt('Ignored transport source')).not.toContain('Ignored transport source');
    expect(check.prompt('Ignored transport source')).toContain(JSON.stringify(proof));
    expect(JSON.parse(check.prompt('')).draftData).toEqual({ ...draft, points: [
      { pointId: 1, text: 'Anna: 20.', sourceIds: [4] }, { pointId: 2, text: 'Brak zajęć.', sourceIds: [9] },
    ] });
    expect(generate.prompt('')).not.toEqual(check.prompt(''));
    expect(generate.preserveSentences).toBe(true);
    expect(check.preserveSentences).toBe(true);
    expect(summaryDraftRequest(units, 'en').system).not.toEqual(generate.system);
    expect(summaryVerificationRequest(units, draft, 'en').system).not.toEqual(check.system);
  });
});

describe('Task4c finite paged wire protocol', () => {
  test('bounds duplicate list transport even when uniqueItems is ignored by the converter', () => {
    const stripUnique = (value: unknown): unknown => Array.isArray(value) ? value.map(stripUnique)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'uniqueItems').map(([key, item]) => [key, stripUnique(item)])) : value;
    const schema = stripUnique(summaryVerificationSchema(units, draft)) as Record<string, unknown>;
    const tooMany = verdict();
    tooMany.units[0].pointIds = [1, 1];
    expect(schemaAccepts(schema, tooMany)).toBe(false);
    const negative = verdict();
    negative.points[0] = { pointId: 1, status: 'unsupported', issues: ['actor'] };
    expect(schemaAccepts(schema, negative)).toBe(true);
  });
  test('assembles complete disjoint pages but never accepts missing, duplicate or forged targets', () => {
    expect(typeof protocol.summaryVerificationPageRequest).toBe('function');
    const targets = [{ pointIds: [1], sourceIds: [4] }, { pointIds: [2], sourceIds: [9] }];
    const pages = targets.map((target, i) => {
      const wire = protocol.summaryVerificationPageRequest(units, draft, target, 'en');
      const payload = JSON.parse(wire.request.prompt(''));
      expect(payload.sourceCatalogData).toContain('[9] Brak zajęć.');
      expect(payload.draftData.points).toHaveLength(2);
      expect(wire.maxWireBytes).toBeGreaterThan(100);
      const raw = { points: [verdict().points[i]], units: [verdict().units[i]] };
      expect(schemaAccepts(wire.schema, raw)).toBe(true);
      return protocol.parseSummaryVerificationPage(JSON.stringify(raw), units, draft, target)!;
    });
    expect(protocol.assembleSummaryVerification(pages, units, draft)).toEqual(verdict());
    expect(protocol.assembleSummaryVerification(pages.slice(0, 1), units, draft)).toBeNull();
    expect(protocol.assembleSummaryVerification([...pages, pages[0]], units, draft)).toBeNull();
    expect(protocol.parseSummaryVerificationPage(JSON.stringify(verdict()), units, draft, targets[0])).toBeNull();
    const wrong = { points: [verdict().points[0]], units: [{ ...verdict().units[0], pointIds: [2] }] };
    expect(protocol.parseSummaryVerificationPage(JSON.stringify(wrong), units, draft, targets[0])).toBeNull();
  });
  test('discovery uses complete raw S references and enforces namespace and chronology, not semantics', () => {
    expect(typeof protocol.summaryRelationPageRequest).toBe('function');
    const wire = protocol.summaryRelationPageRequest(units, [9], 'en', true);
    const payload = JSON.parse(wire.request.prompt(''));
    expect(payload).toEqual({ sourceData: [{ source: 'S4', text: 'Anna: 20.' }, { source: 'S9', text: 'Brak zajęć.' }], targetSources: ['S9'] });
    const raw = { format: 'paragraph', rows: [{ source: 'S9', relatedEarlier: ['S4'], unresolved: false }] };
    expect(schemaAccepts(wire.schema, raw)).toBe(true);
    // This legal but semantically unrelated edge is intentionally NOT rejected by geometry.
    expect(protocol.parseSummaryRelationPage(JSON.stringify(raw), units, [9], true)).toEqual(raw);
    for (const relatedEarlier of [['P4'], [4], ['S9'], ['S4', 'S4']]) {
      expect(protocol.parseSummaryRelationPage(JSON.stringify({ ...raw, rows: [{ ...raw.rows[0], relatedEarlier }] }), units, [9], true)).toBeNull();
    }
    expect(protocol.parseSummaryRelationPage(JSON.stringify({ ...raw, rows: [] }), units, [9], true)).toBeNull();
  });
});

test('Task4c page assembly follows transitive final corrections across nonconsecutive source IDs', () => {
  const context = [13, 28, 71].map((id, i) => ({ id, start: i * 10, end: i * 10 + 5, text: 'Fact.' }));
  const corrected: SummaryDraft = { format: 'paragraph', points: [{ text: 'Final.', sourceIds: [13, 71] }] };
  const rows = [
    { sourceId: 13, status: 'superseded', pointIds: [], supersededBy: [28] },
    { sourceId: 28, status: 'superseded', pointIds: [], supersededBy: [71] },
    { sourceId: 71, status: 'covered', pointIds: [1], supersededBy: [] },
  ];
  const pagesFor = (d: SummaryDraft) => rows.map((row, i) => protocol.parseSummaryVerificationPage(JSON.stringify({
    points: i === 0 ? [{ pointId: 1, status: 'supported', issues: [] }] : [], units: [row],
  }), context, d, { pointIds: i === 0 ? [1] : [], sourceIds: [row.sourceId] })!);
  expect(protocol.assembleSummaryVerification(pagesFor(corrected), context, corrected)).not.toBeNull();
  const missingFinal: SummaryDraft = { ...corrected, points: [{ text: 'Obsolete.', sourceIds: [13, 28] }] };
  const partial = protocol.parseSummaryVerificationPage(JSON.stringify({ points: [{ pointId: 1, status: 'supported', issues: [] }], units: [rows[0]] }), context, missingFinal, { pointIds: [1], sourceIds: [13] });
  expect(partial).not.toBeNull(); // A page does not claim to validate the chain.
  const missingRows = [partial!, protocol.parseSummaryVerificationPage(JSON.stringify({ points: [], units: [rows[1], { ...rows[2], status: 'context', pointIds: [] }] }), context, missingFinal, { pointIds: [], sourceIds: [28, 71] })!];
  expect(protocol.assembleSummaryVerification(missingRows, context, missingFinal)).toBeNull();
  for (const id of [13, 28]) {
    expect(protocol.parseSummaryVerificationPage(JSON.stringify({ points: [], units: [{ ...rows[1], supersededBy: [id] }] }), context, corrected, { pointIds: [], sourceIds: [28] })).toBeNull();
  }
});

test('Task4c negative page verdicts remain negative; supported with issues is rejected', () => {
  const targets = { pointIds: [1, 2], sourceIds: [4, 9] };
  const negative = verdict(); negative.points[0] = { pointId: 1, status: 'unsupported', issues: ['actor', 'negation'] };
  const page = protocol.parseSummaryVerificationPage(JSON.stringify(negative), units, draft, targets)!;
  const assembled = protocol.assembleSummaryVerification([page], units, draft)!;
  expect(isCompleteSummaryVerification(assembled, draft)).toBe(false);
  negative.points[0].status = 'supported';
  expect(protocol.parseSummaryVerificationPage(JSON.stringify(negative), units, draft, targets)).toBeNull();
});

test.each([undefined, 'bullets', 'paragraph', 'grouped'] as const)('fix1 I1 keeps free draft content compatible with native repetition grammar: %s', format => {
  const schema = summaryDraftSchema(units, format);
  for (const branch of schema.anyOf as Record<string, unknown>[]) {
    const properties = branch.properties as Record<string, Record<string, unknown>>;
    const points = properties.points;
    expect(points).not.toHaveProperty('maxItems');
    const fields = (points.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
    expect(fields.text).not.toHaveProperty('maxLength');
    if (fields.group) expect(fields.group).not.toHaveProperty('maxLength');
    expect(fields.sourceIds.maxItems).toBe(2);
  }
  const selectedFormat = format ?? 'grouped';
  const candidate = { format: selectedFormat, points: Array.from({ length: 2100 }, () => ({
    text: 'A fact.', sourceIds: [4], ...(selectedFormat === 'grouped' ? { group: 'Topic' } : {}),
  })) };
  expect(schemaAccepts(schema, candidate)).toBe(true);
  expect(parseSummaryDraft(JSON.stringify(candidate), units)?.points).toHaveLength(2100);
  const long = { format: selectedFormat, points: [{ text: 'x'.repeat(1_048_576), sourceIds: [4], ...(selectedFormat === 'grouped' ? { group: 'Topic' } : {}) }] };
  expect(schemaAccepts(schema, long)).toBe(true);
  expect(parseSummaryDraft(JSON.stringify(long), units)).toBeNull(); // Raw transport cap remains the guard.
});

describe('P0 relation and verification grammar caps', () => {
  // Deterministic characters-to-token approximation, the same formula the
  // paging integration tests use: ceil((system + prompt) / 3) + 12.
  const approximatePromptTokens = (wire: protocol.SummaryWireRequest): number =>
    Math.ceil((wire.request.system.length + wire.request.prompt('').length) / 3) + 12;
  const branchProperties = (branch: Readonly<Record<string, unknown>>): Record<string, Record<string, unknown>> =>
    branch.properties as Record<string, Record<string, unknown>>;
  const unitRowItems = (schema: Readonly<Record<string, unknown>>): readonly { readonly anyOf: readonly Readonly<Record<string, unknown>>[] }[] =>
    (((schema.properties as Record<string, Record<string, unknown>>).units) as { items: readonly { anyOf: readonly Readonly<Record<string, unknown>>[] }[] }).items;
  const supersededByOf = (row: { readonly anyOf: readonly Readonly<Record<string, unknown>>[] }): Readonly<Record<string, unknown>> =>
    branchProperties(row.anyOf.find(branch => branchProperties(branch).status.const === 'superseded')!).supersededBy;
  const statusEnumOf = (row: { readonly anyOf: readonly Readonly<Record<string, unknown>>[] }): readonly string[] => {
    const status = row.anyOf.map(branch => branchProperties(branch).status).find(candidate => Array.isArray(candidate.enum))!;
    return status.enum as readonly string[];
  };

  test('P0-1 caps relatedEarlier so a 95-unit late-target relation page fits the 8192 budget', () => {
    const count = 95;
    const lateUnits: readonly SummarySourceUnit[] = Array.from({ length: count }, (_, index) => ({
      id: index + 1, start: index * 100, end: index * 100 + 84,
      text: `Workshop archive item ${index + 1} recorded during the review meeting for later reference.`,
    }));
    const wire = protocol.summaryRelationPageRequest(lateUnits, [count], 'en', true);
    const rows = (wire.schema.properties as Record<string, Record<string, unknown>>).rows;
    const rowItems = rows.items as readonly Readonly<Record<string, unknown>>[];
    const relatedEarlier = (rowItems[0].properties as Record<string, Record<string, unknown>>).relatedEarlier;
    expect(relatedEarlier.maxItems).toBe(8);
    const refs = (relatedEarlier.items as Readonly<Record<string, unknown>>).enum as readonly string[];
    expect(refs).toHaveLength(count - 1); // The enum still names every earlier source.
    const promptTokens = approximatePromptTokens(wire);
    expect(wire.maxWireBytes).not.toBeNull();
    expect(promptTokens + wire.maxWireBytes! + 24).toBeLessThanOrEqual(8192);
    // Guard the regression: without the cap the same page cannot fit. The wire
    // byte formula is linear in maxItems, so the uncapped reserve adds one item
    // plus one separator for every entry the cap removed.
    const itemBytes = Math.max(...refs.map(ref => JSON.stringify(ref).length + 22));
    const uncappedExtra = (count - 1 - 8) * (itemBytes + 23);
    expect(promptTokens + wire.maxWireBytes! + uncappedExtra + 24).toBeGreaterThan(8192);
  });

  test('P0-2 caps supersededBy at 8 while the parser stays permissive and closure survives', () => {
    const count = 10;
    const chainUnits: readonly SummarySourceUnit[] = Array.from({ length: count }, (_, index) => ({
      id: index + 1, start: index * 10, end: index * 10 + 5, text: 'Fact.',
    }));
    const chainDraft: SummaryDraft = { format: 'bullets', points: [{ text: 'Final fact.', sourceIds: [1, count] }] };
    const schema = summaryVerificationSchema(chainUnits, chainDraft);
    const unitRows = unitRowItems(schema);
    expect(supersededByOf(unitRows[0]).maxItems).toBe(8); // 9 later units, capped.
    expect(supersededByOf(unitRows[0]).items).toEqual({ type: 'integer', enum: [2, 3, 4, 5, 6, 7, 8, 9, 10] });
    expect(supersededByOf(unitRows[2]).maxItems).toBe(7); // Existing call sites keep the default below 8.
    const chainVerdict = (firstCorrections: readonly number[]) => ({
      points: [{ pointId: 1, status: 'supported', issues: [] as string[] }],
      units: chainUnits.map((unit, index) => ({
        sourceId: unit.id,
        status: index === count - 1 ? 'covered' : 'superseded',
        pointIds: index === count - 1 ? [1] : ([] as number[]),
        supersededBy: index === count - 1 ? ([] as number[]) : index === 0 ? [...firstCorrections] : [count],
      })),
    });
    const eight = chainVerdict([2, 3, 4, 5, 6, 7, 8, 9]);
    const nine = chainVerdict([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(schemaAccepts(schema, eight)).toBe(true);
    expect(schemaAccepts(schema, nine)).toBe(false); // Grammar cap only.
    expect(protocol.parseSummaryVerification(JSON.stringify(eight), chainUnits, chainDraft)).not.toBeNull();
    // parseVerification stays permissive; closure walks a 9-entry list without crashing.
    expect(protocol.parseSummaryVerification(JSON.stringify(nine), chainUnits, chainDraft)).not.toBeNull();
    const duplicated = chainVerdict([2, 2, 3, 4, 5, 6, 7, 8]);
    expect(schemaAccepts(schema, duplicated)).toBe(false); // uniqueItems
    expect(protocol.parseSummaryVerification(JSON.stringify(duplicated), chainUnits, chainDraft)).toBeNull(); // idList uniqueness
    const stale: SummaryDraft = { format: 'bullets', points: [{ text: 'Obsolete fact.', sourceIds: [1] }] };
    expect(protocol.parseSummaryVerification(JSON.stringify(eight), chainUnits, stale)).toBeNull(); // Closure rejects resurrecting the chain.
  });

  test('P0-4a cited units cannot be missing while uncited rows keep all three statuses', () => {
    const context: readonly SummarySourceUnit[] = [
      { id: 1, start: 0, end: 5, text: 'Cited.' },
      { id: 2, start: 6, end: 11, text: 'Spare.' },
      { id: 3, start: 12, end: 17, text: 'Extra.' },
    ];
    const citedDraft: SummaryDraft = { format: 'bullets', points: [{ text: 'Cited fact.', sourceIds: [1] }] };
    const schema = summaryVerificationSchema(context, citedDraft);
    const unitRows = unitRowItems(schema);
    expect(statusEnumOf(unitRows[0])).toEqual(['context', 'uncertain']);
    expect(statusEnumOf(unitRows[1])).toEqual(['context', 'missing', 'uncertain']);
    const unitRow = (sourceId: number, status: string, pointIds: readonly number[] = []) =>
      ({ sourceId, status, pointIds, supersededBy: [] as number[] });
    const verdictWith = (index: number, row: ReturnType<typeof unitRow>) => {
      const units = [unitRow(1, 'context'), unitRow(2, 'context'), unitRow(3, 'context')];
      units[index] = row;
      return { points: [{ pointId: 1, status: 'supported', issues: [] as string[] }], units };
    };
    expect(schemaAccepts(schema, verdictWith(0, unitRow(1, 'missing')))).toBe(false);
    expect(schemaAccepts(schema, verdictWith(0, unitRow(1, 'context')))).toBe(true);
    expect(schemaAccepts(schema, verdictWith(0, unitRow(1, 'uncertain')))).toBe(true);
    expect(schemaAccepts(schema, verdictWith(0, unitRow(1, 'covered', [1])))).toBe(true);
    for (const status of ['context', 'missing', 'uncertain']) {
      expect(schemaAccepts(schema, verdictWith(1, unitRow(2, status)))).toBe(true);
    }
    // The parser remains permissive (grammar-level guard only).
    expect(protocol.parseSummaryVerification(JSON.stringify(verdictWith(0, unitRow(1, 'missing'))), context, citedDraft)).not.toBeNull();
  });
});
