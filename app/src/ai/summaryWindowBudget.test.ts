import { planSummaryWindows, type PlannedSummaryWindow } from './summaryWindowBudget';

interface TestUnit {
  readonly id: number;
  readonly text: string;
}

const unitsWithLengths = (lengths: readonly number[]): readonly TestUnit[] =>
  lengths.map((length, index) => ({ id: index + 1, text: 'x'.repeat(length) }));

const idsOf = (windows: readonly PlannedSummaryWindow<TestUnit>[]): number[][] =>
  windows.map(window => window.units.map(unit => unit.id));

const boundsOf = (windows: readonly PlannedSummaryWindow<TestUnit>[]): number[][] =>
  windows.map(window => [window.firstId, window.lastId]);

// Exact copy of the previous greedy budget loop, kept as an independent oracle
// for every equivalence comparison below.
const linearPlan = async (
  units: readonly TestUnit[],
  fits: (candidate: readonly TestUnit[]) => Promise<boolean>,
): Promise<readonly PlannedSummaryWindow<TestUnit>[]> => {
  const windows: PlannedSummaryWindow<TestUnit>[] = [];
  let current: TestUnit[] = [];
  for (const unit of units) {
    const proposed = [...current, unit];
    const candidateFits = await fits(proposed);
    if (!candidateFits && current.length) {
      windows.push({ units: current, firstId: current[0].id, lastId: current[current.length - 1].id });
      current = [];
      if (windows.length >= 64 || !(await fits([unit]))) return [];
    } else if (!candidateFits) return [];
    current.push(unit);
  }
  if (current.length) windows.push({ units: current, firstId: current[0].id, lastId: current[current.length - 1].id });
  return windows;
};

// Synthetic monotone cost: fixed overhead plus the summed unit text lengths.
const cost = (overhead: number, candidate: readonly TestUnit[]): number =>
  overhead + candidate.reduce((sum, unit) => sum + unit.text.length, 0);
const costFits = (overhead: number, budget: number) =>
  async (candidate: readonly TestUnit[]): Promise<boolean> => cost(overhead, candidate) <= budget;

interface CountedFits {
  readonly calls: () => number;
  readonly fits: (candidate: readonly TestUnit[]) => Promise<boolean>;
}
const countedFits = (overhead: number, budget: number): CountedFits => {
  let calls = 0;
  return { calls: () => calls, fits: async candidate => { calls += 1; return cost(overhead, candidate) <= budget; } };
};

const expectSamePlan = async (
  units: readonly TestUnit[],
  fits: (candidate: readonly TestUnit[]) => Promise<boolean>,
): Promise<void> => {
  const planned = await planSummaryWindows(units, fits);
  const reference = await linearPlan(units, fits);
  expect(idsOf(planned)).toEqual(idsOf(reference));
  expect(boundsOf(planned)).toEqual(boundsOf(reference));
};

// Deterministic PRNG so the generated unit lists stay reproducible.
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

test('returns no windows for an empty unit list', async () => {
  expect(await planSummaryWindows([], costFits(0, 0))).toEqual([]);
  await expectSamePlan([], costFits(0, 0));
});

test('rejects a single unit that cannot fit alone', async () => {
  const units = unitsWithLengths([20]);
  expect(await planSummaryWindows(units, costFits(0, 10))).toEqual([]);
  await expectSamePlan(units, costFits(0, 10));
});

test('plans one fitting unit as a single window', async () => {
  const units = unitsWithLengths([4]);
  const planned = await planSummaryWindows(units, costFits(1, 5));
  expect(idsOf(planned)).toEqual([[1]]);
  expect(planned[0]).toMatchObject({ firstId: 1, lastId: 1 });
  await expectSamePlan(units, costFits(1, 5));
});

test('keeps all fitting units in one window', async () => {
  const units = unitsWithLengths([3, 4, 5]);
  expect(idsOf(await planSummaryWindows(units, costFits(2, 14)))).toEqual([[1, 2, 3]]);
  await expectSamePlan(units, costFits(2, 14));
});

test('closes windows greedily at the first failing candidate', async () => {
  const units = unitsWithLengths([4, 4, 4, 4]);
  expect(idsOf(await planSummaryWindows(units, costFits(0, 8)))).toEqual([[1, 2], [3, 4]]);
  await expectSamePlan(units, costFits(0, 8));
});

