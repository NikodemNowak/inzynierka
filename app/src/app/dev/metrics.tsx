import { useCallback, useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  clearMetrics,
  listMetrics,
  type GenerationMetric,
} from '../../data/metricsRepository'
import { summarizeByPhase } from '../../ai/metricsSummary'

// Success criteria stated in the thesis proposal: first token under two seconds,
// generation above ten tokens per second.
const TTFT_TARGET_MS = 2000
const TOKENS_TARGET = 10

const formatTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })

export default function MetricsScreen() {
  const [metrics, setMetrics] = useState<GenerationMetric[]>([])

  const reload = useCallback(async () => {
    setMetrics(await listMetrics())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const summaries = summarizeByPhase(metrics)

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Wydajność modelu' }} />

      {metrics.length === 0 ? (
        <Text style={styles.empty}>
          Brak pomiarów. Przetwórz notatkę przez LLM, aby je zebrać.
        </Text>
      ) : (
        <>
          <Text style={styles.heading}>Mediany wg fazy ({metrics.length} pomiarów)</Text>
          {summaries.map((summary) => {
            const ttftOk = summary.medianTtftMs <= TTFT_TARGET_MS
            const speedOk = summary.medianTokensPerSecond >= TOKENS_TARGET
            return (
              <View key={summary.phase} style={styles.card}>
                <Text style={styles.phase}>
                  {summary.phase} · {summary.runs}×
                </Text>
                <Text style={ttftOk ? styles.ok : styles.bad}>
                  TTFT {summary.medianTtftMs} ms (najgorszy {summary.worstTtftMs} ms) · próg{' '}
                  {TTFT_TARGET_MS} ms
                </Text>
                <Text style={speedOk ? styles.ok : styles.bad}>
                  {summary.medianTokensPerSecond} tok/s (najgorszy{' '}
                  {summary.worstTokensPerSecond}) · próg {TOKENS_TARGET}
                </Text>
              </View>
            )
          })}

          <Text style={styles.heading}>Ostatnie pomiary</Text>
          {metrics.slice(0, 30).map((metric) => (
            <Text key={metric.id} style={styles.row}>
              {formatTime(metric.createdAt)} · {metric.phase} · {metric.inputChars} zn. ·{' '}
              {metric.ttftMs} ms · {metric.tokensPerSecond.toFixed(2)} tok/s
            </Text>
          ))}
        </>
      )}

      <Button title="Odśwież" onPress={() => void reload()} />
      <Button
        title="Wyczyść pomiary"
        color="#B91C1C"
        onPress={() => void clearMetrics().then(reload)}
      />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10 },
  heading: { fontSize: 16, fontWeight: '700', color: '#111827', marginTop: 8 },
  empty: { fontSize: 15, color: '#6B7280' },
  card: {
    gap: 3,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  phase: { fontSize: 15, fontWeight: '600', color: '#111827' },
  ok: { fontSize: 13, color: '#2E7D32' },
  bad: { fontSize: 13, color: '#B45309' },
  row: { fontSize: 12, color: '#4B5563', fontFamily: 'monospace' },
})
