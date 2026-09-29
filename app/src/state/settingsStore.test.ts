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

test.each([null, 'sepia', ''])('falls back to system for stored value %s', async (stored) => {
  mockGetSetting.mockImplementation(async (key) =>
    key === 'appearance.preference' ? stored : null,
  )

  await useSettingsStore.getState().load()

  expect(useSettingsStore.getState().appearancePreference).toBe('system')
  expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('unspecified')
})

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
    () => new Promise<void>((resolve) => { finishSave = resolve }),
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
