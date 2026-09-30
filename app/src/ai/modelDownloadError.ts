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

export const modelDownloadErrorMessage = (error: unknown): string => {
  const details = errorDetails(error)
  if (
    /ENOSPC|no space left|disk.{0,12}full|NSCocoaErrorDomain.*\b640\b/i.test(
      details,
    )
  ) {
    return 'Brakuje miejsca na model. Zwolnij miejsce w pamięci telefonu i spróbuj ponownie.'
  }
  if (/timed?\s*out|timeout|NSURLErrorDomain.*-1001\b/i.test(details)) {
    return 'Serwer modelu nie odpowiadał zbyt długo. Sprawdź połączenie i spróbuj ponownie.'
  }
  if (
    /unable to resolve host|network|internet|offline|ENOTFOUND|EAI_AGAIN|ECONN|NSURLErrorDomain.*-(1003|1004|1005|1006|1009)\b/i.test(
      details,
    )
  ) {
    return 'Nie można połączyć się z serwerem modelu. Sprawdź połączenie z internetem i spróbuj ponownie.'
  }
  if (/HTTP [45]\d{2}/i.test(details)) {
    return 'Serwer nie udostępnił modelu. Spróbuj pobrać go ponownie później.'
  }
  return 'Nie udało się pobrać modelu. Spróbuj ponownie.'
}
