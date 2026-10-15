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

// The reference device (iPhone 17 Pro, 12 GB RAM) runs the target Qwen3-4B.
// The emulator runs 1.7B: 4B on CPU-only inference is too slow to iterate on,
// and the emulator's memory budget is far below the reference device.
// Both are hybrid Qwen3 checkpoints, so the `/no_think` prefix the prompts rely
// on keeps the same meaning on either platform.
const IOS_MODEL: ModelConfig = {
  url: 'https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/22c9fc8a8c7700b76a1789366280a6a5a1ad1120/Qwen3-4B-Q4_K_M.gguf',
  filename: 'Qwen3-4B-Q4_K_M.gguf',
  displayName: 'Qwen3-4B (Q4_K_M)',
  approxSizeMb: 2500,
  nGpuLayers: 99,
  nCtx: 8192,
  revision: '22c9fc8a8c7700b76a1789366280a6a5a1ad1120',
  sizeBytes: 2497281312,
  sha256: 'f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a',
}

const ANDROID_MODEL: ModelConfig = {
  url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_K_M.gguf',
  filename: 'Qwen3-1.7B-Q4_K_M.gguf',
  displayName: 'Qwen3-1.7B (Q4_K_M)',
  approxSizeMb: 1060,
  nGpuLayers: 0,
  nCtx: 2048,
  revision: 'd7f544eead698dbd1f15126ef60b45a1e1933222',
  sizeBytes: 1107409472,
  sha256: 'b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897',
}

export const MODEL_CONFIG: ModelConfig =
  Platform.OS === 'ios' ? IOS_MODEL : ANDROID_MODEL