test('fails when a later unit cannot fit alone after a window closes', async () => {
  const units = unitsWithLengths([5, 100, 5]);
  expect(await planSummaryWindows(units, costFits(0, 10))).toEqual([]);
  await expectSamePlan(units, costFits(0, 10));
});

test('treats an exact boundary cost as fitting', async () => {
  const pair = unitsWithLengths([6, 6]);
  expect(idsOf(await planSummaryWindows(pair, costFits(3, 15)))).toEqual([[1, 2]]);
  await expectSamePlan(pair, costFits(3, 15));
  const triple = unitsWithLengths([6, 6, 6]);
  expect(idsOf(await planSummaryWindows(triple, costFits(3, 15)))).toEqual([[1, 2], [3]]);
  await expectSamePlan(triple, costFits(3, 15));
});

test('plans maximal windows under a synthetic monotone character-cost budget', async () => {
  const units = unitsWithLengths([7, 7, 7, 7, 7, 7, 7]);
  expect(idsOf(await planSummaryWindows(units, costFits(4, 40)))).toEqual([[1, 2, 3, 4, 5], [6, 7]]);
  await expectSamePlan(units, costFits(4, 40));
});

test('rejects more than 64 windows while accepting exactly 64', async () => {
  const sixtyFour = unitsWithLengths(Array.from({ length: 64 }, () => 1));
  const planned = await planSummaryWindows(sixtyFour, costFits(5, 6));
  expect(planned).toHaveLength(64);
  expect(idsOf(planned)).toEqual(sixtyFour.map(unit => [unit.id]));
  await expectSamePlan(sixtyFour, costFits(5, 6));

  const sixtyFive = unitsWithLengths(Array.from({ length: 65 }, () => 1));
  expect(await planSummaryWindows(sixtyFive, costFits(5, 6))).toEqual([]);
  await expectSamePlan(sixtyFive, costFits(5, 6));
});

test('pushes a final multi-unit window as the 64th window without a cap check', async () => {
  const units = unitsWithLengths([...Array.from({ length: 63 }, () => 10), 1, 1]);
  const planned = await planSummaryWindows(units, costFits(5, 15));
  expect(planned).toHaveLength(64);
  expect(idsOf(planned).slice(0, 63)).toEqual(Array.from({ length: 63 }, (_, index) => [index + 1]));
  expect(idsOf(planned)[63]).toEqual([64, 65]);
  await expectSamePlan(units, costFits(5, 15));
});

test('matches the linear reference on deterministic pseudo-random monotone budgets', async () => {
  let emptyPlans = 0;
  let multiWindowPlans = 0;
  for (let seed = 1; seed <= 40; seed += 1) {
    const random = mulberry32(seed);
    const count = 1 + Math.floor(random() * 80);
    const units = unitsWithLengths(Array.from({ length: count }, () => 1 + Math.floor(random() * 30)));
    const overhead = Math.floor(random() * 10);
    const budget = Math.floor(random() * 300);
    const fits = costFits(overhead, budget);
    const planned = await planSummaryWindows(units, fits);
    const reference = await linearPlan(units, fits);
    expect(idsOf(planned)).toEqual(idsOf(reference));
    expect(boundsOf(planned)).toEqual(boundsOf(reference));
    if (!planned.length) emptyPlans += 1;
    if (planned.length > 1) multiWindowPlans += 1;
  }
  expect(emptyPlans).toBeGreaterThan(0);
  expect(multiWindowPlans).toBeGreaterThan(0);
});

test('uses fewer fits calls than the linear reference on a 200-unit source with identical windows', async () => {
  const units = unitsWithLengths(Array.from({ length: 200 }, () => 1));
  const planner = countedFits(0, 90);
  const reference = countedFits(0, 90);
  const planned = await planSummaryWindows(units, planner.fits);
  const linear = await linearPlan(units, reference.fits);
  expect(idsOf(planned)).toEqual(idsOf(linear));
  expect(boundsOf(planned)).toEqual(boundsOf(linear));
  expect(planned.map(window => window.units.length)).toEqual([90, 90, 20]);
  // Binary search: window costs are 9 + 7 + 6 fits calls. The linear loop
  // re-measures every growing candidate: 92 + 91 + 19.
  expect(planner.calls()).toBe(22);
  expect(reference.calls()).toBe(202);
  expect(planner.calls()).toBeLessThan(reference.calls());
});
