'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Settings,
  Apple,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  Link2,
  Unlink,
  RefreshCw,
  ArrowRightLeft,
  FileText,
  Image,
  Palette,
  Cpu,
  Copy,
  Check,
  ExternalLink,
  DollarSign,
  Eye,
  EyeOff,
  Headset,
  ShoppingBag,
  Globe,
} from 'lucide-react'
import { useInternalIntegrations } from '@/components/dashboard/internal-integrations-context'
import { appOrigin } from '@/lib/routing/app-url'

// Client bundle: NEXT_PUBLIC_APP_URL must be read literally so Next inlines it at build time.
const APP_ORIGIN = appOrigin({ NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL })

// Demo project constant for detection
const DEMO_PROJECT_ID = 'demo-project'

interface ProjectSettings {
  name: string
  storeType: 'ios' | 'android' | 'web'
  appStoreAppId: string | null
  playStorePackage: string | null
}

interface LinkedProject {
  id: string
  name: string
  storeType: 'ios' | 'android'
  appStoreAppId: string | null
  playStorePackage: string | null
}

interface LinkConfiguration {
  syncMode: 'auto' | 'manual'
  shareMetadata: boolean
  shareScreenshots: boolean
  shareIcons: boolean
  sharedMetadataFields: string[]
  lastSyncedAt: string | null
}

interface LinkStatus {
  linked: boolean
  linkedProjectId: string | null
  linkConfiguration: LinkConfiguration | null
  linkOwner: boolean
  linkedProject: LinkedProject | null
}

interface AvailableProject {
  id: string
  name: string
  storeType: 'ios' | 'android'
}

