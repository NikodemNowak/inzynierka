import { useState } from 'react'
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Stack } from 'expo-router'
import { downloadModel, getModelPath, isModelDownloaded } from '../../ai/modelDownload'
import { generate, isModelLoaded, loadModel } from '../../ai/llm'

type Phase = 'idle' | 'downloading' | 'loading' | 'ready' | 'generating'

export default function PocScreen() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [downloadPercent, setDownloadPercent] = useState(0)
  const [loadPercent, setLoadPercent] = useState(0)
  const [prompt, setPrompt] = useState('Napisz krótkie powitanie.')
  const [output, setOutput] = useState('')
  const [ttftMs, setTtftMs] = useState<number | null>(null)
  const [tokensPerSecond, setTokensPerSecond] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const prepare = async () => {
    setError(null)
    try {
      setPhase('downloading')
      if (await isModelDownloaded()) {
        setDownloadPercent(100)
      } else {
        await downloadModel(setDownloadPercent)
      }
      setPhase('loading')
      await loadModel(getModelPath(), setLoadPercent)
      setPhase('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }

  const run = async () => {
    setError(null)
    setOutput('')
    setTtftMs(null)
    setTokensPerSecond(null)
    setPhase('generating')
    try {
      let accumulated = ''
      const result = await generate(prompt, (token) => {
        accumulated += token
        setOutput(accumulated)
      })
      setTtftMs(result.ttftMs)
      setTokensPerSecond(result.tokensPerSecond)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPhase('ready')
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'POC LLM' }} />
      <Text style={styles.subtitle}>Qwen3-0.6B Q4_K_M · CPU</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      {phase === 'idle' && <Button title="Przygotuj model" onPress={prepare} />}
      {phase === 'downloading' && (
        <Text style={styles.status}>Pobieranie modelu: {downloadPercent.toFixed(0)}%</Text>
      )}
      {phase === 'loading' && (
        <Text style={styles.status}>Ładowanie do pamięci: {loadPercent.toFixed(0)}%</Text>
      )}

      {(phase === 'ready' || phase === 'generating') && (
        <View style={styles.block}>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            multiline
            style={styles.input}
            editable={phase === 'ready'}
          />
          <Button title="Generuj" onPress={run} disabled={phase === 'generating' || !isModelLoaded()} />
          {phase === 'generating' && <ActivityIndicator style={styles.spinner} />}
          {output.length > 0 && (
            <Text selectable style={styles.output}>
              {output}
            </Text>
          )}
          {ttftMs !== null && <Text style={styles.metric}>TTFT: {ttftMs} ms</Text>}
          {tokensPerSecond !== null && (
            <Text style={styles.metric}>Prędkość: {tokensPerSecond.toFixed(2)} tok/s</Text>
          )}
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  subtitle: { fontSize: 13, color: '#666' },
  status: { fontSize: 16 },
  block: { gap: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 10,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  spinner: { marginVertical: 4 },
  output: { fontSize: 16, lineHeight: 22 },
  metric: { fontSize: 14, color: '#1F4E79', fontWeight: '500' },
  error: { color: '#B91C1C', fontSize: 14 },
})
