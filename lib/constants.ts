import {
  OVERAGE_RATES,
  PLAN_LIMITS,
  type UserPlan,
} from './billing/catalog'

export {
  AI_MODELS,
  BILLING_PLANS,
  IMAGE_MODEL_ECONOMICS,
  OVERAGE_RATES,
  PLAN_LIMITS,
  getImageCreditWeight,
} from './billing/catalog'
export type { UserPlan } from './billing/catalog'

// App Store Connect locales (50 locales; Apple's locale shortcode table, API 4.3.1+)
export const APPSTORE_LOCALES = [
  'ar-SA', 'bn-BD', 'ca', 'cs', 'da', 'de-DE', 'el', 'en-AU', 'en-CA', 'en-GB', 'en-US',
  'es-ES', 'es-MX', 'fi', 'fr-CA', 'fr-FR', 'gu-IN', 'he', 'hi', 'hr', 'hu', 'id',
  'it', 'ja', 'kn-IN', 'ko', 'ml-IN', 'mr-IN', 'ms', 'nl-NL', 'no', 'or-IN', 'pa-IN',
  'pl', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sk', 'sl-SI', 'sv', 'ta-IN', 'te-IN', 'th', 'tr',
  'uk', 'ur-PK', 'vi', 'zh-Hans', 'zh-Hant'
] as const

export type AppStoreLocale = typeof APPSTORE_LOCALES[number]

// Google Play Store locales (77 locales)
export const PLAYSTORE_LOCALES = [
  'af', 'am', 'ar', 'hy-AM', 'az-AZ', 'eu-ES', 'be', 'bn-BD', 'bg', 'my-MM',
  'ca', 'zh-HK', 'zh-CN', 'zh-TW', 'hr', 'cs-CZ', 'da-DK', 'nl-NL', 'en-AU',
  'en-CA', 'en-IN', 'en-SG', 'en-ZA', 'en-GB', 'en-US', 'et', 'fil', 'fi-FI',
  'fr-CA', 'fr-FR', 'gl-ES', 'ka-GE', 'de-DE', 'el-GR', 'gu', 'iw-IL', 'hi-IN',
  'hu-HU', 'is-IS', 'id', 'it-IT', 'ja-JP', 'kn-IN', 'kk', 'km-KH', 'ko-KR',
  'ky-KG', 'lo-LA', 'lv', 'lt', 'mk-MK', 'ms', 'ms-MY', 'ml-IN', 'mr-IN',
  'mn-MN', 'ne-NP', 'no-NO', 'fa', 'pl-PL', 'pt-BR', 'pt-PT', 'pa', 'ro',
  'rm', 'ru-RU', 'sr', 'si-LK', 'sk', 'sl', 'es-419', 'es-ES', 'es-US',
  'sw', 'sv-SE', 'ta-IN', 'te-IN', 'th', 'tr-TR', 'uk', 'ur', 'vi', 'zu'
] as const

export type PlayStoreLocale = typeof PLAYSTORE_LOCALES[number]

// Type guards for locale validation (avoids 'as any' casts)
export function isAppStoreLocale(locale: string): locale is AppStoreLocale {
  return (APPSTORE_LOCALES as readonly string[]).includes(locale)
}

export function isPlayStoreLocale(locale: string): locale is PlayStoreLocale {
  return (PLAYSTORE_LOCALES as readonly string[]).includes(locale)
}

// iOS to Android locale mapping
export const IOS_TO_ANDROID_LOCALE_MAP: Record<string, string> = {
  'ar-SA': 'ar',
  'ca': 'ca',
  'cs': 'cs-CZ',
  'da': 'da-DK',
  'de-DE': 'de-DE',
  'el': 'el-GR',
  'en-AU': 'en-AU',
  'en-CA': 'en-CA',
  'en-GB': 'en-GB',
  'en-US': 'en-US',
  'es-ES': 'es-ES',
  'es-MX': 'es-419',
  'fi': 'fi-FI',
  'fr-CA': 'fr-CA',
  'fr-FR': 'fr-FR',
  'he': 'iw-IL',
  'hi': 'hi-IN',
  'hr': 'hr',
  'hu': 'hu-HU',
  'id': 'id',
  'it': 'it-IT',
  'ja': 'ja-JP',
  'ko': 'ko-KR',
  'ms': 'ms-MY',
  'nl-NL': 'nl-NL',
  'no': 'no-NO',
  'pl': 'pl-PL',
  'pt-BR': 'pt-BR',
  'pt-PT': 'pt-PT',
  'ro': 'ro',
  'ru': 'ru-RU',
  'sk': 'sk',
  'sv': 'sv-SE',
  'th': 'th',
  'tr': 'tr-TR',
  'uk': 'uk',
  'vi': 'vi',
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-TW',
  // Added to the App Store in API 4.3.1 (Play has no Odia listing locale)
  'bn-BD': 'bn-BD',
  'gu-IN': 'gu',
  'kn-IN': 'kn-IN',
  'ml-IN': 'ml-IN',
  'mr-IN': 'mr-IN',
  'pa-IN': 'pa',
  'sl-SI': 'sl',
  'ta-IN': 'ta-IN',
  'te-IN': 'te-IN',
  'ur-PK': 'ur',
}

