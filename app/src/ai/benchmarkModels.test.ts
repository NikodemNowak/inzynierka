import * as FileSystem from 'expo-file-system/legacy'
import { loadLlamaModelInfo } from 'llama.rn'
import { downloadBenchmarkModel, verifyBenchmarkModel } from './benchmarkModels'
import type { ModelConfig } from './modelConfig'
import { verifyFileNatively } from './nativeFileVerification'
const { createHash } = require('node:crypto') as {
  createHash(algorithm: string): {
    update(bytes: Uint8Array): { digest(encoding: 'hex'): string }
  }
}

let mockBytes = new Uint8Array([97, 98, 99])
let mockPosition = 0
const mockClose = jest.fn()
const mockOpen = jest.fn()
let mockReadLengths: number[] = []
jest.mock('expo-file-system', () => ({
  FileMode: { ReadOnly: 'r' },
  File: class {
    size = mockBytes.length
    open() {
      mockOpen()
      mockPosition = 0
      return {
        readBytes: (length: number) => {
          mockReadLengths.push(length)
          const result = mockBytes.subarray(mockPosition, mockPosition + length)
          mockPosition += length
          return result
        },
        close: mockClose,
      }
    }
  },
}))
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  deleteAsync: jest.fn(async () => undefined),
  moveAsync: jest.fn(async () => undefined),
  createDownloadResumable: jest.fn(() => ({
    downloadAsync: async () => ({ status: 200 }),
    cancelAsync: async () => undefined,
  })),
}))
jest.mock('llama.rn', () => ({
  loadLlamaModelInfo: jest.fn(async () => ({
    'general.architecture': 'qwen35',
    'qwen35.nextn_predict_layers': '1',
  })),
}))
jest.mock('./llm', () => ({
  GenerationCancelledError: class extends Error {
    constructor() {
      super('Cancelled')
    }
  },
}))
jest.mock('./nativeFileVerification', () => ({
  verifyFileNatively: jest.fn(async () => null),
}))
jest.mock('../i18n/translate', () => ({
  translate: (_pl: string, en: string) => en,
}))
const model: ModelConfig = {
  filename: 'benchmark-test.gguf',
  displayName: 'Test',
  url: 'https://example.test/pinned/model.gguf',
  approxSizeMb: 0,
  nCtx: 4096,
  nGpuLayers: 0,
  sizeBytes: 3,
  sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  architecture: 'qwen35',
  nextnPredictLayers: 1,
}
beforeEach(() => {
  jest.clearAllMocks()
  mockBytes = new Uint8Array([97, 98, 99])
  mockReadLengths = []
  jest.mocked(verifyFileNatively).mockResolvedValue(null)
})

test('uses native integrity verification without opening the JavaScript file reader', async () => {
  jest.mocked(verifyFileNatively).mockResolvedValue({
    sha256: model.sha256!, sizeBytes: model.sizeBytes!, durationMs: 12,
  })
  await expect(verifyBenchmarkModel(model)).resolves.toMatchObject({
    backend: 'native', durationMs: 12, nextnPredictLayers: 1,
  })
  expect(mockOpen).not.toHaveBeenCalled()
  expect(loadLlamaModelInfo).toHaveBeenCalledWith('file:///docs/benchmark-test.gguf')
})

test.each([
  { sha256: '0'.repeat(64), sizeBytes: 3 },
  { sha256: model.sha256!, sizeBytes: 4 },
])('rejects incorrect native integrity results without JavaScript fallback: %p', async (result) => {
  jest.mocked(verifyFileNatively).mockResolvedValue({ ...result, durationMs: 2 })
  await expect(verifyBenchmarkModel(model)).rejects.toThrow()
  expect(mockOpen).not.toHaveBeenCalled()
  expect(loadLlamaModelInfo).not.toHaveBeenCalled()
})

test('propagates native corruption errors without JavaScript fallback', async () => {
  jest.mocked(verifyFileNatively).mockRejectedValue(new Error('Native SHA-256 mismatch'))
  await expect(verifyBenchmarkModel(model)).rejects.toThrow('Native SHA-256 mismatch')
  expect(mockOpen).not.toHaveBeenCalled()
})

