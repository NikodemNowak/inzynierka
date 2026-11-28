import { darkColors, lightColors, type } from './theme'

describe('theme tokens', () => {
  it('keeps light and dark palettes on the same keys', () => {
    expect(Object.keys(lightColors).sort()).toEqual(Object.keys(darkColors).sort())
  })

  it('uses the iOS-like palette', () => {
    expect(lightColors.accent).toBe('#0064D2')
    expect(darkColors.accent).toBe('#4C9BFF')
    expect(lightColors.canvas).toBe('#F2F2F7')
    expect(darkColors.canvas).toBe('#000000')
  })

  it('uses the system font for every text style', () => {
    for (const style of Object.values(type)) expect(style).not.toHaveProperty('fontFamily')
  })
})
