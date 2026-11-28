import { plPlural } from '../../i18n/plPlural'
import type { ReactNode } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Note } from '../../domain/note'
import { useI18n } from '../../i18n/useI18n'
import { NoteTags } from '../../tags/NoteTags'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { font, spacing, type, useTheme } from '../../ui/theme'
import {
  getNoteProposalChanges,
  isNoteProposalFieldAvailable,
  type NoteProposal,
  type NoteProposalSelection,
} from '../noteProposals'
import { addedWords } from '../wordDiff'

export type ProposalField = keyof NoteProposalSelection

function ProposalChoice({
  label,
  value,
  selected,
  disabled = false,
  onPress,
  children,
  compareTo,
}: {
  label: string
  value?: string
  selected: boolean
  disabled?: boolean
  onPress: () => void
  children?: ReactNode
  compareTo?: string
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: selected ? colors.tint : colors.group,
          borderLeftColor: selected ? colors.accent : 'transparent',
          opacity: disabled ? 0.55 : pressed ? 0.78 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.radio,
          { borderColor: selected ? colors.accent : colors.faint },
          selected && { backgroundColor: colors.accent },
        ]}
      >
        {selected && <Icon name="check" size={14} color={colors.onAccent} />}
      </View>
      <View style={styles.choiceValueContent}>
        <Text style={[styles.choiceLabel, { color: colors.secondary }]}>{label}</Text>
        {children ?? (compareTo !== undefined ? (
          <Text style={[styles.choiceValue, { color: colors.ink }]}>
            {addedWords(compareTo, value ?? '').map((segment, index) => (
              <Text key={index} style={segment.added ? { color: colors.onTint, backgroundColor: colors.tint } : undefined}>{segment.text}</Text>
            ))}
          </Text>
        ) : (
          <Text style={[styles.choiceValue, { color: colors.ink }]}>
            {value}
          </Text>
        ))}
      </View>
    </Pressable>
  )
}

function ProposalValue({ label, value, hint, children }: {
  label: string
  value?: string
  hint?: string
  children?: ReactNode
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.choice}>
      <View style={styles.choiceValueContent}>
        <Text style={[styles.choiceLabel, { color: colors.secondary }]}>{label}</Text>
        {children ?? <Text style={[styles.choiceValue, { color: colors.ink }]}>{value}</Text>}
        {hint && <Text style={[styles.hint, { color: colors.secondary }]}>{hint}</Text>}
      </View>
    </View>
  )
}

