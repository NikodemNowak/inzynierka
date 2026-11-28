import { useI18n } from '../i18n/useI18n'
import { useImperativeHandle, useState, type Ref } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio'
import { Icon } from '../ui/Icon'
import { useTheme, font, type } from '../ui/theme'
import { nextPlaybackRate, type PlaybackRate } from './playbackRate'
import { formatAudioTime } from './audioTime'
import { nativeCapture } from '../stt/nativeCapture'
import type { AudioTimeline } from '../domain/audioTimeline'

export interface AudioMark {
  readonly startMs: number
  readonly endMs: number
}
export interface AudioNotePlayerHandle {
  playFrom: (ms: number) => void
}
type Props = {
  uri: string
  durationMs: number | null
  // Kept for callers; the pill shows a thin progress bar, not the levels.
  timeline?: AudioTimeline | null
  // Audio windows that summary points were drawn from.
  marks?: readonly AudioMark[]
  ref?: Ref<AudioNotePlayerHandle>
}

export function AudioNotePlayer({ uri, durationMs, marks = [], ref }: Props) {
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
  const totalMs = durationSeconds * 1000
  const handleError = (error: unknown) =>
    setPlaybackError(error instanceof Error ? error.message : String(error))
  const startPlayback = async (fromSeconds?: number) => {
    try {
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
      if (fromSeconds !== undefined) await player.seekTo(Math.max(0, fromSeconds))
      else if (status.didJustFinish) await player.seekTo(0)
      player.setPlaybackRate(selectedRate)
      player.play()
    } catch (error) {
      handleError(error)
    }
  }
  const togglePlayback = async () => {
    if (status.playing) {
      try {
        player.pause()
      } catch (error) {
        handleError(error)
      }
      return
    }
    await startPlayback()
  }
  useImperativeHandle(ref, () => ({
    playFrom: (ms: number) => void startPlayback(ms / 1000),
  }))
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
  // One 44 pt pill: play, thin progress bar, time and speed.
  return (
    <View style={{ gap: 6 }}>
      <View
        style={{
          height: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingLeft: 6,
          paddingRight: 12,
          borderRadius: 22,
          backgroundColor: colors.field,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            status.playing
              ? t('Pauza', 'Pause')
              : t('Odtwórz nagranie', 'Play recording')
          }
          onPress={() => void togglePlayback()}
          hitSlop={6}
          style={({ pressed }) => ({
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Icon
            name={status.playing ? 'pause' : 'play'}
            color={colors.onAccent}
            size={14}
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
          style={{ flex: 1, height: 44, justifyContent: 'center' }}
        >
          <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden' }}>
            {/* Where summary points were spoken. */}
            {totalMs > 0 && marks.map((mark) => (
              <View
                key={`${mark.startMs}:${mark.endMs}`}
                testID="audio-source-mark"
                style={{
                  position: 'absolute',
                  left: (Math.max(0, mark.startMs) / totalMs) * scrubberWidth,
                  width: Math.max(2, ((Math.min(totalMs, mark.endMs) - Math.max(0, mark.startMs)) / totalMs) * scrubberWidth),
                  top: 0,
                  bottom: 0,
                  backgroundColor: colors.accent,
                  opacity: 0.3,
                }}
              />
            ))}
            <View style={{ width: `${progress * 100}%`, height: 4, backgroundColor: colors.accent }} />
          </View>
        </Pressable>
        <Text style={{ ...type.caption, ...font.regular, color: colors.secondary, fontVariant: ['tabular-nums'] }}>
          {formatAudioTime(currentSeconds)} / {formatAudioTime(durationSeconds)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            `Prędkość ${activeRate}. Dotknij, aby zmienić`,
            `Speed ${activeRate}. Tap to change`,
          )}
          onPress={cycleRate}
          hitSlop={10}
          style={({ pressed }) => ({ minWidth: 24, alignItems: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={{ ...type.caption, color: colors.accent, fontVariant: ['tabular-nums'] }}>
            {activeRate}×
          </Text>
        </Pressable>
      </View>
      {(playbackError || status.error) && (
        <Text
          accessibilityLiveRegion="polite"
          style={{ ...type.caption, ...font.regular, color: colors.danger }}
        >
          {playbackError || status.error}
        </Text>
      )}
    </View>
  )
}
