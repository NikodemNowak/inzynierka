import type { Language } from "../i18n/language";
import { PIPELINE_VERSION, throwIfProcessingAborted, type ProcessingExecutionContext } from "./processingContext";
import { canProjectSourceUnits, needsSourceUnitPlan, projectSourceUnitPlan, punctuationProposalWords, validateSourceUnitPlan, type SourceUnitPlan } from "./sourceUnits";
import { generate, getLoadedModelInfo, getContextWindowSize, measureFormattedPromptTokens } from "./llm";
import { fitsPrompt, isIncompleteGeneration } from "./sourcePipeline";
import { recordGeneration } from "./generationMetrics";
import { readSourcePlanCache, writeSourcePlanCache, discardSourcePlanCache, type SourcePlanCacheIdentity } from "./sourcePlanCache";

const SOURCE_STRUCTURE_PROTOCOL = "punctuation-v7-short-complete-clauses-legacy-fallback-owned-prefix";

export const prepareSpokenSource = async (
  content: string, language: Language, execution?: ProcessingExecutionContext,
  onSourceStructure?: () => void,
): Promise<SourceUnitPlan | null> => {
  throwIfProcessingAborted(execution);
  if (!needsSourceUnitPlan(content)) return null;
  const context = getLoadedModelInfo();
  const signal = execution?.signal;
  const checkpoint = execution?.checkpoint;
  const initialPlan = execution?.sourceUnitPlan;
  const runtime = JSON.stringify(execution?.runtimeOptions ?? null);
  const runtimeKey = (): string => {
    const loaded = getLoadedModelInfo();
    return JSON.stringify([PIPELINE_VERSION, SOURCE_STRUCTURE_PROTOCOL, content, language, execution?.runtimeOptions ?? null,
      loaded?.modelPath, loaded?.model, loaded?.execution, loaded?.speculative,
      loaded?.gpu, loaded?.devices, getContextWindowSize()]);
  };
  const key = runtimeKey();
  const assertRuntime = (): void => {
    throwIfProcessingAborted(execution);
    if (getLoadedModelInfo() !== context || execution?.signal !== signal ||
        execution?.checkpoint !== checkpoint || execution?.sourceUnitPlan !== initialPlan ||
        JSON.stringify(execution?.runtimeOptions ?? null) !== runtime || runtimeKey() !== key)
      throw new Error("Source structure runtime changed during processing");
  };
  if (initialPlan) {
    const result = validateSourceUnitPlan(content, initialPlan);
    assertRuntime();
    return result;
  }
  const memo = execution?.taskEvidenceMemo?.sourceStructure;
  assertRuntime();
  if (memo?.key === key && memo.context === context && memo.signal === signal && memo.checkpoint === checkpoint) {
    const result = memo.result ? validateSourceUnitPlan(content, memo.result) : null;
    assertRuntime();
    return result;
  }
  const saveMemo = (result: SourceUnitPlan | null): SourceUnitPlan | null => {
    assertRuntime();
    if (execution?.taskEvidenceMemo) execution.taskEvidenceMemo.sourceStructure = Object.freeze({ key, context, signal, checkpoint, result });
    return result;
  };
  if (!canProjectSourceUnits(content)) return saveMemo(null);
  const options = execution?.runtimeOptions;
  const cacheIdentity: SourcePlanCacheIdentity | null = context?.execution === "foreground" &&
    (options?.execution ?? context.execution) === "foreground" && context.model.sha256 && context.model.revision
    ? { source: content, language, pipeline: PIPELINE_VERSION, protocol: SOURCE_STRUCTURE_PROTOCOL,
      modelIdentity: JSON.stringify([context.modelPath, context.model, context.execution, context.speculative,
        context.gpu, context.devices, context.reasonNoGPU, context.systemInfo, getContextWindowSize(),
        { modelPath: options?.modelPath ?? context.modelPath, model: options?.model ?? context.model,
          execution: options?.execution ?? context.execution, speculative: options?.speculative ?? context.speculative }]) }
    : null;
  assertRuntime();
  const saveAccepted = (plan: SourceUnitPlan): SourceUnitPlan | null => {
    const result = saveMemo(plan);
    assertRuntime();
    if (cacheIdentity) {
      try {
        writeSourcePlanCache(cacheIdentity, plan, signal);
        assertRuntime();
      } catch (error) {
        discardSourcePlanCache(cacheIdentity);
        throw error;
      }
    }
    return result;
  };
  const checkpointKey = `source_structure:0:${content.length}`;
  const saved = await checkpoint?.read(checkpointKey);
  assertRuntime();
  if (typeof saved === "object" && saved !== null && !Array.isArray(saved)) {
    const value = saved as { version?: unknown; source?: unknown; key?: unknown; plan?: unknown };
    if (Object.keys(saved).every((field) => ["version", "source", "key", "plan"].includes(field)) &&
        value.version === PIPELINE_VERSION && value.source === content && value.key === key) {
      let plan: SourceUnitPlan | null = null;
      try { plan = validateSourceUnitPlan(content, value.plan); } catch { /* invalid saved proposals are never trusted */ }
      assertRuntime();
      if (plan) return saveAccepted(plan);
    }
  }
  const retained = cacheIdentity ? readSourcePlanCache(cacheIdentity) : null;
  assertRuntime();
  if (retained) {
    await checkpoint?.write(checkpointKey, { version: PIPELINE_VERSION, source: content, key, plan: retained });
    assertRuntime();
    return saveAccepted(retained);
  }
  const legacyPunctuationPrompt = (text: string, rule = ""): string => language === "pl"
    ? `Dodaj kropki rozdzielające zdania w transkrypcji. Nie zmieniaj żadnych słów ani ich kolejności. Zwróć tylko tekst z interpunkcją.${rule}\n\n${text}`
    : `Add periods separating sentences in the transcript. Do not change any words or their order. Return only the text with punctuation.${rule}\n\n${text}`;
  const punctuationPrompt = (text: string, preserveRepetitions = false): string => {
    const rule = preserveRepetitions ? language === "pl"
      ? " Zachowaj każde powtórzenie słów i zdań, również gdy brzmi zbędnie. Nie skracaj tekstu i nie dopisuj jego dalszego ciągu. Zachowaj dokładny zapis wszystkich liczb i odstępów w godzinach."
      : " Preserve every repetition of words and sentences, even when redundant. Do not shorten the text or add a continuation. Keep all numbers and spaces in clock times exactly as given." : "";
    if (preserveRepetitions) return legacyPunctuationPrompt(text, rule);
    return language === "pl"
      ? `Przepisz całą transkrypcję słowo w słowo, dodając tylko kropki i zmieniając wielkość liter na początku zdań. Nie usuwaj ani nie dodawaj żadnego słowa, także przymiotników, powtórzeń, liczb i przeczeń. Oddziel wprowadzenie tematu od zobowiązań. Każdy wykonawca ze swoją czynnością tworzy osobne zdanie. Termin stojący przed czynnością należy do tej czynności, a nie do wcześniejszego wprowadzenia. Przymiotniki i dopełnienia muszą zostać z opisywaną czynnością. Samodzielne informacje o kwotach, ich poprawki, zakazy i czynności już wykonane umieść w osobnych zdaniach. Zwróć tylko cały tekst z kropkami.${rule}\n\n${text}`
      : `Copy the entire transcript word for word, adding only periods and changing capitalization at sentence beginnings. Do not remove or add any word, including adjectives, repetitions, numbers and negations. Separate the topic introduction from commitments. Each actor with their action forms a separate sentence. A deadline before an action belongs to that action, not to the preceding introduction. Keep adjectives and complements with the action they describe. Put independent monetary statements, their corrections, prohibitions and completed actions in separate sentences. Return only the entire text with periods.${rule}\n\n${text}`;
  };
  const system = language === "pl" ? "Jesteś pomocnym asystentem. /no_think" : "You are a helpful assistant. /no_think";
  const words = [...content.matchAll(/\S+/gu)];
  if (words.length > 120 || content.length > 1800) {
    // The model still proposes punctuation, never rewritten evidence. Each
    // window has context on both sides; a cropped window edge is never admitted
    // as a sentence boundary. The complete source retains the scope guards.
    const ends = new Set<number>();
    const overlap = 24;
    let coreSize = 150;
    for (let core = 0; core < words.length;) {
      assertRuntime();
      let count = Math.min(coreSize, words.length - core);
      let start = 0;
      let end = 0;
      let nPredict = 0;
      let prompt = "";
      while (count > 0) {
        const first = Math.max(0, core - overlap);
        const last = Math.min(words.length, core + count + overlap) - 1;
        start = first === 0 ? 0 : words[first].index;
        end = last === words.length - 1 ? content.length : words[last].index + words[last][0].length;
        const text = content.slice(start, end);
        const tokens = await measureFormattedPromptTokens({ systemPrompt: "", userPrompt: text });
        assertRuntime();
        nPredict = Math.max(512, Math.ceil(tokens * 1.2) + 64);
        prompt = punctuationPrompt(text, true);
        if (nPredict <= 2048 && await fitsPrompt("", { system, nPredict, prompt: () => prompt }, execution)) break;
        assertRuntime();
        count = count === 1 ? 0 : Math.floor(count / 2);
      }
      assertRuntime();
      if (!count) return saveMemo(null);
      const text = content.slice(start, end);
      const preceding = core - Math.max(0, core - overlap);
      const minimumOwned = Math.min(16, count);
      const ownedCount = (prefixEnd: number): number => {
        const covered = text.slice(0, prefixEnd).trim().split(/\s+/u).length - preceding;
        // Six unchanged following words are required unless this is the true
        // source end. Ownership shrinks; the generated suffix never enters it.
        return Math.min(count, covered - (start + prefixEnd === content.length ? 0 : 6));
      };
      const partKey = `source_structure:window:${start}:${end}`;
      const part = await checkpoint?.read(partKey);
      assertRuntime();
      let plan: SourceUnitPlan | null = null;
      let accepted = false;
      if (typeof part === "object" && part !== null && !Array.isArray(part)) {
        const value = part as { version?: unknown; source?: unknown; key?: unknown; prefixEnd?: unknown; plan?: unknown };
        if (Object.keys(part).every(field => ["version", "source", "key", "prefixEnd", "plan"].includes(field)) &&
            value.version === PIPELINE_VERSION && value.source === text && value.key === key &&
            typeof value.prefixEnd === "number" && Number.isInteger(value.prefixEnd) && value.prefixEnd > 0 && value.prefixEnd <= text.length &&
            (value.prefixEnd === text.length || /\s/u.test(text[value.prefixEnd])) &&
            ownedCount(value.prefixEnd) >= minimumOwned) {
          try { plan = validateSourceUnitPlan(text.slice(0, value.prefixEnd as number), value.plan); } catch { /* Recompute an invalid part. */ }
          if (plan) { count = ownedCount(value.prefixEnd); accepted = true; }
        }
      }
      if (!accepted) {
        onSourceStructure?.();
        assertRuntime();
        const result = await generate(prompt, () => undefined, { system, nPredict, temperature: 0, signal });
        assertRuntime();
        recordGeneration("source_structure", text.length, result);
        assertRuntime();
        if (result.completion?.interrupted) throw new Error("Source structure generation interrupted");
        if (isIncompleteGeneration(result)) {
          if (coreSize > 16) { coreSize = Math.max(16, Math.floor(coreSize / 2)); continue; }
          return saveMemo(null);
        }
        const localWords = [...text.matchAll(/\S+/gu)];
        const proposal = result.text.replace(/^<think>\s*<\/think>\s*/u, "");
        const proposedWords = punctuationProposalWords(text, proposal);
        let aligned = 0;
        while (aligned < localWords.length && aligned < proposedWords.length) {
          const original = localWords[aligned][0].toLowerCase();
          const proposed = proposedWords[aligned].toLowerCase();
          if (!proposed.startsWith(original) || !/^[.,!?;:]*$/u.test(proposed.slice(original.length))) break;
          aligned += 1;
        }
        // Only propose boundaries inside a fully unchanged ownership core with
        // a verified right context. A generated continuation or an omitted
        // lookahead tail never becomes note text or source evidence.
        if (aligned > 0) {
          const prefixEnd = aligned === localWords.length ? text.length
            : localWords[aligned - 1].index + localWords[aligned - 1][0].length;
          if (ownedCount(prefixEnd) >= minimumOwned) {
            count = ownedCount(prefixEnd);
            plan = projectSourceUnitPlan(text.slice(0, prefixEnd), proposedWords.slice(0, aligned).join(" "));
            // An aligned one-statement window contributes no artificial edge.
            // Later windows may still provide valid boundaries for the source.
            accepted = true;
          }
        }
        if (!accepted) {
          if (coreSize > 16) { coreSize = Math.max(16, Math.floor(coreSize / 2)); continue; }
          return saveMemo(null);
        }
        if (plan) await checkpoint?.write(partKey, { version: PIPELINE_VERSION, source: text, key, prefixEnd: plan.source.length, plan });
        assertRuntime();
      }
      const coreStart = core === 0 ? 0 : words[core].index;
      const coreLast = words[core + count - 1];
      const coreEnd = core + count === words.length ? content.length : coreLast.index + coreLast[0].length;
      if (plan) for (const localEnd of plan.ends) {
        const originalEnd = start + localEnd;
        if (localEnd === plan.source.length && start + plan.source.length !== content.length) continue;
        if (originalEnd > coreStart && originalEnd <= coreEnd) ends.add(originalEnd);
      }
      core += count;
      coreSize = 150;
    }
    ends.add(content.length);
    const boundaries = [...ends].sort((a, b) => a - b);
    let plan: SourceUnitPlan;
    try {
      plan = validateSourceUnitPlan(content, { version: 1, source: content,
        identity: JSON.stringify([1, content, boundaries]), ends: boundaries });
    } catch { return saveMemo(null); }
    assertRuntime();
    await checkpoint?.write(checkpointKey, { version: PIPELINE_VERSION, source: content, key, plan });
    assertRuntime();
    return saveAccepted(plan);
  }
  // A complete preferred response can still omit a word. Give short sources
  // one legacy punctuation request, with the same exact-source admission and
  // a separately measured prompt. Runtime or incomplete-generation failures
  // never initiate a fallback; two invalid proposals preserve source review.
  for (const prompt of [punctuationPrompt(content), legacyPunctuationPrompt(content)]) {
    const fits = await fitsPrompt("", { system, nPredict: 512, prompt: () => prompt }, execution);
    assertRuntime();
    if (!fits) continue;
    onSourceStructure?.();
    assertRuntime();
    const result = await generate(prompt, () => undefined, { system, nPredict: 512, temperature: 0, signal });
    assertRuntime();
    recordGeneration("source_structure", content.length, result);
    assertRuntime();
    if (result.completion?.interrupted) throw new Error("Source structure generation interrupted");
    if (isIncompleteGeneration(result)) return saveMemo(null);
    // Native Qwen can return its empty chat thinking envelope in raw content.
    // Keep the recorded response intact and strip only that leading empty frame.
    const proposal = result.text.replace(/^<think>\s*<\/think>\s*/u, "");
    const plan = projectSourceUnitPlan(content, proposal);
    if (!plan) continue;
    await checkpoint?.write(checkpointKey, { version: PIPELINE_VERSION, source: content, key, plan });
    assertRuntime();
    return saveAccepted(plan);
  }
  return saveMemo(null);
};