// Full-screen "Co zmienić?" comparison of the current note and a proposal.
export function ProposalChooser({
  visible,
  reducedMotion,
  note,
  proposal,
  proposalCurrent,
  selection,
  changeCount,
  error,
  discarding,
  processing,
  onChoose,
  onApply,
  onDiscard,
  onClose,
}: {
  visible: boolean
  reducedMotion: boolean
  note: Note
  proposal: NoteProposal | undefined
  proposalCurrent: boolean
  selection: NoteProposalSelection
  changeCount: number
  error: string | null
  discarding: boolean
  processing: boolean
  onChoose: (field: ProposalField, useNewValue: boolean) => void
  onApply: () => void
  onDiscard: () => void
  onClose: () => void
}) {
  const { colors } = useTheme()
  const { t, language } = useI18n()
  const insets = useSafeAreaInsets()
  const proposalChanges = proposal ? getNoteProposalChanges(proposal) : { title: false, summary: false, tags: false }
  const changedFieldCount = Object.values(proposalChanges).filter(Boolean).length
  const titleAvailable = Boolean(proposal && isNoteProposalFieldAvailable(proposal, 'title'))
  const summaryAvailable = Boolean(proposal && isNoteProposalFieldAvailable(proposal, 'summary'))
  const tagsAvailable = Boolean(proposal && isNoteProposalFieldAvailable(proposal, 'tags'))
  const unavailableValue = t(
    'Nie udało się przygotować tego pola. Obecna wartość pozostanie.',
    'This field could not be prepared. The current value will be kept.',
  )
  const pluralChanges = (count: number): string =>
    language === 'en'
      ? count === 1
        ? 'change'
        : 'changes'
      : plPlural(count, 'zmianę', 'zmiany', 'zmian')
  const categories = (tags: string[]) => tags.length > 0 ? (
    <NoteTags tags={tags} onChange={() => undefined} editable={false} showLabel={false} compact />
  ) : (
    <Text style={[styles.choiceValue, { color: colors.secondary }]}>
      {t('Bez kategorii', 'No categories')}
    </Text>
  )
  const group = (title: string, children: ReactNode) => (
    <View style={styles.proposalSection}>
      <Text style={[styles.choiceSectionTitle, { color: colors.secondary }]}>{title}</Text>
      <View style={[styles.choiceGroup, { backgroundColor: colors.group }]}>{children}</View>
    </View>
  )
  const divider = <View style={[styles.choiceDivider, { backgroundColor: colors.line }]} />

  return (
    <Modal
      visible={visible}
      animationType={reducedMotion ? 'fade' : 'slide'}
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        accessibilityViewIsModal
        style={[styles.choiceScreen, { backgroundColor: colors.canvas }]}
      >
        <View
          style={[
            styles.choiceHeader,
            { paddingTop: insets.top + spacing.xs, borderBottomColor: colors.line },
          ]}
        >
          <View style={styles.choiceCancel}>
            <Button compact variant="quiet" label={t('Anuluj', 'Cancel')} onPress={onClose} disabled={discarding} />
          </View>
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.choiceScreenTitle, { color: colors.ink }]}>
            {t('Nowa wersja', 'New version')}
          </Text>
          <View style={styles.choiceCancel} />
        </View>

        <ScrollView
          style={styles.choiceScroll}
          contentContainerStyle={styles.choiceScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: spacing.xs }}>
            <Text style={[type.noteTitle, { color: colors.ink }]}>
              {t('Co zmienić?', 'What should change?')}
            </Text>
            <Text style={[styles.choiceIntro, { color: colors.secondary }]}>
              {t(
                'Nowe fragmenty są zakreślone. Dopóki nic nie wybierzesz, zostaje obecna wersja.',
                'New parts are highlighted. Until you pick something, the current version stays.',
              )}
            </Text>
          </View>
          {proposal && proposalCurrent ? (
            <>
              {changedFieldCount === 0 && (
                <Text accessibilityLiveRegion="polite" style={[styles.choiceValue, { color: colors.secondary }]}>
                  {titleAvailable && summaryAvailable && tagsAvailable
                    ? t('Brak zmian. Propozycje są takie same jak obecne wartości.', 'No changes. The suggestions match the current values.')
                    : t('Brak zmian do zastosowania.', 'No changes to apply.')}
                </Text>
              )}
              {proposal.generated.warnings?.map((warning, index) => (
                <Text key={index} accessibilityRole="alert" style={[styles.choiceValue, { color: colors.secondary }]}>
                  {warning}
                </Text>
              ))}
              {error && (
                <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
                  {error}
                </Text>
              )}
              {group(t('Tytuł', 'Title'), proposalChanges.title ? (
                <>
                  <ProposalChoice
                    label={t('Obecny', 'Current')}
                    value={note.title.trim() || t('Bez tytułu', 'Untitled')}
                    selected={!selection.title}
                    onPress={() => onChoose('title', false)}
                  />
                  {divider}
                  <ProposalChoice
                    label={t('Nowy', 'New')}
                    value={proposal.generated.title}
                    compareTo={note.title}
                    selected={selection.title}
                    disabled={discarding}
                    onPress={() => onChoose('title', true)}
                  />
                </>
              ) : (
                <ProposalValue
                  label={titleAvailable ? t('Bez zmian', 'No change') : t('Niedostępne', 'Unavailable')}
                  value={note.title.trim() || t('Bez tytułu', 'Untitled')}
                  hint={titleAvailable ? undefined : unavailableValue}
                />
              ))}
              {group(t('Podsumowanie', 'Summary'), proposalChanges.summary ? (
                <>
                  <ProposalChoice
                    label={t('Obecne', 'Current')}
                    value={note.summary?.trim() || t('Brak podsumowania', 'No summary')}
                    selected={!selection.summary}
                    onPress={() => onChoose('summary', false)}
                  />
                  {divider}
                  <ProposalChoice
                    label={t('Nowe', 'New')}
                    value={proposal.generated.summary.trim() || t('Brak podsumowania', 'No summary')}
                    compareTo={note.summary ?? ''}
                    selected={selection.summary}
                    disabled={discarding}
                    onPress={() => onChoose('summary', true)}
                  />
                </>
              ) : (
                <ProposalValue
                  label={summaryAvailable ? t('Bez zmian', 'No change') : t('Niedostępne', 'Unavailable')}
                  value={note.summary?.trim() || t('Brak podsumowania', 'No summary')}
                  hint={summaryAvailable ? undefined : unavailableValue}
                />
              ))}
              {group(t('Kategorie', 'Categories'), proposalChanges.tags ? (
                <>
                  <ProposalChoice
                    label={t('Obecne', 'Current')}
                    selected={!selection.tags}
                    onPress={() => onChoose('tags', false)}
                  >
                    {categories(note.tags)}
                  </ProposalChoice>
                  {divider}
                  <ProposalChoice
                    label={t('Nowe', 'New')}
                    selected={selection.tags}
                    disabled={discarding}
                    onPress={() => onChoose('tags', true)}
                  >
                    {categories(proposal.generated.tags)}
                  </ProposalChoice>
                </>
              ) : (
                <ProposalValue
                  label={tagsAvailable ? t('Bez zmian', 'No change') : t('Niedostępne', 'Unavailable')}
                  hint={tagsAvailable ? undefined : unavailableValue}
                >
                  {categories(note.tags)}
                </ProposalValue>
              ))}
            </>
          ) : (
            <Text style={[styles.choiceValue, { color: colors.secondary }]}>
              {t(
                'Propozycja nie jest już aktualna. Zamknij ekran i wygeneruj ją ponownie.',
                'The suggestion is no longer current. Close this screen and generate it again.',
              )}
            </Text>
          )}
        </ScrollView>

        <View
          style={[
            styles.choiceFooter,
            {
              backgroundColor: colors.canvas,
              borderTopColor: colors.line,
              paddingBottom: Math.max(insets.bottom, spacing.md),
            },
          ]}
        >
          {proposal && (
            <Button
              label={t(
                `Zastosuj ${changeCount} ${pluralChanges(changeCount)}`,
                `Apply ${changeCount} ${pluralChanges(changeCount)}`,
              )}
              variant="primary"
              onPress={onApply}
              disabled={changeCount === 0 || discarding || processing}
            />
          )}
          {proposal && (
            <Button
              label={discarding
                ? t('Odrzucanie propozycji…', 'Discarding suggestions…')
                : t('Odrzuć propozycje', 'Discard suggestions')}
              variant="quiet"
              onPress={onDiscard}
              disabled={discarding || processing}
            />
          )}
          {/* The header already has Cancel; repeat it only when nothing else is offered. */}
          {!proposal && (
            <Button label={t('Anuluj', 'Cancel')} variant="secondary" onPress={onClose} disabled={discarding} />
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  hint: { ...type.meta },
  error: { ...type.body },
  proposalSection: { gap: spacing.sm },
  choiceSectionTitle: { ...type.caption, textTransform: 'uppercase', letterSpacing: 0.3, marginHorizontal: 4 },
  choice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: 66,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
  },
  radio: {
    width: 22,
    height: 22,
    marginTop: 2,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceValueContent: { flex: 1, gap: spacing.xs },
  choiceLabel: { ...type.meta, ...font.semibold },
  choiceValue: { ...type.body },
  choiceScreen: { flex: 1 },
  choiceHeader: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  choiceCancel: { width: 96, minHeight: 44, justifyContent: 'center', alignItems: 'flex-start' },
  choiceScreenTitle: { ...type.title, textAlign: 'center', flex: 1 },
  choiceScroll: { flex: 1 },
  choiceScrollContent: {
    paddingHorizontal: 20,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  choiceIntro: { ...type.meta },
  choiceGroup: { borderRadius: 12, overflow: 'hidden' },
  choiceDivider: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  choiceFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
})