// Android to iOS locale mapping (reverse of IOS_TO_ANDROID_LOCALE_MAP)
export const ANDROID_TO_IOS_LOCALE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(IOS_TO_ANDROID_LOCALE_MAP).map(([ios, android]) => [android, ios])
)

/**
 * Map a locale from one store format to another
 * Returns the mapped locale for the target store.
 * If the locale has an explicit mapping (e.g., iOS 'he' → Android 'iw-IL'), returns it.
 * Otherwise returns the locale as-is (same identifier on both platforms, e.g., 'en-US').
 */
export function mapLocale(locale: string, fromStore: string, toStore: string): string {
  if (fromStore === toStore) return locale
  const map = fromStore === 'ios' ? IOS_TO_ANDROID_LOCALE_MAP : ANDROID_TO_IOS_LOCALE_MAP
  return map[locale] ?? locale
}

// Character limits for App Store Connect
export const APPSTORE_LIMITS = {
  title: 30,
  subtitle: 30,
  keywords: 100,
  description: 4000,
  whatsNew: 4000,
  promotionalText: 170,
} as const

// Character limits for Google Play Store
export const PLAYSTORE_LIMITS = {
  title: 30,
  shortDescription: 80,
  fullDescription: 4000,
} as const

// In-App Purchase field limits (Google Play Store)
export const PLAYSTORE_IAP_LIMITS = {
  title: 55,
  description: 80,
  benefits: 4,               // Max benefit bullet points (subscriptions)
  sku: 150,                  // Product ID max length
} as const

// In-App Purchase field limits (App Store Connect)
export const IAP_LIMITS = {
  displayName: 30,
  description: 45,
  productId: 100,
  referenceName: 100,
  reviewNote: 4000,
} as const

// Screenshot dimensions for App Store (per Apple 2024/2025 specs)
// See: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/
export const APPSTORE_SCREENSHOT_SIZES = {
  '6.9': { width: 1260, height: 2736, name: 'iPhone 6.9" Display' },  // REQUIRED - iPhone 16 Pro Max, 15 Pro Max
  '6.5': { width: 1284, height: 2778, name: 'iPhone 6.5" Display' },  // Required if 6.9" not provided
  '6.3': { width: 1206, height: 2622, name: 'iPhone 6.3" Display' },  // Optional - iPhone 16 Pro, 15 Pro
  '6.1': { width: 1170, height: 2532, name: 'iPhone 6.1" Display' },  // Optional - iPhone 14, 13, 12
  '5.5': { width: 1242, height: 2208, name: 'iPhone 5.5" Display' },  // Optional - iPhone 8 Plus
  'ipad-13': { width: 2064, height: 2752, name: 'iPad 13" Display' }, // REQUIRED - iPad Pro M4/M5
  'ipad-12.9': { width: 2048, height: 2732, name: 'iPad 12.9" Display' }, // Optional (legacy)
  'ipad-11': { width: 1668, height: 2388, name: 'iPad 11" Display' }, // Optional
  'watch-ultra-3': { width: 422, height: 514, name: 'Apple Watch Ultra 3 Display' }, // Optional
  'watch-ultra': { width: 410, height: 502, name: 'Apple Watch Ultra Display' }, // Optional
  'watch-10': { width: 416, height: 496, name: 'Apple Watch Series 10/11 Display' }, // REQUIRED for watchOS apps
  'watch-7': { width: 396, height: 484, name: 'Apple Watch Series 7-9 Display' }, // Fallback
  'watch-4': { width: 368, height: 448, name: 'Apple Watch Series 4-6 / SE Display' }, // Fallback
  'watch-3': { width: 312, height: 390, name: 'Apple Watch Series 3 Display' }, // Legacy
} as const

// App Icon sizes for iOS and Android
export const ICON_SIZES = {
  ios: { width: 1024, height: 1024, name: 'iOS App Store' },
  android: { width: 512, height: 512, name: 'Google Play Store' },
} as const

export type IconPlatform = keyof typeof ICON_SIZES

