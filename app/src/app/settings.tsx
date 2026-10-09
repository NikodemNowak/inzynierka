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
import type { LanguagePreference } from '../i18n/language'
import { useI18n } from '../i18n/useI18n'
import type { AppearancePreference } from '../ui/appearance'
import { Button } from '../ui/Button'
import { BottomSheet } from '../ui/BottomSheet'
import { Icon } from '../ui/Icon'
import { radius, spacing, type, useTheme } from '../ui/theme'
import { ProcessingSettingsSection } from '../processing/ProcessingSettingsSection'

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
      <Text
        style={[styles.sectionTitle, { color: colors.ink }]}
        accessibilityRole="header"
      >
        {t('Język', 'Language')}
      </Text>
      <View
        style={[
          styles.preferenceCard,
          { backgroundColor: colors.paper, borderColor: colors.line },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            `Język aplikacji: ${appLanguageLabel}`,
            `App language: ${appLanguageLabel}`,
          )}
          accessibilityHint={t(
            'Otwiera wybór języka interfejsu',
            'Opens app language options',
          )}
          onPress={() => open('app')}
          style={styles.preferenceRow}
        >
          <Icon name="phone" color={colors.accent} size={21} />
          <Text style={[styles.preferenceLabel, { color: colors.ink }]}>
            {t('Język aplikacji', 'App language')}
          </Text>
          <Text style={[styles.preferenceValue, { color: colors.muted }]}>
            {appLanguageLabel}
          </Text>
          <Icon name="chevron-right" color={colors.muted} size={20} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            `Język nowych notatek: ${languageNames[noteLanguage]}`,
            `Language for new notes: ${languageNames[noteLanguage]}`,
          )}
          accessibilityHint={t(
            'Otwiera wybór domyślnego języka transkrypcji i AI',
            'Opens default transcription and AI language options',
          )}
          onPress={() => open('note')}
          style={[
            styles.preferenceRow,
            styles.preferenceAction,
            { borderTopColor: colors.line },
          ]}
        >
          <Icon name="note" color={colors.accent} size={21} />
          <Text style={[styles.preferenceLabel, { color: colors.ink }]}>
            {t('Język nowych notatek', 'Language for new notes')}
          </Text>
          <Text style={[styles.preferenceValue, { color: colors.muted }]}>
            {languageNames[noteLanguage]}
          </Text>
          <Icon name="chevron-right" color={colors.muted} size={20} />
        </Pressable>
      </View>
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

  const confirmRemove = () => {
    Alert.alert(
      t('Usunąć model?', 'Remove model?'),
      t(
        'Zwolni to miejsce na urządzeniu. Tytuły i podsumowania AI będą niedostępne, dopóki nie pobierzesz modelu ponownie. Notatki i nagrania zostaną nienaruszone.',
        'This frees up space on your device. AI titles and summaries will be unavailable until you download the model again. Your notes and recordings will be kept.',
      ),
      [
        { text: t('Anuluj', 'Cancel'), style: 'cancel' },
        {
          text: t('Usuń', 'Remove'),
          style: 'destructive',
          onPress: () => void remove(),
        },
      ],
    )
  }

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
      <Text
        style={[styles.sectionTitle, { color: colors.ink }]}
        accessibilityRole="header"
      >
        {t('Model lokalny', 'Local model')}
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
              {t('Tytuły i podsumowania', 'Titles and summaries')}
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
              style={[styles.progressTrack, { backgroundColor: colors.line }]}
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

        {status === 'ready' && (
          <Pressable
            onPress={confirmRemove}
            accessibilityRole="button"
            style={[styles.removeRow, { borderTopColor: colors.line }]}
          >
            <Icon name="trash" color={colors.danger} size={21} />
            <Text style={[styles.removeLabel, { color: colors.danger }]}>
              {t('Usuń model', 'Remove model')}
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
    titleEn: 'Notes stay on your phone',
  },
  {
    icon: 'sparkles' as const,
    title: 'Przetwarzanie działa offline',
    titleEn: 'Processing works offline',
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
      <Text
        style={[styles.sectionTitle, { color: colors.ink }]}
        accessibilityRole="header"
      >
        {t('Prywatność', 'Privacy')}
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
                {t(point.title, point.titleEn)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

function DataSection() {
  const { t } = useI18n()
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
        {t('Twoje dane', 'Your data')}
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
            {busy
              ? t('Eksportowanie…', 'Exporting…')
              : t('Eksportuj notatki', 'Export notes')}
          </Text>
          <Text style={[styles.dataDescription, { color: colors.muted }]}>
            {t('Nagrania nie są dołączane', 'Recordings are not included')}
          </Text>
        </View>
        <Icon name="chevron-right" color={colors.muted} size={20} />
      </Pressable>
      {notes.length === 0 && (
        <Text style={[styles.hint, { color: colors.muted }]}>
          {t('Brak notatek do wyeksportowania.', 'No notes to export.')}
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
  const { t } = useI18n()
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
  const [appearanceError, setAppearanceError] = useState(false)
  const appearanceSaveLock = useRef(false)

  const chooseAppearance = async (preference: AppearancePreference) => {
    if (appearanceSaveLock.current) return
    appearanceSaveLock.current = true
    setAppearanceError(false)
    setAppearanceSaving(true)
    try {
      await setAppearancePreference(preference)
      setAppearanceVisible(false)
    } catch {
      setAppearanceError(true)
    } finally {
      appearanceSaveLock.current = false
      setAppearanceSaving(false)
    }
  }

  const appearanceLabel: Record<AppearancePreference, string> = {
    system: t('System', 'System'),
    light: t('Jasny', 'Light'),
    dark: t('Ciemny', 'Dark'),
  }

  const appearanceOptions: ReadonlyArray<{
    value: AppearancePreference
    title: string
    description: string
  }> = [
    {
      value: 'system',
      title: t('System', 'System'),
      description: t(
        'Zgodny z ustawieniami urządzenia',
        'Follow device settings',
      ),
    },
    {
      value: 'light',
      title: t('Jasny', 'Light'),
      description: t('Jasny wygląd aplikacji', 'Light app appearance'),
    },
    {
      value: 'dark',
      title: t('Ciemny', 'Dark'),
      description: t('Ciemny wygląd aplikacji', 'Dark app appearance'),
    },
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
          accessibilityLabel={t(
            `Wygląd: ${appearanceLabel[appearancePreference]}`,
            `Appearance: ${appearanceLabel[appearancePreference]}`,
          )}
          accessibilityHint={t(
            'Otwiera wybór wyglądu aplikacji',
            'Opens app appearance options',
          )}
          onPress={() => {
            setAppearanceError(false)
            setAppearanceVisible(true)
          }}
          style={styles.preferenceRow}
        >
          <Icon name="phone" color={colors.accent} size={21} />
          <Text style={[styles.preferenceLabel, { color: colors.ink }]}>
            {t('Wygląd', 'Appearance')}
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
            {t('Pokaż wprowadzenie ponownie', 'Show introduction again')}
          </Text>
          <Icon name="chevron-right" color={colors.muted} size={20} />
        </Pressable>
      </View>
      <BottomSheet
        visible={appearanceVisible}
        onClose={() => setAppearanceVisible(false)}
        title={t('Wygląd', 'Appearance')}
      >
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t('Wybór wyglądu', 'Choose appearance')}
        >
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
            {t(
              'Nie udało się zapisać ustawienia. Przywrócono poprzedni wygląd.',
              'Could not save this setting. Your previous appearance was restored.',
            )}
          </Text>
        )}
      </BottomSheet>
    </>
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
      <Text
        style={[styles.sectionTitle, { color: colors.muted }]}
        accessibilityRole="header"
      >
        {t('Narzędzia deweloperskie', 'Developer tools')}
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
              {t(route.title, route.titleEn)}
            </Text>
            <Icon name="chevron-right" color={colors.muted} size={20} />
          </Pressable>
        ))}
      </View>
    </View>
  )
}

export default function SettingsScreen() {
  const { t } = useI18n()
  const { colors } = useTheme()
  const router = useRouter()
  return (
    <ScrollView
      style={{ backgroundColor: colors.canvas }}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <Stack.Screen options={{ title: t('Ustawienia', 'Settings') }} />
      <LanguageSection />
      <ProcessingSettingsSection />
      <ModelSection />
      <PrivacySection />
      <DataSection />
      <Button
        label={t(
          'Pomiary i porównanie modeli',
          'Measurements and model comparison',
        )}
        variant="secondary"
        onPress={() => router.push('/dev/benchmark')}
      />
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
