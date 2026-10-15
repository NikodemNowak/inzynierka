import { useState } from 'react'
import {
  Button,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Stack } from 'expo-router'
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition'
import { useI18n } from '../../i18n/useI18n'
import { localeForLanguage } from '../../i18n/language'
import { useSettingsStore } from '../../state/settingsStore'
import { LanguagePicker } from '../../ui/LanguagePicker'

const ANDROID_SERVICE = 'com.google.android.googlequicksearchbox'

type Capabilities = {
  recognitionAvailable: boolean
  onDeviceSupported: boolean
  recordingSupported: boolean
}

type LocaleInfo = {
  locales: string[]
  installedLocales: string[]
  plSupported: boolean
  plInstalled: boolean
}

export default function SttProbeScreen() {
  const { t, locale } = useI18n()
  const defaultLanguage = useSettingsStore((state) => state.noteLanguage)
  const [language, setLanguage] = useState(defaultLanguage)
  const speechLocale = localeForLanguage(language)
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [localeInfo, setLocaleInfo] = useState<LocaleInfo | null>(null)
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null)
  const [recognizing, setRecognizing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [log, setLog] = useState<string[]>([])

  const append = (line: string) =>
    setLog((prev) => [
      `${new Date().toLocaleTimeString(locale)}  ${line}`,
      ...prev,
    ])

  useSpeechRecognitionEvent('start', () => {
    setRecognizing(true)
    append('event: start')
  })
  useSpeechRecognitionEvent('end', () => {
    setRecognizing(false)
    append('event: end')
  })
  useSpeechRecognitionEvent('result', (event) => {
    const best = event.results[0]?.transcript ?? ''
    setTranscript(best)
    append(`result (isFinal=${event.isFinal}): "${best}"`)
  })
  useSpeechRecognitionEvent('error', (event) => {
    append(`ERROR [${event.error}]: ${event.message}`)
  })
  useSpeechRecognitionEvent('audioend', (event) => {
    append(`audioend uri: ${event.uri ?? '(none)'}`)
  })

  const checkCapabilities = () => {
    try {
      const next: Capabilities = {
        recognitionAvailable:
          ExpoSpeechRecognitionModule.isRecognitionAvailable(),
        onDeviceSupported:
          Platform.OS === 'ios'
            ? ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(
                speechLocale,
              )
            : ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
        recordingSupported: ExpoSpeechRecognitionModule.supportsRecording(),
      }
      setCaps(next)
      append(
        `caps: recognition=${next.recognitionAvailable} onDevice=${next.onDeviceSupported} recording=${next.recordingSupported}`,
      )
    } catch (e) {
      append(`caps FAILED: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const checkLocales = async () => {
    try {
      const result = await ExpoSpeechRecognitionModule.getSupportedLocales({
        androidRecognitionServicePackage: ANDROID_SERVICE,
      })
      const locales = result.locales ?? []
      const installedLocales = result.installedLocales ?? []
      const info: LocaleInfo = {
        locales,
        installedLocales,
        plSupported: locales.some(
          (l) =>
            l.toLowerCase().replace('_', '-') === speechLocale.toLowerCase(),
        ),
        plInstalled: installedLocales.some(
          (l) =>
            l.toLowerCase().replace('_', '-') === speechLocale.toLowerCase(),
        ),
      }
      setLocaleInfo(info)
      append(
        `locales: ${locales.length} total, ${installedLocales.length} listed as installed | ${speechLocale} supported=${info.plSupported} listed=${info.plInstalled}`,
      )
    } catch (e) {
      append(
        `getSupportedLocales FAILED: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  const downloadModel = async () => {
    if (Platform.OS !== 'android') {
      append('androidTriggerOfflineModelDownload: Android only')
      return
    }
    setDownloadStatus(t('pobieranie…', 'downloading…'))
    try {
      const result =
        await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({
          locale: speechLocale,
        })
      setDownloadStatus(result.status)
      append(`offline model download: ${result.status}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setDownloadStatus(`${t('błąd', 'error')}: ${msg}`)
      append(`offline model download FAILED: ${msg}`)
    }
  }

  const startLive = async () => {
    setTranscript('')
    const permission =
      await ExpoSpeechRecognitionModule.requestPermissionsAsync()
    if (!permission.granted) {
      append(`Permission denied: ${permission.status}`)
      return
    }
    try {
      ExpoSpeechRecognitionModule.start({
        lang: speechLocale,
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: true,
        addsPunctuation: true,
      })
      append(`start() called (on-device, ${speechLocale})`)
    } catch (e) {
      append(`start FAILED: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const stopLive = () => {
    ExpoSpeechRecognitionModule.stop()
    append('stop() called')
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'STT probe' }} />
      <Text style={styles.subtitle}>
        {t('Diagnostyka on-device', 'On-device diagnostics')} {speechLocale} ·{' '}
        {Platform.OS}
      </Text>
      <LanguagePicker
        value={language}
        onChange={(next) => {
          setLanguage(next)
          setCaps(null)
          setLocaleInfo(null)
          setDownloadStatus(null)
        }}
        disabled={recognizing}
      />

      <View style={styles.block}>
        <Button
          title={t('1. Sprawdź możliwości', '1. Check capabilities')}
          onPress={checkCapabilities}
        />
        {caps && (
          <View style={styles.result}>
            <Text style={row(caps.recognitionAvailable)}>
              recognitionAvailable: {String(caps.recognitionAvailable)}
            </Text>
            <Text style={row(caps.onDeviceSupported)}>
              onDeviceSupported: {String(caps.onDeviceSupported)}
            </Text>
            <Text style={row(caps.recordingSupported)}>
              recordingSupported: {String(caps.recordingSupported)}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.block}>
        <Button
          title={t(
            `2. Sprawdź język (${speechLocale})`,
            `2. Check language (${speechLocale})`,
          )}
          onPress={checkLocales}
        />
        {localeInfo && (
          <View style={styles.result}>
            <Text style={row(localeInfo.plSupported)}>
              {speechLocale} supported: {String(localeInfo.plSupported)}
            </Text>
            <Text style={row(localeInfo.plInstalled)}>
              {speechLocale} listed as installed:{' '}
              {String(localeInfo.plInstalled)}
            </Text>
            <Text style={styles.muted}>
              installed: {localeInfo.installedLocales.join(', ') || '(none)'}
            </Text>
            {Platform.OS === 'ios' && (
              <Text style={styles.muted}>
                {t(
                  'Ta lista nie potwierdza dostępności offline. Sprawdź możliwości i wykonaj próbę w trybie samolotowym.',
                  'This list does not confirm offline availability. Check capabilities and test in airplane mode.',
                )}
              </Text>
            )}
          </View>
        )}
      </View>

      <View style={styles.block}>
        <Button
          title={t(
            `3. Pobierz model offline ${speechLocale}`,
            `3. Download offline model ${speechLocale}`,
          )}
          onPress={downloadModel}
        />
        {downloadStatus && (
          <Text style={styles.muted}>status: {downloadStatus}</Text>
        )}
      </View>

      <View style={styles.block}>
        {!recognizing ? (
          <Button
            title={t(
              `4. Rozpocznij (${speechLocale}, offline)`,
              `4. Start (${speechLocale}, offline)`,
            )}
            onPress={startLive}
          />
        ) : (
          <Button
            title={t('Zatrzymaj', 'Stop')}
            color="#B91C1C"
            onPress={stopLive}
          />
        )}
        {transcript.length > 0 && (
          <Text style={styles.transcript}>{transcript}</Text>
        )}
      </View>

      <View style={styles.block}>
        <Text style={styles.logTitle}>Log</Text>
        {log.map((line, index) => (
          <Text key={`${index}-${line}`} style={styles.logLine} selectable>
            {line}
          </Text>
        ))}
      </View>
    </ScrollView>
  )
}

const row = (ok: boolean) => [styles.resultRow, ok ? styles.ok : styles.bad]

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  subtitle: { fontSize: 13, color: '#666' },
  block: { gap: 8 },
  result: { gap: 2, paddingLeft: 4 },
  resultRow: { fontSize: 14, fontWeight: '600' },
  ok: { color: '#15803D' },
  bad: { color: '#B91C1C' },
  muted: { fontSize: 13, color: '#666' },
  transcript: { fontSize: 18, lineHeight: 24, marginTop: 4 },
  logTitle: { fontSize: 14, fontWeight: '700', marginTop: 8 },
  logLine: {
    fontSize: 12,
    color: '#333',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
})
