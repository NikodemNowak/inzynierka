export interface PlannedSummaryWindow<T> {
  readonly units: readonly T[];
  readonly firstId: number;
  readonly lastId: number;
}

// Greedy window planning over an ordered unit list. Each window is the longest
// prefix of the remaining units whose draft request still fits. A window closes
// at the first failing prefix; a unit that cannot fit alone fails the whole
// plan, and more than 64 windows fail as well. The final window is pushed
// without the cap check because a close always leaves another unit behind.
export const planSummaryWindows = async <T extends { id: number }>(
  units: readonly T[],
  fits: (candidate: readonly T[]) => Promise<boolean>,
): Promise<readonly PlannedSummaryWindow<T>[]> => {
  const windows: PlannedSummaryWindow<T>[] = [];
  let start = 0;
  while (start < units.length) {
    // Every window begins with the same single-unit feasibility check the
    // linear loop performed right after a close (or on the very first unit).
    if (!(await fits(units.slice(start, start + 1)))) return [];
    // The search assumes monotone fits: a longer candidate never fits when a
    // shorter candidate fails. The equivalence test guards this assumption.
    let low = 1;
    let high = units.length - start + 1; // One past the remaining units: a virtual failing length.
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (await fits(units.slice(start, start + middle))) low = middle; else high = middle;
    }
    const end = start + low;
    windows.push({ units: units.slice(start, end), firstId: units[start].id, lastId: units[end - 1].id });
    if (end < units.length && windows.length >= 64) return [];
    start = end;
  }
  return windows;
};