// Canonical presets. Legacy IDs remain accepted at API/storage boundaries.
export const ICON_STYLES = ['liquid-glass', 'tactile-3d', 'mascot', 'gradient-glyph', 'clay', 'premium-dark', 'illustrated', 'isometric', 'line', 'brand'] as const
export type ModernIconStyle = typeof ICON_STYLES[number]
export const LEGACY_ICON_STYLE_MAP = {
  flat: 'gradient-glyph', '3d': 'tactile-3d', minimalist: 'line', gradient: 'gradient-glyph',
  cute: 'mascot', glassmorphism: 'liquid-glass', neon: 'premium-dark', duotone: 'gradient-glyph',
  watercolor: 'illustrated', sketch: 'illustrated', pixel: 'illustrated', metallic: 'premium-dark',
  geometric: 'gradient-glyph', retro: 'illustrated',
} as const satisfies Record<string, ModernIconStyle>
export type IconStyle = ModernIconStyle | keyof typeof LEGACY_ICON_STYLE_MAP
export const ICON_STYLE_IDS = [...ICON_STYLES, ...Object.keys(LEGACY_ICON_STYLE_MAP)]
export function isIconStyle(style: string): style is IconStyle {
  return (ICON_STYLES as readonly string[]).includes(style) || Object.hasOwn(LEGACY_ICON_STYLE_MAP, style)
}
export function normalizeIconStyle(style: IconStyle): ModernIconStyle {
  return LEGACY_ICON_STYLE_MAP[style as keyof typeof LEGACY_ICON_STYLE_MAP] || style as ModernIconStyle
}

// Category-to-icon style mapping with prompt enhancements
export const ICON_STYLE_TEMPLATES: Record<AppCategory, {
  suggestedStyle: IconStyle
  colorSuggestions: { primary: string; secondary: string }
  promptEnhancement: string
  subjectSuggestions: string[]
}> = {
  kids: {
    suggestedStyle: 'cute',
    colorSuggestions: { primary: '#FFB6C1', secondary: '#E6E6FA' },
    promptEnhancement: 'playful, child-friendly, soft rounded shapes, bright cheerful colors',
    subjectSuggestions: ['teddy bear', 'star', 'rainbow', 'balloon', 'cute animal'],
  },
  productivity: {
    suggestedStyle: 'minimalist',
    colorSuggestions: { primary: '#4A90D9', secondary: '#FFFFFF' },
    promptEnhancement: 'clean lines, professional, modern, simple geometric shapes',
    subjectSuggestions: ['checkmark', 'calendar', 'list', 'clock', 'document'],
  },
  fitness: {
    suggestedStyle: '3d',
    colorSuggestions: { primary: '#FF6B35', secondary: '#1E1E1E' },
    promptEnhancement: 'dynamic, energetic, bold, powerful, motion-inspired',
    subjectSuggestions: ['dumbbell', 'heart rate', 'running figure', 'flame', 'lightning bolt'],
  },
  social: {
    suggestedStyle: 'gradient',
    colorSuggestions: { primary: '#8B5CF6', secondary: '#EC4899' },
    promptEnhancement: 'vibrant, trendy, modern, youthful, engaging',
    subjectSuggestions: ['chat bubble', 'heart', 'people', 'connection', 'smile'],
  },
  finance: {
    suggestedStyle: 'flat',
    colorSuggestions: { primary: '#10B981', secondary: '#1F2937' },
    promptEnhancement: 'trustworthy, premium, secure, professional, elegant',
    subjectSuggestions: ['dollar sign', 'chart', 'piggy bank', 'wallet', 'shield'],
  },
  utility: {
    suggestedStyle: 'minimalist',
    colorSuggestions: { primary: '#6B7280', secondary: '#FFFFFF' },
    promptEnhancement: 'functional, simple, clear, straightforward, clean',
    subjectSuggestions: ['gear', 'wrench', 'lightbulb', 'magnifying glass', 'settings'],
  },
  entertainment: {
    suggestedStyle: '3d',
    colorSuggestions: { primary: '#F43F5E', secondary: '#7C3AED' },
    promptEnhancement: 'fun, exciting, eye-catching, dynamic, playful',
    subjectSuggestions: ['play button', 'popcorn', 'music note', 'star', 'sparkle'],
  },
  education: {
    suggestedStyle: 'flat',
    colorSuggestions: { primary: '#3B82F6', secondary: '#22C55E' },
    promptEnhancement: 'inspiring, approachable, friendly, knowledge-focused',
    subjectSuggestions: ['book', 'graduation cap', 'lightbulb', 'pencil', 'brain'],
  },
  lifestyle: {
    suggestedStyle: 'gradient',
    colorSuggestions: { primary: '#F59E0B', secondary: '#EF4444' },
    promptEnhancement: 'aspirational, warm, inviting, personal, elegant',
    subjectSuggestions: ['sun', 'leaf', 'home', 'coffee cup', 'camera'],
  },
  health: {
    suggestedStyle: 'flat',
    colorSuggestions: { primary: '#06B6D4', secondary: '#10B981' },
    promptEnhancement: 'calming, trustworthy, clean, peaceful, wellness-focused',
    subjectSuggestions: ['heart', 'cross', 'apple', 'meditation figure', 'leaf'],
  },
}

