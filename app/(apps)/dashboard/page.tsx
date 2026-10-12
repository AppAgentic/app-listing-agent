'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { SupportButton } from '@/components/support/gleap-support'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useProjects } from '@/hooks/useSelectedProject'
import { useSelfHosted } from '@/components/selfhost/self-hosted-context'
import Starfield from '@/components/Starfield'
import {
  FolderKanban,
  Plus,
  Apple,
  Play,
  ArrowRight,
  Settings,
  X,
  Globe,
  Loader2,
  Check,
  AlertCircle,
  Smartphone,
  Tablet,
  Watch,
  LogOut,
  Search,
  ChevronRight,
  ChevronDown,
  ImageIcon,
  Link2
} from 'lucide-react'
import { APPSTORE_LOCALES, LOCALE_NAMES, LOCALE_FLAGS, PRIORITY_LOCALES } from '@/lib/constants'

// Human-readable display type names (includes both internal types and ASC API types)
const DISPLAY_TYPE_NAMES: Record<string, string> = {
  // Current Apple requirements (2024/2025)
  'APP_IPHONE_69': 'iPhone 6.9"',    // REQUIRED - iPhone 16 Pro Max, 15 Pro Max
  'APP_IPHONE_67': 'iPhone 6.7"',    // ASC API name for 6.7-6.9" displays
  'APP_IPHONE_65': 'iPhone 6.5"',
  'APP_IPHONE_63': 'iPhone 6.3"',    // iPhone 16 Pro, 15 Pro
  'APP_IPHONE_61': 'iPhone 6.1"',
  'APP_IPHONE_58': 'iPhone 5.8"',    // Legacy
  'APP_IPHONE_55': 'iPhone 5.5"',
  'APP_IPHONE_47': 'iPhone 4.7"',
  'APP_IPHONE_40': 'iPhone 4"',
  'APP_IPHONE_35': 'iPhone 3.5"',
  // iPad - new required size
  'APP_IPAD_PRO_13': 'iPad 13"',     // REQUIRED - iPad Pro M4/M5
  'APP_IPAD_PRO_3GEN_129': 'iPad Pro 12.9"',
  'APP_IPAD_PRO_129': 'iPad Pro 12.9"',
  'APP_IPAD_PRO_3GEN_11': 'iPad Pro 11"',
  'APP_IPAD_PRO_11': 'iPad Pro 11"',
  'APP_IPAD_105': 'iPad 10.5"',
  'APP_IPAD_97': 'iPad 9.7"',
  // Other devices
  'APP_WATCH_ULTRA_3': 'Watch Ultra 3',
  'APP_WATCH_SERIES_10': 'Watch Series 10/11',
  'APP_WATCH_SERIES_3': 'Watch Series 3',
  'APP_WATCH_SERIES_4': 'Watch Series 4',
  'APP_WATCH_SERIES_7': 'Watch Series 7-9',
  'APP_WATCH_ULTRA': 'Watch Ultra',
  'APP_DESKTOP': 'Mac',
  'APP_APPLE_TV': 'Apple TV',
}

const getDeviceIcon = (displayType: string) => {
  if (displayType.includes('IPAD')) return <Tablet className="w-3 h-3" />
  if (displayType.includes('WATCH')) return <Watch className="w-3 h-3" />
  return <Smartphone className="w-3 h-3" />
}

const getDisplayTypeName = (displayType: string): string => {
  return DISPLAY_TYPE_NAMES[displayType] || displayType.replace('APP_', '').replace(/_/g, ' ')
}
import { StoreCredentials } from '@/components/dashboard/store-credentials'
import { useInternalIntegrations } from '@/components/dashboard/internal-integrations-context'

// Toggle this to show a demo app for testing UI
const SHOW_DEMO_APP = false

// Demo project for testing UI without a real project
const DEMO_PROJECT = {
  id: 'demo-project',
  name: 'My Awesome App',
  storeType: 'ios' as const,
  appStoreAppId: '1234567890',
  playStorePackage: 'com.example.myawesomeapp',
  linkedProjectId: null,
  primaryLocale: 'en-US',
}

interface ScreenshotPreview {
  url: string
  width: number
  height: number
}

interface DeviceScreenshots {
  displayType: string
  count: number
  previews: ScreenshotPreview[]
}

interface LocaleScreenshots {
  locale: string
  screenshotCount: number
  deviceTypes: DeviceScreenshots[]
}

interface AppStoreApp {
  id: string
  name: string
  bundleId: string
  sku: string
  primaryLocale: string
  iconUrl?: string
  availableLocales?: string[]
  screenshots?: LocaleScreenshots[]
  totalScreenshots?: number
}

interface PlayStoreApp {
  packageName: string
  title: string
}

interface StoreAppsResponse {
  appstore: {
    connected: boolean
    apps: AppStoreApp[]
    error?: string
  }
  playstore: {
    connected: boolean
    apps: PlayStoreApp[]
    error?: string
  }
}

