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
}

// The reference device (iPhone 17 Pro, 12 GB RAM) runs the target Qwen3-4B.
// The emulator runs 1.7B: 4B on CPU-only inference is too slow to iterate on,
// and the emulator's memory budget is far below the reference device.
// Both are hybrid Qwen3 checkpoints, so the `/no_think` prefix the prompts rely
// on keeps the same meaning on either platform.
const IOS_MODEL: ModelConfig = {
  url: 'https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf',
  filename: 'Qwen3-4B-Q4_K_M.gguf',
  displayName: 'Qwen3-4B (Q4_K_M)',
  approxSizeMb: 2500,
  nGpuLayers: 99,
  nCtx: 4096,
}

const ANDROID_MODEL: ModelConfig = {
  url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf',
  filename: 'Qwen3-1.7B-Q4_K_M.gguf',
  displayName: 'Qwen3-1.7B (Q4_K_M)',
  approxSizeMb: 1060,
  nGpuLayers: 0,
  nCtx: 2048,
}

export const MODEL_CONFIG: ModelConfig = Platform.OS === 'ios' ? IOS_MODEL : ANDROID_MODEL