// App categories for screenshot templates
export const APP_CATEGORIES = [
  'kids',
  'productivity',
  'fitness',
  'social',
  'finance',
  'utility',
  'entertainment',
  'education',
  'lifestyle',
  'health',
] as const

export type AppCategory = typeof APP_CATEGORIES[number]

// Category template styles for screenshot generation
export const CATEGORY_TEMPLATES: Record<AppCategory, {
  gradientColors: { primary: string; secondary: string }
  frameDescription: string
  fontStyle: string
  styleDescription: string
  decorativeElements: string[]
}> = {
  kids: {
    gradientColors: { primary: '#E8D5F2', secondary: '#F5D0E0' },
    frameDescription: 'Soft lavender to pink gradient background with subtle sparkle effects',
    fontStyle: 'rounded, friendly font in white with soft shadow',
    styleDescription: 'Whimsical and child-friendly with playful decorative elements',
    decorativeElements: ['stars', 'moons', 'clouds', 'sparkles', 'hearts'],
  },
  productivity: {
    gradientColors: { primary: '#F5F5F7', secondary: '#FFFFFF' },
    frameDescription: 'Clean light gray to white gradient background',
    fontStyle: 'modern sans-serif in dark gray',
    styleDescription: 'Minimalist and professional with clean lines',
    decorativeElements: ['geometric shapes', 'checkmarks', 'subtle lines'],
  },
  fitness: {
    gradientColors: { primary: '#FF6B6B', secondary: '#FF9500' },
    frameDescription: 'Energetic coral to orange gradient background',
    fontStyle: 'bold sans-serif in white with slight shadow',
    styleDescription: 'Dynamic and energetic with motion-inspired elements',
    decorativeElements: ['motion curves', 'energy waves', 'abstract shapes'],
  },
  social: {
    gradientColors: { primary: '#8B5CF6', secondary: '#3B82F6' },
    frameDescription: 'Vibrant purple to blue gradient background',
    fontStyle: 'modern rounded font in white',
    styleDescription: 'Trendy and youthful with floating elements',
    decorativeElements: ['floating shapes', 'hearts', 'bubbles', 'emojis'],
  },
  finance: {
    gradientColors: { primary: '#1E3A5F', secondary: '#334155' },
    frameDescription: 'Professional navy to slate gradient background',
    fontStyle: 'elegant serif or clean sans-serif in white or gold',
    styleDescription: 'Premium and trustworthy with subtle patterns',
    decorativeElements: ['geometric patterns', 'shields', 'subtle lines'],
  },
  utility: {
    gradientColors: { primary: '#F3F4F6', secondary: '#FFFFFF' },
    frameDescription: 'Simple light gray to white gradient background',
    fontStyle: 'clean sans-serif in dark gray',
    styleDescription: 'Clean and straightforward with functional icons',
    decorativeElements: ['functional icons', 'minimal shapes'],
  },
  entertainment: {
    gradientColors: { primary: '#EC4899', secondary: '#8B5CF6' },
    frameDescription: 'Vibrant pink to purple gradient background',
    fontStyle: 'bold and playful font in white',
    styleDescription: 'Fun and eye-catching with dynamic elements',
    decorativeElements: ['stars', 'confetti', 'sparkles', 'ribbons'],
  },
  education: {
    gradientColors: { primary: '#10B981', secondary: '#3B82F6' },
    frameDescription: 'Fresh green to blue gradient background',
    fontStyle: 'friendly rounded font in white',
    styleDescription: 'Approachable and inspiring with educational elements',
    decorativeElements: ['books', 'lightbulbs', 'stars', 'geometric shapes'],
  },
  lifestyle: {
    gradientColors: { primary: '#F59E0B', secondary: '#EF4444' },
    frameDescription: 'Warm amber to red gradient background',
    fontStyle: 'elegant script or modern sans in white',
    styleDescription: 'Aspirational and warm with lifestyle elements',
    decorativeElements: ['leaves', 'abstract shapes', 'soft textures'],
  },
  health: {
    gradientColors: { primary: '#06B6D4', secondary: '#10B981' },
    frameDescription: 'Calming cyan to green gradient background',
    fontStyle: 'clean and calming font in white',
    styleDescription: 'Peaceful and trustworthy with health-focused elements',
    decorativeElements: ['hearts', 'waves', 'leaves', 'soft curves'],
  },
}

