import { useRef, useState } from 'react'
import { Button, Text, View } from 'react-native'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { useI18n } from '../i18n/useI18n'
import { type, useTheme } from '../ui/theme'
import { runFullFlowSuite, type SuiteProgress } from './fullFlowSuite'

const WAKE_TAG = 'full-flow-suite'

// The whole app in one run: recordings → transcript → note → questions.
export function FullFlowSuiteCard() {
  const { t } = useI18n()
  const { colors } = useTheme()
  const [progress, setProgress] = useState<SuiteProgress | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const running = controller.current !== null && progress?.step !== 'done'

  const start = async (): Promise<void> => {
    controller.current = new AbortController()
    setMessage(null)
    const started = Date.now()
    await activateKeepAwakeAsync(WAKE_TAG).catch(() => undefined)
    try {
      const path = await runFullFlowSuite(setProgress, controller.current.signal)
      setMessage(t(`Gotowe w ${Math.round((Date.now() - started) / 60000)} min. Zapisano: ${path.split('/').pop()}`, `Done in ${Math.round((Date.now() - started) / 60000)} min. Saved: ${path.split('/').pop()}`))
    } catch (error) {
      setMessage(String(error))
    } finally {
      await deactivateKeepAwake(WAKE_TAG).catch(() => undefined)
      controller.current = null
      setProgress(null)
    }
  }

  return (
    <View style={{ gap: 8, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper }}>
      <Text style={[type.title, { color: colors.ink }]}>{t('Pakiet całościowy', 'Full-flow suite')}</Text>
      <Text style={[type.meta, { color: colors.body }]}>
        {t(
          'Trzy syntetyczne nagrania (PL, PL, EN) → transkrypcja na telefonie → tytuł, streszczenie, zadania → około 30 pytań do notatek (z wektorami, jeśli model wyszukiwania jest pobrany) → czas wyszukiwania w roku notatek. Twoje notatki nie są zmieniane. Ok. 10–15 min, zostaw aplikację otwartą.',
          'Three synthetic recordings (PL, PL, EN) → on-device transcription → title, summary, tasks → about 30 questions to the notes (with vectors if the search model is downloaded) → search time over a year of notes. Your notes are not changed. About 10–15 min; keep the app open.',
        )}
      </Text>
      {progress ? (
        <Text style={[type.meta, { color: colors.muted }]}>{`${progress.done}/${progress.total} · ${progress.step}`}</Text>
      ) : null}
      {message ? <Text selectable style={[type.meta, { color: colors.ink }]}>{message}</Text> : null}
      {running ? (
        <Button title={t('Zatrzymaj', 'Stop')} onPress={() => controller.current?.abort()} />
      ) : (
        <Button title={t('Uruchom pakiet', 'Run the suite')} onPress={() => void start()} />
      )}
    </View>
  )
}
