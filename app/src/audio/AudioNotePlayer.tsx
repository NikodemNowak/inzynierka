import { useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { colors, radius, spacing, type } from '../ui/theme'

type Props = {
  uri: string
  durationMs: number | null
}

const playbackRates = [0.75, 1, 1.25, 1.5, 2] as const

export const formatAudioTime = (seconds: number): string => {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

export function AudioNotePlayer({ uri, durationMs }: Props) {
  const player = useAudioPlayer({ uri }, { updateInterval: 250 })
  const status = useAudioPlayerStatus(player)
  const [scrubberWidth, setScrubberWidth] = useState(0)
  const [playbackError, setPlaybackError] = useState<string | null>(null)

  const durationSeconds = status.duration > 0 ? status.duration : (durationMs ?? 0) / 1000
  const currentSeconds = Math.min(status.currentTime, durationSeconds || status.currentTime)
  const progress = durationSeconds > 0 ? currentSeconds / durationSeconds : 0
  const activeRate = status.playbackRate || 1

  const togglePlayback = async () => {
    if (status.playing) {
      player.pause()
      return
    }
    setPlaybackError(null)
    try {
      // Restore speaker playback after speech recognition used the shared session.
      if (Platform.OS === 'ios') {
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
      }
      if (status.didJustFinish) await player.seekTo(0)
      player.play()
    } catch (error) {
      setPlaybackError(error instanceof Error ? error.message : String(error))
    }
  }

  const seekToPosition = (locationX: number) => {
    if (scrubberWidth <= 0 || durationSeconds <= 0) return
    const ratio = Math.max(0, Math.min(1, locationX / scrubberWidth))
    void player.seekTo(durationSeconds * ratio)
  }

  const seekBy = (seconds: number) => {
    if (durationSeconds <= 0) return
    void player.seekTo(Math.max(0, Math.min(durationSeconds, currentSeconds + seconds)))
  }

  const setRate = (rate: number) => {
    player.setPlaybackRate(rate)
  }

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pauza' : 'Odtwórz'}
          onPress={() => void togglePlayback()}
          style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
        >
          <Text style={styles.playButtonText}>{status.playing ? 'Pauza' : 'Odtwórz'}</Text>
        </Pressable>
        <Text style={styles.timeText}>
          {formatAudioTime(currentSeconds)} / {formatAudioTime(durationSeconds)}
        </Text>
      </View>
      {(playbackError || status.error) && (
        <Text style={styles.error}>{playbackError || status.error}</Text>
      )}

      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel="Pozycja nagrania"
        accessibilityValue={{
          min: 0,
          max: Math.max(1, Math.floor(durationSeconds)),
          now: Math.floor(currentSeconds),
        }}
        accessibilityActions={[
          { name: 'increment', label: 'Przewiń o 10 sekund' },
          { name: 'decrement', label: 'Cofnij o 10 sekund' },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') seekBy(10)
          if (event.nativeEvent.actionName === 'decrement') seekBy(-10)
        }}
        onLayout={(event) => setScrubberWidth(event.nativeEvent.layout.width)}
        onPress={(event) => seekToPosition(event.nativeEvent.locationX)}
        style={styles.scrubber}
      >
        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${Math.min(100, Math.max(0, progress * 100))}%` }]} />
        </View>
      </Pressable>

      <View style={styles.rateRow}>
        {playbackRates.map((rate) => {
          const active = Math.abs(activeRate - rate) < 0.01
          return (
            <Pressable
              key={rate}
              accessibilityRole="button"
              accessibilityLabel={`Prędkość ${rate}x`}
              accessibilityState={{ selected: active }}
              onPress={() => setRate(rate)}
              style={({ pressed }) => [
                styles.rateButton,
                active && styles.rateButtonActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.rateText, active && styles.rateTextActive]}>
                {rate}x
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  playButton: {
    backgroundColor: colors.navy,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonText: { ...type.label, color: colors.paper },
  timeText: { ...type.meta, color: colors.body, fontSize: 13 },
  error: { ...type.meta, color: colors.danger },
  scrubber: { height: 44, justifyContent: 'center' },
  track: { height: 6, backgroundColor: colors.line, borderRadius: radius.pill, overflow: 'hidden' },
  trackFill: { height: '100%', backgroundColor: colors.navy },
  rateRow: { flexDirection: 'row', gap: spacing.sm },
  rateButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.paper,
  },
  rateButtonActive: {
    backgroundColor: colors.navySoft,
    borderColor: colors.navy,
  },
  rateText: { ...type.meta, color: colors.muted, fontSize: 12 },
  rateTextActive: { color: colors.navy },
  pressed: { opacity: 0.75 },
})
