import { Alert, Linking } from 'react-native'
import { Button } from '../ui/Button'

export function PermissionSettingsButton() {
  return (
    <Button
      label="Otwórz ustawienia uprawnień"
      variant="quiet"
      icon="settings"
      onPress={() => {
        void Linking.openSettings().catch(() => {
          Alert.alert(
            'Uprawnienia aplikacji',
            'Otwórz ustawienia telefonu, znajdź Notatki i włącz dostęp do mikrofonu oraz rozpoznawania mowy.',
          )
        })
      }}
    />
  )
}
