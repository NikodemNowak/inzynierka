// Spoken English numbers as digits ("two hundred and twelve dollars" -> "212
// dollars", "at five pm" -> "at 5 pm"), so the model and the reader see values.

const UNITS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Readonly<Record<string, number>> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const ORDINALS: Readonly<Record<string, number>> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
  nineteenth: 19, twentieth: 20, thirtieth: 30,
}
const SUFFIX = (day: number): string => (day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th')

const WORD = /[A-Za-z]+(?:-[A-Za-z]+)?/gu

export const englishWordsToDigits = (text: string): string => {
  const tokens = [...text.matchAll(WORD)]
  const out: string[] = []
  let last = 0
  let index = 0
  while (index < tokens.length) {
    let total = 0
    let current = 0
    let end = index
    let used = false
    let ordinal: number | null = null
    let cursor = index
    while (cursor < tokens.length) {
      const raw = tokens[cursor]![0].toLowerCase()
      const gap = cursor === index ? '' : text.slice(tokens[cursor - 1]!.index! + tokens[cursor - 1]![0].length, tokens[cursor]!.index)
      if (cursor > index && !/^[\s-]*$/u.test(gap)) break
      const parts = raw.split('-')
      const value = parts.length === 2 && TENS[parts[0]!] !== undefined && UNITS[parts[1]!] !== undefined && UNITS[parts[1]!]! < 10
        ? TENS[parts[0]!]! + UNITS[parts[1]!]!
        : parts.length === 2 && TENS[parts[0]!] !== undefined && ORDINALS[parts[1]!] !== undefined ? null : UNITS[raw] ?? TENS[raw]
      if (value !== undefined && value !== null) {
        // "twenty two" -> 22, but "two two" stays two numbers.
        if (current % 10 !== 0 && current > 0 && current < 100) break
        current += value
        used = true
        end = cursor
      } else if (raw === 'hundred' && used) {
        current = Math.max(current, 1) * 100
        end = cursor
      } else if (raw === 'thousand' && used) {
        total += Math.max(current, 1) * 1000
        current = 0
        end = cursor
      } else if (raw === 'and' && used && cursor + 1 < tokens.length && (UNITS[tokens[cursor + 1]![0].toLowerCase()] !== undefined || TENS[tokens[cursor + 1]![0].toLowerCase()] !== undefined)) {
        // "two hundred and twelve"
      } else {
        const ordinalValue = ORDINALS[raw] ?? (parts.length === 2 && TENS[parts[0]!] !== undefined ? (ORDINALS[parts[1]!] !== undefined ? TENS[parts[0]!]! + ORDINALS[parts[1]!]! : undefined) : undefined)
        // "the twenty second" -> "the 22nd"
        if (ordinalValue !== undefined && (used ? current % 10 === 0 && current >= 20 && ordinalValue < 10 : true)) {
          ordinal = (used ? current : 0) + ordinalValue
          end = cursor
        }
        break
      }
      cursor += 1
    }
    const value = total + current
    const start = tokens[index]!.index!
    const stop = tokens[end]!.index! + tokens[end]![0].length
    const before = text.slice(Math.max(0, start - 5), start).toLowerCase()
    if (ordinal !== null && ordinal >= 1 && ordinal <= 31 && /the\s+$/u.test(before) && ordinal > 0) {
      out.push(text.slice(last, start), `${ordinal}${SUFFIX(ordinal)}`)
      last = stop
      index = end + 1
      continue
    }
    // Single small words stay words ("one of them", "two cartons" reads fine), others become digits.
    if (used && ordinal === null && (value >= 10 || end > index || /^\s+(?:am|pm|a\.m\.|p\.m\.|o'clock|dollars?|euros?|zlot\w*|pounds?|percent|minutes?|hours?|pages?|people|guests|ml|kg)\b/iu.test(text.slice(stop)))) {
      out.push(text.slice(last, start), String(value))
      last = stop
      index = end + 1
      continue
    }
    index = Math.max(end, index) + 1
  }
  out.push(text.slice(last))
  return out.join('')
}
