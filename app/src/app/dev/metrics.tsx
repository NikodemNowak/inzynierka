import { useCallback, useEffect, useState } from 'react'
import { Stack, router } from 'expo-router'
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native'
import {
  clearMetrics,
  listMetrics,
  listLlmOperations,
  type GenerationMetric,
  type LlmOperationMetric,
} from '../../data/metricsRepository'
import { summarizeByPhase } from '../../ai/metricsSummary'
import { useI18n } from '../../i18n/useI18n'

const formatTime = (ms: number, locale: string): string =>
  new Date(ms).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  })

export default function MetricsScreen() {
  const { t, locale } = useI18n()
  const [metrics, setMetrics] = useState<GenerationMetric[]>([])
  const [operations, setOperations] = useState<LlmOperationMetric[]>([])

  const reload = useCallback(async () => {
    const [samples, wholeOperations] = await Promise.all([
      listMetrics(),
      listLlmOperations(),
    ])
    setMetrics(samples)
    setOperations(wholeOperations)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const summaries = summarizeByPhase(metrics)

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{ title: t('Wydajność modelu', 'Model performance') }}
      />
      <Button
        title={t('Porównanie Qwen / MTP', 'Qwen / MTP comparison')}
        onPress={() => router.push('/dev/benchmark')}
      />
      <Text style={styles.heading}>
        {t('Całe operacje', 'Whole operations')}
      </Text>
      <Text style={styles.empty}>
        {t(
          'Czas od akcji do zakończenia zapisu, z oczekiwaniem w kolejce i ładowaniem. Niepełne i błędne wyniki są oznaczone osobno. Model i profil pochodzą z rzeczywistego kontekstu.',
          'Time from action to completed save, including queue wait and loading. Incomplete and failed operations are labelled separately. Model and profile come from the actual context.',
        )}
      </Text>
      {operations.slice(0, 30).map((operation) => (
        <View style={styles.card} key={operation.id}>
          <Text style={styles.phase}>
            {operation.operation} · {operation.model} ·{' '}
            {operation.succeeded
              ? t('ukończona', 'completed')
              : t('niepełna / błąd', 'incomplete / failed')}
          </Text>
          <Text style={styles.row}>
            {operation.metadata?.execution ?? 'unknown'} ·{' '}
            {operation.modelLoadMs === null ? 'warm' : 'cold'} ·{' '}
            {operation.inputChars} {t('zn.', 'chars')}
          </Text>
          <Text style={styles.row}>
            {t('Całość', 'Total')} {(operation.totalMs / 1000).toFixed(2)} s ·{' '}
            {t('kolejka', 'queue')} {operation.queueMs} ms ·{' '}
            {t('ładowanie', 'load')} {operation.modelLoadMs ?? 0} ms
          </Text>
        </View>
      ))}

      {metrics.length === 0 ? (
        <Text style={styles.empty}>
          {t(
            'Brak pomiarów. Przetwórz notatkę przez LLM, aby je zebrać.',
            'No measurements yet. Process a note to collect them.',
          )}
        </Text>
      ) : (
        <>
          <Text style={styles.heading}>
            {t(
              `Mediany wg fazy (${metrics.length} pomiarów)`,
              `Medians by stage (${metrics.length} measurements)`,
            )}
          </Text>
          {summaries.map((summary, index) => {
            return (
              <View key={`${summary.phase}-${index}`} style={styles.card}>
                <Text style={styles.phase}>
                  {summary.phase} · {summary.runs}×
                </Text>
                <Text style={styles.row}>
                  {summary.model} · {summary.execution} · {summary.backend} ·
                  MTP {String(summary.speculative ?? 'unknown')} ·{' '}
                  {summary.status}
                </Text>
                <Text style={styles.row}>
                  TTFT {summary.medianTtftMs} ms ({t('najgorszy', 'worst')}{' '}
                  {summary.worstTtftMs} ms)
                </Text>
                <Text style={styles.row}>
                  {summary.medianTokensPerSecond} tok/s (
                  {t('najgorszy', 'worst')} {summary.worstTokensPerSecond})
                </Text>
              </View>
            )
          })}

          <Text style={styles.heading}>
            {t('Ostatnie pomiary', 'Recent measurements')}
          </Text>
          {metrics.slice(0, 30).map((metric) => (
            <Text key={metric.id} style={styles.row}>
              {formatTime(metric.createdAt, locale)} · {metric.phase} ·{' '}
              {metric.inputChars} {t('zn.', 'chars')} · {metric.ttftMs} ms ·{' '}
              {metric.tokensPerSecond.toFixed(2)} tok/s
            </Text>
          ))}
        </>
      )}

      <Button title={t('Odśwież', 'Refresh')} onPress={() => void reload()} />
      <Button
        title={t('Wyczyść pomiary', 'Clear measurements')}
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
