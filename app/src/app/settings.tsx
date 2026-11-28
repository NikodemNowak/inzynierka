import { useRef, useState } from 'react'
import {
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
import type { LanguagePreference } from '../i18n/language'
import { useI18n } from '../i18n/useI18n'
import type { AppearancePreference } from '../ui/appearance'
import { Button } from '../ui/Button'
import { BottomSheet } from '../ui/BottomSheet'
import { Group, Row, SectionTitle } from '../ui/Grouped'
import { Icon } from '../ui/Icon'
import { radius, spacing, type, useTheme, font } from '../ui/theme'
import { ProcessingSettingsSection } from '../processing/ProcessingSettingsSection'
import { MEASUREMENT_TOOLS } from '../measurementBuild'

const formatGb = (bytes: number, locale: string): string =>
  `${(bytes / 1024 ** 3).toLocaleString(locale, { maximumFractionDigits: 1 })} GB`

const approximateModelBytes = MODEL_CONFIG.approxSizeMb * 1024 ** 2

function LanguageSection() {
  const { t, language } = useI18n()
  const { colors } = useTheme()
  const languagePreference = useSettingsStore(
    (state) => state.languagePreference,
  )
  const noteLanguage = useSettingsStore((state) => state.noteLanguage)
  const setLanguagePreference = useSettingsStore(
    (state) => state.setLanguagePreference,
  )
  const setNoteLanguage = useSettingsStore((state) => state.setNoteLanguage)
  const [visible, setVisible] = useState<'app' | 'note' | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const saveLock = useRef(false)

  const languageNames = { pl: 'Polski', en: 'English' } as const
  const appLanguageLabel =
    languagePreference === 'system'
      ? t(
          `System · ${languageNames[language]}`,
          `System · ${languageNames[language]}`,
        )
      : languageNames[languagePreference]
  const sheetTitle =
    visible === 'note'
      ? t('Język nowych notatek', 'Language for new notes')
      : t('Język aplikacji', 'App language')
  const options: ReadonlyArray<{
    value: LanguagePreference
    title: string
    description: string
  }> = [
    ...(visible === 'app'
      ? [
          {
            value: 'system' as const,
            title: t('System', 'System'),
            description: t(
              'Zgodny z ustawieniami urządzenia',
              'Follow device settings',
            ),
          },
        ]
      : []),
    {
      value: 'pl',
      title: languageNames.pl,
      description:
        visible === 'note'
          ? t('Transkrypcja i AI po polsku', 'Transcription and AI in Polish')
          : t('Polski interfejs aplikacji', 'Polish app interface'),
    },
    {
      value: 'en',
      title: languageNames.en,
      description:
        visible === 'note'
          ? t(
              'Transkrypcja i AI po angielsku',
              'Transcription and AI in English',
            )
          : t('Angielski interfejs aplikacji', 'English app interface'),
    },
  ]
  const selectedPreference =
    visible === 'note' ? noteLanguage : languagePreference

  const chooseLanguage = async (preference: LanguagePreference) => {
    if (
      !visible ||
      saveLock.current ||
      (visible === 'note' && preference === 'system')
    )
      return
    saveLock.current = true
    setSaveError(false)
    setSaving(true)
    try {
      if (visible === 'app') await setLanguagePreference(preference)
      else if (preference !== 'system') await setNoteLanguage(preference)
      setVisible(null)
    } catch {
      setSaveError(true)
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }

  const open = (target: 'app' | 'note') => {
    setSaveError(false)
    setVisible(target)
  }

  return (
    <View style={styles.section}>
      <SectionTitle>
        {t('Język', 'Language')}
      </SectionTitle>
      <Group>
        <Row
          title={t('Język aplikacji', 'App language')}
          accessibilityLabel={t(
            `Język aplikacji: ${appLanguageLabel}`,
            `App language: ${appLanguageLabel}`,
          )}
          accessibilityHint={t(
            'Otwiera wybór języka interfejsu',
            'Opens app language options',
          )}
          onPress={() => open('app')}
          trailing={
            <>
              <Text style={[styles.preferenceValue, { color: colors.muted }]}>
                {appLanguageLabel}
              </Text>
              <Icon name="chevron-right" color={colors.muted} size={20} />
            </>
          }
        />
        <Row
          title={t('Język nowych notatek', 'Language for new notes')}
          accessibilityLabel={t(
            `Język nowych notatek: ${languageNames[noteLanguage]}`,
            `Language for new notes: ${languageNames[noteLanguage]}`,
          )}
          accessibilityHint={t(
            'Otwiera wybór domyślnego języka transkrypcji i AI',
            'Opens default transcription and AI language options',
          )}
          onPress={() => open('note')}
          trailing={
            <>
              <Text style={[styles.preferenceValue, { color: colors.muted }]}>
                {languageNames[noteLanguage]}
              </Text>
              <Icon name="chevron-right" color={colors.muted} size={20} />
            </>
          }
        />
      </Group>
      <Text style={[styles.hint, { color: colors.muted }]}>
        {t(
          'Język nowych notatek określa język transkrypcji i AI. Zmiana języka aplikacji nie tłumaczy istniejących notatek.',
          'The language for new notes controls transcription and AI. Changing the app language does not translate existing notes.',
        )}
      </Text>
      <BottomSheet
        visible={visible !== null}
        title={sheetTitle}
        onClose={() => {
          if (!saving) setVisible(null)
        }}
      >
        <View accessibilityRole="radiogroup" accessibilityLabel={sheetTitle}>
          {options.map((option, index) => {
            const selected = selectedPreference === option.value
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={`${option.title}. ${option.description}`}
                accessibilityState={{ checked: selected, disabled: saving }}
                disabled={saving}
                onPress={() => void chooseLanguage(option.value)}
                style={[
                  styles.appearanceOption,
                  index < options.length - 1 && {
                    borderBottomColor: colors.line,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={styles.appearanceOptionCopy}>
                  <Text
                    style={[
                      styles.appearanceOptionTitle,
                      { color: colors.ink },
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
                  <Icon name="check" color={colors.ink} size={22} />
                ) : (
                  <View style={styles.appearanceCheckSpace} />
                )}
              </Pressable>
            )
          })}
        </View>
        {saveError && (
          <Text
            style={[styles.appearanceError, { color: colors.danger }]}
            accessibilityRole="alert"
          >
            {t(
              'Nie udało się zapisać języka. Przywrócono poprzednie ustawienie.',
              'Could not save the language. Your previous setting was restored.',
            )}
          </Text>
        )}
      </BottomSheet>
    </View>
  )
}

function ModelSection() {
  const { t, locale } = useI18n()
  const modelSize = formatGb(approximateModelBytes, locale)
  const status = useModelStore((state) => state.status)
  const progress = useModelStore((state) => state.progress)
  const isCancelling = useModelStore((state) => state.isCancelling)
  const sizeBytes = useModelStore((state) => state.sizeBytes)
  const error = useModelStore((state) => state.error)
  const download = useModelStore((state) => state.download)
  const cancelDownload = useModelStore((state) => state.cancelDownload)
  const remove = useModelStore((state) => state.remove)
  const { colors } = useTheme()

  const [confirming, setConfirming] = useState(false)
  const confirmRemove = () => setConfirming(true)

  const statusLabel = {
    checking: t('Sprawdzanie', 'Checking'),
    absent: t('Niepobrany', 'Not downloaded'),
    downloading: t(
      `Pobieranie · ${progress.toFixed(0)}%`,
      `Downloading · ${progress.toFixed(0)}%`,
    ),
    ready: t('Gotowy', 'Ready'),
  }[status]

  const statusIcon = {
    checking: 'refresh',
    absent: 'download',
    downloading: 'waveform',
    ready: 'check',
  }[status] as 'refresh' | 'download' | 'waveform' | 'check'

  return (
    <View style={styles.section}>
      <SectionTitle>
        {t('Model lokalny', 'Local model')}
      </SectionTitle>
      <Group>
      <View style={styles.modelCard}>
        <View style={styles.modelHeader}>
          <View style={styles.modelIdentity}>
            <Text style={[styles.modelName, { color: colors.ink }]}>
              {MODEL_CONFIG.displayName.replace(/\s*\([^)]*\)$/, '')}
            </Text>
            <Text style={[styles.modelPurpose, { color: colors.muted }]}>
              {t('Tytuły, streszczenia i zadania na telefonie', 'Titles, summaries and tasks on the phone')}
            </Text>
          </View>
          <View
            style={[styles.statusBadge, { backgroundColor: status === 'ready' ? colors.accent : colors.surface }]}
          >
            {status === 'ready' && <Icon name={statusIcon} color={colors.onAccent} size={14} />}
            <Text style={[styles.statusLabel, { color: status === 'ready' ? colors.onAccent : colors.ink }]}>
              {statusLabel}
            </Text>
          </View>
        </View>

        <Text style={[styles.modelSize, { color: colors.muted }]}>
          {status === 'ready' && sizeBytes > 0
            ? t(
                `${formatGb(sizeBytes, locale)} na urządzeniu`,
                `${formatGb(sizeBytes, locale)} on device`,
              )
            : status === 'absent'
              ? t(
                  `Około ${modelSize} do pobrania`,
                  `About ${modelSize} to download`,
                )
              : t(
                  `Około ${modelSize} modelu`,
                  `Model size: about ${modelSize}`,
                )}
        </Text>

        {status === 'downloading' && (
          <View style={styles.progressSection}>
            <View
              style={[styles.progressTrack, { backgroundColor: colors.track }]}
              accessibilityRole="progressbar"
              accessibilityLabel={t(
                'Pobieranie modelu AI',
                'Downloading AI model',
              )}
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
              {t(
                'Możesz przejść do notatek. Postęp zobaczysz także nad listą.',
                'You can go to your notes. Progress also appears above the list.',
              )}
            </Text>
          </View>
        )}

        {status === 'absent' && (
          <>
            <Button
              label={t('Pobierz model', 'Download model')}
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
              {t(
                'Nagrywanie działa bez modelu.',
                'Recording works without the model.',
              )}
            </Text>
          </>
        )}

        {status === 'downloading' && (
          <Button
            label={
              isCancelling
                ? t('Anulowanie…', 'Cancelling…')
                : t('Anuluj pobieranie', 'Cancel download')
            }
            variant="secondary"
            icon="close"
            disabled={isCancelling}
            busy={isCancelling}
            onPress={() => void cancelDownload()}
          />
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
      </Group>
      {status === 'ready' && (
        <Pressable onPress={confirmRemove} accessibilityRole="button" style={styles.removeLink}>
          <Text style={[styles.removeLabel, { color: colors.danger }]}>
            {t('Usuń model z telefonu', 'Remove the model from this phone')}
          </Text>
        </Pressable>
      )}
      <BottomSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title={t('Usunąć model?', 'Remove model?')}
      >
        <Text style={{ ...type.body, color: colors.body }}>
          {t(
            'Zwolni to miejsce na urządzeniu. Tytuły i podsumowania AI będą niedostępne, dopóki nie pobierzesz modelu ponownie. Notatki i nagrania zostaną nienaruszone.',
            'This frees up space on your device. AI titles and summaries will be unavailable until you download the model again. Your notes and recordings will be kept.',
          )}
        </Text>
        <Button
          label={t('Usuń model', 'Remove model')}
          variant="danger"
          onPress={() => {
            setConfirming(false)
            void remove()
          }}
        />
        <Button
          label={t('Anuluj', 'Cancel')}
          variant="quiet"
          onPress={() => setConfirming(false)}
        />
      </BottomSheet>
    </View>
  )
}

const PRIVACY_POINTS = [
  {
    icon: 'phone' as const,
    title: 'Notatki i nagrania zostają na telefonie',
    titleEn: 'Notes and recordings stay on your phone',
  },
  {
    icon: 'shield' as const,
    title: 'Opracowanie działa bez internetu',
    titleEn: 'Processing works without internet',
  },
  {
    icon: 'lock' as const,
    title: 'Bez konta i logowania',
    titleEn: 'No account or sign-in',
  },
]

function PrivacySection() {
  const { t } = useI18n()
  const { colors } = useTheme()
  return (
    <View style={styles.section}>
      <SectionTitle>
        {t('Prywatność', 'Privacy')}
      </SectionTitle>
      <Group>
        {PRIVACY_POINTS.map((point) => (
          <Row
            key={point.title}
            title={t(point.title, point.titleEn)}
            numberOfLines={2}
            leading={
              <View style={[styles.privacyIcon, { backgroundColor: colors.accent }]}>
                <Icon name={point.icon} color={colors.onAccent} size={16} />
              </View>
            }
          />
        ))}
      </Group>
    </View>
  )
}

function DataSection() {
  const { t } = useI18n()
  const router = useRouter()
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
      <SectionTitle>
        {t('Twoje dane', 'Your data')}
      </SectionTitle>
      <Group>
        <Row
          title={busy ? t('Eksportowanie…', 'Exporting…') : t('Eksportuj notatki', 'Export notes')}
          subtitle={t('Tekst i zadania, bez nagrań', 'Text and tasks, without recordings')}
          disabled={busy || notes.length === 0}
          onPress={() => void exportAll()}
          trailing={<Icon name="chevron-right" color={colors.faint} size={20} />}
        />
        <Row
          title={t('Pokaż wprowadzenie', 'Show the introduction')}
          onPress={() => router.push('/welcome')}
          trailing={<Icon name="chevron-right" color={colors.faint} size={20} />}
        />
      </Group>
      {notes.length === 0 && (
        <Text style={[styles.hint, { color: colors.muted }]}>
          {t('Brak notatek do wyeksportowania.', 'No notes to export.')}
        </Text>
      )}
      {error && (
        <Text style={[styles.error, { color: colors.danger }]} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  )
}

function AppearanceSection() {
  const { t } = useI18n()
  const { colors } = useTheme()
  const appearancePreference = useSettingsStore((state) => state.appearancePreference)
  const setAppearancePreference = useSettingsStore((state) => state.setAppearancePreference)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const options: ReadonlyArray<{ value: AppearancePreference; title: string }> = [
    { value: 'light', title: t('Jasny', 'Light') },
    { value: 'dark', title: t('Ciemny', 'Dark') },
    { value: 'system', title: t('Jak system', 'System') },
  ]
  const choose = async (preference: AppearancePreference) => {
    if (saving || preference === appearancePreference) return
    setFailed(false)
    setSaving(true)
    try {
      await setAppearancePreference(preference)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }
  return (
    <View style={styles.section}>
      <SectionTitle>{t('Wygląd', 'Appearance')}</SectionTitle>
      <Segmented
        label={t('Wybór wyglądu', 'Choose appearance')}
        options={options}
        value={appearancePreference}
        disabled={saving}
        onChange={(value) => void choose(value)}
      />
      {failed && (
        <Text style={[styles.appearanceError, { color: colors.danger }]} accessibilityRole="alert">
          {t(
            'Nie udało się zapisać ustawienia. Przywrócono poprzedni wygląd.',
            'Could not save this setting. Your previous appearance was restored.',
          )}
        </Text>
      )}
    </View>
  )
}

// Short choices sit side by side; the selected one lifts onto paper.
function Segmented<T extends string>({ label, options, value, onChange, disabled = false }: {
  label: string
  options: ReadonlyArray<{ value: T; title: string }>
  value: T
  onChange: (value: T) => void
  disabled?: boolean
}) {
  const { colors } = useTheme()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.segment, { backgroundColor: colors.surface }]}>
      {options.map((option) => {
        const selected = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[styles.segmentOption, selected && { backgroundColor: colors.raised }]}
          >
            <Text style={{ ...font.semibold, fontSize: 14, color: selected ? colors.ink : colors.muted }}>{option.title}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const DEV_ROUTES = [
  {
    href: '/dev/poc' as const,
    title: 'POC modelu językowego',
    titleEn: 'Language model POC',
  },
  {
    href: '/dev/stt-probe' as const,
    title: 'Diagnostyka mowy',
    titleEn: 'Speech diagnostics',
  },
  {
    href: '/dev/metrics' as const,
    title: 'Metryki wydajności',
    titleEn: 'Performance metrics',
  },
]

function DeveloperSection() {
  const { t } = useI18n()
  const router = useRouter()
  const { colors } = useTheme()
  return (
    <View style={styles.section}>
      <SectionTitle>
        {t('Dla dewelopera', 'For developers')}
      </SectionTitle>
      <Group>
        <Row
          title={t('Pomiary i porównanie modeli', 'Measurements and model comparison')}
          numberOfLines={2}
          onPress={() => router.push('/dev/benchmark')}
          trailing={<Icon name="chevron-right" color={colors.faint} size={20} />}
        />
        {(__DEV__ ? DEV_ROUTES : []).map((route) => (
          <Row
            key={route.href}
            title={t(route.title, route.titleEn)}
            numberOfLines={2}
            onPress={() => router.push(route.href)}
            trailing={<Icon name="chevron-right" color={colors.muted} size={20} />}
          />
        ))}
      </Group>
    </View>
  )
}

export default function SettingsScreen() {
  const { t } = useI18n()
  const { colors } = useTheme()
  return (
    <ScrollView
      style={{ backgroundColor: colors.canvas }}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <Stack.Screen options={{ title: t('Ustawienia', 'Settings') }} />
      <ModelSection />
      <ProcessingSettingsSection />
      <LanguageSection />
      <AppearanceSection />
      <PrivacySection />
      <DataSection />
      {MEASUREMENT_TOOLS && <DeveloperSection />}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  section: { gap: 0 },
  modelCard: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  modelHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  modelIdentity: { flex: 1, gap: 2, minWidth: 0 },
  modelName: { ...type.title, fontSize: 17 },
  modelPurpose: { ...type.meta },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    minHeight: 26,
  },
  statusLabel: { ...type.meta, ...font.semibold },
  modelSize: { ...type.body, fontSize: 14 },
  progressSection: { gap: spacing.sm },
  progressTrack: { height: 10, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderTopRightRadius: 6, borderBottomRightRadius: 2 },
  progressHint: { ...type.meta },
  modelHelper: { textAlign: 'center' },
  removeLink: { marginTop: spacing.sm, alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', marginLeft: 4 },
  removeLabel: { ...type.label, fontSize: 14 },
  error: { ...type.body, fontSize: 14 },
  privacyIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  hint: { ...type.meta, marginHorizontal: spacing.md, marginTop: spacing.sm },
  preferenceValue: { ...type.meta },
  appearanceOption: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  appearanceOptionCopy: { flex: 1, gap: 3 },
  appearanceOptionTitle: { ...type.body, ...font.semibold },
  appearanceOptionDescription: { ...type.meta },
  appearanceCheckSpace: { width: 22, height: 22 },
  appearanceError: { ...type.meta },
  segment: { flexDirection: 'row', padding: 3, borderRadius: 14, gap: 3 },
  segmentOption: { flex: 1, minHeight: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
})
