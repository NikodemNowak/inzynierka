import { isModelLoadedFor, loadModel } from "./llm";
import { getModelPath, isModelDownloaded } from "./modelDownload";
import { throwIfProcessingAborted, type ProcessingExecutionContext } from "./processingContext";
import { translate } from "../i18n/translate";
import type { ProcessingProgress } from "./noteProcessing";

export const MODEL_MISSING_MESSAGE =
  "Pobierz model w Ustawieniach, aby tworzyć tytuły, podsumowania i zadania.";
export const getModelMissingMessage = (): string => translate(
  MODEL_MISSING_MESSAGE,
  "Download the model in Settings to create titles, summaries and tasks.",
);

export const ensureModelReady = async (
  onProgress: (progress: ProcessingProgress) => void,
  onModelLoad?: (durationMs: number) => void,
  execution?: ProcessingExecutionContext,
): Promise<number | null> => {
  throwIfProcessingAborted(execution);
  if (!execution?.runtimeOptions?.modelPath && !(await isModelDownloaded()))
    throw new Error(getModelMissingMessage());
  throwIfProcessingAborted(execution);
  const modelPath = execution?.runtimeOptions?.modelPath ?? getModelPath();
  if (!isModelLoadedFor(modelPath, execution?.runtimeOptions)) {
    const startedAt = Date.now();
    onProgress({ phase: "loading", percent: 0 });
    try {
      await loadModel(modelPath, (percent) => onProgress({ phase: "loading", percent }),
        { ...execution?.runtimeOptions, signal: execution?.signal });
    } finally {
      onModelLoad?.(Date.now() - startedAt);
    }
    throwIfProcessingAborted(execution);
    return Date.now() - startedAt;
  }
  return null;
};
