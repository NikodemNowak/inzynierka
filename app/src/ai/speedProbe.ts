import * as FileSystem from "expo-file-system/legacy";
import { enqueueLlm } from "./llmQueue";
import {
  generate,
  getLoadedModelInfo,
  loadModel,
  unloadModel,
  type RuntimeTuning,
} from "./llm";
import { BENCHMARK_QWEN3 } from "./benchmarkProfiles";
import { benchmarkModelPath } from "./benchmarkModels";
import { QUICK_SUITE_TEXTS } from "./benchmarkQuickTexts";

export interface SpeedProbeVariant {
  id: string;
  tuning?: RuntimeTuning;
}

// Each variant reloads the model with one runtime setting changed, then runs
// the same greedy long-context and short-context generations.
export const SPEED_PROBE_VARIANTS: readonly SpeedProbeVariant[] = [
  { id: "base" },
  { id: "flash-on", tuning: { flashAttn: "on" } },
  { id: "kv-q8", tuning: { flashAttn: "on", cacheType: "q8_0" } },
  { id: "ubatch-1024", tuning: { nUbatch: 1024 } },
  {
    id: "kv-q8+ubatch-1024",
    tuning: { flashAttn: "on", cacheType: "q8_0", nUbatch: 1024 },
  },
];

export interface SpeedProbeResult {
  id: string;
  tuning: RuntimeTuning | null;
  loadMs: number;
  longPromptTokens: number;
  prefillTokensPerSecond: number;
  longDecodeTokens: number;
  longDecodeTokensPerSecond: number;
  shortDecodeTokensPerSecond: number;
  sameTextAsBase: boolean | null;
  nativeInitLog: string[];
  error: string | null;
}

export interface SpeedProbeReport {
  version: 1;
  createdAt: number;
  results: SpeedProbeResult[];
}

const SYSTEM = "Jesteś zwięzłym asystentem. Odpowiadaj po polsku.";
const longPrompt = (): string =>
  `/no_think\nSOURCE_START\n${QUICK_SUITE_TEXTS[QUICK_SUITE_TEXTS.length - 1].source}\nSOURCE_END\nWypisz w punktach wszystkie zadania do wykonania.`;
const SHORT_PROMPT =
  "/no_think\nNapisz pięć krótkich zdań o jesiennej pogodzie.";
const perSecond = (tokens: number, ms: number): number =>
  ms > 0 ? Math.round((tokens / ms) * 10_000) / 10 : 0;

const probeDir = (): string => `${FileSystem.documentDirectory}speed-probe/`;

export const runSpeedProbe = (
  options: {
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
  } = {},
): Promise<SpeedProbeReport> =>
  enqueueLlm(async () => {
    const results: SpeedProbeResult[] = [];
    let baseText: string | null = null;
    const modelPath = benchmarkModelPath(BENCHMARK_QWEN3);
    await unloadModel();
    try {
      for (const [index, variant] of SPEED_PROBE_VARIANTS.entries()) {
        if (options.signal?.aborted) throw new Error("Speed probe cancelled");
        options.onProgress?.(
          `${index + 1}/${SPEED_PROBE_VARIANTS.length} · ${variant.id}`,
        );
        const loadStarted = Date.now();
        try {
          await loadModel(modelPath, undefined, {
            model: BENCHMARK_QWEN3,
            execution: "foreground",
            tuning: variant.tuning,
            signal: options.signal,
          });
          const loadMs = Date.now() - loadStarted;
          const long = await generate(longPrompt(), () => undefined, {
            system: SYSTEM,
            nPredict: 160,
            temperature: 0,
            signal: options.signal,
          });
          const short = await generate(SHORT_PROMPT, () => undefined, {
            system: SYSTEM,
            nPredict: 64,
            temperature: 0,
            signal: options.signal,
          });
          if (variant.id === "base") baseText = long.text;
          results.push({
            id: variant.id,
            tuning: variant.tuning ?? null,
            loadMs,
            longPromptTokens: long.promptTokens,
            prefillTokensPerSecond: perSecond(long.promptTokens, long.promptMs),
            longDecodeTokens: long.predictedTokens,
            longDecodeTokensPerSecond: perSecond(
              long.predictedTokens,
              long.predictedMs,
            ),
            shortDecodeTokensPerSecond: perSecond(
              short.predictedTokens,
              short.predictedMs,
            ),
            sameTextAsBase:
              baseText === null || variant.id === "base"
                ? null
                : long.text === baseText,
            nativeInitLog: getLoadedModelInfo()?.nativeInitLog ?? [],
            error: null,
          });
        } catch (failure) {
          if (options.signal?.aborted) throw failure;
          // One unsupported setting must not discard the other variants.
          results.push({
            id: variant.id,
            tuning: variant.tuning ?? null,
            loadMs: 0,
            longPromptTokens: 0,
            prefillTokensPerSecond: 0,
            longDecodeTokens: 0,
            longDecodeTokensPerSecond: 0,
            shortDecodeTokensPerSecond: 0,
            sameTextAsBase: null,
            nativeInitLog: getLoadedModelInfo()?.nativeInitLog ?? [],
            error: failure instanceof Error ? failure.message : String(failure),
          });
        }
      }
    } finally {
      await unloadModel();
    }
    const report: SpeedProbeReport = {
      version: 1,
      createdAt: Date.now(),
      results,
    };
    await FileSystem.makeDirectoryAsync(probeDir(), { intermediates: true });
    await FileSystem.writeAsStringAsync(
      `${probeDir()}probe-${report.createdAt}.json`,
      JSON.stringify(report, null, 2),
    );
    return report;
  });
