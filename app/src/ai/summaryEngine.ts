// 'points' is the default concise point-summary pipeline (summary, title,
// categories, tasks). 'auto' and 'verified' keep the legacy source-linked
// engines for their own tests and diagnostics: 'auto' routes longer notes to the
// fast chunked summary; 'verified' always uses the LLM-verified engine.
export type SummaryEngineMode = 'points' | 'auto' | 'verified';

let mode: SummaryEngineMode = 'points';
export const getSummaryEngineMode = (): SummaryEngineMode => mode;
export const setSummaryEngineMode = (next: SummaryEngineMode): void => {
  mode = next;
};