test('does not parse model metadata after native verification was aborted', async () => {
  const controller = new AbortController()
  jest.mocked(verifyFileNatively).mockImplementation(async () => {
    controller.abort()
    return { sha256: model.sha256!, sizeBytes: 3, durationMs: 2 }
  })
  await expect(verifyBenchmarkModel(model, controller.signal)).rejects.toThrow(/Cancel/)
  expect(mockOpen).not.toHaveBeenCalled()
  expect(loadLlamaModelInfo).not.toHaveBeenCalled()
})

test('still rejects native-verified bytes without the pinned GGUF NextN metadata', async () => {
  jest.mocked(verifyFileNatively).mockResolvedValue({
    sha256: model.sha256!, sizeBytes: 3, durationMs: 2,
  })
  jest.mocked(loadLlamaModelInfo).mockResolvedValueOnce({
    'general.architecture': 'qwen35', 'qwen35.nextn_predict_layers': '0',
  })
  await expect(verifyBenchmarkModel(model)).rejects.toThrow(/NextN|MTP/)
  expect(mockOpen).not.toHaveBeenCalled()
})

test('keeps JavaScript fallback reads bounded and progress updates at most four per second plus final', async () => {
  mockBytes = new Uint8Array(2 * 1024 * 1024 + 3).fill(97)
  const fallbackModel = {
    ...model, sizeBytes: mockBytes.length,
    sha256: createHash('sha256').update(mockBytes).digest('hex'),
  }
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1000)
  const progress = jest.fn()
  try {
    await expect(verifyBenchmarkModel(fallbackModel, undefined, progress)).resolves.toMatchObject({
      backend: 'javascript', durationMs: 0, sizeBytes: mockBytes.length,
    })
    expect(mockReadLengths).toEqual([1024 * 1024, 1024 * 1024, 3])
    expect(progress).toHaveBeenCalledTimes(2)
    expect(progress).toHaveBeenLastCalledWith(100)
    expect(mockClose).toHaveBeenCalledTimes(1)
  } finally {
    clock.mockRestore()
  }
})

test('verifies bytes, digest and real GGUF NextN with bounded reads', async () => {
  await expect(
    verifyBenchmarkModel(model, undefined, undefined, '/model.gguf'),
  ).resolves.toMatchObject({
    sha256: model.sha256,
    sizeBytes: 3,
    nextnPredictLayers: 1,
  })
  expect(mockClose).toHaveBeenCalledTimes(1)
  expect(loadLlamaModelInfo).toHaveBeenCalledWith('/model.gguf')
  expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled()
})
test('rejects a checksum mismatch before accepting GGUF metadata', async () => {
  mockBytes = new Uint8Array([0, 1, 2])
  await expect(verifyBenchmarkModel(model)).rejects.toThrow(/SHA-256/)
  expect(loadLlamaModelInfo).not.toHaveBeenCalled()
  expect(mockClose).toHaveBeenCalledTimes(1)
})
test('promotes an explicitly downloaded file only after checksum and NextN verification', async () => {
  await downloadBenchmarkModel(model, () => undefined)
  expect(FileSystem.createDownloadResumable).toHaveBeenCalledWith(
    model.url,
    'file:///docs/benchmark-test.gguf.part',
    {},
    expect.any(Function),
  )
  expect(FileSystem.moveAsync).toHaveBeenCalledWith({
    from: 'file:///docs/benchmark-test.gguf.part',
    to: 'file:///docs/benchmark-test.gguf',
  })
})
test('never promotes a downloaded wrong checkpoint', async () => {
  mockBytes = new Uint8Array([0, 1, 2])
  await expect(downloadBenchmarkModel(model, () => undefined)).rejects.toThrow(
    /SHA-256/,
  )
  expect(FileSystem.moveAsync).not.toHaveBeenCalled()
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
    'file:///docs/benchmark-test.gguf.part',
    { idempotent: true },
  )
})
test('pre-aborted validation has no file or metadata side effects', async () => {
  const signal = new AbortController()
  signal.abort()
  await expect(verifyBenchmarkModel(model, signal.signal)).rejects.toThrow(
    /Cancel/,
  )
  expect(mockClose).not.toHaveBeenCalled()
  expect(loadLlamaModelInfo).not.toHaveBeenCalled()
})
