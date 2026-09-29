import { useMemo, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { colors, radius, spacing, type } from '../ui/theme'

type Props = {
  uri: string
  durationMs: number | null
}

const playbackRates = [0.75, 1, 1.25, 1.5, 2] as const
const waveformBarCount = 42

export const formatAudioTime = (seconds: number): string => {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

const createWaveformBars = (uri: string): number[] => {
  let seed = 0
  for (let i = 0; i < uri.length; i += 1) {
    seed = (seed + uri.charCodeAt(i) * (i + 1)) % 997
  }

  return Array.from({ length: waveformBarCount }, (_, index) => {
    const value =
      Math.sin((index + 1) * 0.85 + seed) * 0.28 +
      Math.sin((index + 1) * 0.31 + seed * 0.17) * 0.22 +
      0.5
    return Math.max(0.18, Math.min(1, value))
  })
}

export function AudioNotePlayer({ uri, durationMs }: Props) {
  const player = useAudioPlayer({ uri }, { updateInterval: 250 })
  const status = useAudioPlayerStatus(player)
  const [scrubberWidth, setScrubberWidth] = useState(0)
  const [playbackError, setPlaybackError] = useState<string | null>(null)

  const bars = useMemo(() => createWaveformBars(uri), [uri])
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
          <Text style={styles.playButtonText}>{status.playing ? 'Pauza' : 'Play'}</Text>
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
        onLayout={(event) => setScrubberWidth(event.nativeEvent.layout.width)}
        onPress={(event) => seekToPosition(event.nativeEvent.locationX)}
        style={styles.waveform}
      >
        {bars.map((height, index) => {
          const barProgress = (index + 1) / bars.length
          const active = barProgress <= progress
          return (
            <View
              key={`${uri}-${index}`}
              style={[
                styles.waveformBar,
                { height: 10 + height * 34 },
                active ? styles.waveformBarActive : styles.waveformBarInactive,
              ]}
            />
          )
        })}
      </Pressable>

      <View style={styles.rateRow}>
        {playbackRates.map((rate) => {
          const active = Math.abs(activeRate - rate) < 0.01
          return (
            <Pressable
              key={rate}
              accessibilityRole="button"
              accessibilityLabel={`Prędkość ${rate}x`}
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
    paddingVertical: 9,
    minWidth: 76,
    alignItems: 'center',
  },
  playButtonText: { ...type.label, color: colors.paper },
  timeText: { ...type.meta, color: colors.body, fontSize: 13 },
  error: { ...type.meta, color: colors.danger },
  waveform: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  waveformBar: {
    flex: 1,
    borderRadius: 1,
  },
  waveformBarActive: { backgroundColor: colors.navy },
  waveformBarInactive: { backgroundColor: '#D5DBE3' },
  rateRow: { flexDirection: 'row', gap: spacing.sm },
  rateButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: 7,
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
