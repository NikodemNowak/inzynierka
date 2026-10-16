import { ActionSheetIOS, Alert, Platform } from 'react-native'
import { translate } from '../i18n/translate'
import { addTaskToCalendar, addTaskToReminders, remindersAvailable, type CalendarOutcome } from './taskCalendar'

type Target = 'reminders' | 'calendar'

const run = async (target: Target, text: string, recordedAt: Date, notes: string): Promise<CalendarOutcome> =>
  target === 'reminders' ? addTaskToReminders(text, recordedAt, notes) : addTaskToCalendar(text, recordedAt, notes)

const report = (target: Target, outcome: CalendarOutcome): void => {
  if (outcome === 'added' && target === 'reminders')
    Alert.alert(translate('Dodano do Przypomnień', 'Added to Reminders'))
  else if (outcome === 'denied')
    Alert.alert(
      translate('Brak dostępu do Przypomnień', 'No access to Reminders'),
      translate('Dostęp możesz włączyć w Ustawieniach systemu.', 'You can allow access in system Settings.'),
    )
  else if (outcome === 'unavailable')
    Alert.alert(translate('Przypomnienia są niedostępne', 'Reminders are unavailable'))
}

// Offer the system apps for one task. Nothing leaves the app until the user picks one.
export const offerTaskExport = (text: string, recordedAt: Date, noteTitle: string): void => {
  const notes = translate(`Z notatki: ${noteTitle}`, `From note: ${noteTitle}`)
  const choose = (target: Target): void => {
    void run(target, text, recordedAt, notes)
      .then((outcome) => report(target, outcome))
      .catch((cause: unknown) => Alert.alert(translate('Nie udało się dodać zadania', 'The task could not be added'), cause instanceof Error ? cause.message : String(cause)))
  }
  const targets: { target: Target; label: string }[] = [
    ...(remindersAvailable ? [{ target: 'reminders' as const, label: translate('Dodaj do Przypomnień', 'Add to Reminders') }] : []),
    { target: 'calendar', label: translate('Dodaj do Kalendarza', 'Add to Calendar') },
  ]
  const cancel = translate('Anuluj', 'Cancel')
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: [...targets.map((item) => item.label), cancel], cancelButtonIndex: targets.length, title: text },
      (index) => {
        const picked = targets[index]
        if (picked) choose(picked.target)
      },
    )
    return
  }
  Alert.alert(text, undefined, [
    ...targets.map((item) => ({ text: item.label, onPress: () => choose(item.target) })),
    { text: cancel, style: 'cancel' as const },
  ])
}
