import type { Language } from "../i18n/language";
import { validateSourceUnitPlan, type SourceUnitPlan } from "./sourceUnits";

export interface SourcePlanCacheIdentity {
  readonly source: string;
  readonly language: Language;
  readonly pipeline: string;
  readonly protocol: string;
  readonly modelIdentity: string;
}

interface CacheEntry {
  readonly plan: SourceUnitPlan;
  readonly characters: number;
  readonly signal?: AbortSignal;
  onAbort?: () => void;
}

// Bound retained private text, not native model/KV resources or task decisions.
const MAX_ENTRIES = 4;
const MAX_SERIALIZED_CHARACTERS = 65_536;
const entries = new Map<string, CacheEntry>();
let retainedCharacters = 0;
const keyFor = (identity: SourcePlanCacheIdentity): string => JSON.stringify([
  identity.pipeline, identity.protocol, identity.language, identity.modelIdentity, identity.source,
]);
const removeEntry = (key: string, expected?: CacheEntry): void => {
  const entry = entries.get(key);
  if (!entry || (expected && entry !== expected)) return;
  if (entry.onAbort) entry.signal?.removeEventListener("abort", entry.onAbort);
  retainedCharacters -= entry.characters;
  entries.delete(key);
};

export const clearSourcePlanCache = (): void => {
  for (const key of entries.keys()) removeEntry(key);
};

export const discardSourcePlanCache = (identity: SourcePlanCacheIdentity): void => {
  removeEntry(keyFor(identity));
};

export const readSourcePlanCache = (identity: SourcePlanCacheIdentity): SourceUnitPlan | null => {
  const key = keyFor(identity);
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.signal?.aborted) {
    removeEntry(key, entry);
    return null;
  }
  const plan = validateSourceUnitPlan(identity.source, entry.plan);
  entries.delete(key);
  entries.set(key, entry);
  return plan;
};

export const writeSourcePlanCache = (
  identity: SourcePlanCacheIdentity, value: SourceUnitPlan, signal?: AbortSignal,
): void => {
  if (signal?.aborted) return;
  const plan = validateSourceUnitPlan(identity.source, value);
  const key = keyFor(identity);
  const characters = key.length + JSON.stringify(plan).length;
  if (characters > MAX_SERIALIZED_CHARACTERS) return;
  removeEntry(key);
  while (entries.size >= MAX_ENTRIES || retainedCharacters + characters > MAX_SERIALIZED_CHARACTERS) {
    const oldest = entries.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    removeEntry(oldest);
  }
  const entry: CacheEntry = { plan, characters, signal };
  entry.onAbort = signal ? () => removeEntry(key, entry) : undefined;
  entries.set(key, entry);
  retainedCharacters += characters;
  if (entry.onAbort) signal?.addEventListener("abort", entry.onAbort, { once: true });
};
