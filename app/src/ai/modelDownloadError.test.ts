import { modelDownloadErrorMessage } from './modelDownloadError'

test.each([
  new Error(
    'Unable to resolve host "huggingface.co": No address associated with hostname',
  ),
  new Error(
    'Error Domain=NSURLErrorDomain Code=-1009 "The Internet connection appears to be offline."',
  ),
  {
    code: 'ERR_FILESYSTEM_DOWNLOAD',
    cause: { domain: 'NSURLErrorDomain', code: -1003 },
  },
])(
  'explains Android and iOS network failures without exposing native exceptions',
  (error) => {
    expect(modelDownloadErrorMessage(error)).toBe(
      'Nie można połączyć się z serwerem modelu. Sprawdź połączenie z internetem i spróbuj ponownie.',
    )
  },
)

test.each([
  new Error('ENOSPC: No space left on device'),
  { domain: 'NSCocoaErrorDomain', code: 640 },
])('explains insufficient device storage', (error) => {
  expect(modelDownloadErrorMessage(error)).toContain('Brakuje miejsca')
})

test('distinguishes timeout, server response and unknown errors', () => {
  expect(
    modelDownloadErrorMessage({ domain: 'NSURLErrorDomain', code: -1001 }),
  ).toContain('zbyt długo')
  expect(
    modelDownloadErrorMessage(
      new Error('Pobieranie modelu nie powiodło się (HTTP 503)'),
    ),
  ).toContain('Serwer')
  expect(
    modelDownloadErrorMessage(
      new Error('native failure /private/var/tmp/secret'),
    ),
  ).toBe('Nie udało się pobrać modelu. Spróbuj ponownie.')
})
