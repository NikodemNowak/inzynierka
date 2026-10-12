import { useEffect, useRef, useState } from 'react'
import { Stack } from 'expo-router'
import {
  Button,
  Platform,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  TextInput,
  View,
  type TextProps,
} from 'react-native'
import { useI18n } from '../../i18n/useI18n'
import {
  BENCHMARK_PROFILES,
  BENCHMARK_QWEN3,
  BENCHMARK_QWEN35,
  type BenchmarkArm,
} from '../../ai/benchmarkProfiles'
import {
  makeBenchmarkFixture,
  BENCHMARK_AUDIO_FIXTURES,
  prepareEnglishBenchmarkAudioFixture,
  type BenchmarkAudioFixtureId,
  type BenchmarkFixtureId,
} from '../../ai/benchmarkFixtures'
import {
  downloadBenchmarkModel,
  deleteBenchmarkModel,
  isBenchmarkModelPresent,
} from '../../ai/benchmarkModels'
import { runBenchmarkSuite } from '../../ai/benchmarkService'
import { QUICK_SUITE_TEXTS, runQuickSuite } from '../../ai/benchmarkQuickSuite'
import { runSpeechWindowBenchmarkSuite, shareSpeechWindowBenchmarks, type SpeechWindowBenchmarkReport } from '../../stt/speechWindowBenchmark'
import {
  listBenchmarkRunSummaries,
  loadBenchmarkRun,
  projectBenchmarkRun,
  updateBenchmarkAssessment,
  shareBenchmarkRuns,
  type BenchmarkAssessmentKey,
  type BenchmarkRunSummary,
} from '../../ai/benchmarkStorage'
import type { BenchmarkRun, BenchmarkSpeechBackend } from '../../ai/benchmarkTypes'
import type { ModelExecutionProfile, ModelConfig } from '../../ai/modelConfig'
import { useTheme, type ThemeColors } from '../../ui/theme'
import {
  captureGpuDiagnosticReport,
  shareGpuDiagnosticReports,
  type GpuDiagnosticReport,
} from '../../processing/gpuDiagnostics'

function Text({ style, ...props }: TextProps) {
  const { colors } = useTheme()
  return <NativeText {...props} style={[{ color: colors.ink }, style]} />
}

const fixtureIds: readonly BenchmarkFixtureId[] = [
  'smoke',
  '5-min-text',
  '15-min-text',
  '30-min-text',
]
const labelForFixture = (
  id: BenchmarkFixtureId,
  t: (pl: string, en: string) => string,
): string =>
  id === 'smoke'
    ? t('Krótki test', 'Smoke test')
    : id.replace('-min-text', ' min')

type SpeechBenchmarkArmPreview = Pick<
  SpeechWindowBenchmarkReport['arms'][number],
  'pass' | 'windowDurationMs' | 'nativeRequestWallMs' | 'status'
> & {
  quality?: Pick<
    NonNullable<SpeechWindowBenchmarkReport['arms'][number]['quality']>,
    'wordErrorRate'
  >
}

export type SpeechWindowBenchmarkPreview = Pick<
  SpeechWindowBenchmarkReport,
  'id' | 'status' | 'nativeReadinessDiagnostics'
> & { arms: SpeechBenchmarkArmPreview[] }

export const projectSpeechWindowBenchmarkReport = (
  report: SpeechWindowBenchmarkReport,
): SpeechWindowBenchmarkPreview => ({
  id: report.id,
  status: report.status,
  nativeReadinessDiagnostics: report.nativeReadinessDiagnostics,
  arms: report.arms.map((arm) => ({
    pass: arm.pass,
    windowDurationMs: arm.windowDurationMs,
    nativeRequestWallMs: arm.nativeRequestWallMs,
    status: arm.status,
    quality: arm.quality ? { wordErrorRate: arm.quality.wordErrorRate } : undefined,
  })),
})

