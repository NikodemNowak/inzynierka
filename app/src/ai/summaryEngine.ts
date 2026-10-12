// 'auto' routes longer notes to the fast chunked summary; 'verified' always
// uses the LLM-verified engine (kept for its own tests and for diagnostics).
export type SummaryEngineMode = 'auto' | 'verified';

let mode: SummaryEngineMode = 'auto';
export const getSummaryEngineMode = (): SummaryEngineMode => mode;
export const setSummaryEngineMode = (next: SummaryEngineMode): void => {
  mode = next;
};