export default function AppsPage() {
  const internalIntegrationsEnabled = useInternalIntegrations()
  const router = useRouter()
  const selfHosted = useSelfHosted()
  const { projects, loading, selectProject, refetch } = useProjects()

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoadingApps, setIsLoadingApps] = useState(false)
  const [storeData, setStoreData] = useState<StoreAppsResponse | null>(null)
  const [selectedApp, setSelectedApp] = useState<AppStoreApp | null>(null)
  const [showManualEntry, setShowManualEntry] = useState(false)
  const [showConnectStores, setShowConnectStores] = useState(false)
  const [appSearchQuery, setAppSearchQuery] = useState('')
  const [selectedDeviceType, setSelectedDeviceType] = useState<string | null>(null)
  const [isLoadingScreenshots, setIsLoadingScreenshots] = useState(false)

  // Pagination for app list
  const [currentPage, setCurrentPage] = useState(0)
  const APPS_PER_PAGE = 5

  // Store type for new project (ios, android, both, or web)
  const [selectedStoreType, setSelectedStoreType] = useState<'ios' | 'android' | 'both' | 'web' | null>(null)

  const [formData, setFormData] = useState({
    name: '',
    appStoreAppId: '',
    playStorePackage: '',
    primaryLocale: 'en-US',
    enabledLocales: ['en-US'] as string[],
  })

  // Lazy-loaded app icons
  const [appIcons, setAppIcons] = useState<Record<string, string>>({})
  const [isLoadingIcons, setIsLoadingIcons] = useState(false)

  // Fetch connected apps when modal opens
  useEffect(() => {
    if (showCreateModal && !storeData) {
      fetchApps()
    }
  }, [showCreateModal])

  async function fetchApps() {
    setIsLoadingApps(true)
    try {
      const response = await fetch('/api/stores/apps')
      if (response.ok) {
        const data: StoreAppsResponse = await response.json()
        setStoreData(data)
        // Don't auto-show manual entry - let user choose from "No Store Credentials" screen
      } else {
        // API error (e.g., 401 unauthorized) - show empty state
        setStoreData({
          appstore: { connected: false, apps: [] },
          playstore: { connected: false, apps: [] }
        })
      }
    } catch (err) {
      console.error('Failed to fetch apps:', err)
      // Network error - show empty state so user can connect stores or enter manually
      setStoreData({
        appstore: { connected: false, apps: [] },
        playstore: { connected: false, apps: [] }
      })
    } finally {
      setIsLoadingApps(false)
    }
  }

  // Lazy load icons for App Store apps
  async function fetchAppIcons(appIds: string[]) {
    if (appIds.length === 0) return

    setIsLoadingIcons(true)
    try {
      const response = await fetch('/api/stores/apps/icons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appIds }),
      })

      if (response.ok) {
        const data = await response.json()
        // Merge new icons with existing ones
        setAppIcons(prev => ({ ...prev, ...data.icons }))
      }
    } catch (err) {
      console.error('Failed to fetch app icons:', err)
    } finally {
      setIsLoadingIcons(false)
    }
  }

  // Get filtered and paginated apps
  const filteredApps = storeData?.appstore.apps.filter(app =>
    !appSearchQuery ||
    app.name.toLowerCase().includes(appSearchQuery.toLowerCase()) ||
    app.bundleId.toLowerCase().includes(appSearchQuery.toLowerCase())
  ) || []

  const totalPages = Math.ceil(filteredApps.length / APPS_PER_PAGE)
  const paginatedApps = filteredApps.slice(
    currentPage * APPS_PER_PAGE,
    (currentPage + 1) * APPS_PER_PAGE
  )

  // Reset to first page when search query changes
  useEffect(() => {
    setCurrentPage(0)
  }, [appSearchQuery])

  // Trigger icon loading for current page of apps (in modal)
  useEffect(() => {
    if (paginatedApps.length > 0) {
      const appIds = paginatedApps
        .filter(app => !appIcons[app.id]) // Only fetch icons we don't have
        .map(app => app.id)

      if (appIds.length > 0) {
        fetchAppIcons(appIds)
      }
    }
  }, [paginatedApps.map(a => a.id).join(',')])

  // Fetch icons for existing projects on dashboard
  useEffect(() => {
    if (!loading && projects.length > 0) {
      const appIds = projects
        .filter(p => p.appStoreAppId && !appIcons[p.appStoreAppId])
        .map(p => p.appStoreAppId!)

      if (appIds.length > 0) {
        fetchAppIcons(appIds)
      }
    }
  }, [loading, projects.map(p => p.id).join(',')])

  const handleSelectProject = (project: typeof projects[0]) => {
    selectProject(project)
    router.push(`/projects/${project.id}`)
  }

  const openCreateModal = () => {
    setShowCreateModal(true)
    setError(null)
    setSelectedApp(null)
    setShowManualEntry(false)
    setSelectedStoreType(null)
    setFormData({
      name: '',
      appStoreAppId: '',
      playStorePackage: '',
      primaryLocale: 'en-US',
      enabledLocales: ['en-US'],
    })
  }

  const closeCreateModal = () => {
    setShowCreateModal(false)
    setError(null)
    setSelectedApp(null)
    setShowManualEntry(false)
    setShowConnectStores(false)
    setAppSearchQuery('')
    setSelectedDeviceType(null)
    setCurrentPage(0)
    setSelectedStoreType(null)
  }

  const handleSelectApp = async (app: AppStoreApp) => {
    setSelectedApp(app)
    setSelectedStoreType('ios') // App Store apps are iOS
    setSelectedDeviceType(null) // Reset device type when selecting a new app
    // Use available locales from App Store Connect, or fallback to primary locale
    const locales = app.availableLocales?.length ? app.availableLocales : [app.primaryLocale]
    setFormData({
      ...formData,
      name: app.name,
      appStoreAppId: app.id,
      primaryLocale: app.primaryLocale,
      enabledLocales: locales,
    })

    // Fetch screenshots on-demand
    setIsLoadingScreenshots(true)
    try {
      const response = await fetch(`/api/stores/apps/${app.id}/screenshots`)
      if (response.ok) {
        const data = await response.json()
        // Update the selected app with screenshots
        setSelectedApp(prev => prev ? {
          ...prev,
          screenshots: data.screenshots,
          totalScreenshots: data.totalScreenshots
        } : null)
      }
    } catch (error) {
      console.error('Failed to fetch screenshots:', error)
    } finally {
      setIsLoadingScreenshots(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    if (!selectedStoreType) {
      setError('Please select a store type (iOS or Android)')
      setIsSubmitting(false)
      return
    }

    try {
      if (selectedStoreType === 'both') {
        // Paired project creation
        const response = await fetch('/api/projects/create-pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name,
            appStoreAppId: formData.appStoreAppId || null,
            playStorePackage: formData.playStorePackage || null,
            primaryLocale: formData.primaryLocale,
            enabledLocales: formData.enabledLocales,
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to create paired projects')
        }

        closeCreateModal()
        refetch()
        // Navigate to the iOS project (primary/owner)
        router.push(`/projects/${data.data.iosProjectId}`)
      } else {
        // Single project creation
        const response = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formData.name,
            storeType: selectedStoreType,
            appStoreAppId: selectedStoreType === 'ios' ? (formData.appStoreAppId || null) : null,
            playStorePackage: selectedStoreType === 'android' ? (formData.playStorePackage || null) : null,
            primaryLocale: formData.primaryLocale,
            enabledLocales: formData.enabledLocales,
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to create project')
        }

        closeCreateModal()
        refetch()
        router.push(`/projects/${data.data.projectId}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  const toggleLocale = (locale: string) => {
    const current = formData.enabledLocales
    if (current.includes(locale)) {
      if (locale === formData.primaryLocale) return
      setFormData({
        ...formData,
        enabledLocales: current.filter(l => l !== locale),
      })
    } else {
      setFormData({
        ...formData,
        enabledLocales: [...current, locale],
      })
    }
  }

  const selectAllLocales = () => {
    setFormData({
      ...formData,
      enabledLocales: [...APPSTORE_LOCALES],
    })
  }

  const selectPriorityLocales = () => {
    setFormData({
      ...formData,
      enabledLocales: [...PRIORITY_LOCALES],
    })
  }

  const hasConnectedStores = storeData?.appstore.connected || storeData?.playstore.connected
  const hasApps = (storeData?.appstore.apps.length || 0) > 0 || (storeData?.playstore.apps.length || 0) > 0

  return (
    <div className="min-h-screen bg-black text-white selection:bg-purple-500/30 selection:text-purple-200">
      {/* Starfield Background */}
      <Starfield mode="float" />

      {/* Gradient Overlays */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-[1]">
        <div className="absolute top-[-10%] left-[-10%] w-[70%] h-[70%] bg-purple-500/10 blur-[120px] rounded-full animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-blue-500/8 blur-[120px] rounded-full animate-pulse" style={{ animationDuration: '12s' }} />
      </div>

      {/* Sign Out Button - Top Right */}
      <button
        onClick={async () => {
          await fetch('/api/auth/logout', { method: 'POST' })
          router.push('/login')
        }}
        className="fixed top-6 right-6 z-50 flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] text-neutral-400 hover:text-white hover:bg-white/[0.08] transition-all backdrop-blur-sm"
      >
        <LogOut className="w-4 h-4" />
        <span className="hidden sm:inline">Sign out</span>
      </button>

      {/* Main Content */}
      <main className="relative z-10 min-h-screen flex flex-col px-6 pt-24 pb-16">
        <div className="max-w-6xl mx-auto w-full">
          {/* Hero Title */}
          <h1 className="text-6xl md:text-7xl lg:text-8xl font-black text-center mb-16 font-brand tracking-tight bg-clip-text text-transparent animate-shimmer"
              style={{
                backgroundImage: 'linear-gradient(to bottom, #ffffff 0%, #a3a3a3 50%, #ffffff 100%), linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
                backgroundSize: '100% 100%, 200% 100%',
                backgroundPosition: '0 0, -100% 0',
                animation: 'shimmer 3s ease-in-out infinite',
              }}>
            App Listing Agent
          </h1>
          <style jsx>{`
            @keyframes shimmer {
              0% { background-position: 0 0, -100% 0; }
              50% { background-position: 0 0, 100% 0; }
              100% { background-position: 0 0, -100% 0; }
            }
            @keyframes glow {
              0%, 100% { box-shadow: 0 0 20px rgba(255, 255, 255, 0.3), 0 0 40px rgba(168, 85, 247, 0.2); }
              50% { box-shadow: 0 0 30px rgba(255, 255, 255, 0.5), 0 0 60px rgba(168, 85, 247, 0.4); }
            }
          `}</style>

          {/* Navigation Tabs */}
          <div className="flex items-center justify-center gap-2 mb-16">
            <Link
              href="/dashboard"
              className="px-5 py-2.5 rounded-full text-[13px] font-medium bg-white/[0.1] text-white border border-white/[0.1]"
            >
              Apps
            </Link>
            <Link
              href="/settings"
              className="px-5 py-2.5 rounded-full text-[13px] font-medium text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all"
            >
              Settings
            </Link>
            {!selfHosted && (
              <Link
                href="/billing"
                className="px-5 py-2.5 rounded-full text-[13px] font-medium text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all"
              >
                Billing
              </Link>
            )}
          </div>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <div className="w-10 h-10 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        ) : projects.length === 0 && !SHOW_DEMO_APP ? (
          /* Empty State */
          <div className="text-center py-24 rounded-3xl bg-white/[0.02] border border-white/[0.08]">
            <div className="w-60 h-60 mx-auto mb-4">
              <Image
                src="/empty-planet.png"
                alt="Empty state"
                width={240}
                height={240}
                className="w-full h-full object-contain"
              />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">No apps yet</h2>
            <p className="text-neutral-400 mb-8 max-w-md mx-auto text-lg">
              Create your first app to start managing your App Store and Play Store listings with AI-powered tools.
            </p>
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black rounded-xl font-medium hover:bg-neutral-200 transition-colors"
              style={{
                animation: 'glow 2s ease-in-out infinite',
              }}
            >
              <Plus className="w-5 h-5" />
              Create Your First App
            </button>
          </div>
        ) : (
          /* Apps Grid */
          <div className="flex flex-wrap justify-center gap-6">
            {/* Demo App - remove SHOW_DEMO_APP flag to hide */}
            {SHOW_DEMO_APP && (
              <button
                onClick={() => {
                  selectProject(DEMO_PROJECT)
                  router.push(`/projects/${DEMO_PROJECT.id}`)
                }}
                className="group w-[220px] rounded-2xl p-6 transition-all"
              >
                {/* Large App Icon */}
                <div className="w-36 h-36 mx-auto mb-5 rounded-[2.25rem] bg-gradient-to-br from-purple-500 via-violet-500 to-blue-500 p-[3px] shadow-xl shadow-purple-500/30 group-hover:scale-105 transition-transform">
                  <div className="w-full h-full rounded-[2rem] bg-gradient-to-br from-purple-400 via-violet-500 to-blue-600 flex items-center justify-center">
                    <span className="text-5xl font-bold text-white drop-shadow-lg">M</span>
                  </div>
                </div>

                {/* App Name - Always visible */}
                <h3 className="font-semibold text-white text-lg text-center mb-1 group-hover:text-neutral-300 transition-colors">
                  My Awesome App
                </h3>

                {/* Details - Hidden until hover */}
                <div className="overflow-hidden transition-all duration-300 max-h-0 opacity-0 group-hover:max-h-24 group-hover:opacity-100">
                  <div className="flex flex-wrap justify-center gap-2 mt-3 mb-2">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-white/[0.05] text-neutral-300">
                      <Apple className="w-3 h-3" />
                      iOS
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-white/[0.05] text-neutral-300">
                      <Play className="w-3 h-3" />
                      Android
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500 text-center">en-US</p>
                </div>
              </button>
            )}

            {(() => {
              // Group linked projects into pairs, keep singles separate
              const rendered = new Set<string>()
              const allItems: ({ type: 'single'; project: typeof projects[0] } | { type: 'pair'; projects: [typeof projects[0], typeof projects[0]] })[] = []

              projects.forEach(p => {
                if (rendered.has(p.id)) return
                rendered.add(p.id)

                if (p.linkedProjectId) {
                  const linked = projects.find(lp => lp.id === p.linkedProjectId)
                  if (linked && !rendered.has(linked.id)) {
                    rendered.add(linked.id)
                    const pair: [typeof projects[0], typeof projects[0]] = p.storeType === 'ios' ? [p, linked] : [linked, p]
                    allItems.push({ type: 'pair', projects: pair })
                    return
                  }
                }
                allItems.push({ type: 'single', project: p })
              })

              const renderProjectCard = (project: typeof projects[0]) => {
                const iconUrl = project.appStoreAppId ? appIcons[project.appStoreAppId] : null
                const isIos = project.storeType === 'ios'
                const isWeb = project.storeType === 'web'

                return (
                  <button
                    key={project.id}
                    onClick={() => handleSelectProject(project)}
                    className="group w-[220px] rounded-2xl p-6 transition-all hover:bg-white/[0.03]"
                  >
                    <div className="relative w-36 h-36 mx-auto mb-5">
                      <div className={`w-full h-full rounded-[2rem] bg-white/20 p-[1px] shadow-xl group-hover:scale-105 transition-all ${
                        isIos
                          ? 'shadow-blue-500/20 group-hover:shadow-blue-500/40'
                          : isWeb
                            ? 'shadow-violet-500/20 group-hover:shadow-violet-500/40'
                            : 'shadow-green-500/20 group-hover:shadow-green-500/40'
                      }`}>
                        {iconUrl ? (
                          <img src={iconUrl} alt={project.name} className="w-full h-full rounded-[1.9rem] object-cover" />
                        ) : (
                          <div className={`w-full h-full rounded-[1.9rem] flex items-center justify-center ${
                            isIos
                              ? 'bg-gradient-to-br from-blue-400 via-blue-500 to-indigo-600'
                              : isWeb
                                ? 'bg-gradient-to-br from-violet-400 via-violet-500 to-purple-600'
                                : 'bg-gradient-to-br from-green-400 via-emerald-500 to-teal-600'
                          }`}>
                            <span className="text-5xl font-bold text-white drop-shadow-lg">
                              {project.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Store badge */}
                      <div className={`absolute -bottom-1.5 -right-1.5 w-8 h-8 rounded-xl flex items-center justify-center shadow-lg border ${
                        isIos
                          ? 'bg-blue-500 border-blue-400/50 shadow-blue-500/40'
                          : isWeb
                            ? 'bg-violet-500 border-violet-400/50 shadow-violet-500/40'
                            : 'bg-green-500 border-green-400/50 shadow-green-500/40'
                      }`}>
                        {isIos
                          ? <Apple className="w-4 h-4 text-white" />
                          : isWeb
                            ? <Globe className="w-4 h-4 text-white" />
                            : <Play className="w-4 h-4 text-white" />
                        }
                      </div>
                    </div>

                    <h3 className="font-semibold text-white text-lg text-center mb-0.5 group-hover:text-neutral-300 transition-colors">
                      {project.name}
                    </h3>

                    <p className={`text-xs text-center font-medium ${
                      isIos ? 'text-blue-400/70' : isWeb ? 'text-violet-400/70' : 'text-green-400/70'
                    }`}>
                      {isIos ? 'iOS' : isWeb ? 'Web' : 'Android'}
                    </p>
                  </button>
                )
              }

              return allItems.map((item) => {
                if (item.type === 'pair') {
                  const [first, second] = item.projects
                  return (
                    <div
                      key={`pair-${first.id}`}
                      className="relative rounded-[2rem] border border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-transparent pt-5 pb-2 px-2"
                    >
                      {/* Linked pill */}
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/15 border border-purple-500/25 backdrop-blur-sm">
                        <Link2 className="w-3 h-3 text-purple-400" />
                        <span className="text-[10px] font-semibold text-purple-300 uppercase tracking-wider">Linked</span>
                      </div>

                      <div className="flex items-start">
                        {renderProjectCard(first)}
                        {renderProjectCard(second)}
                      </div>
                    </div>
                  )
                }

                return renderProjectCard(item.project)
              })
            })()}

            {/* Add New App Card */}
            <button
              onClick={openCreateModal}
              className="group w-[220px] rounded-2xl p-6 transition-all"
            >
              <div className="w-36 h-36 mx-auto mb-5 rounded-[2.25rem] bg-white/[0.02] border-2 border-dashed border-white/[0.1] flex items-center justify-center group-hover:border-white/[0.3] group-hover:bg-white/[0.05] group-hover:scale-105 transition-all">
                <Plus className="w-12 h-12 text-neutral-600 group-hover:text-white transition-colors" />
              </div>
              <h3 className="font-semibold text-neutral-500 text-lg text-center mb-1 group-hover:text-white transition-colors">
                Add New App
              </h3>
            </button>
          </div>
        )}
        </div>
      </main>

      {/* Footer - Fixed at bottom */}
      <footer className="fixed bottom-0 left-0 right-0 z-10 border-t border-white/[0.08] bg-black/50 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between text-sm text-neutral-500">
            <p className="font-brand">App Listing Agent</p>
            <div className="flex items-center gap-6">
              <Link href="/docs" className="hover:text-white transition-colors">Docs</Link>
              <SupportButton className="hover:text-white transition-colors">Support</SupportButton>
            </div>
          </div>
        </div>
      </footer>

      {/* Create App Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={closeCreateModal}
          />

          {/* Modal Content */}
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4 rounded-2xl bg-black/60 backdrop-blur-2xl border border-white/[0.1] shadow-2xl">
            {/* Modal Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between p-6 border-b border-white/[0.08] bg-black/40 backdrop-blur-xl">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
                  <FolderKanban className="w-6 h-6 text-neutral-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Create New App</h2>
                  <p className="text-sm text-neutral-400">Add an app to manage with AI tools</p>
                </div>
              </div>
              <button
                onClick={closeCreateModal}
                className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/[0.05] transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6">
              {isLoadingApps ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Loader2 className="w-8 h-8 animate-spin text-neutral-400 mb-4" />
                  <p className="text-neutral-400">Loading your apps...</p>
                </div>
              ) : !selectedStoreType && !selectedApp && !showManualEntry ? (
                /* Step 1: Store Type Selection */
                <div className="space-y-6">
                  <div className="text-center">
                    <h3 className="text-lg font-semibold text-white mb-2">Choose Platform</h3>
                    <p className="text-sm text-neutral-400">
                      Each project is dedicated to one platform. You can link iOS and Android projects together later.
                    </p>
                  </div>

                  <div className={`grid gap-4 ${internalIntegrationsEnabled ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                    {/* iOS Option */}
                    <button
                      onClick={() => setSelectedStoreType('ios')}
                      className="group p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08]
                               hover:border-blue-500/30 hover:bg-blue-500/5 transition-all text-center"
                    >
                      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-600/20
                                    flex items-center justify-center border border-blue-500/20
                                    group-hover:border-blue-500/40 transition-colors">
                        <Apple className="w-8 h-8 text-blue-400" />
                      </div>
                      <h4 className="font-semibold text-white mb-1 group-hover:text-blue-400 transition-colors">
                        iOS / App Store
                      </h4>
                      <p className="text-xs text-neutral-500">
                        iPhone, iPad, Apple Watch, Mac
                      </p>
                    </button>

                    {/* Android Option */}
                    <button
                      onClick={() => setSelectedStoreType('android')}
                      className="group p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08]
                               hover:border-green-500/30 hover:bg-green-500/5 transition-all text-center"
                    >
                      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-green-500/20 to-green-600/20
                                    flex items-center justify-center border border-green-500/20
                                    group-hover:border-green-500/40 transition-colors">
                        <Play className="w-8 h-8 text-green-400" />
                      </div>
                      <h4 className="font-semibold text-white mb-1 group-hover:text-green-400 transition-colors">
                        Android / Play Store
                      </h4>
                      <p className="text-xs text-neutral-500">
                        Android phones, tablets, TV
                      </p>
                    </button>

                    {/* Web projects are an internal beta capability. */}
                    {internalIntegrationsEnabled && (
                    <button
                      onClick={() => {
                        setSelectedStoreType('web')
                        setShowManualEntry(true)
                      }}
                      className="group p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08]
                               hover:border-violet-500/30 hover:bg-violet-500/5 transition-all text-center"
                    >
                      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-violet-500/20 to-violet-600/20
                                    flex items-center justify-center border border-violet-500/20
                                    group-hover:border-violet-500/40 transition-colors">
                        <Globe className="w-8 h-8 text-violet-400" />
                      </div>
                      <h4 className="font-semibold text-white mb-1 group-hover:text-violet-400 transition-colors">
                        Web App
                      </h4>
                      <p className="text-xs text-neutral-500">
                        Whop purchases and web app management
                      </p>
                    </button>
                    )}
                  </div>

                  {/* Both Platforms Option */}
                  <button
                    onClick={() => {
                      setSelectedStoreType('both')
                      setShowManualEntry(true)
                    }}
                    className="group w-full p-4 rounded-2xl bg-white/[0.02] border border-dashed border-white/[0.1]
                             hover:border-purple-500/30 hover:bg-purple-500/5 transition-all text-center"
                  >
                    <div className="flex items-center justify-center gap-3">
                      <div className="flex items-center -space-x-2">
                        <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center border border-blue-500/20 z-10">
                          <Apple className="w-4 h-4 text-blue-400" />
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center border border-green-500/20">
                          <Play className="w-4 h-4 text-green-400" />
                        </div>
                      </div>
                      <div className="text-left">
                        <h4 className="font-semibold text-neutral-300 text-sm group-hover:text-purple-400 transition-colors flex items-center gap-1.5">
                          <Link2 className="w-3.5 h-3.5" />
                          Both Platforms
                        </h4>
                        <p className="text-[11px] text-neutral-500">
                          Creates iOS + Android projects, pre-linked with screenshot and metadata sharing
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              ) : (
                <>
                  {/* Store Type Badge - shown after selection */}
                  {selectedStoreType && !selectedApp && !showManualEntry && selectedStoreType !== 'both' && selectedStoreType !== 'web' && (
                    <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/[0.08]">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          selectedStoreType === 'ios'
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-green-500/20 text-green-400'
                        }`}>
                          {selectedStoreType === 'ios' ? <Apple className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        </div>
                        <span className="text-sm font-medium text-white">
                          {selectedStoreType === 'ios' ? 'iOS / App Store' : 'Android / Play Store'}
                        </span>
                      </div>
                      <button
                        onClick={() => setSelectedStoreType(null)}
                        className="text-xs text-neutral-400 hover:text-white transition-colors"
                      >
                        Change
                      </button>
                    </div>
                  )}

                  {/* No Stores Connected */}
                  {!hasConnectedStores && !showManualEntry && !showConnectStores && (
                    <div className="p-8 rounded-xl bg-white/[0.02] border border-white/[0.08] text-center">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-500/10 flex items-center justify-center">
                        <AlertCircle className="w-8 h-8 text-amber-400" />
                      </div>
                      <h3 className="text-lg font-semibold text-white mb-2">No Store Credentials Connected</h3>
                      <p className="text-neutral-400 mb-6 text-sm">
                        Connect your App Store Connect or Google Play Console credentials to automatically import your apps.
                      </p>
                      <div className="flex items-center justify-center gap-4">
                        <button
                          onClick={() => setShowConnectStores(true)}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-white text-black hover:bg-neutral-200 transition-all"
                        >
                          <Settings className="w-4 h-4" />
                          Connect Stores
                        </button>
                        <button
                          onClick={() => setShowManualEntry(true)}
                          className="px-5 py-2.5 rounded-xl text-sm font-medium text-neutral-400 hover:text-white transition-colors"
                        >
                          Enter Manually
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Connect Stores Form (Inline) */}
                  {showConnectStores && !showManualEntry && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-lg font-semibold text-white">Connect Your Stores</h3>
                        <button
                          onClick={() => setShowConnectStores(false)}
                          className="text-sm text-neutral-400 hover:text-white transition-colors"
                        >
                          ← Back
                        </button>
                      </div>
                      <p className="text-neutral-400 text-sm mb-4">
                        Connect your App Store Connect or Google Play Console to automatically import your apps.
                      </p>
                      <StoreCredentials
                        appStoreConnected={storeData?.appstore.connected || false}
                        playStoreConnected={storeData?.playstore.connected || false}
                        onContinue={() => {
                          fetchApps()
                          setShowConnectStores(false)
                        }}
                      />
                      <div className="pt-4 border-t border-white/[0.08]">
                        <button
                          onClick={() => {
                            setShowConnectStores(false)
                            setShowManualEntry(true)
                          }}
                          className="text-sm text-neutral-400 hover:text-white transition-colors"
                        >
                          Or enter app details manually →
                        </button>
                      </div>
                    </div>
                  )}

                  {/* App Selection - filtered by store type */}
                  {hasConnectedStores && !showManualEntry && !selectedApp && !showConnectStores && selectedStoreType && (
                    <div className="space-y-4">
                      {/* Search Bar */}
                      {((selectedStoreType === 'ios' && (storeData?.appstore.apps.length || 0) > 5) ||
                        (selectedStoreType === 'android' && (storeData?.playstore.apps.length || 0) > 5)) && (
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                          <input
                            type="text"
                            placeholder="Search apps..."
                            value={appSearchQuery}
                            onChange={(e) => setAppSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08]
                                     text-white placeholder:text-neutral-500 focus:outline-none focus:border-white/[0.2]
                                     text-sm transition-colors"
                          />
                        </div>
                      )}

                      {/* App Store Apps - only show for iOS */}
                      {selectedStoreType === 'ios' && storeData?.appstore.connected && (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <Apple className="w-4 h-4 text-blue-400" />
                            <span className="text-sm font-medium text-white">App Store Connect</span>
                            <span className="text-xs text-neutral-500">
                              {filteredApps.length} apps
                            </span>
                          </div>

                          {storeData.appstore.error ? (
                            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                              {storeData.appstore.error}
                            </div>
                          ) : storeData.appstore.apps.length === 0 ? (
                            <p className="text-neutral-500 text-sm py-4 text-center">No apps found</p>
                          ) : filteredApps.length === 0 && appSearchQuery ? (
                            <p className="text-neutral-500 text-sm py-4 text-center">No apps match "{appSearchQuery}"</p>
                          ) : (
                            <>
                              <div className="space-y-1.5">
                                {paginatedApps.map((app) => (
                                  <button
                                    key={app.id}
                                    onClick={() => handleSelectApp(app)}
                                    className="flex items-center gap-3 w-full p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]
                                             hover:border-blue-500/30 hover:bg-blue-500/5 transition-all text-left group"
                                  >
                                    {(appIcons[app.id] || app.iconUrl) ? (
                                      <img
                                        src={appIcons[app.id] || app.iconUrl}
                                        alt={app.name}
                                        className="w-11 h-11 rounded-xl border border-white/[0.05] object-cover transition-opacity"
                                      />
                                    ) : (
                                      <div className={`w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20
                                                    flex items-center justify-center border border-white/[0.05]
                                                    ${isLoadingIcons ? 'animate-pulse' : ''}`}>
                                        <span className="text-lg font-semibold text-white/80">
                                          {app.name.charAt(0).toUpperCase()}
                                        </span>
                                      </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <h4 className="font-medium text-white text-sm truncate group-hover:text-blue-400 transition-colors">
                                        {app.name}
                                      </h4>
                                      <p className="text-xs text-neutral-500 truncate font-mono">{app.bundleId}</p>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-neutral-600 group-hover:text-blue-400
                                                           group-hover:translate-x-0.5 transition-all" />
                                  </button>
                                ))}
                              </div>

                              {/* Pagination Controls */}
                              {totalPages > 1 && (
                                <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/[0.05]">
                                  <button
                                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                    disabled={currentPage === 0}
                                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.05] text-neutral-300
                                             hover:bg-white/[0.1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                  >
                                    ← Previous
                                  </button>
                                  <span className="text-xs text-neutral-500">
                                    Page {currentPage + 1} of {totalPages}
                                  </span>
                                  <button
                                    onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                                    disabled={currentPage >= totalPages - 1}
                                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.05] text-neutral-300
                                             hover:bg-white/[0.1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                  >
                                    Next →
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {/* Play Store Apps - only show for Android */}
                      {selectedStoreType === 'android' && storeData?.playstore.connected && (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <Play className="w-4 h-4 text-green-400" />
                            <span className="text-sm font-medium text-white">Google Play Console</span>
                          </div>

                          {storeData.playstore.error ? (
                            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                              {storeData.playstore.error}
                            </div>
                          ) : storeData.playstore.apps.length === 0 ? (
                            <div className="space-y-3">
                              <div className="space-y-2">
                                <label className="text-sm font-medium text-neutral-300">
                                  Package Name <span className="text-neutral-500 text-xs font-normal">(optional)</span>
                                </label>
                                <input
                                  type="text"
                                  value={formData.playStorePackage}
                                  onChange={(e) => setFormData({ ...formData, playStorePackage: e.target.value })}
                                  placeholder="com.example.myapp"
                                  className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder:text-neutral-600 focus:outline-none focus:border-green-500/50 hover:border-white/[0.15] transition-colors text-sm font-mono"
                                />
                                <p className="text-xs text-neutral-500">
                                  App still in draft without a package name? Skip this and add it later in project settings.
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  if (formData.playStorePackage.trim()) {
                                    setFormData({
                                      ...formData,
                                      name: formData.name || formData.playStorePackage.split('.').pop() || '',
                                    })
                                  }
                                  setShowManualEntry(true)
                                }}
                                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors text-sm font-medium"
                              >
                                Continue
                                <ChevronRight className="w-4 h-4" />
                              </button>
                              <p className="text-[11px] text-neutral-600 text-center">
                                Google Play doesn't provide an API to list apps automatically
                              </p>
                            </div>
                          ) : (
                            <div className="max-h-[200px] overflow-y-auto space-y-1.5 pr-1">
                              {storeData.playstore.apps
                                .filter(app =>
                                  !appSearchQuery ||
                                  app.title.toLowerCase().includes(appSearchQuery.toLowerCase()) ||
                                  app.packageName.toLowerCase().includes(appSearchQuery.toLowerCase())
                                )
                                .map((app) => (
                                <button
                                  key={app.packageName}
                                  onClick={() => {
                                    setSelectedStoreType('android') // Play Store apps are Android
                                    setFormData({
                                      ...formData,
                                      name: app.title,
                                      playStorePackage: app.packageName,
                                    })
                                    setShowManualEntry(true)
                                  }}
                                  className="flex items-center gap-3 w-full p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]
                                           hover:border-green-500/30 hover:bg-green-500/5 transition-all text-left group"
                                >
                                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-green-500/20 to-emerald-500/20
                                                flex items-center justify-center border border-white/[0.05]">
                                    <span className="text-lg font-semibold text-white/80">
                                      {app.title.charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h4 className="font-medium text-white text-sm truncate group-hover:text-green-400 transition-colors">
                                      {app.title}
                                    </h4>
                                    <p className="text-xs text-neutral-500 truncate font-mono">{app.packageName}</p>
                                  </div>
                                  <ChevronRight className="w-4 h-4 text-neutral-600 group-hover:text-green-400
                                                         group-hover:translate-x-0.5 transition-all" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Connect Store Option - show if selected store is not connected */}
                      {selectedStoreType === 'ios' && !storeData?.appstore.connected && (
                        <div className="pt-4 border-t border-white/[0.05]">
                          <button
                            onClick={() => setShowConnectStores(true)}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-500/5 border border-blue-500/20
                                     text-blue-400 hover:bg-blue-500/10 hover:border-blue-500/30 transition-all text-sm"
                          >
                            <Apple className="w-4 h-4" />
                            Connect App Store Connect
                          </button>
                        </div>
                      )}
                      {selectedStoreType === 'android' && !storeData?.playstore.connected && (
                        <div className="pt-4 border-t border-white/[0.05]">
                          <button
                            onClick={() => setShowConnectStores(true)}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-green-500/5 border border-green-500/20
                                     text-green-400 hover:bg-green-500/10 hover:border-green-500/30 transition-all text-sm"
                          >
                            <Play className="w-4 h-4" />
                            Connect Google Play Console
                          </button>
                        </div>
                      )}

                      {/* Manual Entry Option */}
                      <div className={`pt-4 ${storeData?.appstore.connected === storeData?.playstore.connected ? 'border-t border-white/[0.05]' : ''}`}>
                        <button
                          onClick={() => setShowManualEntry(true)}
                          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-white/[0.1]
                                   text-neutral-400 hover:text-white hover:border-white/[0.2] hover:bg-white/[0.02] transition-all text-sm"
                        >
                          <Plus className="w-4 h-4" />
                          Enter app details manually
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Selected App or Manual Entry Form */}
                  {(selectedApp || showManualEntry) && (
                    <form onSubmit={handleSubmit} className="space-y-6">
                      {/* Selected App Banner */}
                      {selectedApp && (
                        <div className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.05] border border-white/[0.1]">
                          {(appIcons[selectedApp.id] || selectedApp.iconUrl) ? (
                            <img
                              src={appIcons[selectedApp.id] || selectedApp.iconUrl}
                              alt={selectedApp.name}
                              className="w-12 h-12 rounded-xl border border-white/[0.1] object-cover"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/30 to-purple-500/30
                                          flex items-center justify-center border border-white/[0.1]">
                              <span className="text-xl font-semibold text-white">
                                {selectedApp.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                          )}
                          <div className="flex-1">
                            <h4 className="font-medium text-white">{selectedApp.name}</h4>
                            <p className="text-xs text-neutral-400">{selectedApp.bundleId}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedApp(null)
                              setFormData({
                                name: '',
                                appStoreAppId: '',
                                playStorePackage: '',
                                primaryLocale: 'en-US',
                                enabledLocales: ['en-US'],
                              })
                            }}
                            className="text-sm text-neutral-400 hover:text-white transition-colors"
                          >
                            Change
                          </button>
                        </div>
                      )}

                      {/* Web Platform badge */}
                      {selectedStoreType === 'web' && showManualEntry && (
                        <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/[0.08]">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-violet-500/20 text-violet-400">
                              <Globe className="w-4 h-4" />
                            </div>
                            <span className="text-sm font-medium text-white">Web App</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedStoreType(null)
                              setShowManualEntry(false)
                            }}
                            className="text-xs text-neutral-400 hover:text-white transition-colors"
                          >
                            Change
                          </button>
                        </div>
                      )}

                      {/* Basic Info */}
                      <div className="space-y-4">
                        <h3 className="font-semibold text-white">Project Details</h3>

                        <div className="space-y-2">
                          <label className="text-sm font-medium text-neutral-300">
                            Project Name <span className="text-red-400">*</span>
                          </label>
                          <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="My Awesome App"
                            required
                            className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]
                                     text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/[0.2]
                                     hover:border-white/[0.15] transition-colors"
                          />
                        </div>

                        {/* Store ID - Only show if manual entry, field depends on store type */}
                        {showManualEntry && !selectedApp && selectedStoreType && selectedStoreType !== 'web' && (
                          <div className="space-y-4">
                            {/* Both Platforms badge */}
                            {selectedStoreType === 'both' && (
                              <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
                                <div className="flex items-center gap-2">
                                  <div className="flex items-center -space-x-1.5">
                                    <div className="w-6 h-6 rounded-md bg-blue-500/20 flex items-center justify-center border border-blue-500/20 z-10">
                                      <Apple className="w-3 h-3 text-blue-400" />
                                    </div>
                                    <div className="w-6 h-6 rounded-md bg-green-500/20 flex items-center justify-center border border-green-500/20">
                                      <Play className="w-3 h-3 text-green-400" />
                                    </div>
                                  </div>
                                  <span className="text-sm font-medium text-white flex items-center gap-1.5">
                                    <Link2 className="w-3.5 h-3.5 text-purple-400" />
                                    Both Platforms (Pre-linked)
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedStoreType(null)
                                    setShowManualEntry(false)
                                  }}
                                  className="text-xs text-neutral-400 hover:text-white transition-colors"
                                >
                                  Change
                                </button>
                              </div>
                            )}

                            {(selectedStoreType === 'ios' || selectedStoreType === 'both') && (
                              <div className="space-y-2">
                                <label className="flex items-center gap-2 text-sm font-medium text-neutral-300">
                                  <Apple className="w-4 h-4 text-blue-400" />
                                  App Store App ID {selectedStoreType === 'both' && <span className="text-neutral-500 text-xs font-normal">(optional)</span>}
                                </label>
                                <input
                                  type="text"
                                  value={formData.appStoreAppId}
                                  onChange={(e) => setFormData({ ...formData, appStoreAppId: e.target.value })}
                                  placeholder="1234567890"
                                  className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]
                                           text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/[0.2]
                                           hover:border-white/[0.15] transition-colors"
                                />
                                <p className="text-xs text-neutral-500">Found in App Store Connect under App Information</p>
                              </div>
                            )}
                            {(selectedStoreType === 'android' || selectedStoreType === 'both') && (
                              <div className="space-y-2">
                                <label className="flex items-center gap-2 text-sm font-medium text-neutral-300">
                                  <Play className="w-4 h-4 text-green-400" />
                                  Play Store Package Name <span className="text-neutral-500 text-xs font-normal">(optional)</span>
                                </label>
                                <input
                                  type="text"
                                  value={formData.playStorePackage}
                                  onChange={(e) => setFormData({ ...formData, playStorePackage: e.target.value })}
                                  placeholder="com.example.app"
                                  className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white placeholder:text-neutral-600 focus:outline-none focus:border-white/[0.2] hover:border-white/[0.15] transition-colors"
                                />
                                <p className="text-xs text-neutral-500">
                                  Draft app without a package name? Skip this — you can add it later in settings.
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Localization - Read-only when app selected, editable for manual entry (skip for web) */}
                      {selectedStoreType === 'web' ? null : selectedApp ? (
                        <div className="space-y-4">
                          <div>
                            <h3 className="font-semibold text-white">Localization</h3>
                            <p className="text-xs text-neutral-400 mt-1">
                              {formData.enabledLocales.length} locale(s) will be synced from App Store Connect
                            </p>
                          </div>

                          <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]">
                            <div className="flex items-center gap-2 mb-3">
                              <Globe className="w-4 h-4 text-blue-400" />
                              <span className="text-sm font-medium text-white">Primary Locale</span>
                            </div>
                            <div className="flex items-center gap-2 mb-4">
                              <span className="text-lg">{LOCALE_FLAGS[formData.primaryLocale] || '🌐'}</span>
                              <span className="text-white font-medium">{formData.primaryLocale}</span>
                              <span className="text-neutral-500">-</span>
                              <span className="text-neutral-400">{LOCALE_NAMES[formData.primaryLocale]}</span>
                            </div>

                            {formData.enabledLocales.length > 1 && (
                              <>
                                <div className="text-xs text-neutral-500 mb-2">Additional Locales</div>
                                <div className="flex flex-wrap gap-2">
                                  {formData.enabledLocales
                                    .filter(l => l !== formData.primaryLocale)
                                    .map(locale => (
                                      <span
                                        key={locale}
                                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/[0.05] text-xs text-neutral-300"
                                      >
                                        <span>{LOCALE_FLAGS[locale] || '🌐'}</span>
                                        {locale}
                                      </span>
                                    ))}
                                </div>
                              </>
                            )}
                          </div>

                          {/* Screenshots Preview */}
                          {isLoadingScreenshots ? (
                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <ImageIcon className="w-4 h-4 text-purple-400" />
                                <span className="text-sm font-medium text-white">Screenshots</span>
                              </div>
                              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]">
                                <div className="flex items-center gap-2 text-neutral-400">
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  <span className="text-xs">Loading screenshots...</span>
                                </div>
                              </div>
                            </div>
                          ) : selectedApp.screenshots && selectedApp.screenshots.length > 0 ? (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <ImageIcon className="w-4 h-4 text-purple-400" />
                                  <span className="text-sm font-medium text-white">Screenshots</span>
                                </div>
                                <span className="text-xs text-neutral-500">
                                  {selectedApp.totalScreenshots || 0} screenshot(s) found
                                </span>
                              </div>

                              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]">
                                {selectedApp.screenshots.map((localeScreenshots) => {
                                  // Get available device types for this locale
                                  const deviceTypes = localeScreenshots.deviceTypes || []

                                  // Auto-select first device type if none selected
                                  const activeDeviceType = selectedDeviceType || deviceTypes[0]?.displayType
                                  const activeDevice = deviceTypes.find(d => d.displayType === activeDeviceType)

                                  return (
                                    <div key={localeScreenshots.locale}>
                                      <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs text-neutral-400">
                                            {LOCALE_FLAGS[localeScreenshots.locale] || '🌐'} {localeScreenshots.locale}
                                          </span>
                                          <span className="text-xs text-neutral-600">•</span>
                                          <span className="text-xs text-neutral-500">
                                            {localeScreenshots.screenshotCount} screenshot(s)
                                          </span>
                                        </div>

                                        {/* Device Type Dropdown */}
                                        {deviceTypes.length > 1 && (
                                          <div className="relative">
                                            <select
                                              value={activeDeviceType || ''}
                                              onChange={(e) => setSelectedDeviceType(e.target.value)}
                                              className="appearance-none pl-3 pr-8 py-1.5 text-xs rounded-lg
                                                       bg-white/[0.05] border border-white/[0.1] text-neutral-300
                                                       hover:border-white/[0.2] focus:outline-none focus:border-purple-500/50
                                                       transition-colors cursor-pointer"
                                            >
                                              {deviceTypes.map((device) => (
                                                <option
                                                  key={device.displayType}
                                                  value={device.displayType}
                                                  className="bg-neutral-900"
                                                >
                                                  {getDisplayTypeName(device.displayType)} ({device.count})
                                                </option>
                                              ))}
                                            </select>
                                            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-neutral-500 pointer-events-none" />
                                          </div>
                                        )}

                                        {/* Single device type - just show label */}
                                        {deviceTypes.length === 1 && (
                                          <span className="text-xs text-neutral-500 flex items-center gap-1">
                                            {getDeviceIcon(deviceTypes[0].displayType)}
                                            {getDisplayTypeName(deviceTypes[0].displayType)}
                                          </span>
                                        )}
                                      </div>

                                      {/* Screenshot Thumbnails for selected device type */}
                                      {activeDevice && (
                                        <div className="flex gap-2 overflow-x-auto pb-2">
                                          {activeDevice.previews.map((preview, idx) => {
                                            // Calculate aspect ratio for skeleton
                                            const aspectRatio = preview.width / preview.height
                                            const skeletonWidth = Math.round(128 * aspectRatio) // h-32 = 128px

                                            return (
                                              <div
                                                key={idx}
                                                className="flex-shrink-0 relative group"
                                              >
                                                {/* Skeleton frame - shows while loading */}
                                                <div
                                                  className="absolute inset-0 h-32 rounded-lg border border-white/[0.1] bg-white/[0.03] animate-pulse"
                                                  style={{ width: skeletonWidth }}
                                                >
                                                  <div className="absolute inset-0 flex items-center justify-center">
                                                    <ImageIcon className="w-6 h-6 text-neutral-700" />
                                                  </div>
                                                </div>

                                                {/* Actual image */}
                                                <img
                                                  src={preview.url}
                                                  alt={`Screenshot ${idx + 1}`}
                                                  className="relative h-32 w-auto rounded-lg border border-white/[0.1] object-cover
                                                           group-hover:border-purple-500/50 transition-all bg-transparent"
                                                  style={{ minWidth: skeletonWidth }}
                                                  onLoad={(e) => {
                                                    // Hide skeleton by making image fully visible
                                                    const img = e.currentTarget
                                                    img.style.opacity = '1'
                                                    const skeleton = img.previousElementSibling as HTMLElement
                                                    if (skeleton) skeleton.style.display = 'none'
                                                  }}
                                                  onError={(e) => {
                                                    // On error, hide loading skeleton and show error state
                                                    const img = e.currentTarget
                                                    const skeleton = img.previousElementSibling as HTMLElement
                                                    if (skeleton) {
                                                      skeleton.classList.remove('animate-pulse')
                                                      skeleton.classList.add('bg-red-500/10', 'border-red-500/20')
                                                    }
                                                    img.style.display = 'none'
                                                  }}
                                                />
                                              </div>
                                            )
                                          })}
                                          {activeDevice.count > activeDevice.previews.length && (
                                            <div className="flex-shrink-0 h-32 w-16 rounded-lg border border-dashed border-white/[0.1]
                                                          flex items-center justify-center bg-white/[0.02]">
                                              <span className="text-xs text-neutral-500">
                                                +{activeDevice.count - activeDevice.previews.length}
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="font-semibold text-white">Localization</h3>
                              <p className="text-xs text-neutral-400 mt-1">
                                {formData.enabledLocales.length} locale(s) selected
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={selectPriorityLocales}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.05] text-neutral-300 hover:bg-white/[0.1] transition-colors"
                              >
                                Priority ({PRIORITY_LOCALES.length})
                              </button>
                              <button
                                type="button"
                                onClick={selectAllLocales}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.05] text-neutral-300 hover:bg-white/[0.1] transition-colors"
                              >
                                All ({APPSTORE_LOCALES.length})
                              </button>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="flex items-center gap-2 text-sm font-medium text-neutral-300">
                              <Globe className="w-4 h-4" />
                              Primary Locale
                            </label>
                            <select
                              value={formData.primaryLocale}
                              onChange={(e) => {
                                const newPrimary = e.target.value
                                setFormData({
                                  ...formData,
                                  primaryLocale: newPrimary,
                                  enabledLocales: formData.enabledLocales.includes(newPrimary)
                                    ? formData.enabledLocales
                                    : [...formData.enabledLocales, newPrimary],
                                })
                              }}
                              className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08]
                                       text-white focus:outline-none focus:border-white/[0.2]
                                       hover:border-white/[0.15] transition-colors"
                            >
                              {APPSTORE_LOCALES.map(locale => (
                                <option key={locale} value={locale} className="bg-neutral-900">
                                  {LOCALE_FLAGS[locale]} {locale} - {LOCALE_NAMES[locale]}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-4 max-h-[200px] overflow-y-auto p-1">
                            {APPSTORE_LOCALES.map(locale => {
                              const isSelected = formData.enabledLocales.includes(locale)
                              const isPrimary = locale === formData.primaryLocale
                              return (
                                <button
                                  key={locale}
                                  type="button"
                                  onClick={() => toggleLocale(locale)}
                                  className={`relative flex items-center gap-2 p-2 rounded-lg border text-left text-xs transition-all ${
                                    isSelected
                                      ? isPrimary
                                        ? 'border-white/[0.3] bg-white/[0.1] ring-1 ring-white/[0.2]'
                                        : 'border-white/[0.15] bg-white/[0.08]'
                                      : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.04]'
                                  }`}
                                >
                                  {isSelected && (
                                    <div className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center ${
                                      isPrimary ? 'bg-white' : 'bg-neutral-400'
                                    }`}>
                                      <Check className={`w-2 h-2 ${isPrimary ? 'text-black' : 'text-white'}`} />
                                    </div>
                                  )}
                                  <span>{LOCALE_FLAGS[locale] || '🌐'}</span>
                                  <span className={isSelected ? 'text-white font-medium' : 'text-neutral-400'}>
                                    {locale}
                                  </span>
                                  {isPrimary && (
                                    <span className="ml-auto text-[10px] font-bold text-white/70 uppercase tracking-wider">1st</span>
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Error */}
                      {error && (
                        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                          {error}
                        </div>
                      )}

                      {/* Submit */}
                      <div className="flex items-center justify-end gap-4 pt-4 border-t border-white/[0.08]">
                        <button
                          type="button"
                          onClick={closeCreateModal}
                          className="px-5 py-2.5 rounded-xl text-sm font-medium text-neutral-400 hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={isSubmitting || !formData.name}
                          className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium
                                   bg-white text-black hover:bg-neutral-200
                                   disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                          {isSubmitting ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              {selectedStoreType === 'both' ? 'Creating Pair...' : 'Creating...'}
                            </>
                          ) : (
                            selectedStoreType === 'both' ? 'Create Paired Apps' : 'Create App'
                          )}
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
