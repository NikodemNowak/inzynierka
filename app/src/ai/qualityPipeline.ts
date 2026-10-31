import type { Language } from "../i18n/language";
import { throwIfProcessingAborted, type ProcessingExecutionContext } from "./processingContext";
import { deterministicSourceUnitPlan } from "./sourceUnits";
import { createSummarySources, type SummarySourceUnit } from "./summarySources";
import { generatePointSummary } from "./pointSummary";
import { generateTitleAndTags } from "./titleTags";
import { extractTaskLines } from "./taskLines";
import { fallbackTitle } from "./noteOutput";
import { resolveSelfCorrections } from "./selfCorrection";
import { applySpokenCorrections, findSpokenCorrections, type SpokenCorrection } from "./spokenCorrections";
import { renderSummaryDocument } from "../domain/summary";
import type { NoteProcessingResult, ProcessingProgress } from "./noteProcessing";

// Sentence units shared by the summary, title and task calls. An unpunctuated
// transcript is split deterministically on the recognizer's capitals and spoken
// cues: the model punctuation pass cost two calls per field and was mostly rejected.
export const qualitySourceUnits = async (
  content: string,
  _language: Language,
  execution: ProcessingExecutionContext | undefined,
): Promise<readonly SummarySourceUnit[]> => {
  throwIfProcessingAborted(execution);
  return createSummarySources(content, execution?.sourceUnitPlan ?? deterministicSourceUnitPlan(content) ?? undefined);
};

// The units as recorded and the same units with the speaker's corrections applied:
// the model reads the final values, source ranges stay on the recorded text.
const correctedUnits = async (
  content: string, language: Language, execution: ProcessingExecutionContext | undefined,
): Promise<{ recorded: readonly SummarySourceUnit[]; corrected: readonly SummarySourceUnit[]; corrections: readonly SpokenCorrection[] }> => {
  const recorded = await qualitySourceUnits(content, language, execution);
  // An explicit cue ("cztery, nie, sześć") is settled first, without the model.
  const cued = recorded.map((unit) => resolveSelfCorrections(unit.text, language));
  const corrections = await findSpokenCorrections(cued, language, execution);
  const texts = applySpokenCorrections(cued, corrections);
  return { recorded, corrected: recorded.map((unit, index) => ({ ...unit, text: texts[index] })), corrections };
};

const warn = (language: Language, pl: string, en: string): string => (language === "en" ? en : pl);

// Summary, title and categories from the point-summary pipeline. Tasks are a
// separate user action (see createQualityTaskLines).
export const processNoteQuality = async (
  content: string,
  onProgress: (progress: ProcessingProgress) => void,
  language: Language,
  execution: ProcessingExecutionContext | undefined,
): Promise<NoteProcessingResult> => {
  const { recorded, corrected: units, corrections } = await correctedUnits(content, language, execution);
  throwIfProcessingAborted(execution);

  const warnings: string[] = [];
  const failedFields: NonNullable<NoteProcessingResult["failedFields"]> = [];

  onProgress({ phase: "summary" });
  const summary = await generatePointSummary(units, content, language, execution,
    (live) => onProgress({ phase: "summary", live }), recorded);
  throwIfProcessingAborted(execution);
  warnings.push(...summary.warnings);
  const points = summary.points.map((point) => point.text);
  if (!points.length && units.length) {
    failedFields.push("summary");
    warnings.push(warn(language,
      "Nie udało się utworzyć wiarygodnego podsumowania. Treść notatki została zachowana.",
      "A reliable summary could not be created. Your source note has been kept."));
  }

  onProgress({ phase: "title" });
  let title = "";
  let categories: string[] = [];
  try {
    const result = await generateTitleAndTags(
      { opening: units[0]?.text ?? content, points, content }, language, execution);
    title = result.title;
    categories = result.categories;
    if (!categories.length) {
      failedFields.push("tags");
      warnings.push(warn(language, "Nie udało się ustalić kategorii.", "A category could not be determined."));
    }
  } catch (error) {
    throwIfProcessingAborted(execution);
    failedFields.push("title", "tags");
    warnings.push(warn(language,
      "Nie udało się utworzyć tytułu. Sprawdź treść źródła.",
      "A title could not be created. Review the source note."));
  }
  if (!title) title = fallbackTitle(content, language);

  // The chat reads the transcript; it applies the same corrections from here.
  const document = summary.document && corrections.length ? { ...summary.document, corrections } : summary.document;
  return {
    title,
    summary: document ? renderSummaryDocument(document) : "",
    summaryDocument: document,
    tags: categories,
    ...(warnings.length ? { warnings, failedFields } : {}),
  };
};

// One task-line pass over the pre-filtered candidate sentences.
export const createQualityTaskLines = async (
  source: string,
  language: Language,
  execution: ProcessingExecutionContext | undefined,
): Promise<{ tasks: string[]; warnings: string[] }> => {
  const { corrected: units } = await correctedUnits(source, language, execution);
  throwIfProcessingAborted(execution);
  const result = await extractTaskLines(units, language, execution);
  return { tasks: result.rendered, warnings: result.warnings };
};