export default function BenchmarkScreen() {
  const { t, language } = useI18n()
  const { colors } = useTheme()
  const styles = makeStyles(colors)
  const [fixtureId, setFixtureId] = useState<BenchmarkFixtureId>('smoke')
  const [inputMode, setInputMode] = useState<'audio' | 'text'>('audio')
  const [audioFixtureId, setAudioFixtureId] =
    useState<BenchmarkAudioFixtureId>('en-audio-3min-v1')
  const [source, setSource] = useState(
    () => makeBenchmarkFixture('smoke', language).source,
  )
  const [custom, setCustom] = useState(false)
  const [device, setDevice] = useState('')
  const [arms, setArms] = useState<BenchmarkArm[]>(['qwen3'])
  const [execution, setExecution] =
    useState<ModelExecutionProfile>('foreground')
  const [warmRepeats, setWarmRepeats] = useState(1)
  const [sttReport, setSttReport] = useState<SpeechWindowBenchmarkPreview | null>(null)
  const [speechBackend, setSpeechBackend] = useState<BenchmarkSpeechBackend>('recognizer')
  const [gpuDiagnostic, setGpuDiagnostic] = useState<GpuDiagnosticReport | null>(null)
  const [present, setPresent] = useState<Record<string, boolean>>({})
  const [runs, setRuns] = useState<BenchmarkRunSummary[]>([])
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailRun, setDetailRun] = useState<BenchmarkRun | null>(null)
  const [detailError, setDetailError] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const selectedAudio = BENCHMARK_AUDIO_FIXTURES.find(
    (fixture) => fixture.id === audioFixtureId,
  )
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const gpuDiagnosticRequest = useRef(0)
  const detailRequest = useRef(0)
  const listRequest = useRef(0)
  const clearDetails = (): void => {
    detailRequest.current++
    setDetailId(null)
    setDetailRun(null)
    setDetailError('')
  }
  const showDetails = async (id: string): Promise<void> => {
    if (controller.current) return
    if (detailId === id) { clearDetails(); return }
    const requestId = ++detailRequest.current
    setDetailId(id)
    setDetailRun(null)
    setDetailError('')
    const canPublish = (): boolean => mounted.current &&
      requestId === detailRequest.current && controller.current === null
    try {
      const full = await loadBenchmarkRun(id)
      if (canPublish()) setDetailRun(full)
    } catch (failure) {
      if (canPublish()) setDetailError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  const reload = async (): Promise<void> => {
    const requestId = ++listRequest.current
    const models = [BENCHMARK_QWEN3, BENCHMARK_QWEN35]
    const availability = await Promise.all(
      models.map(
        async (model) =>
          [model.filename, await isBenchmarkModelPresent(model)] as const,
      ),
    )
    const saved = await listBenchmarkRunSummaries()
    if (mounted.current && requestId === listRequest.current) {
      setPresent(Object.fromEntries(availability))
      setRuns(saved)
    }
  }
  const refreshGpuDiagnostic = async (
    trigger: GpuDiagnosticReport['trigger'],
    signal?: AbortSignal,
  ): Promise<void> => {
    if (signal?.aborted) return
    const requestId = ++gpuDiagnosticRequest.current
    const canPublish = (): boolean => mounted.current &&
      requestId === gpuDiagnosticRequest.current && !signal?.aborted
    let onAbort: (() => void) | undefined
    const aborted = signal ? new Promise<void>((resolve) => {
      onAbort = resolve
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) resolve()
    }) : undefined
    // Saving the observation may finish safely after cancellation. Handle its
    // rejection while releasing the screen immediately and suppressing updates.
    const capture = (async () => {
      try {
        const report = await captureGpuDiagnosticReport(trigger)
        if (canPublish()) setGpuDiagnostic(report)
      } catch (failure) {
        if (canPublish())
          setError(failure instanceof Error ? failure.message : String(failure))
      }
    })()
    try {
      await (aborted ? Promise.race([capture, aborted]) : capture)
    } finally {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort)
    }
  }
  useEffect(() => {
    mounted.current = true
    void reload().catch((failure: unknown) => {
      if (mounted.current) setError(String(failure))
    })
    void refreshGpuDiagnostic('automatic')
    return () => {
      mounted.current = false
      gpuDiagnosticRequest.current++
      detailRequest.current++
      listRequest.current++
      controller.current?.abort()
    }
  }, [])
  useEffect(() => { clearDetails() }, [inputMode, audioFixtureId, fixtureId])
  useEffect(() => {
    if (!custom && !busy)
      setSource(makeBenchmarkFixture(fixtureId, language).source)
  }, [fixtureId, language, custom, busy])

  const perform = async (
    operation: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> => {
    if (controller.current) return
    const current = new AbortController()
    controller.current = current
    clearDetails()
    listRequest.current++
    setBusy(true)
    setError('')
    try {
      await operation(current.signal)
    } catch (failure) {
      if (mounted.current)
        setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      controller.current = null
      if (mounted.current) {
        setBusy(false)
        setStatus('')
        await reload()
      }
    }
  }
  const download = (model: ModelConfig): void => {
    void perform((signal) =>
      downloadBenchmarkModel(
        model,
        (stage, percent) => {
          if (mounted.current)
            setStatus(
              `${model.displayName} · ${stage === 'download' ? t('pobieranie', 'download') : 'SHA-256'} · ${percent.toFixed(1)}%`,
            )
        },
        signal,
      ),
    )
  }
  const startSttWindows = (): void => {
    void perform(async (signal) => {
      const audio = await prepareEnglishBenchmarkAudioFixture(audioFixtureId, signal)
      const report = await runSpeechWindowBenchmarkSuite({
        fixtureId: audioFixtureId, fixture: audio, speechBackend, deviceLabel: device, signal,
        onProgress: (value) => { if (mounted.current && !signal.aborted) setStatus(value) },
        onResult: (value) => { if (mounted.current) setSttReport(projectSpeechWindowBenchmarkReport(value)) },
      })
      if (report.status === 'failed') throw new Error(report.error)
    })
  }
  const start = (): void => {
    const fixture = makeBenchmarkFixture(fixtureId, language)
    void perform(async (signal) => {
      if (inputMode === 'audio' && !selectedAudio)
        throw new Error('Unknown benchmark audio fixture')
      const audio =
        inputMode === 'audio'
          ? await prepareEnglishBenchmarkAudioFixture(audioFixtureId, signal)
          : undefined
      await runBenchmarkSuite({
        arms: audio ? ['qwen3'] : arms,
        warmRepeats: audio ? 1 : warmRepeats,
        language: audio ? 'en' : language,
        source: audio ? '' : source,
        inputMode,
        audioFixture: audio,
        speechBackend: audio ? speechBackend : undefined,
        deviceLabel: device,
        fixtureId: audio ? audioFixtureId : custom ? 'custom' : fixtureId,
        sourceProvenance: custom ? 'user-text' : fixture.provenance,
        nominalMinutes: audio
          ? selectedAudio!.nominalMinutes
          : custom
            ? null
            : fixture.nominalMinutes,
        execution: audio ? 'foreground' : execution,
        signal,
        onProgress: (message) => {
          if (mounted.current) setStatus(message)
        },
        onResult: (run) => {
          if (mounted.current) {
            clearDetails()
            listRequest.current++
            const summary = projectBenchmarkRun(run)
            setRuns((previous) => [summary, ...previous].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30))
          }
        },
      })
    })
  }
  const startQuick = (): void => {
    void perform(async (signal) => {
      await runQuickSuite({
        deviceLabel: device,
        signal,
        onProgress: (message) => {
          if (mounted.current) setStatus(message)
        },
        onResult: (run) => {
          if (mounted.current) {
            clearDetails()
            listRequest.current++
            const summary = projectBenchmarkRun(run)
            setRuns((previous) => [summary, ...previous].sort((a, b) => b.createdAt - a.createdAt).slice(0, 30))
          }
        },
      })
    })
  }
  const assess = async (
    run: BenchmarkRunSummary,
    key: BenchmarkAssessmentKey,
  ): Promise<void> => {
    const current = run.assessment[key]
    await perform(async () => {
      const next = await updateBenchmarkAssessment(run.id, key, current === null ? true : current ? false : null)
      if (mounted.current) setRuns((previous) =>
        previous.map((item) => (item.id === next.id ? next : item)))
    })
  }
  const modelsReady = (inputMode === 'audio' ? ['qwen3'] : arms).every(
    (arm) => {
      const profile = BENCHMARK_PROFILES.find((item) => item.id === arm)
      return profile ? present[profile.model.filename] : false
    },
  )
  return (
    <ScrollView
      style={{ backgroundColor: colors.canvas }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: t(
            'Pomiary i porównanie modeli',
            'Measurements and model comparison',
          ),
        }}
      />
      <Text style={styles.copy}>
        {t(
          'Pomiar transkrypcji i opracowania notatki: tytuł, podsumowanie, kategorie i zadania. Ekran pozostaje aktywny podczas testu. Pozostaw aplikację otwartą. Wyjście z aplikacji lub presja pamięci anuluje próbę.',
          'Measure transcription and note processing: title, summary, categories and tasks. The screen stays awake during the test. Keep the app open. Leaving the app or memory pressure cancels the attempt.',
        )}
      </Text>
      <View style={styles.card}>
        <Text style={styles.heading}>{t('Szybki test szybkości', 'Quick speed test')}</Text>
        <Text style={styles.copy}>
          {t(
            `Jeden przycisk: trzy stałe polskie notatki (${QUICK_SUITE_TEXTS.map((text) => text.words).join(', ')} słów) przechodzą pełne przetwarzanie. Czasy faz i log Metal zapisują się w wynikach. Zostaw ekran włączony; całość trwa kilka minut.`,
            `One button: three fixed Polish notes (${QUICK_SUITE_TEXTS.map((text) => text.words).join(', ')} words) go through the full processing. Phase timings and the Metal log are saved with the results. Keep the screen on; it takes a few minutes.`,
          )}
        </Text>
        {!present[BENCHMARK_QWEN3.filename] ? (
          <Text style={styles.copy}>
            {t(
              'Najpierw pobierz model Qwen3 poniżej (jednorazowo).',
              'First download the Qwen3 model below (once).',
            )}
          </Text>
        ) : null}
        <Button
          disabled={busy || !present[BENCHMARK_QWEN3.filename]}
          title={t('Uruchom pełny test', 'Run full test')}
          onPress={startQuick}
        />
        <Button
          disabled={busy}
          title={t('Eksportuj wyniki', 'Export results')}
          onPress={() => void perform(async () => { await shareBenchmarkRuns() })}
        />
        {busy ? <Text style={styles.copy}>{status}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>{t('GPU w tle', 'Background GPU')}</Text>
        <Text style={styles.copy}>
          {gpuDiagnostic?.capabilities.gpu === false
            ? t(
                'Ten telefon i system nie udostępniają GPU w tle.',
                'This device and OS do not support background GPU use.',
              )
            : gpuDiagnostic?.capabilities.gpu === true
              ? t(
                  'Urządzenie i system obsługują GPU w tle. Przed próbą GPU trzeba zweryfikować uprawnienie podpisanej aplikacji.',
                  'The device and OS support background GPU use. The signed app permission must be verified before a GPU workload test.',
                )
              : t(
                  'Wsparcie GPU w tle nie zostało odczytane. Wynik pozostaje nierozstrzygnięty.',
                  'Background GPU support has not been observed. The result is inconclusive.',
                )}
        </Text>
        {gpuDiagnostic ? (
          <Text style={styles.small}>
            {gpuDiagnostic.capabilities.osVersion ? `iOS ${gpuDiagnostic.capabilities.osVersion}` : '—'}
            {' · '}{t('build', 'build')} {gpuDiagnostic.capabilities.appBuild ?? '—'}
            {' · '}{t('raport zapisany', 'report saved')}
          </Text>
        ) : null}
        <Button
          disabled={busy}
          title={t('Sprawdź GPU w tle', 'Check background GPU')}
          onPress={() => void perform(async (signal) => { await refreshGpuDiagnostic('user', signal) })}
        />
        <Button
          disabled={busy}
          title={t('Eksportuj diagnostykę GPU', 'Export GPU diagnostics')}
          onPress={() => void perform(async () => { await shareGpuDiagnosticReports() })}
        />
      </View>
      <Text style={styles.heading}>
        {t('Modele do pobrania', 'Models to download')}
      </Text>
      <Text style={styles.copy}>
        {inputMode === 'audio'
          ? t(
              'Test używa domyślnego modelu Qwen3. Przycisk pobrania zgadza się na pobranie tego pliku z Hugging Face. SHA-256 i metadane GGUF są sprawdzane lokalnie.',
              'This test uses the default Qwen3 model. The download button opts into fetching this file from Hugging Face. SHA-256 and GGUF metadata are checked locally.',
            )
          : t(
              'Dwa osobne pliki zajmują łącznie około 5,33 GB. Każdy przycisk pobrania zgadza się na pobranie wskazanego pliku z Hugging Face. SHA-256 i metadane GGUF są sprawdzane lokalnie. Model aplikacji pozostaje domyślnym Qwen3.',
              'Two separate files require about 5.33 GB in total. Each download button opts into fetching that file from Hugging Face. SHA-256 and GGUF metadata are checked locally. Qwen3 remains the app default.',
            )}
      </Text>
      {(inputMode === 'audio'
        ? [BENCHMARK_QWEN3]
        : [BENCHMARK_QWEN3, BENCHMARK_QWEN35]
      ).map((model) => (
        <View key={model.filename} style={styles.card}>
          <Text style={styles.heading}>{model.displayName}</Text>
          <Text style={styles.small}>
            {(model.sizeBytes! / 1e9).toFixed(2)} GB ·{' '}
            {model.revision?.slice(0, 12)} · NextN {model.nextnPredictLayers}
          </Text>
          <Text>
            {present[model.filename]
              ? t(
                  'Plik jest obecny; suma będzie sprawdzona przed testem.',
                  'File is present; checksum will be checked before testing.',
                )
              : t('Nie pobrano', 'Not downloaded')}
          </Text>
          <Button
            disabled={busy}
            title={
              present[model.filename]
                ? t('Sprawdź plik', 'Verify file')
                : t('Pobierz ten model', 'Download this model')
            }
            onPress={() => download(model)}
          />
          {present[model.filename] ? (
            <Button
              disabled={busy}
              color="#B91C1C"
              title={t('Usuń plik benchmarku', 'Remove benchmark file')}
              onPress={() =>
                void perform(async () => {
                  await deleteBenchmarkModel(model)
                })
              }
            />
          ) : null}
        </View>
      ))}
      <Text style={styles.heading}>
        {t('Konfiguracja pomiaru', 'Measurement setup')}
      </Text>
      <Button
        disabled={busy}
        title={`${inputMode === 'audio' ? '● ' : ''}${t('Audio po angielsku → STT → Qwen3', 'English audio → STT → Qwen3')}`}
        onPress={() => setInputMode('audio')}
      />
      <Button
        disabled={busy}
        title={`${inputMode === 'text' ? '● ' : ''}${t('Porównanie modeli na tekście', 'Compare models using text')}`}
        onPress={() => setInputMode('text')}
      />
      <Text style={styles.copy}>
        {Platform.OS} · {String(Platform.Version)}.{' '}
        {t(
          'Platforma i wersja systemu zapisują się automatycznie. Opcjonalnie dopisz warunki testu, np. „50% baterii, bez ładowania”.',
          'Platform and OS version are recorded automatically. Optionally add test conditions, e.g. “50% battery, unplugged”.',
        )}
      </Text>
      <TextInput
        accessibilityLabel={t(
          'Warunki testu (opcjonalnie)',
          'Test conditions (optional)',
        )}
        style={styles.input}
        value={device}
        editable={!busy}
        onChangeText={setDevice}
        placeholder={t(
          'Warunki testu (opcjonalnie)',
          'Test conditions (optional)',
        )}
      />
      {inputMode === 'text' ? (
        <>
          {BENCHMARK_PROFILES.map((profile) => (
            <Button
              key={profile.id}
              disabled={busy}
              title={`${arms.includes(profile.id) ? '☑' : '☐'} ${profile.id}`}
              onPress={() =>
                setArms((current) =>
                  current.includes(profile.id)
                    ? current.length > 1
                      ? current.filter((id) => id !== profile.id)
                      : current
                    : [...current, profile.id],
                )
              }
            />
          ))}
          <Button
            disabled={busy}
            title={
              execution === 'foreground'
                ? t(
                    'Backend: pierwszy plan (Metal na iOS, jeśli dostępny)',
                    'Backend: foreground (Metal on iOS when available)',
                  )
                : t(
                    'Backend: wyłącznie CPU, aplikacja otwarta',
                    'Backend: CPU only, app stays open',
                  )
            }
            onPress={() =>
              setExecution((current) =>
                current === 'foreground' ? 'background-cpu' : 'foreground',
              )
            }
          />
          <Button
            disabled={busy}
            title={t(
              `Zimny start + ${warmRepeats} ciepłe powtórzenia`,
              `Cold start + ${warmRepeats} warm repeats`,
            )}
            onPress={() =>
              setWarmRepeats((current) => (current >= 3 ? 0 : current + 1))
            }
          />
          <Text style={styles.copy}>
            {t(
              'Próbki 5/15/30 min to syntetyczny tekst przy założeniu 130 słów/min, bez zmierzonego audio i bez STT. Temperatura telefonu może wpływać na wynik; powtarzaj próbę po schłodzeniu i zmieniaj kolejność wariantów.',
              'The 5/15/30 min fixtures are synthetic text at an assumed 130 words/min, without measured audio or STT. Device temperature can affect results; repeat after cooling and vary arm order.',
            )}
          </Text>
          {fixtureIds.map((id) => (
            <Button
              key={id}
              disabled={busy}
              title={`${fixtureId === id && !custom ? '● ' : ''}${labelForFixture(id, t)}`}
              onPress={() => {
                setCustom(false)
                setFixtureId(id)
              }}
            />
          ))}
          <Text style={styles.small}>
            {source.trim().split(/\s+/).length} {t('słów', 'words')} ·{' '}
            {custom
              ? t('własny tekst', 'custom text')
              : t('próbka syntetyczna', 'synthetic fixture')}
          </Text>
          <TextInput
            accessibilityLabel={t('Tekst źródłowy', 'Source text')}
            style={[styles.input, styles.source]}
            multiline
            value={source}
            editable={!busy}
            onChangeText={(value) => {
              setCustom(true)
              setSource(value)
            }}
          />
        </>
      ) : (
        <>
          <Button
            disabled={busy}
            title={speechBackend === 'recognizer'
              ? t('STT: bieżące rozpoznawanie → sprawdź SpeechAnalyzer', 'STT: current recognizer → try SpeechAnalyzer')
              : t('STT: SpeechAnalyzer, jeśli model jest zainstalowany', 'STT: SpeechAnalyzer if the model is installed')}
            onPress={() => setSpeechBackend((current) =>
              current === 'recognizer' ? 'analyzer-if-installed' : 'recognizer',
            )}
          />
          <Text style={styles.small}>
            {t(
              'SpeechAnalyzer jest wariantem testowym. Użyje tylko zainstalowanego modelu języka; gdy jest niedostępny, test wróci do bieżącego rozpoznawania. Wynik zapisze użyty wariant. Modele nie będą pobierane.',
              'SpeechAnalyzer is an experimental test option. It uses only an installed language model; if unavailable, the test falls back to the current recognizer. The result records the actual backend. No models are downloaded.',
            )}
          </Text>
          {gpuDiagnostic?.speech?.capabilities?.locales['en-US'] ? (
            <Text style={styles.small}>
              {gpuDiagnostic.speech.capabilities.locales['en-US'].analyzerInstalled
                ? t('SpeechAnalyzer en-US jest gotowy.', 'SpeechAnalyzer en-US is ready.')
                : t('SpeechAnalyzer en-US nie jest gotowy; próba użyje bieżącego rozpoznawania.', 'SpeechAnalyzer en-US is not ready; the attempt will use the current recognizer.')}
            </Text>
          ) : null}
          {gpuDiagnostic?.speech?.capabilities?.locales['en-US']?.analyzerReadiness ? (
            <Text style={styles.small}>
              {t('EN w installedLocales', 'EN in installedLocales')}: {String(gpuDiagnostic.speech.capabilities.locales['en-US'].analyzerReadiness!.localeInstalled)} ·
              {' '}{t('zasoby modułu', 'module assets')}: {gpuDiagnostic.speech.capabilities.locales['en-US'].analyzerReadiness!.assetStatus} ·
              {' '}{gpuDiagnostic.speech.capabilities.locales['en-US'].analyzerReadiness!.fallbackReason ?? 'ready'}
            </Text>
          ) : null}
          <Button disabled={busy} title={t('Porównaj samo STT: 30 / 55 / 60 s', 'Compare STT only: 30 / 55 / 60 s')} onPress={startSttWindows} />
          <Button disabled={busy} title={t('Eksport pomiarów STT', 'Export STT measurements')} onPress={() => {
            void perform(() => shareSpeechWindowBenchmarks())
          }} />
          <Text style={styles.small}>
            {t('Wybrane audio zostanie rozpoznane sześć razy: 30→55→60 s, potem 60→55→30 s. Bez LLM i pobierania modeli. Zostaw aplikację otwartą; wyniki STT zapisują się osobno.', 'The selected audio is recognized six times: 30→55→60 s, then 60→55→30 s. No LLM or model downloads. Keep the app open; STT results are saved separately.')}
          </Text>
          {sttReport ? (
            <Text style={styles.small}>
              STT: {sttReport.status} · {sttReport.arms.filter((arm) => arm.status === 'complete').length}/6 · {sttReport.id}
              {sttReport.nativeReadinessDiagnostics === 'not-reported' ? `\n${t('Ten build nie raportuje szczegółowych statusów zasobów Analyzer.', 'This build does not report detailed Analyzer asset statuses.')}` : ''}
              {sttReport.arms.map((arm) => `\n${arm.pass}/${arm.windowDurationMs / 1000}s: ${(arm.nativeRequestWallMs / 1000).toFixed(2)}s · WER ${arm.quality?.wordErrorRate === undefined || arm.quality.wordErrorRate === null ? '—' : (arm.quality.wordErrorRate * 100).toFixed(2) + '%'} · ${arm.status}`).join('')}
            </Text>
          ) : null}
          {BENCHMARK_AUDIO_FIXTURES.map((fixture) => (
            <Button
              key={fixture.id}
              disabled={busy}
              title={`${audioFixtureId === fixture.id ? '● ' : ''}${t(`Nagranie ${fixture.nominalMinutes} min`, `${fixture.nominalMinutes} min recording`)}`}
              onPress={() => setAudioFixtureId(fixture.id)}
            />
          ))}
          {selectedAudio ? (
            <Text style={styles.small}>
              {Math.floor(selectedAudio.durationMs / 60000)}:{String(Math.floor(selectedAudio.durationMs / 1000) % 60).padStart(2, '0')} ·{' '}
              {selectedAudio.referenceTranscript.trim().split(/\s+/).length} {t('słów', 'words')}
            </Text>
          ) : null}
          <Text style={styles.copy}>
            {t(
              'Gotowe syntetyczne nagrania po angielsku są w aplikacji i nie wymagają pobierania ani dyktowania. Test wykonuje zimny start i jedno ciepłe powtórzenie Qwen3; za każdym razem rozpoznaje całe audio od nowa lokalnie w en-US. Wybierz długość, uruchom test i zostaw aplikację otwartą. Wyniki przetwarzania zapiszą się automatycznie; problemy pokażą się na ekranie.',
              'Ready-made synthetic English recordings are included in the app and need no download or dictation. The test performs a Qwen3 cold start and one warm repeat; each recognizes the complete audio afresh on-device in en-US. Choose a duration, start the test and leave the app open. Processing results are saved automatically; problems appear on screen.',
            )}
          </Text>
        </>
      )}
      <Button
        disabled={
          busy || !modelsReady || (inputMode === 'text' && !source.trim())
        }
        title={
          inputMode === 'audio'
            ? t('Uruchom test audio po angielsku', 'Run English audio test')
            : t('Uruchom wybrane warianty', 'Run selected arms')
        }
        onPress={start}
      />
      {!busy && !modelsReady ? (
        <Text style={styles.copy}>
          {t(
            'Nie wszystkie modele wybranych wariantów są gotowe. Sprawdź ich dostępność powyżej.',
            'The selected arms require their matching model files. Check their availability above.',
          )}
        </Text>
      ) : null}
      {!busy && inputMode === 'text' && !source.trim() ? (
        <Text style={styles.copy}>
          {t(
            'Wybierz próbkę lub wpisz tekst źródłowy do testu.',
            'Select a sample or enter source text for the test.',
          )}
        </Text>
      ) : null}
      {busy ? (
        <>
          <Text style={styles.copy}>{status}</Text>
          <Button
            color="#B91C1C"
            title={t('Anuluj', 'Cancel')}
            onPress={() => controller.current?.abort()}
          />
        </>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        disabled={busy}
        title={t(
          'Eksportuj wszystkie wyniki i źródła',
          'Export all results and sources',
        )}
        onPress={() =>
          void perform(async () => {
            await shareBenchmarkRuns()
          })
        }
      />
      <Text style={styles.heading}>
        {t('Wyniki na tym urządzeniu', 'Results on this device')}
      </Text>
      <Text style={styles.small}>
        {t(
          'Całość obejmuje STT w trybie audio, ładowanie modelu, cały pipeline LLM i pierwszy zapis wyniku. Pobieranie, pytanie o uprawnienie i weryfikacja SHA-256 są poza tym czasem. Weryfikacja jest osobnym kosztem eksportowanej sesji. Ręczna ocena jakości nie jest automatycznym wynikiem.',
          'Total includes STT in audio mode, model loading, the full LLM pipeline and the first saved result. Downloading, permission prompts and SHA-256 verification are outside this timer. Verification is a separate exported suite cost. Quality ratings are manual.',
        )}
      </Text>
      {runs.slice(0, 30).map((run) => (
        <View style={styles.card} key={run.id}>
          <Text style={styles.heading}>
            {run.arm} · {run.condition} ·{' '}
            {run.error
              ? t('błąd', 'failed')
              : run.output?.warnings.length
                ? t('wynik do sprawdzenia', 'review needed')
                : run.succeeded
                  ? t('zakończono', 'completed')
                  : t('niepełny', 'incomplete')}
          </Text>
          <Text style={styles.small}>
            {run.environment.deviceLabel} ·{' '}
            {run.environment.deviceLabelSource === 'automatic'
              ? t('automatycznie', 'automatic')
              : t('wpisano ręcznie', 'user supplied')}{' '}
            · {run.environment.gpu ? 'GPU' : 'CPU'} · {run.language} ·{' '}
            {run.wordCount} {t('słów', 'words')}
          </Text>
          <Text>
            {t('Całość', 'Total')}: {(run.totalMs / 1000).toFixed(2)} s ·{' '}
            {t('Ładowanie', 'Load')}: {(run.modelLoadMs / 1000).toFixed(2)} s
          </Text>
          {run.inputMode === 'audio' && run.audio ? (
            <>
              <Text>
                STT {((run.sttMs ?? run.audio.sttMs) / 1000).toFixed(2)} s · LLM{' '}
                {((run.llmMs ?? run.processingMs) / 1000).toFixed(2)} s ·{' '}
                {run.audio.durationMs === null
                  ? '—'
                  : (run.audio.durationMs / 1000).toFixed(2)}{' '}
                s audio · {run.audio.locale} ·{' '}
                {t('wymaga on-device', 'on-device required')}
              </Text>
              {run.audio.speechBackend === 'analyzer-if-installed' && run.audio.recognizerFallback ? (
                <Text style={styles.small}>
                  {t(
                    'SpeechAnalyzer był niedostępny dla części lub całości próby; użyto bieżącego rozpoznawania. Szczegóły są w eksporcie.',
                    'SpeechAnalyzer was unavailable for some or all of this attempt; the current recognizer was used. Details are in the export.',
                  )}
                </Text>
              ) : null}
            </>
          ) : null}
          <Text>
            Prefill {(run.prefillMs / 1000).toFixed(2)} s · decode{' '}
            {(run.decodeMs / 1000).toFixed(2)} s · draft{' '}
            {run.draftTokensAccepted ?? '—'} / {run.draftTokens ?? '—'}
          </Text>
          {run.output ? (
            <>
              <Text style={styles.heading}>{run.output.title}</Text>
              <Text>{run.output.summary}</Text>
              <Text>{run.output.tasks.join('\n')}</Text>
              {run.output.warnings.map((warning) => (
                <Text key={warning} style={styles.error}>
                  {warning}
                </Text>
              ))}
            </>
          ) : null}
          {run.error ? <Text style={styles.error}>{run.error}</Text> : null}
          <Button disabled={busy} title={detailId === run.id
            ? t('Ukryj źródła', 'Hide sources')
            : t('Pokaż źródła', 'Show sources')}
            onPress={() => { void showDetails(run.id) }} />
          {detailId === run.id ? detailError
            ? <Text style={styles.error}>{detailError}</Text>
            : detailRun === null
              ? <Text style={styles.small}>{t('Wczytywanie źródeł…', 'Loading sources…')}</Text>
              : detailRun.audio ? <>
                <Text style={styles.heading}>{t('Transkrypcja STT', 'STT transcript')}</Text>
                <Text>{detailRun.audio.transcript || t('(pusta)', '(empty)')}</Text>
                <Text style={styles.heading}>{t('Tekst referencyjny', 'Reference transcript')}</Text>
                <Text style={styles.small}>{detailRun.audio.referenceTranscript}</Text>
              </> : <>
                <Text style={styles.heading}>{t('Tekst źródłowy', 'Source text')}</Text>
                <Text>{detailRun.source || t('(pusty)', '(empty)')}</Text>
              </> : null}
          {(
            ['faithfulSummary', 'completeTasks', 'acceptableLanguage'] as const
          ).map((key) => (
            <Button
              disabled={busy}
              key={key}
              title={`${key === 'faithfulSummary' ? t('Wierność podsumowania', 'Summary faithfulness') : key === 'completeTasks' ? t('Kompletność zadań', 'Task completeness') : t('Jakość języka', 'Language quality')}: ${run.assessment[key] === null ? '—' : run.assessment[key] ? t('Tak', 'Yes') : t('Nie', 'No')}`}
              onPress={() => void assess(run, key)}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  )
}
const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { padding: 16, gap: 12, paddingBottom: 48 },
    heading: { fontSize: 16, fontWeight: '700' },
    copy: { fontSize: 14, lineHeight: 21 },
    small: { fontSize: 12, lineHeight: 18, color: colors.muted },
    card: {
      padding: 12,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.paper,
      borderRadius: 14,
    },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.paper,
      color: colors.ink,
      borderRadius: 8,
      padding: 10,
    },
    source: { height: 160, textAlignVertical: 'top' },
    error: { color: colors.danger, fontSize: 13 },
  })
