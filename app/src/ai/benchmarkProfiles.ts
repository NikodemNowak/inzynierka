import { Platform } from 'react-native'
import type { ModelConfig } from './modelConfig'

export type BenchmarkArm = 'qwen3' | 'qwen35-off' | 'qwen35-mtp'
export interface BenchmarkProfile {
  id: BenchmarkArm
  model: ModelConfig
  speculative: boolean
}
const gpuLayers = Platform.OS === 'ios' ? 99 : 0

// Immutable HF revisions, LFS SHA-256 and byte sizes verified from HF API.
// Candidate header at this revision: architecture=qwen35, NextN=1.
export const BENCHMARK_QWEN3: ModelConfig = {
  url: 'https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/22c9fc8a8c7700b76a1789366280a6a5a1ad1120/Qwen3-4B-Q4_K_M.gguf',
  filename: 'benchmark-22c9fc8a8c77-Qwen3-4B-Q4_K_M.gguf',
  displayName: 'Qwen3-4B (Q4_K_M)',
  approxSizeMb: 2497,
  nGpuLayers: gpuLayers,
  nCtx: Platform.OS === 'ios' ? 8192 : 4096,
  revision: '22c9fc8a8c7700b76a1789366280a6a5a1ad1120',
  sha256: 'f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a',
  sizeBytes: 2497281312,
  architecture: 'qwen3',
  nextnPredictLayers: 0,
}
export const BENCHMARK_QWEN35: ModelConfig = {
  url: 'https://huggingface.co/unsloth/Qwen3.5-4B-MTP-GGUF/resolve/86835bf9949e4d14d6860f7910b1340ad4f271a9/Qwen3.5-4B-Q4_K_M.gguf',
  filename: 'benchmark-86835bf9949e-Qwen3.5-4B-Q4_K_M.gguf',
  displayName: 'Qwen3.5-4B MTP (Q4_K_M)',
  approxSizeMb: 2835,
  nGpuLayers: gpuLayers,
  nCtx: 4096,
  revision: '86835bf9949e4d14d6860f7910b1340ad4f271a9',
  sha256: '3874209241c9a397e2f62cd3f70f80fd2dfbf0dfccb6838416bdb48a714e8630',
  sizeBytes: 2834975040,
  architecture: 'qwen35',
  nextnPredictLayers: 1,
}
export const BENCHMARK_PROFILES: readonly BenchmarkProfile[] = [
  { id: 'qwen3', model: BENCHMARK_QWEN3, speculative: false },
  { id: 'qwen35-off', model: BENCHMARK_QWEN35, speculative: false },
  { id: 'qwen35-mtp', model: BENCHMARK_QWEN35, speculative: true },
]

export const validateBenchmarkMetadata = (
  model: ModelConfig,
  metadata: Record<string, unknown>,
): void => {
  const arch = String(metadata['general.architecture'] ?? '').replace(
    /^"|"$/g,
    '',
  )
  const nextn = Number(metadata[`${arch}.nextn_predict_layers`] ?? 0)
  if (arch !== model.architecture || nextn !== model.nextnPredictLayers) {
    throw new Error(
      'GGUF architecture/NextN metadata does not match the pinned benchmark model',
    )
  }
}
