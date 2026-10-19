import { useI18n } from '../i18n/useI18n'
import { useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio'
import { Icon } from '../ui/Icon'
import { useTheme, fonts } from '../ui/theme'
import { nextPlaybackRate, type PlaybackRate } from './playbackRate'
import { nativeCapture } from '../stt/nativeCapture'

type Props = { uri: string; durationMs: number | null }
export const formatAudioTime = (seconds: number): string => {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, '0')}`
}
export function AudioNotePlayer({ uri, durationMs }: Props) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const player = useAudioPlayer({ uri }, { updateInterval: 250 })
  const status = useAudioPlayerStatus(player)
  const [selectedRate, setSelectedRate] = useState<PlaybackRate>(1)
  const [scrubberWidth, setScrubberWidth] = useState(0)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const durationSeconds =
    status.duration > 0 ? status.duration : (durationMs ?? 0) / 1000
  const currentSeconds = Math.min(
    status.currentTime,
    durationSeconds || status.currentTime,
  )
  const progress =
    durationSeconds > 0
      ? Math.min(1, Math.max(0, currentSeconds / durationSeconds))
      : 0
  const activeRate = selectedRate
  const handleError = (error: unknown) =>
    setPlaybackError(error instanceof Error ? error.message : String(error))
  const togglePlayback = async () => {
    try {
      if (status.playing) {
        player.pause()
        return
      }
      setPlaybackError(null)
      const capture = await nativeCapture?.getSnapshot()
      if (capture?.manifest.state === 'recording') {
        setPlaybackError(
          t(
            'Odtwarzanie jest dostępne po zatrzymaniu mikrofonu.',
            'Playback is available after stopping the microphone.',
          ),
        )
        return
      }
      // Required after recording: restore the shared iOS session to speaker playback.
      if (Platform.OS === 'ios')
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        })
      if (status.didJustFinish) await player.seekTo(0)
      player.setPlaybackRate(selectedRate)
      player.play()
    } catch (error) {
      handleError(error)
    }
  }
  const seek = async (seconds: number) => {
    if (durationSeconds <= 0) return
    try {
      await player.seekTo(Math.max(0, Math.min(durationSeconds, seconds)))
    } catch (error) {
      handleError(error)
    }
  }
  const cycleRate = () => {
    try {
      const nextRate = nextPlaybackRate(selectedRate)
      player.setPlaybackRate(nextRate)
      setSelectedRate(nextRate)
    } catch (error) {
      handleError(error)
    }
  }
  const chip = {
    minHeight: 32,
    minWidth: 44,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  }
  return (
    <View
      style={{
        backgroundColor: colors.paper,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: colors.line,
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            status.playing
              ? t('Pauza', 'Pause')
              : t('Odtwórz nagranie', 'Play recording')
          }
          onPress={() => void togglePlayback()}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: colors.brand,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scale: pressed ? 0.94 : 1 }],
          })}
        >
          <Icon
            name={status.playing ? 'pause' : 'play'}
            color={colors.onBrand}
            size={20}
          />
        </Pressable>
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel={t('Pozycja nagrania', 'Recording position')}
          accessibilityValue={{
            min: 0,
            max: Math.max(1, Math.floor(durationSeconds)),
            now: Math.floor(currentSeconds),
          }}
          accessibilityActions={[
            {
              name: 'increment',
              label: t('Przewiń o 10 sekund', 'Skip forward 10 seconds'),
            },
            {
              name: 'decrement',
              label: t('Cofnij o 10 sekund', 'Skip back 10 seconds'),
            },
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment')
              void seek(currentSeconds + 10)
            if (event.nativeEvent.actionName === 'decrement')
              void seek(currentSeconds - 10)
          }}
          onLayout={(event) =>
            setScrubberWidth(event.nativeEvent.layout.width)
          }
          onPress={(event) => {
            if (scrubberWidth > 0)
              void seek(
                (durationSeconds * event.nativeEvent.locationX) /
                  scrubberWidth,
              )
          }}
          style={{ flex: 1, minHeight: 44, justifyContent: 'center' }}
        >
          {/* Played time is a highlighter stroke across the recording. */}
          <View style={{ height: 12, borderRadius: 3, backgroundColor: colors.surface, overflow: 'hidden' }}>
            <View
              style={{
                width: `${progress * 100}%`,
                height: 12,
                backgroundColor: colors.marker,
                borderTopRightRadius: 6,
                borderBottomRightRadius: 2,
              }}
            />
          </View>
          <View
            style={{
              position: 'absolute',
              left: Math.max(0, progress * scrubberWidth - 1),
              top: 8,
              bottom: 8,
              width: 2,
              borderRadius: 1,
              backgroundColor: colors.ink,
            }}
          />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 56 }}>
        <Text
          style={{
            flex: 1,
            fontSize: 12,
            lineHeight: 17,
            fontFamily: fonts.medium,
            color: colors.muted,
            fontVariant: ['tabular-nums'],
          }}
        >
          {formatAudioTime(currentSeconds)} / {formatAudioTime(durationSeconds)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Cofnij o 10 sekund', 'Skip back 10 seconds')}
          onPress={() => void seek(currentSeconds - 10)}
          style={({ pressed }) => [chip, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={{ color: colors.ink, fontSize: 12, fontFamily: fonts.semibold }}>−10 s</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            `Prędkość ${activeRate}. Dotknij, aby zmienić`,
            `Speed ${activeRate}. Tap to change`,
          )}
          onPress={cycleRate}
          style={({ pressed }) => [chip, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={{ color: colors.ink, fontSize: 12, fontFamily: fonts.semibold }}>
            {activeRate}×
          </Text>
        </Pressable>
      </View>
      {(playbackError || status.error) && (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.danger, fontSize: 13, lineHeight: 19 }}
        >
          {playbackError || status.error}
        </Text>
      )}
    </View>
  )
}
