import { Text } from 'react-native'
import { categoryLabel } from '../../domain/categories'
import { useI18n } from '../../i18n/useI18n'
import { localeForLanguage, type Language } from '../../i18n/language'
import { type, useTheme } from '../../ui/theme'

// "4 listopada, 13:10 · Praca": date, time and the first category as text.
export const formatNoteMeta = (createdAt: number, tags: readonly string[], language: Language): string => {
  const date = new Date(createdAt)
  const locale = localeForLanguage(language)
  const day = date.toLocaleDateString(locale, { day: 'numeric', month: 'long' })
  const time = date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  const category = tags[0] ? ` · ${categoryLabel(tags[0], language)}` : ''
  return `${day}, ${time}${category}`
}

export function NoteMeta({ createdAt, tags }: { createdAt: number; tags: readonly string[] }) {
  const { colors } = useTheme()
  const { language } = useI18n()
  return (
    <Text style={{ ...type.meta, color: colors.secondary, marginTop: 6 }}>
      {formatNoteMeta(createdAt, tags, language)}
    </Text>
  )
}
