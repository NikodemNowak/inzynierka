import { AppState } from 'react-native'
import { enqueueLlm } from './llmQueue'
import { isModelLoaded, unloadModel } from './llm'
import { startModelMemoryGuard } from './modelMemory'
import {
  hasBackgroundProcessingLease,
  pauseAllProcessing,
} from '../processing/jobRunner'

jest.mock('../processing/jobRunner', () => ({
  hasBackgroundProcessingLease: jest.fn(() => false),
  pauseAllProcessing: jest.fn(async () => undefined),
}))

type MockListeners = {
  change: ((state: string) => void) | null
  memoryWarning: (() => void) | null
  removeCount: number
}

const mockListeners: MockListeners = {
  change: null,
  memoryWarning: null,
  removeCount: 0,
}

jest.mock('react-native', () => ({
  Platform: {
    OS: 'ios',
    select: (specifics: Record<string, unknown>) =>
      specifics.ios ?? specifics.native ?? specifics.default,
  },
  TurboModuleRegistry: {
    get: () => null,
    getEnforcing: () => null,
  },
  AppState: {
    addEventListener: jest.fn((event: string, listener: unknown) => {
      if (event === 'change') {
        mockListeners.change = listener as MockListeners['change']
      }
      if (event === 'memoryWarning') {
        mockListeners.memoryWarning = listener as MockListeners['memoryWarning']
      }
      return {
        remove: () => {
          mockListeners.removeCount += 1
        },
      }
    }),
  },
}))

jest.mock('./llm', () => ({
  isModelLoaded: jest.fn(() => true),
  unloadModel: jest.fn(async () => undefined),
}))

jest.mock('./llmQueue', () => ({
  enqueueLlm: jest.fn((job: () => Promise<void>) => job()),
}))

const mockedIsModelLoaded = jest.mocked(isModelLoaded)
const mockedEnqueueLlm = jest.mocked(enqueueLlm)
const mockedUnloadModel = jest.mocked(unloadModel)

describe('model memory guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockListeners.change = null
    mockListeners.memoryWarning = null
    mockListeners.removeCount = 0
    mockedIsModelLoaded.mockReturnValue(true)
    jest.mocked(hasBackgroundProcessingLease).mockReturnValue(false)
  })

  it('keeps the model loaded while iOS is inactive and unloads in background', async () => {
    startModelMemoryGuard()

    mockListeners.change?.('inactive')
    expect(mockedEnqueueLlm).not.toHaveBeenCalled()

    mockListeners.change?.('background')
    await Promise.resolve()
    expect(mockedEnqueueLlm).toHaveBeenCalledWith(mockedUnloadModel)
  })

  it('queues unloading on memory warning and removes both listeners', async () => {
    const stop = startModelMemoryGuard()

    mockListeners.memoryWarning?.()
    await Promise.resolve()
    expect(mockedEnqueueLlm).toHaveBeenCalledWith(mockedUnloadModel)

    stop()
    expect(mockListeners.removeCount).toBe(2)
    expect(AppState.addEventListener).toHaveBeenCalledTimes(2)
  })

  it('does not enqueue unloading when the context is already absent', () => {
    mockedIsModelLoaded.mockReturnValue(false)
    startModelMemoryGuard()

    mockListeners.change?.('background')
    mockListeners.memoryWarning?.()

    expect(mockedEnqueueLlm).not.toHaveBeenCalled()
  })

  it('keeps a granted CPU task alive in background, but still stops on memory pressure', async () => {
    jest.mocked(hasBackgroundProcessingLease).mockReturnValue(true)
    startModelMemoryGuard()
    mockListeners.change?.('background')
    await Promise.resolve()
    expect(pauseAllProcessing).not.toHaveBeenCalled()
    expect(mockedUnloadModel).not.toHaveBeenCalled()
    mockListeners.memoryWarning?.()
    await Promise.resolve()
    expect(pauseAllProcessing).toHaveBeenCalledWith('memory')
    expect(mockedEnqueueLlm).toHaveBeenCalledWith(mockedUnloadModel)
  })
})
