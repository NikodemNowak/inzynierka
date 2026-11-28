import { translate } from '../i18n/translate'

// Back-button label for screens opened from the tabs: the focused tab's name.
export const tabsBackTitle = (focusedRouteName: string | undefined): string =>
  focusedRouteName === 'tasks'
    ? translate('Zadania', 'Tasks')
    : translate('Notatki', 'Notes')
