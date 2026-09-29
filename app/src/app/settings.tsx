import { useRef, useState } from 'react'
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useNotesStore } from '../state/notesStore'
import { useTasksStore } from '../state/tasksStore'
import { useModelStore } from '../state/modelStore'
import { useSettingsStore } from '../state/settingsStore'
import { shareNotesExport } from '../export/exportNotes'
import { MODEL_CONFIG } from '../ai/modelConfig'
import type { AppearancePreference } from '../ui/appearance'
import { Button } from '../ui/Button'
import { BottomSheet } from '../ui/BottomSheet'
import { Icon } from '../ui/Icon'
import { radius, spacing, type, useTheme } from '../ui/theme'

const formatGb = (bytes: number): string =>
  `${(bytes / 1024 ** 3).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} GB`

const approximateModelBytes = MODEL_CONFIG.approxSizeMb * 1024 ** 2

const approximateModelSize = (): string =>
  `Około ${formatGb(approximateModelBytes)}`

function ModelSection() {
  const status = useModelStore((state) => state.status)
  const progress = useModelStore((state) => state.progress)
  const isCancelling = useModelStore((state) => state.isCancelling)
  const sizeBytes = useModelStore((state) => state.sizeBytes)
  const error = useModelStore((state) => state.error)
  const download = useModelStore((state) => state.download)
  const cancelDownload = useModelStore((state) => state.cancelDownload)
  const remove = useModelStore((state) => state.remove)
  const { colors } = useTheme()

  const confirmRemove = () => {
    Alert.alert(
      'Usunąć model?',
      'Zwolni to miejsce na urządzeniu. Tytuły i podsumowania AI będą niedostępne, dopóki nie pobierzesz modelu ponownie. Notatki i nagrania zostaną nienaruszone.',
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Usuń', style: 'destructive', onPress: () => void remove() },
      ],
    )
  }

  const statusLabel = {
    checking: 'Sprawdzanie',
    absent: 'Niepobrany',
    downloading: `Pobieranie · ${progress.toFixed(0)}%`,
    ready: 'Gotowy',
  }[status]

  const statusIcon = {
    checking: 'refresh',
    absent: 'download',
    downloading: 'waveform',
    ready: 'check',
  }[status] as 'refresh' | 'download' | 'waveform' | 'check'

  return (
    <View style={styles.section}>
      <Text
        style={[styles.sectionTitle, { color: colors.ink }]}
        accessibilityRole="header"
      >
        Model lokalny
      </Text>
      <View
        style={[
          styles.modelCard,
          { backgroundColor: colors.paper, borderColor: colors.line },
        ]}
      >
        <View style={styles.modelHeader}>
          <View
            style={[styles.modelIcon, { backgroundColor: colors.accentSoft }]}
          >
            <Icon name="sparkles" color={colors.accent} size={25} />
          </View>
          <View style={styles.modelIdentity}>
            <Text style={[styles.modelName, { color: colors.ink }]}>
              {MODEL_CONFIG.displayName}
            </Text>
            <Text style={[styles.modelPurpose, { color: colors.muted }]}>
              Tytuły i podsumowania
            </Text>
          </View>
          <View
            style={[styles.statusBadge, { backgroundColor: colors.accentSoft }]}
          >
            <Icon name={statusIcon} color={colors.accent} size={15} />
            <Text style={[styles.statusLabel, { color: colors.accent }]}>
              {statusLabel}
            </Text>
          </View>
        </View>

        <Text style={[styles.modelSize, { color: colors.muted }]}>
          {status === 'ready' && sizeBytes > 0
            ? `${formatGb(sizeBytes)} na urządzeniu`
            : status === 'absent'
              ? `${approximateModelSize()} do pobrania`
              : `${approximateModelSize()} modelu`}
        </Text>

        {status === 'downloading' && (
          <View style={styles.progressSection}>
            <View
              style={[styles.progressTrack, { backgroundColor: colors.line }]}
              accessibilityRole="progressbar"
              accessibilityLabel="Pobieranie modelu AI"
              accessibilityValue={{
                min: 0,
                max: 100,
                now: Math.round(progress),
              }}
            >
              <View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: colors.accent,
                    width: `${Math.min(100, Math.max(0, progress))}%`,
                  },
                ]}
              />
            </View>
            <Text style={[styles.progressHint, { color: colors.muted }]}>
              Możesz przejść do notatek. Postęp zobaczysz także nad listą.
            </Text>
          </View>
        )}

        {status === 'absent' && (
          <>
            <Button
              label="Pobierz model"
              variant="primary"
              icon="download"
              onPress={() => void download()}
            />
            <Text
              style={[
                styles.progressHint,
                styles.modelHelper,
                { color: colors.muted },
              ]}
            >
              Nagrywanie działa bez modelu.
            </Text>
          </>
        )}

        {status === 'downloading' && (
          <Button
            label={isCancelling ? 'Anulowanie…' : 'Anuluj pobieranie'}
            variant="secondary"
            icon="close"
            disabled={isCancelling}
            busy={isCancelling}
            onPress={() => void cancelDownload()}
          />
        )}

        {status === 'ready' && (
          <Pressable
            onPress={confirmRemove}
            accessibilityRole="button"
            style={[styles.removeRow, { borderTopColor: colors.line }]}
          >
            <Icon name="trash" color={colors.danger} size={21} />
            <Text style={[styles.removeLabel, { color: colors.danger }]}>
              Usuń model
            </Text>
            <Icon name="chevron-right" color={colors.muted} size={20} />
          </Pressable>
        )}

        {error && (
          <Text
            style={[styles.error, { color: colors.danger }]}
            accessibilityRole="alert"
          >
            {error}
          </Text>
        )}
      </View>
    </View>
  )
}