// Priority locales (translate these first)
export const PRIORITY_LOCALES = ['en-US', 'de-DE', 'fr-FR', 'es-ES', 'ja', 'zh-Hans', 'ko'] as const

// Locale display names
export const LOCALE_NAMES: Record<string, string> = {
  'gu-IN': 'Gujarati',
  'or-IN': 'Odia',
  'pa-IN': 'Punjabi',
  'sl-SI': 'Slovenian',
  'ur-PK': 'Urdu',
  'ar-SA': 'Arabic (Saudi Arabia)',
  'ca': 'Catalan',
  'cs': 'Czech',
  'da': 'Danish',
  'de-DE': 'German',
  'el': 'Greek',
  'en-AU': 'English (Australia)',
  'en-CA': 'English (Canada)',
  'en-GB': 'English (UK)',
  'en-US': 'English (US)',
  'es-ES': 'Spanish (Spain)',
  'es-MX': 'Spanish (Mexico)',
  'fi': 'Finnish',
  'fr-CA': 'French (Canada)',
  'fr-FR': 'French',
  'he': 'Hebrew',
  'hi': 'Hindi',
  'hr': 'Croatian',
  'hu': 'Hungarian',
  'id': 'Indonesian',
  'it': 'Italian',
  'ja': 'Japanese',
  'ko': 'Korean',
  'ms': 'Malay',
  'nl-NL': 'Dutch',
  'no': 'Norwegian',
  'pl': 'Polish',
  'pt-BR': 'Portuguese (Brazil)',
  'pt-PT': 'Portuguese (Portugal)',
  'ro': 'Romanian',
  'ru': 'Russian',
  'sk': 'Slovak',
  'sv': 'Swedish',
  'th': 'Thai',
  'tr': 'Turkish',
  'uk': 'Ukrainian',
  'vi': 'Vietnamese',
  'zh-Hans': 'Chinese (Simplified)',
  'zh-Hant': 'Chinese (Traditional)',
  // Play Store locale variants (additional to App Store locales above)
  'af': 'Afrikaans',
  'am': 'Amharic',
  'hy-AM': 'Armenian',
  'az-AZ': 'Azerbaijani',
  'eu-ES': 'Basque',
  'be': 'Belarusian',
  'bn-BD': 'Bengali',
  'my-MM': 'Burmese',
  'zh-HK': 'Chinese (Hong Kong)',
  'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)',
  'cs-CZ': 'Czech',
  'da-DK': 'Danish',
  'en-IN': 'English (India)',
  'en-SG': 'English (Singapore)',
  'en-ZA': 'English (South Africa)',
  'et': 'Estonian',
  'fil': 'Filipino',
  'fi-FI': 'Finnish',
  'gl-ES': 'Galician',
  'ka-GE': 'Georgian',
  'el-GR': 'Greek',
  'gu': 'Gujarati',
  'iw-IL': 'Hebrew',
  'hi-IN': 'Hindi',
  'hu-HU': 'Hungarian',
  'is-IS': 'Icelandic',
  'it-IT': 'Italian',
  'ja-JP': 'Japanese',
  'kn-IN': 'Kannada',
  'kk': 'Kazakh',
  'km-KH': 'Khmer',
  'ko-KR': 'Korean',
  'ky-KG': 'Kyrgyz',
  'lo-LA': 'Lao',
  'lv': 'Latvian',
  'lt': 'Lithuanian',
  'mk-MK': 'Macedonian',
  'ms-MY': 'Malay',
  'ml-IN': 'Malayalam',
  'mr-IN': 'Marathi',
  'mn-MN': 'Mongolian',
  'ne-NP': 'Nepali',
  'no-NO': 'Norwegian',
  'fa': 'Persian',
  'pl-PL': 'Polish',
  'pa': 'Punjabi',
  'rm': 'Romansh',
  'ru-RU': 'Russian',
  'sr': 'Serbian',
  'si-LK': 'Sinhala',
  'sl': 'Slovenian',
  'es-419': 'Spanish (Latin America)',
  'es-US': 'Spanish (US)',
  'sw': 'Swahili',
  'sv-SE': 'Swedish',
  'ta-IN': 'Tamil',
  'te-IN': 'Telugu',
  'tr-TR': 'Turkish',
  'ur': 'Urdu',
  'zu': 'Zulu',
}

