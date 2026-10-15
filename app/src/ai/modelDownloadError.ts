import { getAppLanguage } from '../i18n/translate'
import { selectText, type Language } from '../i18n/language'

// Expo can wrap NSError (iOS) or an IOException (Android). Keep their technical
// details out of the UI and offer an action that makes sense on either platform.
const errorDetails = (error: unknown, depth = 0): string => {
  if (depth > 4 || error == null) return ''
  if (typeof error === 'string' || typeof error === 'number')
    return String(error)
  if (typeof error !== 'object') return ''
  const value = error as Record<string, unknown>
  return ['message', 'domain', 'code', 'cause', 'userInfo', 'NSUnderlyingError']
    .map((key) => errorDetails(value[key], depth + 1))
    .join(' ')
}

export const modelDownloadErrorMessage = (
  error: unknown,
  language: Language = getAppLanguage(),
): string => {
  const t = (pl: string, en: string): string => selectText(language, pl, en)
  const details = errorDetails(error)
  if (
    /ENOSPC|no space left|disk.{0,12}full|NSCocoaErrorDomain.*\b640\b/i.test(
      details,
    )
  ) {
    return t(
      'Brakuje miejsca na model. Zwolnij miejsce w pamięci telefonu i spróbuj ponownie.',
      'There is not enough space for the model. Free up storage on your phone and try again.',
    )
  }
  if (/timed?\s*out|timeout|NSURLErrorDomain.*-1001\b/i.test(details)) {
    return t(
      'Serwer modelu nie odpowiadał zbyt długo. Sprawdź połączenie i spróbuj ponownie.',
      'The model server took too long to respond. Check your connection and try again.',
    )
  }
  if (
    /unable to resolve host|network|internet|offline|ENOTFOUND|EAI_AGAIN|ECONN|NSURLErrorDomain.*-(1003|1004|1005|1006|1009)\b/i.test(
      details,
    )
  ) {
    return t(
      'Nie można połączyć się z serwerem modelu. Sprawdź połączenie z internetem i spróbuj ponownie.',
      'Unable to connect to the model server. Check your internet connection and try again.',
    )
  }
  if (/HTTP [45]\d{2}/i.test(details)) {
    return t(
      'Serwer nie udostępnił modelu. Spróbuj pobrać go ponownie później.',
      'The model is unavailable from the server. Try downloading it again later.',
    )
  }
  return t(
    'Nie udało się pobrać modelu. Spróbuj ponownie.',
    'Unable to download the model. Try again.',
  )
}
