import { AppState } from 'react-native'
import { translate } from '../i18n/translate'
import {
  nativeProcessing,
  supportsBackgroundProcessing,
} from './nativeProcessing'

let activeController: AbortController | null = null
const queuedControllers = new Set<AbortController>()
const continuationBrand: unique symbol = Symbol('ImportContinuation')
export interface ImportContinuation {
  readonly [continuationBrand]: true
  readonly signal: AbortSignal
  readonly leaseAttemptId: string
  readonly background: boolean
}
interface ContinuationState {
  token: ImportContinuation
  sourceCommitted: boolean
  completed: number
}
let activeContinuation: ContinuationState | null = null
const issuedContinuations = new WeakMap<ImportContinuation, ContinuationState>()

export const registerImportProcessing = (
  controller: AbortController,
): (() => void) => {
  queuedControllers.add(controller)
  return () => {
    queuedControllers.delete(controller)
  }
}
export const pauseImportProcessing = (): void => {
  activeController?.abort()
  for (const controller of queuedControllers) controller.abort()
}
export const isImportContinuationActive = (
  token: ImportContinuation | undefined,
): token is ImportContinuation =>
  token !== undefined &&
  activeContinuation?.token === token &&
  !token.signal.aborted

export const markImportSourceCommitted = (
  token: ImportContinuation | undefined,
): void => {
  if (isImportContinuationActive(token) && activeContinuation)
    activeContinuation.sourceCommitted = true
}
export const isImportSourceCommitted = (
  token: ImportContinuation | undefined,
): boolean =>
  token !== undefined &&
  (issuedContinuations.get(token)?.sourceCommitted ?? false)

// The single parent lease measures completed speech windows first, then actual
// AI stages. Counts shown in the subtitle describe work, not estimated time.
export const reportImportAiProgress = (
  token: ImportContinuation | undefined,
  phase:
    | 'loading'
    | 'processing'
    | 'fragment'
    | 'reduction'
    | 'tasks'
    | 'summary'
    | 'title'
    | 'tags'
    | 'persist',
  completed = 0,
  total = 0,
): void => {
  if (
    !isImportContinuationActive(token) ||
    !token.background ||
    !activeContinuation
  )
    return
  const fraction = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0
  const value =
    phase === 'fragment' || phase === 'tasks'
      ? 4000 + fraction * 3600
      : phase === 'reduction'
        ? 7600 + fraction * 800
        : phase === 'summary'
          ? 8400
          : phase === 'title'
            ? 8900
            : phase === 'tags'
              ? 9400
              : phase === 'persist'
                ? 9900
                : 4000
  activeContinuation.completed = Math.max(
    activeContinuation.completed,
    Math.floor(value),
  )
  const label =
    phase === 'loading'
      ? translate('Wczytywanie modelu', 'Loading model')
      : phase === 'processing'
        ? translate('Opracowywanie tekstu', 'Processing text')
      : phase === 'summary'
        ? translate('Podsumowanie', 'Summary')
        : phase === 'title'
          ? translate('Tytuł', 'Title')
          : phase === 'tags'
            ? translate('Kategorie', 'Categories')
            : phase === 'persist'
              ? translate('Zapis wyniku', 'Saving result')
              : phase === 'reduction'
                ? translate('Łączenie informacji', 'Combining information')
                : translate('Analiza fragmentów', 'Analyzing sections')
  void nativeProcessing
    ?.update(
      token.leaseAttemptId,
      activeContinuation.completed,
      translate('Import nagrania', 'Importing recording'),
      total > 0 ? `${label} · ${completed}/${total}` : label,
    )
    .catch(() => undefined)
}

export async function runImportProcessing<T>(
  controller: AbortController,
  background: boolean,
  run: (
    progress: (completed: number, total: number) => void,
    continuation: ImportContinuation,
  ) => Promise<T>,
): Promise<T> {
  if (activeController)
    throw new Error(
      translate('Transkrypcja już trwa.', 'Transcription is already running.'),
    )
  activeController = controller
  const attempt = `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  let granted = false
  let complete = false
  const assertActive = () => {
    if (controller.signal.aborted)
      throw new Error(
        translate(
          'Transkrypcję wstrzymano. Ukończone części i audio zostały zachowane.',
          'Transcription paused. Completed parts and audio have been kept.',
        ),
      )
  }
  const state = AppState.addEventListener('change', (value) => {
    if (value === 'background' && !granted) controller.abort()
  })
  const memory = AppState.addEventListener('memoryWarning', () =>
    controller.abort(),
  )
  const expired = nativeProcessing?.addListener(
    'onProcessingExpired',
    (event) => {
      if (event.attemptId === attempt) controller.abort()
    },
  )
  try {
    assertActive()
    if (AppState.currentState !== 'active') controller.abort()
    assertActive()
    if (background) {
      if (!nativeProcessing || !supportsBackgroundProcessing())
        throw new Error(
          translate(
            'Ten system nie udostępnia transkrypcji w tle. W Ustawieniach wybierz pracę w otwartej aplikacji.',
            'This system does not support background transcription. Choose processing with the app open in Settings.',
          ),
        )
      granted = await nativeProcessing.begin(
        attempt,
        translate('Import nagrania', 'Importing recording'),
        translate('Przygotowanie', 'Preparing'),
      )
      assertActive()
      if (!granted)
        throw new Error(
          translate(
            'iOS nie przyznał pracy w tle. Spróbuj ponownie lub zmień tryb w Ustawieniach.',
            'iOS did not grant background time. Try again or change the mode in Settings.',
          ),
        )
      await nativeProcessing.prepareProtectedFiles()
    }
    assertActive()
    const token: ImportContinuation = Object.freeze({
      [continuationBrand]: true as const,
      signal: controller.signal,
      leaseAttemptId: attempt,
      background: granted,
    })
    activeContinuation = { token, sourceCommitted: false, completed: 0 }
    issuedContinuations.set(token, activeContinuation)
    const result = await run((completed, total) => {
      if (!granted || controller.signal.aborted || total <= 0) return
      void nativeProcessing
        ?.update(
          attempt,
          Math.floor(Math.min(1, completed / total) * 4000),
          translate('Transkrypcja nagrania', 'Transcribing recording'),
          `${completed}/${total}`,
        )
        .catch(() => undefined)
    }, token)
    assertActive()
    complete = true
    return result
  } finally {
    activeContinuation = null
    state.remove()
    memory.remove()
    expired?.remove()
    if (background)
      await nativeProcessing?.finish(attempt, complete).catch(() => undefined)
    if (activeController === controller) activeController = null
  }
}
