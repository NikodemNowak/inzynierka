import type { LoadModelOptions, LoadedModelInfo } from "./llm";
import type { SourceEvidence } from "./sourcePipeline";
import { validateSourceUnitPlan, type SourceUnitPlan } from "./sourceUnits";

export const PIPELINE_VERSION = "point-summary-v52";

export interface ProcessingCheckpointStore {
  read(key: string): Promise<unknown | null>;
  write(key: string, value: unknown): Promise<void>;
}

export interface SourceReviewSpan {
  readonly start: number;
  readonly end: number;
  readonly quote: string;
  readonly reason: string;
}

export interface FinalTaskEvidence {
  readonly tasks: readonly string[];
  readonly evidence: readonly SourceEvidence[];
  readonly superseded: readonly {
    readonly earlier: SourceEvidence;
    readonly later: SourceEvidence;
  }[];
  readonly warnings: readonly string[];
  readonly reviewSpans?: readonly SourceReviewSpan[];
}

export interface TaskEvidenceMemo {
  sourceStructure?: {
    readonly key: string;
    readonly context: LoadedModelInfo | null;
    readonly signal: AbortSignal | undefined;
    readonly checkpoint: ProcessingCheckpointStore | undefined;
    readonly result: SourceUnitPlan | null;
  };
  completed?: {
    readonly key: string;
    readonly context: LoadedModelInfo | null;
    readonly signal: AbortSignal | undefined;
    readonly checkpoint: ProcessingCheckpointStore | undefined;
    readonly result: FinalTaskEvidence;
  };
}

export interface ProcessingExecutionContext {
  sourceUnitPlan?: SourceUnitPlan;
  signal?: AbortSignal;
  checkpoint?: ProcessingCheckpointStore;
  runtimeOptions?: LoadModelOptions;
  taskEvidenceMemo?: TaskEvidenceMemo;
  onWarning?: (message: string) => void;
  // App flows keep plainly action-shaped statements the model left unresolved.
  recoverUnresolvedTasks?: boolean;
  onSourceReview?: (span: SourceReviewSpan) => void;
  onProgress?: (progress: {
    phase: "fragment" | "reduction" | "tasks";
    completed: number;
    total: number;
  }) => void;
}

// Keep runtime ownership live without writing into the caller's context. Expo
// may materialize object-literal getters during spread, so install descriptors
// after creating this private view, as in the established task collector.
export const sourceExecutionView = (
  content: string, outer?: ProcessingExecutionContext,
): ProcessingExecutionContext => {
  const suppliedPlan = outer?.sourceUnitPlan;
  const suppliedIdentity = JSON.stringify(suppliedPlan ?? null);
  let privatePlan = suppliedPlan ? validateSourceUnitPlan(content, suppliedPlan) : undefined;
  const view: ProcessingExecutionContext = { ...outer, taskEvidenceMemo: outer?.taskEvidenceMemo ?? {} };
  Object.defineProperties(view, {
    signal: { enumerable: true, configurable: true, get: () => outer?.signal },
    checkpoint: { enumerable: true, configurable: true, get: () => outer?.checkpoint },
    runtimeOptions: { enumerable: true, configurable: true, get: () => outer?.runtimeOptions },
    sourceUnitPlan: { enumerable: true, configurable: true,
      get: () => {
        if (outer?.sourceUnitPlan !== suppliedPlan || JSON.stringify(outer?.sourceUnitPlan ?? null) !== suppliedIdentity)
          throw new Error("Source structure runtime changed during processing");
        return privatePlan;
      },
      set: (plan: SourceUnitPlan | undefined) => { privatePlan = plan ? validateSourceUnitPlan(content, plan) : undefined; },
    },
  });
  return view;
};

export const throwIfProcessingAborted = (
  execution?: ProcessingExecutionContext,
): void => {
  if (!execution?.signal?.aborted) return;
  const error = new Error("Processing aborted");
  error.name = "AbortError";
  throw error;
};
