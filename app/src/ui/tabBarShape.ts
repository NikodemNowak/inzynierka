// Tab bar outline for a 96-high viewBox: the top edge sits at y=22 and bulges
// around a circle centred at (width / 2, 38). Coordinates are the 390-wide
// design shifted by width / 2 - 195.
const num = (value: number): string => String(Number(value.toFixed(2)))

export function tabBarPath(width: number): { fill: string; stroke: string } {
  const dx = width / 2 - 195
  const stroke = [
    'M0 22',
    `H${num(157.05 + dx)}`,
    `A10 10 0 0 0 ${num(165.3 + dx)} 17.65`,
    `A36 36 0 0 1 ${num(224.7 + dx)} 17.65`,
    `A10 10 0 0 0 ${num(232.95 + dx)} 22`,
    `H${num(width)}`,
  ].join(' ')
  return { stroke, fill: `${stroke} V96 H0 Z` }
}
