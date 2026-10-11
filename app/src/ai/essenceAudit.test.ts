import { essenceUnitIds } from './essenceAudit';
import type { FinalTaskEvidence } from './processingContext';
import type { SummarySourceUnit } from './summarySources';

const unit = (id: number, start: number, text: string): SummarySourceUnit => ({ id, start, end: start + text.length, text });
const evidence = (span: SummarySourceUnit, kind: FinalTaskEvidence['evidence'][number]['kind']): FinalTaskEvidence['evidence'][number] =>
  ({ id: `e${span.start}`, start: span.start, end: span.end, quote: span.text, kind, importance: 2 });
const emptyProof = (): FinalTaskEvidence => ({ tasks: [], evidence: [], superseded: [], warnings: [] });

test('marks an explicit decision cue as a decision', () => {
  const first = unit(1, 0, 'Ustaliliśmy, że Marta przygotuje opis.');
  expect(essenceUnitIds([first]).get(1)).toBe('decision');
});

test('marks a unit overlapping active task evidence as a task', () => {
  const first = unit(1, 0, 'Marta przygotuje opis.');
  const proof: FinalTaskEvidence = { ...emptyProof(), evidence: [evidence(first, 'active')] };
  expect(essenceUnitIds([first], proof).get(1)).toBe('task');
});

test('marks a unit overlapping a review span as a task', () => {
  const first = unit(1, 0, 'Marta przygotuje opis.');
  const proof: FinalTaskEvidence = { ...emptyProof(),
    reviewSpans: [{ start: first.start, end: first.end, quote: first.text, reason: 'Unresolved actor' }] };
  expect(essenceUnitIds([first], proof).get(1)).toBe('task');
});

test('marks a unit overlapping a superseded pair as a correction', () => {
  const first = unit(1, 0, 'Pierwotny budżet wynosi 900 złotych.');
  const second = unit(2, first.end + 1, 'Poprawka: końcowy budżet wynosi 1450 złotych.');
  const proof: FinalTaskEvidence = { ...emptyProof(),
    superseded: [{ earlier: evidence(first, 'fact'), later: evidence(second, 'fact') }] };
  expect(essenceUnitIds([first, second], proof).get(1)).toBe('correction');
  expect(essenceUnitIds([first, second], proof).get(2)).toBe('correction');
});

test('marks a dated unit as an amount/date fact', () => {
  const first = unit(1, 0, 'Spotkanie odbędzie się w piątek.');
  expect(essenceUnitIds([first]).get(1)).toBe('amount-date');
});

test('marks a closed scalar statement as an amount/date fact', () => {
  const first = unit(1, 0, 'The budget is 20 dollars.');
  expect(essenceUnitIds([first]).get(1)).toBe('amount-date');
});

test('marks an explicit scalar replacement as an amount/date fact', () => {
  const first = unit(1, 0, 'The final budget replaces the earlier budget of 900 dollars.');
  expect(essenceUnitIds([first]).get(1)).toBe('amount-date');
});

test('marks a closed Polish scalar correction as an amount/date fact', () => {
  const first = unit(1, 0, 'Poprawka: końcowy budżet wynosi 1450 złotych.');
  expect(essenceUnitIds([first]).get(1)).toBe('amount-date');
});

test('marks a cancellation fact as an amount/date fact', () => {
  const first = unit(1, 0, 'Spotkanie zostało odwołane.');
  expect(essenceUnitIds([first]).get(1)).toBe('amount-date');
});

test('marks an explicit lexical change as a correction', () => {
  const first = unit(1, 0, 'Zamiast tego użyjemy południowego studia.');
  expect(essenceUnitIds([first]).get(1)).toBe('correction');
});

test('marks a negation with enough content words as an availability fact', () => {
  const first = unit(1, 0, 'Nie zamówiliśmy pokrowca na kamerę.');
  expect(essenceUnitIds([first]).get(1)).toBe('availability');
});

test('ignores a short negation fragment without three content words', () => {
  const first = unit(1, 0, 'Nie teraz.');
  expect(essenceUnitIds([first]).has(1)).toBe(false);
});

test('ignores a unit with no essence signal', () => {
  const first = unit(1, 0, 'Kawa była dobra.');
  expect(essenceUnitIds([first]).has(1)).toBe(false);
});

test('lets explicit task proof outrank a lexical decision cue', () => {
  const first = unit(1, 0, 'Ustaliliśmy, że Marta przygotuje opis.');
  const proof: FinalTaskEvidence = { ...emptyProof(), evidence: [evidence(first, 'active')] };
  expect(essenceUnitIds([first], proof).get(1)).toBe('task');
});

test('lets a decision cue win over a date in the same unit', () => {
  const first = unit(1, 0, 'Ustaliliśmy spotkanie na 8 listopada.');
  expect(essenceUnitIds([first]).get(1)).toBe('decision');
});

test('is deterministic and preserves catalog order', () => {
  const first = unit(1, 0, 'The budget is 20 dollars.');
  const second = unit(2, first.end + 1, 'Kawa była dobra.');
  const third = unit(3, second.end + 1, 'Nie zamówiliśmy pokrowca na kamerę.');
  const one = essenceUnitIds([first, second, third], emptyProof());
  const two = essenceUnitIds([first, second, third], JSON.parse(JSON.stringify(emptyProof())) as FinalTaskEvidence);
  expect([...one.entries()]).toEqual([...two.entries()]);
  expect([...one.keys()]).toEqual([1, 3]);
  expect(one.get(1)).toBe('amount-date');
  expect(one.get(3)).toBe('availability');
});