// Locale flags (emoji)
export const LOCALE_FLAGS: Record<string, string> = {
  'gu-IN': '🇮🇳',
  'or-IN': '🇮🇳',
  'pa-IN': '🇮🇳',
  'sl-SI': '🇸🇮',
  'ur-PK': '🇵🇰',
  'ar-SA': '🇸🇦',
  'ca': '🇪🇸',
  'cs': '🇨🇿',
  'da': '🇩🇰',
  'de-DE': '🇩🇪',
  'el': '🇬🇷',
  'en-AU': '🇦🇺',
  'en-CA': '🇨🇦',
  'en-GB': '🇬🇧',
  'en-US': '🇺🇸',
  'es-ES': '🇪🇸',
  'es-MX': '🇲🇽',
  'fi': '🇫🇮',
  'fr-CA': '🇨🇦',
  'fr-FR': '🇫🇷',
  'he': '🇮🇱',
  'hi': '🇮🇳',
  'hr': '🇭🇷',
  'hu': '🇭🇺',
  'id': '🇮🇩',
  'it': '🇮🇹',
  'ja': '🇯🇵',
  'ko': '🇰🇷',
  'ms': '🇲🇾',
  'nl-NL': '🇳🇱',
  'no': '🇳🇴',
  'pl': '🇵🇱',
  'pt-BR': '🇧🇷',
  'pt-PT': '🇵🇹',
  'ro': '🇷🇴',
  'ru': '🇷🇺',
  'sk': '🇸🇰',
  'sv': '🇸🇪',
  'th': '🇹🇭',
  'tr': '🇹🇷',
  'uk': '🇺🇦',
  'vi': '🇻🇳',
  'zh-Hans': '🇨🇳',
  'zh-Hant': '🇹🇼',
  // Play Store locale variants
  'af': '🇿🇦',
  'am': '🇪🇹',
  'hy-AM': '🇦🇲',
  'az-AZ': '🇦🇿',
  'eu-ES': '🇪🇸',
  'be': '🇧🇾',
  'bn-BD': '🇧🇩',
  'my-MM': '🇲🇲',
  'zh-HK': '🇭🇰',
  'zh-CN': '🇨🇳',
  'zh-TW': '🇹🇼',
  'cs-CZ': '🇨🇿',
  'da-DK': '🇩🇰',
  'en-IN': '🇮🇳',
  'en-SG': '🇸🇬',
  'en-ZA': '🇿🇦',
  'et': '🇪🇪',
  'fil': '🇵🇭',
  'fi-FI': '🇫🇮',
  'gl-ES': '🇪🇸',
  'ka-GE': '🇬🇪',
  'el-GR': '🇬🇷',
  'gu': '🇮🇳',
  'iw-IL': '🇮🇱',
  'hi-IN': '🇮🇳',
  'hu-HU': '🇭🇺',
  'is-IS': '🇮🇸',
  'it-IT': '🇮🇹',
  'ja-JP': '🇯🇵',
  'kn-IN': '🇮🇳',
  'kk': '🇰🇿',
  'km-KH': '🇰🇭',
  'ko-KR': '🇰🇷',
  'ky-KG': '🇰🇬',
  'lo-LA': '🇱🇦',
  'lv': '🇱🇻',
  'lt': '🇱🇹',
  'mk-MK': '🇲🇰',
  'ms-MY': '🇲🇾',
  'ml-IN': '🇮🇳',
  'mr-IN': '🇮🇳',
  'mn-MN': '🇲🇳',
  'ne-NP': '🇳🇵',
  'no-NO': '🇳🇴',
  'fa': '🇮🇷',
  'pl-PL': '🇵🇱',
  'pa': '🇮🇳',
  'rm': '🇨🇭',
  'ru-RU': '🇷🇺',
  'sr': '🇷🇸',
  'si-LK': '🇱🇰',
  'sl': '🇸🇮',
  'es-419': '🌎',
  'es-US': '🇺🇸',
  'sw': '🇰🇪',
  'sv-SE': '🇸🇪',
  'ta-IN': '🇮🇳',
  'te-IN': '🇮🇳',
  'tr-TR': '🇹🇷',
  'ur': '🇵🇰',
  'zu': '🇿🇦',
}

// Rate limiting constants
export const RATE_LIMITS = {
  requestsPerMinute: 180,
  requestsPerHour: 2800,
  retryDelayMs: 1000,
  maxRetries: 3,
} as const

