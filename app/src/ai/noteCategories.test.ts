import { generate } from './llm'
import { recordGeneration } from './generationMetrics'
import { classifyNoteCategories } from './noteCategories'

jest.mock('./llm', () => ({ generate: jest.fn() }))
jest.mock('./generationMetrics', () => ({ recordGeneration: jest.fn() }))

const mockedGenerate = jest.mocked(generate)
const mockedRecordGeneration = jest.mocked(recordGeneration)

describe('classifyNoteCategories', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('keeps an empty result when the model finds no category', async () => {
    const content =
      'A synthetic note about trying a local app and its new layout.'
    mockedGenerate.mockResolvedValue({
      text: 'brak',
      ttftMs: 100,
      tokensPerSecond: 20,
      wallMs: 300,
      promptMs: 80,
      predictedMs: 210,
      promptTokens: 45,
      predictedTokens: 4,
    })

    await expect(classifyNoteCategories(content)).resolves.toEqual([])
    expect(mockedRecordGeneration).toHaveBeenCalledWith(
      'tags',
      content.length,
      expect.objectContaining({ text: 'brak' }),
    )
  })

  it('normalizes category casing and drops output outside the fixed set', async () => {
    mockedGenerate.mockResolvedValue({
      text: 'nauka, Wynajem magazynu',
      ttftMs: 100,
      tokensPerSecond: 20,
      wallMs: 300,
      promptMs: 80,
      predictedMs: 210,
      promptTokens: 45,
      predictedTokens: 4,
    })

    await expect(
      classifyNoteCategories('Synthetic academic note'),
    ).resolves.toEqual(['Nauka'])
  })

  it('accepts a leading category when the model repeats its definition', async () => {
    mockedGenerate.mockResolvedValue({
      text: '<think>\n\n</think>\n\nNauka — studia, edukacja, badania.',
      ttftMs: 100,
      tokensPerSecond: 20,
      wallMs: 300,
      promptMs: 80,
      predictedMs: 210,
      promptTokens: 45,
      predictedTokens: 4,
    })
    await expect(
      classifyNoteCategories('Synthetic academic note'),
    ).resolves.toEqual(['Nauka'])
  })

  it('keeps only the primary category instead of appending speculative labels', async () => {
    mockedGenerate.mockResolvedValue({
      text: 'Nauka, Praca',
      ttftMs: 100,
      tokensPerSecond: 20,
      wallMs: 300,
      promptMs: 80,
      predictedMs: 210,
      promptTokens: 45,
      predictedTokens: 4,
    })
    await expect(
      classifyNoteCategories('Synthetic academic note'),
    ).resolves.toEqual(['Nauka'])
  })
})
