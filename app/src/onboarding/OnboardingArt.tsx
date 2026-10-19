import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, StyleSheet, Text, View } from 'react-native'
import { useI18n } from '../i18n/useI18n'
import { Icon } from '../ui/Icon'
import { fonts, radius, type, useTheme } from '../ui/theme'

export type OnboardingPage = 0 | 1 | 2 | 3 | 4

// One looping 0→1 clock per scene; it stops when the page is not on screen.
const useLoop = (animate: boolean, duration: number): Animated.Value => {
  const value = useRef(new Animated.Value(animate ? 0 : 1)).current
  useEffect(() => {
    if (!animate) { value.setValue(1); return }
    value.setValue(0)
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(value, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }),
      Animated.delay(900),
    ]))
    loop.start()
    return () => loop.stop()
  }, [animate, duration, value])
  return value
}

// 0 before `from`, 1 after `to`, along the loop clock.
const span = (clock: Animated.Value, from: number, to: number) =>
  clock.interpolate({ inputRange: [0, from, to, 1], outputRange: [0, 0, 1, 1], extrapolate: 'clamp' })

function Card({ children, style }: { children: ReactNode; style?: object }) {
  const { colors, isDark } = useTheme()
  return (
    <View style={[styles.card, { backgroundColor: colors.paper, borderColor: colors.line, shadowOpacity: isDark ? 0 : 0.08 }, style]}>
      {children}
    </View>
  )
}

// A highlighter stroke that grows from the left behind its text.
function Stroke({ progress, children, dark }: { progress: Animated.AnimatedInterpolation<number>; children: ReactNode; dark?: boolean }) {
  const { colors } = useTheme()
  return (
    <View style={{ alignSelf: 'flex-start' }}>
      <Animated.View style={[styles.stroke, { backgroundColor: colors.marker, transform: [{ scaleX: progress }] }]} />
      <Text style={{ color: dark ? colors.onMarker : colors.ink }}>{children}</Text>
    </View>
  )
}

function PrivacyScene({ animate }: { animate: boolean }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const clock = useLoop(animate, 3200)
  const lines = [0.9, 0.7, 0.84, 0.55, 0.78, 0.62]
  return (
    <View style={styles.center}>
      <Card style={{ width: 190, height: 250, padding: 20, gap: 12, transform: [{ rotate: '-3deg' }] }}>
        <Text style={[type.display, { fontSize: 17, lineHeight: 22, color: colors.ink }]}>{t('Notatki', 'Notes')}</Text>
        {lines.map((width, index) => (
          <Animated.View
            key={index}
            style={{
              height: 9,
              borderRadius: 5,
              width: `${width * 100}%`,
              backgroundColor: index === 1 || index === 4 ? colors.marker : colors.line,
              transformOrigin: 'left',
              transform: [{ scaleX: span(clock, index * 0.08, index * 0.08 + 0.22) }],
            }}
          />
        ))}
      </Card>
      <Animated.View
        style={[styles.lock, {
          backgroundColor: colors.brand,
          transform: [{ scale: clock.interpolate({ inputRange: [0, 0.55, 0.65, 0.72, 1], outputRange: [0, 0, 1.15, 1, 1], extrapolate: 'clamp' }) }],
        }]}
      >
        <Icon name="lock" size={26} color={colors.onBrand} />
      </Animated.View>
    </View>
  )
}

function SpeakScene({ animate }: { animate: boolean }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const clock = useLoop(animate, 5200)
  const plain = t('Jutro odebrać paczkę z paczkomatu,', 'Pick up the parcel tomorrow,').split(' ')
  const words = [...plain, t('przed ósmą', 'before eight')]
  const markedFrom = words.length - 1
  const bars = useRef([2.4, 3.6, 4.6, 2.8, 5, 3, 1.8, 3.8, 4.4, 2.2].map(() => new Animated.Value(1))).current
  useEffect(() => {
    if (!animate) return
    const loops = bars.map((bar, index) => Animated.loop(Animated.sequence([
      Animated.timing(bar, { toValue: 2 + (index % 4), duration: 420 + index * 40, useNativeDriver: true }),
      Animated.timing(bar, { toValue: 1, duration: 420 + index * 40, useNativeDriver: true }),
    ])))
    loops.forEach((loop) => loop.start())
    return () => loops.forEach((loop) => loop.stop())
  }, [animate, bars])
  return (
    <Card style={{ width: '100%', padding: 20, gap: 14 }}>
      <View style={styles.rowBetween}>
        <View style={[styles.timer, { backgroundColor: colors.brand }]}>
          <View style={[styles.recDot, { backgroundColor: colors.onBrand }]} />
          <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.onBrand, fontVariant: ['tabular-nums'] }}>0:12</Text>
        </View>
        <Text style={[type.meta, { color: colors.faint }]}>{t('na telefonie', 'on this phone')}</Text>
      </View>
      <View style={styles.words}>
        {words.map((word, index) => {
          const appear = span(clock, index * 0.09, index * 0.09 + 0.06)
          const marked = index >= markedFrom
          return (
            <Animated.Text
              key={index}
              style={[styles.word, { color: marked ? colors.onMarker : colors.ink, backgroundColor: marked ? colors.marker : 'transparent', opacity: appear, transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }]}
            >
              {word}
            </Animated.Text>
          )
        })}
      </View>
      <View style={styles.voice}>
        {bars.map((bar, index) => (
          <Animated.View key={index} style={[styles.bar, { backgroundColor: colors.ink, transform: [{ scaleY: bar }] }]} />
        ))}
        <View style={[styles.dotted, { borderColor: colors.line }]} />
      </View>
    </Card>
  )
}