// Check if a plan has access to a feature (limit > 0 or unlimited)
export function hasPlanAccess(plan: UserPlan, feature: keyof typeof PLAN_LIMITS['starter']): boolean {
  const limit = PLAN_LIMITS[plan][feature]
  return limit === -1 || limit > 0
}

// Check if usage is in overage
export function isInOverage(plan: UserPlan, feature: 'translations' | 'screenshots' | 'icons', used: number): boolean {
  const limit = PLAN_LIMITS[plan][feature]
  if (limit === -1) return false // Unlimited
  return used >= limit
}

// Calculate overage cost
export function calculateOverageCost(plan: UserPlan, feature: 'translations' | 'screenshots' | 'icons', overageAmount: number): number {
  const rates = OVERAGE_RATES[plan]
  if (!rates || overageAmount <= 0) return 0
  return 0
}

// ============================================
// IAP REGIONAL PRICING STRATEGIES
// ============================================

// Pricing tier for regional pricing strategies
export interface PricingTierConfig {
  name: string                        // e.g., "Premium", "Standard", "Emerging"
  multiplier: number                  // Price multiplier (1.0, 0.7, 0.4)
  territories: string[]               // Territory codes (ISO 3166-1 alpha-3)
}

// Built-in pricing strategy configuration
export interface PricingStrategyConfig {
  id: string
  name: string
  description: string
  tiers: PricingTierConfig[]
}

// Built-in pricing strategies based on purchasing power parity (Big Mac Index style)
// These strategies help developers set regional prices that feel fair to local users
export const PRICING_STRATEGIES: Record<string, PricingStrategyConfig> = {
  equalized: {
    id: 'equalized',
    name: 'Apple Equalized',
    description: 'Use Apple automatic FX-based pricing. Prices are automatically adjusted based on current exchange rates.',
    tiers: [
      { name: 'All', multiplier: 1.0, territories: ['*'] }
    ]
  },

  ppp_standard: {
    id: 'ppp_standard',
    name: 'PPP Standard',
    description: 'Purchasing Power Parity with 3 tiers. Adjusts prices based on local economic conditions to maximize accessibility.',
    tiers: [
      {
        name: 'Premium',
        multiplier: 1.0,
        territories: [
          'USA', 'GBR', 'CHE', 'NOR', 'DNK', 'SWE', 'AUS', 'CAN', 'JPN', 'SGP',
          'IRL', 'NLD', 'BEL', 'AUT', 'FIN', 'LUX', 'DEU', 'FRA'
        ]
      },
      {
        name: 'Standard',
        multiplier: 0.7,
        territories: [
          'ESP', 'ITA', 'KOR', 'TWN', 'HKG', 'NZL', 'PRT', 'GRC', 'CZE', 'ISR',
          'SAU', 'ARE', 'KWT', 'QAT', 'POL', 'HUN', 'SVK', 'SVN', 'EST', 'LTU', 'LVA'
        ]
      },
      {
        name: 'Emerging',
        multiplier: 0.4,
        territories: [
          'BRA', 'MEX', 'IND', 'IDN', 'THA', 'VNM', 'PHL', 'TUR', 'RUS', 'ARG',
          'CHL', 'COL', 'PER', 'MYS', 'ZAF', 'EGY', 'NGA', 'PAK', 'BGD', 'UKR'
        ]
      }
    ]
  },

  aggressive_growth: {
    id: 'aggressive_growth',
    name: 'Aggressive Growth',
    description: 'Maximize downloads in emerging markets with deep discounts. Ideal for apps prioritizing user acquisition over short-term revenue.',
    tiers: [
      {
        name: 'Full Price',
        multiplier: 1.0,
        territories: ['USA', 'GBR', 'CHE', 'AUS', 'NOR', 'DNK', 'SWE']
      },
      {
        name: 'Discounted',
        multiplier: 0.5,
        territories: [
          'DEU', 'FRA', 'JPN', 'KOR', 'CAN', 'NLD', 'ITA', 'ESP', 'TWN', 'SGP',
          'HKG', 'NZL', 'ISR', 'IRL', 'BEL', 'AUT', 'FIN'
        ]
      },
      {
        name: 'Deep Discount',
        multiplier: 0.25,
        territories: [
          'IND', 'IDN', 'BRA', 'MEX', 'VNM', 'PHL', 'THA', 'TUR', 'RUS', 'ARG',
          'COL', 'PER', 'MYS', 'ZAF', 'EGY', 'NGA', 'PAK', 'BGD', 'UKR'
        ]
      }
    ]
  },

  premium_focus: {
    id: 'premium_focus',
    name: 'Premium Focus',
    description: 'Maintain higher prices across all markets. Ideal for premium/luxury apps that want to preserve brand positioning.',
    tiers: [
      {
        name: 'Premium Markets',
        multiplier: 1.0,
        territories: [
          'USA', 'GBR', 'CHE', 'NOR', 'DNK', 'SWE', 'AUS', 'CAN', 'JPN', 'SGP',
          'IRL', 'NLD', 'BEL', 'AUT', 'FIN', 'LUX', 'DEU', 'FRA'
        ]
      },
      {
        name: 'Standard Markets',
        multiplier: 0.85,
        territories: [
          'ESP', 'ITA', 'KOR', 'TWN', 'HKG', 'NZL', 'PRT', 'GRC', 'CZE', 'ISR',
          'SAU', 'ARE', 'KWT', 'QAT', 'POL', 'HUN'
        ]
      },
      {
        name: 'Other Markets',
        multiplier: 0.7,
        territories: [
          'BRA', 'MEX', 'IND', 'IDN', 'THA', 'VNM', 'PHL', 'TUR', 'RUS', 'ARG',
          'CHL', 'COL', 'MYS', 'ZAF'
        ]
      }
    ]
  },

  regional_balanced: {
    id: 'regional_balanced',
    name: 'Regional Balanced',
    description: 'Balanced approach with 4 regional tiers. Good for apps with global audience seeking reasonable localization.',
    tiers: [
      {
        name: 'North America & Western Europe',
        multiplier: 1.0,
        territories: ['USA', 'CAN', 'GBR', 'DEU', 'FRA', 'NLD', 'BEL', 'CHE', 'AUT', 'IRL']
      },
      {
        name: 'Advanced Asia & Australia',
        multiplier: 0.9,
        territories: ['JPN', 'KOR', 'SGP', 'HKG', 'TWN', 'AUS', 'NZL']
      },
      {
        name: 'Southern Europe & Middle East',
        multiplier: 0.65,
        territories: ['ESP', 'ITA', 'PRT', 'GRC', 'TUR', 'ISR', 'SAU', 'ARE', 'EGY']
      },
      {
        name: 'Emerging Markets',
        multiplier: 0.4,
        territories: ['BRA', 'MEX', 'IND', 'IDN', 'VNM', 'PHL', 'THA', 'MYS', 'ARG', 'COL', 'RUS']
      }
    ]
  }
}

