import { Appearance } from 'react-native'
import * as repository from '../data/settingsRepository'
import { useSettingsStore } from './settingsStore'

jest.mock('../data/settingsRepository', () => ({
  getSetting: jest.fn(),
  setSetting: jest.fn(),
}))

const mockGetSetting = jest.mocked(repository.getSetting)
const mockSetSetting = jest.mocked(repository.setSetting)
const mockSetNativeScheme = jest
  .spyOn(Appearance, 'setColorScheme')
  .mockImplementation(() => undefined)

beforeEach(() => {
  jest.clearAllMocks()
  mockSetNativeScheme.mockClear()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  mockGetSetting.mockResolvedValue(null)
  mockSetSetting.mockResolvedValue(undefined)
})

test('uses the system appearance before preferences load', () => {
  expect(useSettingsStore.getState().appearancePreference).toBe('system')
})

test('persists background processing choice only after a successful write', async () => {
  expect(useSettingsStore.getState().backgroundProcessing).toBe(false)
  mockSetSetting.mockRejectedValueOnce(new Error('disk full'))
  await expect(
    useSettingsStore.getState().setBackgroundProcessing(true),
  ).rejects.toThrow('disk full')
  expect(useSettingsStore.getState().backgroundProcessing).toBe(false)
  await useSettingsStore.getState().setBackgroundProcessing(true)
  expect(useSettingsStore.getState().backgroundProcessing).toBe(true)
  mockGetSetting.mockImplementation(async (key) =>
    key === 'processing.background' ? '1' : null,
  )
  await useSettingsStore.getState().load()
  expect(useSettingsStore.getState().backgroundProcessing).toBe(true)
})

test('keeps interface and note language as independent preferences', async () => {
  mockGetSetting.mockImplementation(async (key) =>
    key === 'language.interface' ? 'en' : key === 'language.note' ? 'pl' : null,
  )
  await useSettingsStore.getState().load()
  expect(useSettingsStore.getState().languagePreference).toBe('en')
  expect(useSettingsStore.getState().noteLanguage).toBe('pl')
  await useSettingsStore.getState().setLanguagePreference('pl')
  expect(useSettingsStore.getState().noteLanguage).toBe('pl')
  expect(mockSetSetting).toHaveBeenCalledWith('language.interface', 'pl')
})

test('restores language when writing its preference fails', async () => {
  mockSetSetting.mockRejectedValueOnce(new Error('SQLite write failed'))
  await expect(
    useSettingsStore.getState().setNoteLanguage('en'),
  ).rejects.toThrow('SQLite write failed')
  expect(useSettingsStore.getState().noteLanguage).toBe('pl')
})

test('rolls back overlapping failed language writes to the last persisted choice', async () => {
  mockSetSetting.mockRejectedValue(new Error('SQLite write failed'))
  await Promise.allSettled([
    useSettingsStore.getState().setNoteLanguage('en'),
    useSettingsStore.getState().setNoteLanguage('pl'),
  ])
  expect(useSettingsStore.getState().noteLanguage).toBe('pl')
  await Promise.allSettled([
    useSettingsStore.getState().setLanguagePreference('en'),
    useSettingsStore.getState().setLanguagePreference('pl'),
  ])
  expect(useSettingsStore.getState().languagePreference).toBe('system')
})

test.each([null, 'sepia', ''])(
  'falls back to system for stored value %s',
  async (stored) => {
    mockGetSetting.mockImplementation(async (key) =>
      key === 'appearance.preference' ? stored : null,
    )

    await useSettingsStore.getState().load()

    expect(useSettingsStore.getState().appearancePreference).toBe('system')
    expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('unspecified')
  },
)

test('restores the saved appearance after loading settings', async () => {
  mockGetSetting.mockImplementation(async (key) =>
    key === 'appearance.preference' ? 'dark' : null,
  )

  await useSettingsStore.getState().load()

  expect(useSettingsStore.getState().appearancePreference).toBe('dark')
  expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('dark')
})

test('applies a selection immediately and persists it in SQLite settings', async () => {
  let finishSave: (() => void) | undefined
  mockSetSetting.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishSave = resolve
      }),
  )

  const save = useSettingsStore.getState().setAppearancePreference('light')

  expect(useSettingsStore.getState().appearancePreference).toBe('light')
  expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('light')
  expect(mockSetSetting).toHaveBeenCalledWith('appearance.preference', 'light')

  finishSave?.()
  await save
})

test('restores the previous selection when persisting appearance fails', async () => {
  mockSetSetting.mockRejectedValueOnce(new Error('SQLite write failed'))

  await expect(
    useSettingsStore.getState().setAppearancePreference('dark'),
  ).rejects.toThrow('SQLite write failed')

  expect(useSettingsStore.getState().appearancePreference).toBe('system')
  expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('unspecified')
})