function HighlightScene({ animate }: { animate: boolean }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const clock = useLoop(animate, 4200)
  return (
    <View style={{ width: '100%', gap: 12 }}>
      <Card style={{ padding: 16 }}>
        <Text style={[type.body, { fontSize: 15, lineHeight: 24, color: colors.faint }]}>
          {t('…no i w czwartek ', '…and on Thursday ')}
        </Text>
        <Stroke progress={span(clock, 0.05, 0.25)} dark>{t('oddaję hulajnogę o 17:15', 'the scooter goes in at 5:15 pm')}</Stroke>
        <Text style={[type.body, { fontSize: 15, lineHeight: 24, color: colors.faint }]}>{t(', a w piątek muszę ', ', and on Friday I need to ')}</Text>
        <Stroke progress={span(clock, 0.3, 0.5)} dark>{t('oddać projekt z robotyki', 'hand in the robotics project')}</Stroke>
      </Card>
      <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
        {[t('Hulajnoga do naprawy — czw 17:15', 'Scooter repair — Thu 5:15 pm'), t('Projekt z robotyki — pt', 'Robotics project — Fri')].map((point, index) => (
          <Animated.View
            key={point}
            style={[styles.point, index === 0 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, {
              opacity: span(clock, 0.22 + index * 0.25, 0.32 + index * 0.25),
              transform: [{ translateY: span(clock, 0.22 + index * 0.25, 0.32 + index * 0.25).interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
            }]}
          >
            <View style={[styles.bullet, { backgroundColor: colors.marker, borderColor: colors.markerLine }]} />
            <Text style={[type.body, { fontSize: 15, color: colors.ink }]}>{point}</Text>
          </Animated.View>
        ))}
      </Card>
    </View>
  )
}

function AskScene({ animate }: { animate: boolean }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const clock = useLoop(animate, 4600)
  const question = span(clock, 0, 0.1)
  const answer = span(clock, 0.5, 0.62)
  const titles = [t('Paczka i rachunki', 'Parcel and bills'), t('Plan na czwartek', 'Thursday plan'), t('Zakupy na weekend', 'Weekend shopping')]
  return (
    <View style={{ width: '100%', gap: 12 }}>
      <Animated.View style={[styles.question, { backgroundColor: colors.action, opacity: question, transform: [{ scale: question.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }]}>
        <Text style={[type.body, { color: colors.onAction }]}>{t('Kiedy mam odebrać paczkę?', 'When do I pick up the parcel?')}</Text>
      </Animated.View>
      <View style={{ height: 46 }}>
        {titles.map((title, index) => {
          const leave = span(clock, 0.12 + index * 0.1, 0.22 + index * 0.1)
          return (
            <Animated.View
              key={title}
              style={[styles.deckCard, { backgroundColor: colors.paper, borderColor: colors.line, zIndex: titles.length - index,
                opacity: Animated.multiply(span(clock, 0.08, 0.12), leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })),
                transform: [{ translateX: leave.interpolate({ inputRange: [0, 1], outputRange: [0, 120] }) }, { rotate: leave.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '8deg'] }) }] }]}
            >
              <View style={[styles.bullet, { backgroundColor: index === 0 ? colors.marker : colors.line, borderColor: index === 0 ? colors.markerLine : colors.line }]} />
              <Text style={[type.label, { color: colors.ink }]}>{title}</Text>
            </Animated.View>
          )
        })}
      </View>
      <Animated.View style={{ opacity: answer, transform: [{ translateY: answer.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }], gap: 10 }}>
        <Text style={[type.body, { fontSize: 18, lineHeight: 26, color: colors.ink }]}>
          {t('Jutro ', 'Tomorrow ')}<Text style={{ backgroundColor: colors.marker, color: colors.onMarker, fontFamily: fonts.semibold }}>{t('przed ósmą', 'before eight')}</Text>{t(' — z paczkomatu.', ' — from the locker.')}
        </Text>
        <Card style={{ padding: 12, gap: 4 }}>
          <Text style={[type.label, { fontSize: 13, color: colors.ink }]}>{titles[0]}</Text>
          <Text style={[type.meta, { fontSize: 13, color: colors.muted }]}>
            {t('„…jutro odebrać paczkę, ', '“…pick up the parcel tomorrow, ')}<Text style={{ backgroundColor: colors.marker, color: colors.onMarker }}>{t('przed ósmą', 'before eight')}</Text>{t('”', '”')}
          </Text>
        </Card>
      </Animated.View>
    </View>
  )
}

