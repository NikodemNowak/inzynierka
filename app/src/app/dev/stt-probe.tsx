import { useState } from 'react'
import { Button, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack } from 'expo-router'
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition'

const LOCALE = 'pl-PL'
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
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [localeInfo, setLocaleInfo] = useState<LocaleInfo | null>(null)
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null)
  const [recognizing, setRecognizing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [log, setLog] = useState<string[]>([])

  const append = (line: string) =>
    setLog((prev) => [`${new Date().toLocaleTimeString('pl-PL')}  ${line}`, ...prev])

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
    append(`audioend uri: ${event.uri ?? '(brak)'}`)
  })

  const checkCapabilities = () => {
    try {
      const next: Capabilities = {
        recognitionAvailable: ExpoSpeechRecognitionModule.isRecognitionAvailable(),
        onDeviceSupported: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
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
        plSupported: locales.some((l) => l.toLowerCase().startsWith('pl')),
        plInstalled: installedLocales.some((l) => l.toLowerCase().startsWith('pl')),
      }
      setLocaleInfo(info)
      append(
        `locales: ${locales.length} total, ${installedLocales.length} installed | pl supported=${info.plSupported} installed=${info.plInstalled}`,
      )
    } catch (e) {
      append(`getSupportedLocales FAILED: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const downloadModel = async () => {
    if (Platform.OS !== 'android') {
      append('androidTriggerOfflineModelDownload: tylko Android')
      return
    }
    setDownloadStatus('pobieranie…')
    try {
      const result = await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({
        locale: LOCALE,
      })
      setDownloadStatus(result.status)
      append(`offline model download: ${result.status}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setDownloadStatus(`błąd: ${msg}`)
      append(`offline model download FAILED: ${msg}`)
    }
  }

  const startLive = async () => {
    setTranscript('')
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
    if (!permission.granted) {
      append(`brak uprawnień: ${permission.status}`)
      return
    }
    try {
      ExpoSpeechRecognitionModule.start({
        lang: LOCALE,
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: true,
        addsPunctuation: true,
      })
      append('start() wywołane (on-device, pl-PL)')
    } catch (e) {
      append(`start FAILED: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const stopLive = () => {
    ExpoSpeechRecognitionModule.stop()
    append('stop() wywołane')
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'STT probe' }} />
      <Text style={styles.subtitle}>
        Diagnostyka on-device {LOCALE} · {Platform.OS}
      </Text>

      <View style={styles.block}>
        <Button title="1. Sprawdź możliwości" onPress={checkCapabilities} />
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
        <Button title="2. Sprawdź locale (pl-PL?)" onPress={checkLocales} />
        {localeInfo && (
          <View style={styles.result}>
            <Text style={row(localeInfo.plSupported)}>
              pl supported: {String(localeInfo.plSupported)}
            </Text>
            <Text style={row(localeInfo.plInstalled)}>
              pl installed (on-device): {String(localeInfo.plInstalled)}
            </Text>
            <Text style={styles.muted}>
              installed: {localeInfo.installedLocales.join(', ') || '(brak)'}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.block}>
        <Button title="3. Pobierz model offline pl-PL" onPress={downloadModel} />
        {downloadStatus && <Text style={styles.muted}>status: {downloadStatus}</Text>}
      </View>

      <View style={styles.block}>
        {!recognizing ? (
          <Button title="4. Mów po polsku (on-device)" onPress={startLive} />
        ) : (
          <Button title="Zatrzymaj" color="#B91C1C" onPress={stopLive} />
        )}
        {transcript.length > 0 && <Text style={styles.transcript}>{transcript}</Text>}
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
  logLine: { fontSize: 12, color: '#333', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
})
