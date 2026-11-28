import { tabBarPath } from './tabBarShape'

const arcContactXs = (stroke: string): number[] => {
  const arcs = [...stroke.matchAll(/A36 36 0 0 1 ([\d.]+) ([\d.]+)/g)]
  const start = stroke.match(/A10 10 0 0 0 ([\d.]+) ([\d.]+)/)
  return [Number(start?.[1]), Number(arcs[0]?.[1])]
}

test('path for width 390 matches the design', () => {
  expect(tabBarPath(390).stroke).toBe(
    'M0 22 H157.05 A10 10 0 0 0 165.3 17.65 A36 36 0 0 1 224.7 17.65 A10 10 0 0 0 232.95 22 H390',
  )
})

test.each([320, 430])('bulge is centred for width %i', (width) => {
  const [left, right] = arcContactXs(tabBarPath(width).stroke)
  expect((left + right) / 2).toBeCloseTo(width / 2, 2)
})

test('fill closes the shape below the bar', () => {
  const { fill, stroke } = tabBarPath(390)
  expect(fill).toBe(`${stroke} V96 H0 Z`)
  expect(fill.endsWith('Z')).toBe(true)
})