function TasksScene({ animate }: { animate: boolean }) {
  const { colors } = useTheme()
  const { t } = useI18n()
  const clock = useLoop(animate, 3600)
  const [width, setWidth] = useState(0)
  const rows = [
    { text: t('Odebrać paczkę', 'Pick up the parcel'), due: t('Jutro 8:00', 'Tomorrow 8:00'), marked: true },
    { text: t('Zapłacić rachunek za prąd', 'Pay the electricity bill'), due: t('Do 25.', 'By the 25th') },
    { text: t('Zadzwonić do dentysty', 'Call the dentist') },
  ]
  const tick = span(clock, 0.5, 0.6)
  return (
    <Card style={{ width: '100%', paddingHorizontal: 16, paddingVertical: 4 }}>
      {rows.map((row, index) => {
        const enter = span(clock, index * 0.1, index * 0.1 + 0.12)
        return (
          <Animated.View
            key={row.text}
            style={[styles.task, index < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}
          >
            <View style={[styles.check, { borderColor: colors.ink }]}>
              {index === 0 && (
                <Animated.View style={[styles.checkFill, { backgroundColor: colors.brand, transform: [{ scale: tick }] }]}>
                  <Icon name="check" size={12} color={colors.onBrand} />
                </Animated.View>
              )}
            </View>
            <View style={{ flex: 1, alignItems: 'flex-start' }}>
              <View>
                <Text onLayout={index === 0 ? (event) => setWidth(event.nativeEvent.layout.width) : undefined} style={[type.body, { fontSize: 15, color: colors.ink }]}>{row.text}</Text>
                {index === 0 && width > 0 && (
                  <Animated.View style={[styles.strike, { backgroundColor: colors.ink, width, transform: [{ scaleX: span(clock, 0.55, 0.7) }] }]} />
                )}
              </View>
            </View>
            {row.due ? (
              <View style={[styles.due, { backgroundColor: row.marked ? colors.marker : colors.surface }]}>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: row.marked ? colors.onMarker : colors.ink }}>{row.due}</Text>
              </View>
            ) : (
              <View style={[styles.due, { borderWidth: 1, borderStyle: 'dashed', borderColor: colors.faint }]}>
                <Text style={{ fontFamily: fonts.regular, fontSize: 12, color: colors.muted }}>{t('Przypomnij', 'Remind me')}</Text>
              </View>
            )}
          </Animated.View>
        )
      })}
    </Card>
  )
}

export function OnboardingArt({ page, animate }: { page: OnboardingPage; animate: boolean }) {
  const { t } = useI18n()
  const labels = [
    t('Notatka z kłódką: zapis zostaje na telefonie', 'A note with a lock: everything stays on the phone'),
    t('Słowa pojawiają się podczas mówienia', 'Words appear as you speak'),
    t('Zakreślone fragmenty stają się punktami streszczenia', 'Highlighted parts become summary points'),
    t('Pytanie i odpowiedź z notatek ze źródłem', 'A question answered from notes, with its source'),
    t('Zadania z terminami wyłapane z notatek', 'Tasks with due dates picked up from notes'),
  ]
  const Scene = [PrivacyScene, SpeakScene, HighlightScene, AskScene, TasksScene][page]
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={labels[page]} style={styles.scene}>
      <Scene animate={animate} />
    </View>
  )
}

const styles = StyleSheet.create({
  scene: { flex: 1, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg + 4, borderWidth: 1, shadowColor: '#18181B', shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 0 },
  lock: { position: 'absolute', right: '18%', top: '18%', width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 30, paddingHorizontal: 12, borderRadius: 15 },
  recDot: { width: 8, height: 8, borderRadius: 4 },
  words: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 6, rowGap: 2 },
  word: { fontFamily: fonts.medium, fontSize: 21, lineHeight: 30, borderRadius: 3 },
  voice: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 40 },
  bar: { width: 4, height: 6, borderRadius: 2 },
  dotted: { flex: 1, borderTopWidth: 2, borderStyle: 'dotted' },
  stroke: { position: 'absolute', left: -2, right: -2, top: 2, bottom: 0, borderRadius: 3, transformOrigin: 'left' },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 42 },
  bullet: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
  question: { alignSelf: 'flex-end', maxWidth: '82%', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderBottomRightRadius: 6 },
  deckCard: { position: 'absolute', left: 0, right: 0, top: 0, height: 42, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  task: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.6, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  checkFill: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  strike: { position: 'absolute', left: 0, top: '50%', height: 1.5, transformOrigin: 'left' },
  due: { minHeight: 24, paddingHorizontal: 9, borderRadius: 12, justifyContent: 'center' },
})
