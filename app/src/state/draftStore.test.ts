import * as repository from '../data/settingsRepository'
import { useDraftStore } from './draftStore'

jest.mock('../data/settingsRepository', () => ({
  getSetting: jest.fn(),
  setSetting: jest.fn(),
}))
const settings = jest.mocked(repository)

beforeEach(() => {
  jest.clearAllMocks()
  useDraftStore.setState({ draft: null })
})

test('stores and restores the recorded language independently of interface settings', async () => {
  await useDraftStore.getState().save('Call Alice tomorrow.', 123, 'en')
  expect(settings.setSetting).toHaveBeenCalledWith(
    'recording.draft',
    JSON.stringify({
      transcript: 'Call Alice tomorrow.',
      startedAt: 123,
      language: 'en',
    }),
  )
  settings.getSetting.mockResolvedValue(
    JSON.stringify({
      transcript: 'Call Alice tomorrow.',
      startedAt: 123,
      language: 'en',
    }),
  )
  await useDraftStore.getState().load()
  expect(useDraftStore.getState().draft?.language).toBe('en')
})

test.each([undefined, 'de', null])(
  'restores legacy or invalid draft language %s as Polish',
  async (language) => {
    settings.getSetting.mockResolvedValue(
      JSON.stringify({
        transcript: 'Zadzwoń jutro.',
        startedAt: 123,
        language,
      }),
    )
    await useDraftStore.getState().load()
    expect(useDraftStore.getState().draft?.language).toBe('pl')
  },
)
