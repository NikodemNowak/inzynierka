import { Platform } from 'react-native'

export interface ModelConfig {
  url: string
  filename: string
  // Shown to the user before they agree to the download, so they know what the
  // one network request this app makes will cost them.
  displayName: string
  approxSizeMb: number
  // How many transformer layers llama.cpp offloads to the GPU. Metal takes all
  // of them on iOS; the Android emulator exposes no OpenCL/Vulkan compute
  // backend, so everything has to stay on the CPU there.
  nGpuLayers: number
  nCtx: number
  revision?: string
  sizeBytes?: number
  sha256?: string
  architecture?: string
  nextnPredictLayers?: number
}

export type ModelExecutionProfile = 'foreground' | 'background-cpu'

// The reference device (iPhone 17 Pro, 12 GB RAM) runs Qwen3.5-4B: against
// Qwen3-4B on the same prompts it answered more chat questions right (0.65 vs
// 0.56) and found more tasks, at about the same size.
// The emulator runs Qwen3-1.7B: 4B on CPU-only inference is too slow to iterate
// on, and the emulator's memory budget is far below the reference device.
// Thinking is switched off through the chat template on both.
const IOS_MODEL: ModelConfig = {
  url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/e87f176479d0855a907a41277aca2f8ee7a09523/Qwen3.5-4B-Q4_K_M.gguf',
  filename: 'Qwen3.5-4B-Q4_K_M.gguf',
  displayName: 'Qwen3.5-4B (Q4_K_M)',
  approxSizeMb: 2740,
  nGpuLayers: 99,
  nCtx: 8192,
  revision: 'e87f176479d0855a907a41277aca2f8ee7a09523',
  sizeBytes: 2740937888,
  sha256: '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
}

const ANDROID_MODEL: ModelConfig = {
  url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_K_M.gguf',
  filename: 'Qwen3-1.7B-Q4_K_M.gguf',
  displayName: 'Qwen3-1.7B (Q4_K_M)',
  approxSizeMb: 1060,
  nGpuLayers: 0,
  nCtx: 4096,
  revision: 'd7f544eead698dbd1f15126ef60b45a1e1933222',
  sizeBytes: 1107409472,
  sha256: 'b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897',
}

export const MODEL_CONFIG: ModelConfig =
  Platform.OS === 'ios' ? IOS_MODEL : ANDROID_MODEL
