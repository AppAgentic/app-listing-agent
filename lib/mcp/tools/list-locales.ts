import { APPSTORE_LOCALES, PLAYSTORE_LOCALES, IOS_TO_ANDROID_LOCALE_MAP } from '@/lib/constants'

export interface ListLocalesParams {
  store: 'appstore' | 'playstore'
}

export interface ListLocalesResult {
  success: boolean
  store: string
  locales: string[]
  count: number
  mapping?: Record<string, string>
}

export async function listLocales(params: ListLocalesParams): Promise<ListLocalesResult> {
  const { store } = params

  if (store === 'appstore') {
    return {
      success: true,
      store: 'appstore',
      locales: [...APPSTORE_LOCALES],
      count: APPSTORE_LOCALES.length
    }
  } else if (store === 'playstore') {
    return {
      success: true,
      store: 'playstore',
      locales: [...PLAYSTORE_LOCALES],
      count: PLAYSTORE_LOCALES.length,
      mapping: IOS_TO_ANDROID_LOCALE_MAP
    }
  } else {
    return {
      success: false,
      store,
      locales: [],
      count: 0
    }
  }
}