// Get pricing strategy by ID
export function getPricingStrategy(strategyId: string): PricingStrategyConfig | null {
  return PRICING_STRATEGIES[strategyId] || null
}

// Get all pricing strategy options (for UI selectors)
export function getPricingStrategyOptions(): Array<{ id: string; name: string; description: string }> {
  return Object.values(PRICING_STRATEGIES).map(s => ({
    id: s.id,
    name: s.name,
    description: s.description
  }))
}

// Get multiplier for a specific territory in a strategy
export function getTerritoryMultiplier(strategyId: string, territory: string): number {
  const strategy = PRICING_STRATEGIES[strategyId]
  if (!strategy) return 1.0

  for (const tier of strategy.tiers) {
    if (tier.territories.includes('*') || tier.territories.includes(territory)) {
      return tier.multiplier
    }
  }

  // Default to 1.0 if territory not found (won't discount unknown territories)
  return 1.0
}

// All App Store territory codes (175 territories)
export const APP_STORE_TERRITORIES = [
  'USA', 'CAN', 'MEX', 'BRA', 'ARG', 'CHL', 'COL', 'PER', 'ECU', 'VEN',
  'GBR', 'DEU', 'FRA', 'ITA', 'ESP', 'NLD', 'BEL', 'CHE', 'AUT', 'SWE',
  'NOR', 'DNK', 'FIN', 'IRL', 'PRT', 'GRC', 'POL', 'CZE', 'HUN', 'ROU',
  'BGR', 'HRV', 'SVK', 'SVN', 'EST', 'LVA', 'LTU', 'UKR', 'RUS', 'TUR',
  'JPN', 'KOR', 'CHN', 'HKG', 'TWN', 'SGP', 'MYS', 'THA', 'VNM', 'PHL',
  'IDN', 'IND', 'PAK', 'BGD', 'LKA', 'NPL', 'SAU', 'ARE', 'KWT', 'QAT',
  'BHR', 'OMN', 'ISR', 'EGY', 'ZAF', 'NGA', 'KEN', 'GHA', 'TZA', 'UGA',
  'AUS', 'NZL', 'LUX', 'CYP', 'MLT', 'ISL', 'MCO', 'LIE', 'SMR', 'AND'
  // ... more territories (abbreviated for brevity)
] as const

export type AppStoreTerritory = typeof APP_STORE_TERRITORIES[number]