export default function SettingsPage() {
  const internalIntegrationsEnabled = useInternalIntegrations()
  const params = useParams()
  const router = useRouter()
  const projectId = params.projectId as string
  const isDemo = projectId === DEMO_PROJECT_ID

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [settings, setSettings] = useState<ProjectSettings>({
    name: '',
    storeType: 'ios',
    appStoreAppId: null,
    playStorePackage: null,
  })

  const [linkStatus, setLinkStatus] = useState<LinkStatus | null>(null)
  const [isLoadingLink, setIsLoadingLink] = useState(false)
  const [isLinking, setIsLinking] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [availableProjects, setAvailableProjects] = useState<AvailableProject[]>([])
  const [selectedProjectToLink, setSelectedProjectToLink] = useState<string | null>(null)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // MCP Configuration
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // RevenueCat Configuration
  const [revenueCatSecretKey, setRevenueCatSecretKey] = useState('')
  const [revenueCatProjectId, setRevenueCatProjectId] = useState('')
  const [showSecretKey, setShowSecretKey] = useState(false)
  const [isSavingRevenueCat, setIsSavingRevenueCat] = useState(false)
  const [revenueCatStatus, setRevenueCatStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle')
  const [revenueCatFromLinked, setRevenueCatFromLinked] = useState(false)

  // Gleap Configuration
  const [gleapApiToken, setGleapApiToken] = useState('')
  const [gleapProjectId, setGleapProjectId] = useState('')
  const [showGleapToken, setShowGleapToken] = useState(false)
  const [isSavingGleap, setIsSavingGleap] = useState(false)
  const [gleapStatus, setGleapStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle')
  const [gleapFromLinked, setGleapFromLinked] = useState(false)

  // Firebase Integration Configuration
  const [firebaseAppId, setFirebaseAppId] = useState('')
  const [firebaseAnalyticsPropertyId, setFirebaseAnalyticsPropertyId] = useState('')
  const [firebaseProjectId, setFirebaseProjectId] = useState('')
  const [isSavingFirebase, setIsSavingFirebase] = useState(false)
  const [firebaseStatus, setFirebaseStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle')
  const [analyticsStatus, setAnalyticsStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle')
  const [firebaseSaJson, setFirebaseSaJson] = useState('')
  const [firebaseSaEmail, setFirebaseSaEmail] = useState<string | null>(null)
  const [isSavingFirebaseSa, setIsSavingFirebaseSa] = useState(false)
  const [showFirebaseSa, setShowFirebaseSa] = useState(false)

  // Whop Configuration
  const [whopApiKey, setWhopApiKey] = useState('')
  const [whopCompanyId, setWhopCompanyId] = useState('')
  const [whopWebhookSecret, setWhopWebhookSecret] = useState('')
  const [showWhopKey, setShowWhopKey] = useState(false)
  const [isSavingWhop, setIsSavingWhop] = useState(false)
  const [whopStatus, setWhopStatus] = useState<'idle' | 'testing' | 'valid' | 'invalid'>('idle')

  // Store ID / Package Name
  const [storeIdInput, setStoreIdInput] = useState('')
  const [isSavingStoreId, setIsSavingStoreId] = useState(false)

  // Fetch project data
  useEffect(() => {
    async function fetchData() {
      if (isDemo) {
        setSettings({
          name: 'My Awesome App',
          storeType: 'ios',
          appStoreAppId: '1234567890',
          playStorePackage: null,
        })
        setLinkStatus({
          linked: false,
          linkedProjectId: null,
          linkConfiguration: null,
          linkOwner: false,
          linkedProject: null,
        })
        setIsLoading(false)
        return
      }

      try {
        const response = await fetch(`/api/metadata?projectId=${projectId}`)
        if (!response.ok) {
          throw new Error('Failed to fetch project')
        }
        const data = await response.json()

        setSettings({
          name: data.project.name,
          storeType: data.project.storeType || (data.project.appStoreAppId ? 'ios' : 'android'),
          appStoreAppId: data.project.appStoreAppId,
          playStorePackage: data.project.playStorePackage,
        })
        setStoreIdInput(data.project.playStorePackage || '')

        // Load RevenueCat settings (check local first, then linked project)
        if (data.project.revenueCatSecretKey) {
          setRevenueCatSecretKey(data.project.revenueCatSecretKey)
        }
        if (data.project.revenueCatProjectId) {
          setRevenueCatProjectId(data.project.revenueCatProjectId)
        }
        if (data.project.revenueCatSecretKey && data.project.revenueCatProjectId) {
          setRevenueCatStatus('valid')
        } else if (data.project.linkedProjectId) {
          // Check linked project for RevenueCat credentials
          try {
            const linkedRes = await fetch(`/api/metadata?projectId=${data.project.linkedProjectId}`)
            if (linkedRes.ok) {
              const linkedData = await linkedRes.json()
              const linkedKey = linkedData.project?.revenueCatSecretKey
              const linkedProjId = linkedData.project?.revenueCatProjectId
              if (linkedKey && linkedProjId) {
                setRevenueCatSecretKey(linkedKey)
                setRevenueCatProjectId(linkedProjId)
                setRevenueCatStatus('valid')
                setRevenueCatFromLinked(true)
              }
            }
          } catch {
            // Ignore — linked project credentials fetch is best-effort
          }
        }

        // Load Gleap settings (check local first, then linked project)
        if (data.project.gleapApiToken) {
          setGleapApiToken(data.project.gleapApiToken)
        }
        if (data.project.gleapProjectId) {
          setGleapProjectId(data.project.gleapProjectId)
        }
        if (data.project.gleapApiToken && data.project.gleapProjectId) {
          setGleapStatus('valid')
        } else if (data.project.linkedProjectId) {
          // Check linked project for Gleap credentials (reuse linked data if already fetched)
          try {
            const linkedRes = await fetch(`/api/metadata?projectId=${data.project.linkedProjectId}`)
            if (linkedRes.ok) {
              const linkedData = await linkedRes.json()
              const linkedToken = linkedData.project?.gleapApiToken
              const linkedGleapId = linkedData.project?.gleapProjectId
              if (linkedToken && linkedGleapId) {
                setGleapApiToken(linkedToken)
                setGleapProjectId(linkedGleapId)
                setGleapStatus('valid')
                setGleapFromLinked(true)
              }
            }
          } catch {
            // Ignore
          }
        }

        // Load Firebase settings
        if (internalIntegrationsEnabled && data.project.firebaseAppId) {
          setFirebaseAppId(data.project.firebaseAppId)
          setFirebaseStatus('valid')
        }
        if (data.project.firebaseAnalyticsPropertyId) {
          setFirebaseAnalyticsPropertyId(data.project.firebaseAnalyticsPropertyId)
          setAnalyticsStatus('valid')
        }
        if (data.project.firebaseProjectId) {
          setFirebaseProjectId(data.project.firebaseProjectId)
        }
        // Load Firebase SA info (email only — not the private key)
        try {
          const fbCredRes = await fetch(`/api/credentials/firebase?projectId=${projectId}`)
          if (fbCredRes.ok) {
            const fbCredData = await fbCredRes.json()
            if (fbCredData.serviceAccountEmail) {
              setFirebaseSaEmail(fbCredData.serviceAccountEmail)
            }
          }
        } catch {
          // Ignore — non-critical
        }

        // Load Whop settings
        if (data.project.whopApiKey) {
          setWhopApiKey(data.project.whopApiKey)
        }
        if (data.project.whopCompanyId) {
          setWhopCompanyId(data.project.whopCompanyId)
        }
        if (data.project.whopWebhookSecret) {
          setWhopWebhookSecret(data.project.whopWebhookSecret)
        }
        if (data.project.whopApiKey && data.project.whopCompanyId) {
          setWhopStatus('valid')
        }

        // Fetch link status
        await fetchLinkStatus()

        // Fetch API key for MCP config
        const apiResponse = await fetch('/api/settings')
        if (apiResponse.ok) {
          const apiData = await apiResponse.json()
          setApiKey(apiData.apiKey)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [projectId, isDemo, internalIntegrationsEnabled])

  const fetchLinkStatus = async () => {
    if (isDemo) return

    setIsLoadingLink(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/link`)
      if (response.ok) {
        const data = await response.json()
        setLinkStatus(data.data)
      }
    } catch (err) {
      console.error('Failed to fetch link status:', err)
    } finally {
      setIsLoadingLink(false)
    }
  }

  const fetchAvailableProjects = async () => {
    try {
      const response = await fetch('/api/projects')
      if (response.ok) {
        const data = await response.json()
        // Filter to opposite store type and not already linked
        const oppositeType = settings.storeType === 'ios' ? 'android' : 'ios'
        const available = data.data.projects.filter((p: any) =>
          p.id !== projectId &&
          p.storeType === oppositeType &&
          !p.linkedProjectId
        )
        setAvailableProjects(available)
      }
    } catch (err) {
      console.error('Failed to fetch projects:', err)
    }
  }

  const handleLink = async () => {
    if (!selectedProjectToLink) return

    setIsLinking(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetProjectId: selectedProjectToLink,
          syncMode: 'manual',
          shareMetadata: true,
          shareScreenshots: true,
          shareIcons: true,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to link projects')
      }

      setSuccess('Projects linked successfully')
      setShowLinkModal(false)
      await fetchLinkStatus()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLinking(false)
    }
  }

  const handleUnlink = async () => {
    if (!linkStatus?.linkedProjectId) return

    setIsLinking(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}/link`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to unlink projects')
      }

      setSuccess('Projects unlinked successfully')
      await fetchLinkStatus()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLinking(false)
    }
  }

  const handleSync = async (direction: 'push' | 'pull') => {
    setIsSyncing(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction,
          syncMetadata: true,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to sync')
      }

      const data = await response.json()
      setSuccess(`Sync ${direction === 'push' ? 'pushed' : 'pulled'} successfully`)
      await fetchLinkStatus()
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSyncing(false)
    }
  }

  const handleUpdateLinkConfig = async (updates: Partial<LinkConfiguration>) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/link`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update configuration')
      }

      await fetchLinkStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    }
  }

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleSaveRevenueCat = async () => {
    if (isDemo) {
      setError('Cannot modify demo project')
      return
    }

    setIsSavingRevenueCat(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revenueCatSecretKey: revenueCatSecretKey || null,
          revenueCatProjectId: revenueCatProjectId || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save RevenueCat settings')
      }

      setSuccess('RevenueCat settings saved')
      if (revenueCatSecretKey && revenueCatProjectId) {
        setRevenueCatStatus('valid')
      } else {
        setRevenueCatStatus('idle')
      }
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setRevenueCatStatus('invalid')
    } finally {
      setIsSavingRevenueCat(false)
    }
  }

  const handleTestRevenueCat = async () => {
    if (!revenueCatSecretKey || !revenueCatProjectId) {
      setError('Please enter both Secret Key and Project ID')
      return
    }

    setRevenueCatStatus('testing')
    setError(null)

    try {
      const response = await fetch(`/api/revenuecat/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secretKey: revenueCatSecretKey,
          projectId: revenueCatProjectId,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to connect to RevenueCat')
      }

      setRevenueCatStatus('valid')
      setSuccess('Successfully connected to RevenueCat')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setRevenueCatStatus('invalid')
      setError(err instanceof Error ? err.message : 'Failed to connect to RevenueCat')
    }
  }

  const handleSaveStoreId = async () => {
    if (isDemo) {
      setError('Cannot modify demo project')
      return
    }

    setIsSavingStoreId(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playStorePackage: storeIdInput.trim() || null }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save')
      }

      setSettings(prev => ({ ...prev, playStorePackage: storeIdInput.trim() || null }))
      setSuccess('Package name saved')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSavingStoreId(false)
    }
  }

  const handleSaveGleap = async () => {
    if (isDemo) {
      setError('Cannot modify demo project')
      return
    }

    setIsSavingGleap(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gleapApiToken: gleapApiToken || null,
          gleapProjectId: gleapProjectId || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save Gleap settings')
      }

      setSuccess('Gleap settings saved')
      if (gleapApiToken && gleapProjectId) {
        setGleapStatus('valid')
      } else {
        setGleapStatus('idle')
      }
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setGleapStatus('invalid')
    } finally {
      setIsSavingGleap(false)
    }
  }

  const handleTestGleap = async () => {
    if (!gleapApiToken || !gleapProjectId) {
      setError('Please enter both API Token and Project ID')
      return
    }

    setGleapStatus('testing')
    setError(null)

    try {
      const response = await fetch('/api/support/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiToken: gleapApiToken,
          gleapProjectId: gleapProjectId,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to connect to Gleap')
      }

      setGleapStatus('valid')
      setSuccess('Successfully connected to Gleap')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setGleapStatus('invalid')
      setError(err instanceof Error ? err.message : 'Failed to connect to Gleap')
    }
  }

  const handleSaveFirebase = async () => {
    if (isDemo) {
      setError('Cannot modify demo project')
      return
    }

    setIsSavingFirebase(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(internalIntegrationsEnabled
            ? { firebaseAppId: firebaseAppId.trim() || null }
            : {}),
          firebaseAnalyticsPropertyId: firebaseAnalyticsPropertyId.trim() || null,
          firebaseProjectId: firebaseProjectId.trim() || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save Firebase settings')
      }

      setSuccess('Firebase settings saved')
      if (firebaseAppId.trim()) setFirebaseStatus('valid')
      else setFirebaseStatus('idle')
      if (firebaseAnalyticsPropertyId.trim()) setAnalyticsStatus('valid')
      else setAnalyticsStatus('idle')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setFirebaseStatus('invalid')
    } finally {
      setIsSavingFirebase(false)
    }
  }

  const handleTestFirebase = async () => {
    if (!firebaseAppId) { setError('Please enter a Firebase App ID'); return }
    setFirebaseStatus('testing')
    setError(null)
    try {
      const res = await fetch(`/api/crashlytics?projectId=${projectId}&action=test`)
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      setFirebaseStatus('valid')
      setSuccess('Crashlytics connected')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setFirebaseStatus('invalid')
      setError(err instanceof Error ? err.message : 'Failed to connect to Crashlytics')
    }
  }

  const handleTestAnalytics = async () => {
    if (!firebaseAnalyticsPropertyId) { setError('Please enter a GA4 Property ID'); return }
    setAnalyticsStatus('testing')
    setError(null)
    try {
      // Save the property ID first so the API can read it from Firestore
      await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firebaseAnalyticsPropertyId: firebaseAnalyticsPropertyId.trim() || null }),
      })
      const res = await fetch(`/api/firebase/analytics?projectId=${projectId}&action=test`)
      if (!res.ok) {
        const d = await res.json()
        const msg = d.error || 'Failed'
        if (msg.includes('has not been used') || msg.includes('disabled') || msg.includes('Enable it')) {
          throw new Error('Google Analytics Data API is not enabled. Enable it at Google Cloud Console → APIs → Google Analytics Data API, then retry.')
        }
        if (msg.includes('not found') || msg.includes('404')) {
          throw new Error(`Property not found. Check the numeric Property ID is correct (not the "G-XXXXXXXX" measurement ID).`)
        }
        throw new Error(msg)
      }
      setAnalyticsStatus('valid')
      setSuccess('Firebase Analytics connected')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setAnalyticsStatus('invalid')
      setError(err instanceof Error ? err.message : 'Failed to connect to Firebase Analytics')
    }
  }

  const handleSaveFirebaseSa = async () => {
    if (isDemo) { setError('Cannot modify demo project'); return }
    if (!firebaseSaJson.trim()) { setError('Upload your Firebase service account key file first'); return }

    setIsSavingFirebaseSa(true)
    setError(null)
    try {
      const res = await fetch('/api/credentials/firebase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, serviceAccount: firebaseSaJson.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save Firebase credentials')
      setFirebaseSaEmail(data.serviceAccountEmail)
      setFirebaseSaJson('')
      setShowFirebaseSa(false)
      setSuccess('Firebase service account saved')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Firebase credentials')
    } finally {
      setIsSavingFirebaseSa(false)
    }
  }

  const handleRemoveFirebaseSa = async () => {
    if (isDemo) { setError('Cannot modify demo project'); return }

    try {
      const res = await fetch(`/api/credentials/firebase?projectId=${projectId}`, { method: 'DELETE' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to remove') }
      setFirebaseSaEmail(null)
      setSuccess('Firebase service account removed')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove Firebase credentials')
    }
  }

  const handleSaveWhop = async () => {
    if (isDemo) {
      setError('Cannot modify demo project')
      return
    }

    setIsSavingWhop(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whopApiKey: whopApiKey || null,
          whopCompanyId: whopCompanyId || null,
          whopWebhookSecret: whopWebhookSecret || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save Whop settings')
      }

      setSuccess('Whop settings saved')
      if (whopApiKey && whopCompanyId) {
        setWhopStatus('valid')
      } else {
        setWhopStatus('idle')
      }
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setWhopStatus('invalid')
    } finally {
      setIsSavingWhop(false)
    }
  }

  const handleTestWhop = async () => {
    if (!whopApiKey || !whopCompanyId) {
      setError('Please enter both API Key and Company ID')
      return
    }

    setWhopStatus('testing')
    setError(null)

    try {
      const response = await fetch('/api/whop-project/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: whopApiKey,
          companyId: whopCompanyId,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to connect to Whop')
      }

      setWhopStatus('valid')
      setSuccess('Successfully connected to Whop')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      setWhopStatus('invalid')
      setError(err instanceof Error ? err.message : 'Failed to connect to Whop')
    }
  }

  // MCP server name - platform-specific for multi-project support
  const getMcpServerName = () =>
    settings.storeType === 'ios' ? 'appstore-ios' : settings.storeType === 'web' ? 'appstore-web' : 'appstore-android'

  // Generate MCP server config (without wrapper)
  const getMcpServerConfig = () => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : APP_ORIGIN
    return {
      type: 'http',
      url: `${baseUrl}/api/mcp?projectId=${projectId}`,
      headers: {
        Authorization: `Bearer ${apiKey || 'YOUR_API_KEY'}`
      }
    }
  }

  // Generate full MCP config for this project
  const getMcpConfig = () => {
    return {
      mcpServers: {
        [getMcpServerName()]: getMcpServerConfig()
      }
    }
  }

  const handleDelete = async () => {
    if (isDemo) {
      setError('Cannot delete demo project')
      return
    }

    setIsDeleting(true)
    setError(null)

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete project')
      }

      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
      setIsDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3 text-neutral-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading settings...</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="w-5 h-5 text-purple-400" />
          Project Settings
        </h1>
        {isDemo && (
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Demo
          </span>
        )}
      </div>

      <div className="max-w-3xl space-y-8">
        {/* Success/Error Messages */}
        {success && (
          <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            {success}
          </div>
        )}
        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center gap-2">
            <XCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Store Type Badge */}
        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              settings.storeType === 'ios'
                ? 'bg-blue-500/20 text-blue-400'
                : settings.storeType === 'web'
                  ? 'bg-violet-500/20 text-violet-400'
                  : 'bg-green-500/20 text-green-400'
            }`}>
              {settings.storeType === 'ios' ? <Apple className="w-5 h-5" /> : settings.storeType === 'web' ? <Globe className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                {settings.storeType === 'ios' ? 'iOS / App Store' : settings.storeType === 'web' ? 'Web Application' : 'Android / Play Store'}
              </p>
              <p className="text-xs text-neutral-500">
                Platform type is set at creation and cannot be changed
              </p>
            </div>
          </div>
        </div>

        {/* Package Name — Android only (iOS App ID is pulled automatically from the API) */}
        {settings.storeType === 'android' && (
          <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-4">
            <div className="flex items-center gap-3">
              <Play className="w-5 h-5 text-green-400" />
              <h2 className="text-lg font-semibold text-white">Play Store Package Name</h2>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-300">Package Name</label>
              <input
                type="text"
                value={storeIdInput}
                onChange={(e) => setStoreIdInput(e.target.value)}
                placeholder="com.example.myapp"
                className="w-full px-4 py-3 rounded-xl text-sm text-white
                         bg-black/40 border border-white/[0.08]
                         placeholder:text-neutral-600
                         focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20
                         focus:outline-none transition-all font-mono"
              />
              <p className="text-xs text-neutral-500">
                Your app&apos;s applicationId from build.gradle, e.g. com.example.myapp
              </p>
            </div>

            <button
              onClick={handleSaveStoreId}
              disabled={isSavingStoreId}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium
                       bg-gradient-to-r from-green-500 to-emerald-500 text-white
                       hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSavingStoreId ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </button>
          </div>
        )}

        {/* MCP Configuration */}
        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Cpu className="w-5 h-5 text-purple-400" />
              <h2 className="text-lg font-semibold text-white">AI Agent / MCP</h2>
            </div>
            <a
              href="/docs/mcp"
              target="_blank"
              className="flex items-center gap-1.5 text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Documentation
            </a>
          </div>

          <p className="text-sm text-neutral-400">
            Connect this project to Codex, Claude Code, Cursor, or another MCP-compatible AI agent.
            The configuration below is scoped to this project only.
          </p>

          {!apiKey && (
            <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
              <p className="text-sm text-purple-200">
                Create a scoped agent key first, then replace <code>YOUR_API_KEY</code> below.
              </p>
              <Link href="/settings" className="shrink-0 text-sm font-medium text-white hover:text-purple-200 transition-colors">
                Create key →
              </Link>
            </div>
          )}

          {/* CLI Command - Project Level */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-neutral-300">
                Claude Code shortcut
              </label>
              <span className="text-xs text-neutral-500">Project scope</span>
            </div>
            <div className="relative">
              <pre className="p-4 rounded-xl bg-black/40 border border-white/[0.08] text-xs text-neutral-300 overflow-x-auto font-mono whitespace-pre-wrap break-all">
{`claude mcp add-json ${getMcpServerName()} --scope project '${JSON.stringify(getMcpServerConfig())}'`}
              </pre>
              <button
                onClick={() => copyToClipboard(
                  `claude mcp add-json ${getMcpServerName()} --scope project '${JSON.stringify(getMcpServerConfig())}'`,
                  'cli'
                )}
                className="absolute top-3 right-3 p-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1]
                         text-neutral-400 hover:text-white transition-all"
                title="Copy CLI command"
              >
                {copiedField === 'cli' ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              For Claude Code, run this in your project directory. Other MCP agents can use the manual remote-server configuration below.
            </p>
          </div>

          {/* JSON Config - Manual */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-neutral-300">
                Manual Configuration
              </label>
              <span className="text-xs text-neutral-500">Remote MCP server</span>
            </div>
            <div className="relative">
              <pre className="p-4 rounded-xl bg-black/40 border border-white/[0.08] text-xs text-neutral-300 overflow-x-auto font-mono">
{JSON.stringify(getMcpConfig(), null, 2)}
              </pre>
              <button
                onClick={() => copyToClipboard(JSON.stringify(getMcpConfig(), null, 2), 'config')}
                className="absolute top-3 right-3 p-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1]
                         text-neutral-400 hover:text-white transition-all"
                title="Copy configuration"
              >
                {copiedField === 'config' ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Quick Copy Fields */}
          <div className="grid gap-3">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.08]">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-neutral-400 mb-1">MCP URL (with Project ID)</p>
                <p className="text-sm text-white font-mono truncate">
                  {typeof window !== 'undefined' ? window.location.origin : APP_ORIGIN}/api/mcp?projectId={projectId}
                </p>
              </div>
              <button
                onClick={() => copyToClipboard(
                  `${typeof window !== 'undefined' ? window.location.origin : APP_ORIGIN}/api/mcp?projectId=${projectId}`,
                  'url'
                )}
                className="p-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-neutral-400 hover:text-white transition-all"
              >
                {copiedField === 'url' ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.08]">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-neutral-400 mb-1">Project ID</p>
                <p className="text-sm text-white font-mono truncate">{projectId}</p>
              </div>
              <button
                onClick={() => copyToClipboard(projectId, 'projectId')}
                className="p-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-neutral-400 hover:text-white transition-all"
              >
                {copiedField === 'projectId' ? (
                  <Check className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>

            {apiKey && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.08]">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-neutral-400 mb-1">API Key</p>
                  <p className="text-sm text-white font-mono truncate">
                    {apiKey.slice(0, 12)}...{apiKey.slice(-8)}
                  </p>
                </div>
                <button
                  onClick={() => copyToClipboard(apiKey, 'apiKey')}
                  className="p-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-neutral-400 hover:text-white transition-all"
                >
                  {copiedField === 'apiKey' ? (
                    <Check className="w-4 h-4 text-green-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
            )}
          </div>

          <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
            <p className="text-sm text-purple-300">
              <strong>How it works:</strong> When you use the MCP URL with the projectId parameter,
              all tool calls are automatically scoped to this project. You don't need to specify
              the projectId in each command.
            </p>
          </div>
        </div>

        {/* RevenueCat Integration — mobile only */}
        {internalIntegrationsEnabled && settings.storeType !== 'web' && (
        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-orange-400" />
              <h2 className="text-lg font-semibold text-white">RevenueCat Integration</h2>
            </div>
            {revenueCatStatus === 'valid' && (
              <div className="flex items-center gap-1.5 text-xs text-green-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {revenueCatFromLinked ? 'Shared from linked project' : 'Connected'}
              </div>
            )}
            {revenueCatStatus === 'invalid' && (
              <div className="flex items-center gap-1.5 text-xs text-red-400">
                <XCircle className="w-3.5 h-3.5" />
                Invalid
              </div>
            )}
          </div>

          <p className="text-sm text-neutral-400">
            Connect your RevenueCat account to manage products, offerings, and entitlements
            through the MCP tools. This enables seamless sync between App Store Connect and RevenueCat.
          </p>

          {revenueCatFromLinked && linkStatus?.linkedProject && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <Link2 className="w-4 h-4 text-blue-400 shrink-0" />
              <p className="text-sm text-blue-300">
                Credentials shared from linked {linkStatus.linkedProject.storeType === 'ios' ? 'iOS' : 'Android'} project{' '}
                <span className="font-medium text-blue-200">{linkStatus.linkedProject.name}</span>.
                You can override by entering different credentials below.
              </p>
            </div>
          )}

          <div className="space-y-4">
            {/* Secret Key */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-300">
                Secret API Key (V2)
              </label>
              <div className="relative">
                <input
                  type={showSecretKey ? 'text' : 'password'}
                  value={revenueCatSecretKey}
                  onChange={(e) => {
                    setRevenueCatSecretKey(e.target.value)
                    setRevenueCatStatus('idle')
                    setRevenueCatFromLinked(false)
                  }}
                  placeholder="sk_..."
                  className="w-full px-4 py-3 pr-12 rounded-xl text-sm text-white
                           bg-black/40 border border-white/[0.08]
                           placeholder:text-neutral-600
                           focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20
                           focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowSecretKey(!showSecretKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg
                           text-neutral-500 hover:text-white transition-colors"
                >
                  {showSecretKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-neutral-500">
                Find this in RevenueCat → Project Settings → API Keys → Secret API key (v2)
              </p>
            </div>

            {/* Project ID */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-300">
                Project ID
              </label>
              <input
                type="text"
                value={revenueCatProjectId}
                onChange={(e) => {
                  setRevenueCatProjectId(e.target.value)
                  setRevenueCatStatus('idle')
                  setRevenueCatFromLinked(false)
                }}
                placeholder="proj_..."
                className="w-full px-4 py-3 rounded-xl text-sm text-white
                         bg-black/40 border border-white/[0.08]
                         placeholder:text-neutral-600
                         focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20
                         focus:outline-none transition-all"
              />
              <p className="text-xs text-neutral-500">
                Found in RevenueCat → Project Settings → General. Starts with "proj_"
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestRevenueCat}
              disabled={!revenueCatSecretKey || !revenueCatProjectId || revenueCatStatus === 'testing'}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                       bg-white/[0.05] text-white border border-white/[0.08]
                       hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {revenueCatStatus === 'testing' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Testing...
                </>
              ) : (
                'Test Connection'
              )}
            </button>
            <button
              onClick={handleSaveRevenueCat}
              disabled={isSavingRevenueCat}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium
                       bg-gradient-to-r from-orange-500 to-amber-500 text-white
                       hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSavingRevenueCat ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </button>
          </div>

          <div className="p-4 rounded-xl bg-orange-500/10 border border-orange-500/20">
            <p className="text-sm text-orange-300">
              <strong>Available MCP Tools:</strong> Once connected, you can use tools like{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">syncProductsToRevenueCat</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">createOfferingWithProducts</code>,
              and more through Claude Code.
            </p>
          </div>
        </div>
        )}

        {/* Whop Integration */}
        {internalIntegrationsEnabled && (
        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShoppingBag className="w-5 h-5 text-violet-400" />
              <h2 className="text-lg font-semibold text-white">Whop Integration</h2>
            </div>
            {whopStatus === 'valid' && (
              <div className="flex items-center gap-1.5 text-xs text-green-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Connected
              </div>
            )}
            {whopStatus === 'invalid' && (
              <div className="flex items-center gap-1.5 text-xs text-red-400">
                <XCircle className="w-3.5 h-3.5" />
                Invalid
              </div>
            )}
          </div>

          <p className="text-sm text-neutral-400">
            Connect your Whop account to manage products, checkouts, and customers.
            {settings.storeType === 'web' && ' This is the primary monetization integration for web projects.'}
          </p>

          <div className="space-y-4">
            {/* API Key */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-300">
                API Key
              </label>
              <div className="relative">
                <input
                  type={showWhopKey ? 'text' : 'password'}
                  value={whopApiKey}
                  onChange={(e) => {
                    setWhopApiKey(e.target.value)
                    setWhopStatus('idle')
                  }}
                  placeholder="apik_..."
                  className="w-full px-4 py-3 pr-12 rounded-xl text-sm text-white
                           bg-black/40 border border-white/[0.08]
                           placeholder:text-neutral-600
                           focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20
                           focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowWhopKey(!showWhopKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg
                           text-neutral-500 hover:text-white transition-colors"
                >
                  {showWhopKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-neutral-500">
                Find this in Whop Dashboard → Developer → API Keys
              </p>
            </div>

            {/* Company ID */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-300">
                Company ID
              </label>
              <input
                type="text"
                value={whopCompanyId}
                onChange={(e) => {
                  setWhopCompanyId(e.target.value)
                  setWhopStatus('idle')
                }}
                placeholder="biz_..."
                className="w-full px-4 py-3 rounded-xl text-sm text-white
                         bg-black/40 border border-white/[0.08]
                         placeholder:text-neutral-600
                         focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20
                         focus:outline-none transition-all"
              />
              <p className="text-xs text-neutral-500">
                Found in Whop Dashboard → Settings → General. Starts with &quot;biz_&quot;
              </p>
            </div>

            {/* Webhook Secret */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-300">
                Webhook Secret <span className="text-neutral-500">(optional)</span>
              </label>
              <input
                type="password"
                value={whopWebhookSecret}
                onChange={(e) => setWhopWebhookSecret(e.target.value)}
                placeholder="ws_..."
                className="w-full px-4 py-3 rounded-xl text-sm text-white
                         bg-black/40 border border-white/[0.08]
                         placeholder:text-neutral-600
                         focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20
                         focus:outline-none transition-all"
              />
              <p className="text-xs text-neutral-500">
                Used to verify incoming webhook events from Whop. Find in Whop Dashboard → Developer → Webhooks.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestWhop}
              disabled={!whopApiKey || !whopCompanyId || whopStatus === 'testing'}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                       bg-white/[0.05] text-white border border-white/[0.08]
                       hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {whopStatus === 'testing' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Testing...
                </>
              ) : (
                'Test Connection'
              )}
            </button>
            <button
              onClick={handleSaveWhop}
              disabled={isSavingWhop}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium
                       bg-gradient-to-r from-violet-500 to-purple-500 text-white
                       hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSavingWhop ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </button>
          </div>

          <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/20">
            <p className="text-sm text-violet-300">
              <strong>Available MCP Tools:</strong> Once connected, you can use tools like{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">whop_list_products</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">whop_create_checkout</code>,
              and more through Claude Code. View the Purchases dashboard for a visual overview.
            </p>
          </div>
        </div>
        )}

        {/* Gleap Integration */}
        {internalIntegrationsEnabled && (
        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Headset className="w-5 h-5 text-teal-400" />
              <h2 className="text-lg font-semibold text-white">Gleap Support Integration</h2>
            </div>
            {gleapStatus === 'valid' && (
              <div className="flex items-center gap-1.5 text-xs text-green-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {gleapFromLinked ? 'Shared from linked project' : 'Connected'}
              </div>
            )}
            {gleapStatus === 'invalid' && (
              <div className="flex items-center gap-1.5 text-xs text-red-400">
                <XCircle className="w-3.5 h-3.5" />
                Invalid
              </div>
            )}
          </div>

          <p className="text-sm text-neutral-400">
            Connect your Gleap account to view support tickets, manage your help center,
            and train the AI bot — all from within the MCP tools and Support dashboard.
          </p>

          {gleapFromLinked && linkStatus?.linkedProject && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <Link2 className="w-4 h-4 text-blue-400 shrink-0" />
              <p className="text-sm text-blue-300">
                Credentials shared from linked {linkStatus.linkedProject.storeType === 'ios' ? 'iOS' : 'Android'} project{' '}
                <span className="font-medium text-blue-200">{linkStatus.linkedProject.name}</span>.
                You can override by entering different credentials below.
              </p>
            </div>
          )}

          <div className="space-y-4">
            {/* API Token */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-300">
                API Token
              </label>
              <div className="relative">
                <input
                  type={showGleapToken ? 'text' : 'password'}
                  value={gleapApiToken}
                  onChange={(e) => {
                    setGleapApiToken(e.target.value)
                    setGleapStatus('idle')
                    setGleapFromLinked(false)
                  }}
                  placeholder="Your Gleap API token"
                  className="w-full px-4 py-3 pr-12 rounded-xl text-sm text-white
                           bg-black/40 border border-white/[0.08]
                           placeholder:text-neutral-600
                           focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20
                           focus:outline-none transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowGleapToken(!showGleapToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg
                           text-neutral-500 hover:text-white transition-colors"
                >
                  {showGleapToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-neutral-500">
                Find this in Gleap Dashboard → Settings → API
              </p>
            </div>

            {/* Project ID */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-300">
                Project ID
              </label>
              <input
                type="text"
                value={gleapProjectId}
                onChange={(e) => {
                  setGleapProjectId(e.target.value)
                  setGleapStatus('idle')
                  setGleapFromLinked(false)
                }}
                placeholder="Your Gleap project ID"
                className="w-full px-4 py-3 rounded-xl text-sm text-white
                         bg-black/40 border border-white/[0.08]
                         placeholder:text-neutral-600
                         focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20
                         focus:outline-none transition-all"
              />
              <p className="text-xs text-neutral-500">
                Found in Gleap Dashboard → Settings → General
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleTestGleap}
              disabled={!gleapApiToken || !gleapProjectId || gleapStatus === 'testing'}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                       bg-white/[0.05] text-white border border-white/[0.08]
                       hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {gleapStatus === 'testing' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Testing...
                </>
              ) : (
                'Test Connection'
              )}
            </button>
            <button
              onClick={handleSaveGleap}
              disabled={isSavingGleap}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium
                       bg-gradient-to-r from-teal-500 to-emerald-500 text-white
                       hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSavingGleap ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </button>
          </div>

          <div className="p-4 rounded-xl bg-teal-500/10 border border-teal-500/20">
            <p className="text-sm text-teal-300">
              <strong>Available MCP Tools:</strong> Once connected, you can use tools like{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">list_gleap_tickets</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">sync_gleap_ai_knowledge</code>,
              and more through Claude Code. View the Support dashboard for a visual overview.
            </p>
          </div>
        </div>
        )}

        {/* Firebase Integration — mobile only */}
        {internalIntegrationsEnabled && settings.storeType !== 'web' && (
        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-orange-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3.89 15.672L6.255.461A.542.542 0 0 1 7.27.288l2.543 4.771zm16.794 3.692l-2.25-14a.54.54 0 0 0-.919-.295L3.316 19.365l7.856 4.427a1.621 1.621 0 0 0 1.588 0zM14.3 7.147l-1.82-3.482a.542.542 0 0 0-.96 0L3.53 17.984z"/>
              </svg>
              <h2 className="text-lg font-semibold text-white">Firebase</h2>
            </div>
            <div className="flex items-center gap-3">
              {firebaseSaEmail && (
                <div className="flex items-center gap-1 text-xs text-green-400">
                  <CheckCircle2 className="w-3 h-3" />
                  Connected
                </div>
              )}
              {internalIntegrationsEnabled && !firebaseSaEmail && firebaseStatus === 'valid' && (
                <div className="flex items-center gap-1 text-xs text-orange-400">
                  <CheckCircle2 className="w-3 h-3" />
                  Partial
                </div>
              )}
            </div>
          </div>

          <p className="text-sm text-neutral-400">
            Connect Firebase to access {internalIntegrationsEnabled ? 'Crashlytics, ' : ''}Analytics,
            Firestore, Auth, Remote Config, and Cloud Functions via MCP tools.
          </p>

          <div className="space-y-4">
            {/* Config File Upload — auto-fills App ID and Project ID (mobile only) */}
            {(settings.storeType as string) !== 'web' && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-300">Config File</label>
              <div className="block">
                {/* GoogleService-Info.plist — iOS only */}
                {settings.storeType === 'ios' && (
                  <label className="flex flex-col items-center justify-center px-3 py-4 rounded-xl
                                 border-2 border-dashed border-white/[0.10] cursor-pointer
                                 hover:border-orange-500/40 hover:bg-orange-500/5 transition-all group">
                    <input
                      type="file"
                      accept=".plist"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        const reader = new FileReader()
                        reader.onload = async (ev) => {
                          try {
                            const text = ev.target?.result as string
                            const parser = new DOMParser()
                            const xmlDoc = parser.parseFromString(text, 'application/xml')
                            const keys = Array.from(xmlDoc.querySelectorAll('dict > key'))
                            const map: Record<string, string> = {}
                            keys.forEach(k => {
                              const val = k.nextElementSibling
                              if (val?.tagName === 'string') map[k.textContent || ''] = val.textContent || ''
                            })
                            const appId = map['GOOGLE_APP_ID'] || ''
                            const pid = map['PROJECT_ID'] || ''
                            if (!appId && !pid) { setError('Could not find Firebase fields in plist'); return }
                            if (internalIntegrationsEnabled) setFirebaseAppId(appId)
                            setFirebaseProjectId(pid)
                            setFirebaseStatus('idle')
                            // Auto-save immediately
                            await fetch(`/api/projects/${projectId}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                ...(internalIntegrationsEnabled ? { firebaseAppId: appId || null } : {}),
                                firebaseProjectId: pid || null,
                              }),
                            })
                            setSuccess('Firebase config imported from plist')
                            setTimeout(() => setSuccess(null), 3000)
                          } catch { setError('Failed to parse GoogleService-Info.plist') }
                        }
                        reader.readAsText(file)
                        e.target.value = ''
                      }}
                    />
                    <span className="text-2xl mb-1">🍎</span>
                    <span className="text-xs text-neutral-400 group-hover:text-neutral-300 transition-colors text-center font-medium">
                      GoogleService-Info.plist
                    </span>
                    <span className="text-xs text-neutral-600 text-center mt-0.5">iOS</span>
                  </label>
                )}

                {/* google-services.json — Android only */}
                {settings.storeType === 'android' && (
                  <label className="flex flex-col items-center justify-center px-3 py-4 rounded-xl
                                 border-2 border-dashed border-white/[0.10] cursor-pointer
                                 hover:border-orange-500/40 hover:bg-orange-500/5 transition-all group">
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        const reader = new FileReader()
                        reader.onload = async (ev) => {
                          try {
                            const parsed = JSON.parse(ev.target?.result as string)
                            const appId = parsed.client?.[0]?.client_info?.mobilesdk_app_id || ''
                            const pid = parsed.project_info?.project_id || ''
                            if (!appId && !pid) { setError('Could not find Firebase fields in google-services.json'); return }
                            if (internalIntegrationsEnabled) setFirebaseAppId(appId)
                            setFirebaseProjectId(pid)
                            setFirebaseStatus('idle')
                            // Auto-save immediately
                            await fetch(`/api/projects/${projectId}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                ...(internalIntegrationsEnabled ? { firebaseAppId: appId || null } : {}),
                                firebaseProjectId: pid || null,
                              }),
                            })
                            setSuccess('Firebase config imported from google-services.json')
                            setTimeout(() => setSuccess(null), 3000)
                          } catch { setError('Failed to parse google-services.json') }
                        }
                        reader.readAsText(file)
                        e.target.value = ''
                      }}
                    />
                    <span className="text-2xl mb-1">🤖</span>
                    <span className="text-xs text-neutral-400 group-hover:text-neutral-300 transition-colors text-center font-medium">
                      google-services.json
                    </span>
                    <span className="text-xs text-neutral-600 text-center mt-0.5">Android</span>
                  </label>
                )}
              </div>
              <p className="text-xs text-neutral-500">
                Download from Firebase Console &rarr; Project Settings &rarr; Your Apps. Instantly populates {internalIntegrationsEnabled ? 'App ID and Project ID' : 'Project ID'}.
              </p>
            </div>
            )}

            {/* Firebase App ID */}
            {internalIntegrationsEnabled && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-300">
                Firebase App ID
              </label>
              <input
                type="text"
                value={firebaseAppId}
                onChange={(e) => {
                  setFirebaseAppId(e.target.value)
                  setFirebaseStatus('idle')
                }}
                placeholder={settings.storeType === 'ios' ? '1:1234567890:ios:abc123def456' : '1:1234567890:android:abc123def456'}
                className="w-full px-4 py-3 rounded-xl text-sm text-white
                         bg-black/40 border border-white/[0.08]
                         placeholder:text-neutral-600
                         focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20
                         focus:outline-none transition-all font-mono"
              />
              <p className="text-xs text-neutral-500">
                For Crashlytics. Auto-filled when you upload a config file above, or find manually in Firebase Console &rarr; Project Settings &rarr; Your Apps.
              </p>
            </div>
            )}

            {/* Firebase Service Account */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-neutral-300">Firebase Service Account</label>
                {firebaseSaEmail && (
                  <button
                    onClick={handleRemoveFirebaseSa}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>

              {firebaseSaEmail ? (
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/20">
                  <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <span className="text-sm text-green-300 font-mono truncate">{firebaseSaEmail}</span>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full px-4 py-6 rounded-xl
                               border-2 border-dashed border-white/[0.10] cursor-pointer
                               hover:border-orange-500/40 hover:bg-orange-500/5 transition-all group">
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const reader = new FileReader()
                      reader.onload = (ev) => {
                        const text = ev.target?.result as string
                        setFirebaseSaJson(text || '')
                      }
                      reader.readAsText(file)
                      e.target.value = ''
                    }}
                  />
                  {firebaseSaJson ? (
                    <div className="flex flex-col items-center gap-2 text-center">
                      <CheckCircle2 className="w-5 h-5 text-orange-400" />
                      <span className="text-sm text-orange-300">Key file loaded — click Save below</span>
                      <button
                        onClick={(e) => { e.preventDefault(); setFirebaseSaJson('') }}
                        className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-center">
                      <svg className="w-8 h-8 text-neutral-600 group-hover:text-orange-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-sm text-neutral-400 group-hover:text-neutral-300 transition-colors">
                        Click to upload service account key
                      </span>
                      <span className="text-xs text-neutral-600">.json file from Firebase Console</span>
                    </div>
                  )}
                </label>
              )}

              {firebaseSaJson && !firebaseSaEmail && (
                <button
                  onClick={handleSaveFirebaseSa}
                  disabled={isSavingFirebaseSa}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                           bg-orange-500/20 text-orange-300 border border-orange-500/30
                           hover:bg-orange-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isSavingFirebaseSa ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving...</> : 'Save Service Account'}
                </button>
              )}

              <p className="text-xs text-neutral-500">
                In Firebase Console &rarr; Project Settings &rarr; Service Accounts &rarr; Generate new private key.
                Works for iOS, Android, and web projects.
              </p>
            </div>
          </div>

          {/* GA4 Analytics Property ID */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-neutral-300">GA4 Analytics Property ID</label>
              {analyticsStatus === 'valid' && (
                <div className="flex items-center gap-1 text-xs text-blue-400">
                  <CheckCircle2 className="w-3 h-3" />
                  Connected
                </div>
              )}
              {analyticsStatus === 'invalid' && (
                <div className="flex items-center gap-1 text-xs text-red-400">
                  <XCircle className="w-3 h-3" />
                  Invalid
                </div>
              )}
            </div>
            <input
              type="text"
              value={firebaseAnalyticsPropertyId}
              onChange={(e) => { setFirebaseAnalyticsPropertyId(e.target.value); setAnalyticsStatus('idle') }}
              placeholder="123456789"
              className="w-full px-4 py-3 rounded-xl text-sm text-white
                       bg-black/40 border border-white/[0.08]
                       placeholder:text-neutral-600
                       focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20
                       focus:outline-none transition-all font-mono"
            />
            <p className="text-xs text-neutral-500">
              Numeric only (e.g. "123456789"), not the "G-XXXXXXXX" measurement ID. Find in Google Analytics &rarr; Admin &rarr; Property Settings.
              <strong className="text-neutral-400"> The service account email must be added as a Viewer</strong> in Google Analytics &rarr; Admin &rarr; Property Access Management — otherwise the test will fail with a permission error.
            </p>
          </div>

          {/* Firebase Project ID */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-neutral-300">Firebase Project ID</label>
            <input
              type="text"
              value={firebaseProjectId}
              onChange={(e) => setFirebaseProjectId(e.target.value)}
              placeholder="my-app-12345"
              className="w-full px-4 py-3 rounded-xl text-sm text-white
                       bg-black/40 border border-white/[0.08]
                       placeholder:text-neutral-600
                       focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20
                       focus:outline-none transition-all font-mono"
            />
            <p className="text-xs text-neutral-500">
              Required for Firestore, Auth, Cloud Functions, and Remote Config. Auto-filled when you upload a config file above.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            {internalIntegrationsEnabled && (
            <button
              onClick={handleTestFirebase}
              disabled={!firebaseAppId || firebaseStatus === 'testing'}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                       bg-white/[0.05] text-white border border-white/[0.08]
                       hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {firebaseStatus === 'testing' ? <><Loader2 className="w-4 h-4 animate-spin" />Testing...</> : 'Test Crashlytics'}
            </button>
            )}
            <button
              onClick={handleTestAnalytics}
              disabled={!firebaseAnalyticsPropertyId || analyticsStatus === 'testing'}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                       bg-white/[0.05] text-white border border-white/[0.08]
                       hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {analyticsStatus === 'testing' ? <><Loader2 className="w-4 h-4 animate-spin" />Testing...</> : 'Test Analytics'}
            </button>
            <button
              onClick={handleSaveFirebase}
              disabled={isSavingFirebase}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium
                       bg-gradient-to-r from-orange-500 to-amber-500 text-white
                       hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isSavingFirebase ? <><Loader2 className="w-4 h-4 animate-spin" />Saving...</> : 'Save'}
            </button>
          </div>

          <div className="p-4 rounded-xl bg-orange-500/10 border border-orange-500/20">
            <p className="text-sm text-orange-300">
              {internalIntegrationsEnabled && (
                <>
              <strong>Crashlytics:</strong>{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">list_crash_issues</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">list_crash_events</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">update_crash_issue_state</code>
              <br className="my-1" />
                </>
              )}
              <strong>Analytics:</strong>{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_get_user_metrics</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_get_top_events</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_run_report</code>
              <br className="my-1" />
              <strong>Firestore:</strong>{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_list_collections</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_list_documents</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_get_document</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_query_collection</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_set_document</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_delete_document</code>
              <br className="my-1" />
              <strong>Auth:</strong>{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_list_users</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_get_user</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_update_user</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_delete_user</code>
              <br className="my-1" />
              <strong>Remote Config:</strong>{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_get_remote_config</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_update_remote_config</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_publish_remote_config</code>
              <br className="my-1" />
              <strong>Cloud Functions:</strong>{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_list_functions</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_get_function</code>,{' '}
              <code className="px-1 py-0.5 rounded bg-white/[0.05]">firebase_get_function_logs</code>
            </p>
          </div>
        </div>
        )}

        {/* Linked Project Section — mobile only */}
        {settings.storeType !== 'web' && (
        <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/[0.08] space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link2 className="w-5 h-5 text-purple-400" />
              <h2 className="text-lg font-semibold text-white">Linked Project</h2>
            </div>
            {isLoadingLink && <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />}
          </div>

          {linkStatus?.linked && linkStatus.linkedProject ? (
            <div className="space-y-4">
              {/* Linked Project Info */}
              <div className="flex items-center gap-4 p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  linkStatus.linkedProject.storeType === 'ios'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-green-500/20 text-green-400'
                }`}>
                  {linkStatus.linkedProject.storeType === 'ios' ? (
                    <Apple className="w-6 h-6" />
                  ) : (
                    <Play className="w-6 h-6" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-white">{linkStatus.linkedProject.name}</p>
                  <p className="text-xs text-neutral-400">
                    {linkStatus.linkedProject.storeType === 'ios' ? 'iOS / App Store' : 'Android / Play Store'}
                  </p>
                </div>
                <button
                  onClick={handleUnlink}
                  disabled={isLinking}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
                           text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  {isLinking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Unlink className="w-3 h-3" />}
                  Unlink
                </button>
              </div>

              {/* Sync Mode */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-300">Sync Mode</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleUpdateLinkConfig({ syncMode: 'manual' })}
                    className={`flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                      linkStatus.linkConfiguration?.syncMode === 'manual'
                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                        : 'bg-white/[0.03] text-neutral-400 border border-white/[0.08] hover:border-white/[0.15]'
                    }`}
                  >
                    Manual
                  </button>
                  <button
                    onClick={() => handleUpdateLinkConfig({ syncMode: 'auto' })}
                    className={`flex-1 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                      linkStatus.linkConfiguration?.syncMode === 'auto'
                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                        : 'bg-white/[0.03] text-neutral-400 border border-white/[0.08] hover:border-white/[0.15]'
                    }`}
                  >
                    Auto-sync
                  </button>
                </div>
                <p className="text-xs text-neutral-500">
                  {linkStatus.linkConfiguration?.syncMode === 'auto'
                    ? 'Changes to shared fields are automatically synced'
                    : 'Use the sync buttons to manually sync data'}
                </p>
              </div>

              {/* What to Share */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-neutral-300">Shared Data</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] cursor-pointer hover:border-white/[0.15] transition-colors">
                    <input
                      type="checkbox"
                      checked={linkStatus.linkConfiguration?.shareMetadata}
                      onChange={(e) => handleUpdateLinkConfig({ shareMetadata: e.target.checked })}
                      className="w-4 h-4 rounded border-white/20 bg-white/10 text-purple-500 focus:ring-purple-500/50"
                    />
                    <FileText className="w-4 h-4 text-neutral-400" />
                    <span className="text-sm text-white">Metadata</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] cursor-pointer hover:border-white/[0.15] transition-colors">
                    <input
                      type="checkbox"
                      checked={linkStatus.linkConfiguration?.shareScreenshots}
                      onChange={(e) => handleUpdateLinkConfig({ shareScreenshots: e.target.checked })}
                      className="w-4 h-4 rounded border-white/20 bg-white/10 text-purple-500 focus:ring-purple-500/50"
                    />
                    <Image className="w-4 h-4 text-neutral-400" />
                    <span className="text-sm text-white">Screenshots</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.08] cursor-pointer hover:border-white/[0.15] transition-colors">
                    <input
                      type="checkbox"
                      checked={linkStatus.linkConfiguration?.shareIcons}
                      onChange={(e) => handleUpdateLinkConfig({ shareIcons: e.target.checked })}
                      className="w-4 h-4 rounded border-white/20 bg-white/10 text-purple-500 focus:ring-purple-500/50"
                    />
                    <Palette className="w-4 h-4 text-neutral-400" />
                    <span className="text-sm text-white">Icons</span>
                  </label>
                </div>
              </div>

              {/* Manual Sync Controls */}
              {linkStatus.linkConfiguration?.syncMode === 'manual' && (
                <div className="space-y-3">
                  <label className="text-sm font-medium text-neutral-300">Manual Sync</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSync('push')}
                      disabled={isSyncing}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                               bg-white/[0.05] text-white border border-white/[0.08]
                               hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                      Push to linked
                    </button>
                    <button
                      onClick={() => handleSync('pull')}
                      disabled={isSyncing}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                               bg-white/[0.05] text-white border border-white/[0.08]
                               hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {isSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Pull from linked
                    </button>
                  </div>
                  {linkStatus.linkConfiguration?.lastSyncedAt && (
                    <p className="text-xs text-neutral-500">
                      Last synced: {new Date(linkStatus.linkConfiguration.lastSyncedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center">
                <Link2 className="w-8 h-8 text-neutral-600" />
              </div>
              <p className="text-neutral-400 mb-4">
                Link this {settings.storeType === 'ios' ? 'iOS' : 'Android'} project with an {settings.storeType === 'ios' ? 'Android' : 'iOS'} project to share metadata, screenshots, and icons.
              </p>
              <button
                onClick={() => {
                  fetchAvailableProjects()
                  setShowLinkModal(true)
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium
                         bg-gradient-to-r from-purple-500 to-blue-500 text-white
                         hover:opacity-90 transition-all"
              >
                <Link2 className="w-4 h-4" />
                Link a Project
              </button>
            </div>
          )}
        </div>
        )}

        {/* Danger Zone */}
        <div className="p-6 rounded-2xl bg-red-500/5 border border-red-500/20 space-y-4">
          <h2 className="text-lg font-semibold text-red-400">Danger Zone</h2>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-white">Delete Project</p>
              <p className="text-sm text-neutral-400">
                Permanently delete this project and all its data.
              </p>
            </div>

            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                         border border-red-500/30 text-red-400
                         hover:bg-red-500/10 transition-all"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                           bg-red-500 text-white
                           hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    'Confirm Delete'
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Link Project Modal */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setShowLinkModal(false)}
          />
          <div className="relative w-full max-w-md mx-4 rounded-2xl bg-neutral-900 border border-white/[0.1] shadow-2xl">
            <div className="p-6 border-b border-white/[0.08]">
              <h3 className="text-lg font-semibold text-white">Link a Project</h3>
              <p className="text-sm text-neutral-400 mt-1">
                Select an {settings.storeType === 'ios' ? 'Android' : 'iOS'} project to link with
              </p>
            </div>
            <div className="p-6 space-y-4">
              {availableProjects.length === 0 ? (
                <p className="text-center text-neutral-400 py-4">
                  No available {settings.storeType === 'ios' ? 'Android' : 'iOS'} projects to link.
                  Create one first!
                </p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {availableProjects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => setSelectedProjectToLink(project.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                        selectedProjectToLink === project.id
                          ? 'bg-purple-500/20 border border-purple-500/30'
                          : 'bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.15]'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        project.storeType === 'ios'
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-green-500/20 text-green-400'
                      }`}>
                        {project.storeType === 'ios' ? <Apple className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-white">{project.name}</p>
                        <p className="text-xs text-neutral-500">
                          {project.storeType === 'ios' ? 'iOS' : 'Android'}
                        </p>
                      </div>
                      {selectedProjectToLink === project.id && (
                        <CheckCircle2 className="w-5 h-5 text-purple-400" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="p-6 border-t border-white/[0.08] flex justify-end gap-3">
              <button
                onClick={() => setShowLinkModal(false)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-neutral-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLink}
                disabled={!selectedProjectToLink || isLinking}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium
                         bg-gradient-to-r from-purple-500 to-blue-500 text-white
                         hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isLinking ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Linking...
                  </>
                ) : (
                  <>
                    <Link2 className="w-4 h-4" />
                    Link Projects
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
