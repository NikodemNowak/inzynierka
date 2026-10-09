import { Alert, Linking } from 'react-native'
import { Button } from '../ui/Button'
import { useI18n } from '../i18n/useI18n'

export function PermissionSettingsButton() {
  const { t } = useI18n()
  return (
    <Button
      label={t('Otwórz ustawienia uprawnień', 'Open permission settings')}
      variant="quiet"
      icon="settings"
      onPress={() => {
        void Linking.openSettings().catch(() => {
          Alert.alert(
            t('Uprawnienia aplikacji', 'App permissions'),
            t(
              'Otwórz ustawienia telefonu, znajdź Notatki i włącz dostęp do mikrofonu oraz rozpoznawania mowy.',
              'Open your phone settings, find Notes and enable microphone and speech recognition access.',
            ),
          )
        })
      }}
    />
  )
}