const PRIVACY_POINTS = [
  {
    icon: 'phone' as const,
    title: 'Notatki zostają na telefonie',
  },
  {
    icon: 'sparkles' as const,
    title: 'Przetwarzanie działa offline',
  },
  {
    icon: 'lock' as const,
    title: 'Bez konta i logowania',
  },
]

function PrivacySection() {
  const { colors } = useTheme()
  return (
    <View style={styles.section}>
      <Text
        style={[styles.sectionTitle, { color: colors.ink }]}
        accessibilityRole="header"
      >
        Prywatność
      </Text>
      <View
        style={[
          styles.privacyCard,
          { backgroundColor: colors.paper, borderColor: colors.line },
        ]}
      >
        {PRIVACY_POINTS.map((point, index) => (
          <View
            key={point.title}
            style={[
              styles.privacyRow,
              index < PRIVACY_POINTS.length - 1 && {
                borderBottomColor: colors.line,
                borderBottomWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <Icon name={point.icon} color={colors.accent} size={22} />
            <View style={styles.privacyCopy}>
              <Text style={[styles.privacyTitle, { color: colors.ink }]}>
                {point.title}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

function DataSection() {
  const notes = useNotesStore((state) => state.notes)
  const tasks = useTasksStore((state) => state.tasks)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { colors } = useTheme()

  const exportAll = async () => {
    setError(null)
    setBusy(true)
    try {
      await shareNotesExport(notes, tasks)
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : String(exportError),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.section}>
      <Text
        style={[styles.sectionTitle, { color: colors.ink }]}
        accessibilityRole="header"
      >
        Twoje dane
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || notes.length === 0 }}
        onPress={() => void exportAll()}
        disabled={busy || notes.length === 0}
        style={({ pressed }) => [
          styles.dataCard,
          styles.dataRow,
          {
            backgroundColor: colors.paper,
            borderColor: colors.line,
            opacity: busy || notes.length === 0 ? 0.48 : pressed ? 0.62 : 1,
          },
        ]}
      >
        <Icon name="share" color={colors.ink} size={22} />
        <View style={styles.dataCopy}>
          <Text style={[styles.dataTitle, { color: colors.ink }]}>
            {busy ? 'Eksportowanie…' : 'Eksportuj notatki'}
          </Text>
          <Text style={[styles.dataDescription, { color: colors.muted }]}>
            Nagrania nie są dołączane
          </Text>
        </View>
        <Icon name="chevron-right" color={colors.muted} size={20} />
      </Pressable>
      {notes.length === 0 && (
        <Text style={[styles.hint, { color: colors.muted }]}>
          Brak notatek do wyeksportowania.
        </Text>
      )}
      {error && (
        <Text
          style={[styles.error, { color: colors.danger }]}
          accessibilityRole="alert"
        >
          {error}
        </Text>
      )}
      <AppearancePreferences />
    </View>
  )
}

function AppearancePreferences() {
  const router = useRouter()
  const { colors } = useTheme()
  const appearancePreference = useSettingsStore(
    (state) => state.appearancePreference,
  )
  const setAppearancePreference = useSettingsStore(
    (state) => state.setAppearancePreference,
  )
  const [appearanceVisible, setAppearanceVisible] = useState(false)
  const [appearanceSaving, setAppearanceSaving] = useState(false)
  const [appearanceError, setAppearanceError] = useState<string | null>(null)
  const appearanceSaveLock = useRef(false)

  const chooseAppearance = async (preference: AppearancePreference) => {
    if (appearanceSaveLock.current) return
    appearanceSaveLock.current = true
    setAppearanceError(null)
    setAppearanceSaving(true)
    try {
      await setAppearancePreference(preference)
      setAppearanceVisible(false)
    } catch {
      setAppearanceError(
        'Nie udało się zapisać ustawienia. Przywrócono poprzedni wygląd.',
      )
    } finally {
      appearanceSaveLock.current = false
      setAppearanceSaving(false)
    }
  }

  const appearanceLabel: Record<AppearancePreference, string> = {
    system: 'System',
    light: 'Jasny',
    dark: 'Ciemny',
  }

  const appearanceOptions: ReadonlyArray<{
    value: AppearancePreference
    title: string
    description: string
  }> = [
    {
      value: 'system',
      title: 'System',
      description: 'Zgodny z ustawieniami urządzenia',
    },
    { value: 'light', title: 'Jasny', description: 'Jasny wygląd aplikacji' },
    { value: 'dark', title: 'Ciemny', description: 'Ciemny wygląd aplikacji' },
  ]

  return (
    <>
      <View
        style={[
          styles.preferenceCard,
          { backgroundColor: colors.paper, borderColor: colors.line },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Wygląd: ${appearanceLabel[appearancePreference]}`}
          accessibilityHint="Otwiera wybór wyglądu aplikacji"
          onPress={() => {
            setAppearanceError(null)
            setAppearanceVisible(true)
          }}
          style={styles.preferenceRow}
        >
          <Icon name="phone" color={colors.accent} size={21} />
          <Text style={[styles.preferenceLabel, { color: colors.ink }]}>
            Wygląd
          </Text>
          <Text style={[styles.preferenceValue, { color: colors.muted }]}>
            {appearanceLabel[appearancePreference]}
          </Text>
          <Icon name="chevron-right" color={colors.muted} size={20} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/welcome')}
          style={[
            styles.preferenceRow,
            styles.preferenceAction,
            { borderTopColor: colors.line },
          ]}
        >
          <Icon name="refresh" color={colors.accent} size={21} />
          <Text style={[styles.preferenceLabel, { color: colors.ink }]}>
            Pokaż wprowadzenie ponownie
          </Text>
          <Icon name="chevron-right" color={colors.muted} size={20} />
        </Pressable>
      </View>
      <BottomSheet
        visible={appearanceVisible}
        onClose={() => setAppearanceVisible(false)}
        title="Wygląd"
      >
        <View accessibilityRole="radiogroup" accessibilityLabel="Wybór wyglądu">
          {appearanceOptions.map((option, index) => {
            const selected = appearancePreference === option.value
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={`${option.title}. ${option.description}`}
                accessibilityState={{
                  checked: selected,
                  disabled: appearanceSaving,
                }}
                disabled={appearanceSaving}
                onPress={() => void chooseAppearance(option.value)}
                style={[
                  styles.appearanceOption,
                  index < appearanceOptions.length - 1 && {
                    borderBottomColor: colors.line,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={styles.appearanceOptionCopy}>
                  <Text
                    style={[
                      styles.appearanceOptionTitle,
                      { color: selected ? colors.accent : colors.ink },
                    ]}
                  >
                    {option.title}
                  </Text>
                  <Text
                    style={[
                      styles.appearanceOptionDescription,
                      { color: colors.muted },
                    ]}
                  >
                    {option.description}
                  </Text>
                </View>
                {selected ? (
                  <Icon name="check" color={colors.accent} size={22} />
                ) : (
                  <View style={styles.appearanceCheckSpace} />
                )}
              </Pressable>
            )
          })}
        </View>
        {appearanceError && (
          <Text
            style={[styles.appearanceError, { color: colors.danger }]}
            accessibilityRole="alert"
          >
            {appearanceError}
          </Text>
        )}
      </BottomSheet>
    </>
  )
}

const DEV_ROUTES = [
  { href: '/dev/poc' as const, title: 'POC modelu językowego' },
  { href: '/dev/stt-probe' as const, title: 'Diagnostyka mowy' },
  { href: '/dev/metrics' as const, title: 'Metryki wydajności' },
]

function DeveloperSection() {
  const router = useRouter()
  const { colors } = useTheme()
  return (
    <View style={styles.section}>
      <Text
        style={[styles.sectionTitle, { color: colors.muted }]}
        accessibilityRole="header"
      >
        Narzędzia deweloperskie
      </Text>
      <View
        style={[
          styles.preferenceCard,
          { backgroundColor: colors.paper, borderColor: colors.line },
        ]}
      >
        {DEV_ROUTES.map((route, index) => (
          <Pressable
            key={route.href}
            accessibilityRole="button"
            onPress={() => router.push(route.href)}
            style={[
              styles.devRow,
              index > 0 && {
                borderTopColor: colors.line,
                borderTopWidth: StyleSheet.hairlineWidth,
              },
            ]}
          >
            <Text style={[styles.preferenceLabel, { color: colors.ink }]}>
              {route.title}
            </Text>
            <Icon name="chevron-right" color={colors.muted} size={20} />
          </Pressable>
        ))}
      </View>
    </View>
  )
}

export default function SettingsScreen() {
  const { colors } = useTheme()
  return (
    <ScrollView
      style={{ backgroundColor: colors.canvas }}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <Stack.Screen options={{ title: 'Ustawienia' }} />
      <ModelSection />
      <PrivacySection />
      <DataSection />
      {__DEV__ && <DeveloperSection />}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  section: { gap: spacing.sm },
  sectionTitle: { ...type.label, fontSize: 16 },
  modelCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
  },
  modelHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  modelIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modelIdentity: { flex: 1, gap: 2, minWidth: 0 },
  modelName: { ...type.title, fontSize: 16 },
  modelPurpose: { ...type.meta },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusLabel: { ...type.meta, fontWeight: '600' },
  modelSize: { ...type.body, fontSize: 14 },
  progressSection: { gap: spacing.sm },
  progressTrack: { height: 7, borderRadius: radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: radius.pill },
  progressHint: { ...type.meta },
  modelHelper: { textAlign: 'center' },
  removeRow: {
    minHeight: 49,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  removeLabel: { ...type.body, flex: 1, fontWeight: '600' },
  error: { ...type.body, fontSize: 14 },
  privacyCard: {
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  privacyRow: {
    minHeight: 61,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  privacyCopy: { flex: 1, gap: 2 },
  privacyTitle: { ...type.body, fontWeight: '500' },
  dataCard: {
    minHeight: 76,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  dataRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  dataCopy: { flex: 1, gap: 2 },
  dataTitle: { ...type.body, fontWeight: '500' },
  dataDescription: { ...type.body, fontSize: 14 },
  hint: { ...type.meta, marginHorizontal: spacing.md },
  preferenceCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  preferenceRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  preferenceLabel: { ...type.body, flex: 1, fontSize: 15 },
  preferenceValue: { ...type.meta },
  preferenceAction: { borderTopWidth: StyleSheet.hairlineWidth },
  appearanceOption: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  appearanceOptionCopy: { flex: 1, gap: 3 },
  appearanceOptionTitle: { ...type.body, fontWeight: '600' },
  appearanceOptionDescription: { ...type.meta },
  appearanceCheckSpace: { width: 22, height: 22 },
  appearanceError: { ...type.meta },
  devRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center' },
})
