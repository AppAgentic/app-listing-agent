import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { AutoSelectProject } from '@/components/dashboard/auto-select-project'
import { AppIcon } from '@/components/dashboard/app-icon'
import {
  Apple,
  Play,
  FileText,
  Image,
  Settings,
  Clock,
  Globe,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ShoppingBag,
  Headset,
  ScrollText,
} from 'lucide-react'
import type { Project, MetadataSyncStatus } from '@/lib/firebase/firestore'
import { isInternalIntegrationIdentity } from '@/lib/features/internal-integrations'

interface PageProps {
  params: Promise<{ projectId: string }>
}

async function getProject(userId: string, projectId: string, organizationId?: string): Promise<Project | null> {
  const basePath = organizationId
    ? adminDb.collection('organizations').doc(organizationId).collection('projects')
    : adminDb.collection('users').doc(userId).collection('projects')

  const doc = await basePath.doc(projectId).get()
  if (!doc.exists) return null
  return doc.data() as Project
}

function getSyncStatusBadge(status: MetadataSyncStatus) {
  switch (status) {
    case 'synced':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
          <CheckCircle2 className="w-3 h-3" />
          Synced
        </span>
      )
    case 'local_changes':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
          <Clock className="w-3 h-3" />
          Unpublished Changes
        </span>
      )
    case 'conflict':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
          <AlertCircle className="w-3 h-3" />
          Conflict
        </span>
      )
    case 'never_synced':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-neutral-500/10 text-neutral-400 border border-neutral-500/20">
          <RefreshCw className="w-3 h-3" />
          Never Synced
        </span>
      )
  }
}

export default async function ProjectDetailPage({ params }: PageProps) {
  const { projectId } = await params
  const session = await getSession()
  if (!session) return null

  const project = await getProject(session.userId, projectId, session.organizationId)
  if (!project) notFound()

  const isWeb = project.storeType === 'web'
  const internalIntegrationsEnabled = isInternalIntegrationIdentity({
    email: session.email,
    userId: session.userId,
    orgId: session.organizationId,
  })
  if (isWeb && !internalIntegrationsEnabled) notFound()

  // Different actions for web vs mobile projects
  const actions = isWeb
    ? [
        {
          title: 'Purchases',
          description: 'Manage Whop products, checkouts, and customers',
          icon: ShoppingBag,
          href: `/projects/${projectId}/purchases`,
          color: 'from-violet-500 to-purple-500',
        },
        ...(internalIntegrationsEnabled
          ? [{
              title: 'Support',
              description: 'View and manage customer support tickets',
              icon: Headset,
              href: `/projects/${projectId}/support`,
              color: 'from-blue-500 to-cyan-500',
            }]
          : []),
        {
          title: 'Legal',
          description: 'Manage privacy policy, terms of service, and more',
          icon: ScrollText,
          href: `/projects/${projectId}/legal`,
          color: 'from-amber-500 to-orange-500',
        },
        {
          title: 'Settings',
          description: 'Configure Whop credentials and project settings',
          icon: Settings,
          href: `/projects/${projectId}/settings`,
          color: 'from-orange-500 to-red-500',
        },
      ]
    : [
        {
          title: 'Metadata',
          description: 'Edit app title, description, keywords and more',
          icon: FileText,
          href: `/projects/${projectId}/metadata`,
          color: 'from-purple-500 to-blue-500',
        },
        {
          title: 'Screenshots',
          description: 'Generate and manage App Store screenshots',
          icon: Image,
          href: `/projects/${projectId}/screenshots`,
          color: 'from-pink-500 to-purple-500',
        },
        {
          title: 'Settings',
          description: 'Configure store credentials and project settings',
          icon: Settings,
          href: `/projects/${projectId}/settings`,
          color: 'from-orange-500 to-red-500',
        },
      ]

  return (
    <div>
      {/* Auto-select this project in the sidebar */}
      <AutoSelectProject
        project={{
          id: projectId,
          name: project.name,
          storeType: project.storeType || 'ios',
          appStoreAppId: project.appStoreAppId || null,
          playStorePackage: project.playStorePackage || null,
          primaryLocale: project.primaryLocale || 'en-US',
        }}
      />

      {/* Project Header */}
      <div className="rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6 mb-8">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-4">
            <AppIcon
              appStoreAppId={project.appStoreAppId || null}
              name={project.name}
              size="md"
            />
            <div>
              <h1 className="text-2xl font-bold text-white mb-2">{project.name}</h1>
              <div className="flex flex-wrap gap-2">
                {isWeb ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-violet-500/10 text-violet-400 border border-violet-500/20">
                    <Globe className="w-3 h-3" />
                    Web
                  </span>
                ) : (
                  <>
                    {project.appStoreAppId && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        <Apple className="w-3 h-3" />
                        App Store
                      </span>
                    )}
                    {project.playStorePackage && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                        <Play className="w-3 h-3" />
                        Play Store
                      </span>
                    )}
                    {getSyncStatusBadge(project.syncStatus)}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Project Info Grid - different for web vs mobile */}
        {isWeb ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/[0.08]">
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Type</p>
              <p className="text-sm text-white flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-violet-400" />
                Web Application
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Whop</p>
              <p className="text-sm text-white">
                {project.whopApiKey ? 'Connected' : 'Not configured'}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Created</p>
              <p className="text-sm text-white">
                {project.createdAt
                  ? new Date((project.createdAt as any).toDate?.() || project.createdAt).toLocaleDateString()
                  : 'Unknown'}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-white/[0.08]">
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Primary Locale</p>
              <p className="text-sm text-white flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-neutral-400" />
                {project.primaryLocale || 'en-US'}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Locales</p>
              <p className="text-sm text-white">
                {project.enabledLocales?.length || 1} enabled
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Last Pulled</p>
              <p className="text-sm text-white">
                {project.lastPulledAt
                  ? new Date(project.lastPulledAt.toDate?.() || project.lastPulledAt).toLocaleDateString()
                  : 'Never'}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Last Pushed</p>
              <p className="text-sm text-white">
                {project.lastPushedAt
                  ? new Date(project.lastPushedAt.toDate?.() || project.lastPushedAt).toLocaleDateString()
                  : 'Never'}
              </p>
            </div>
          </div>
        )}

        {/* App Store Version State - mobile only */}
        {!isWeb && project.appStoreVersionNumber && (
          <div className="mt-4 pt-4 border-t border-white/[0.08]">
            <p className="text-xs text-neutral-500 uppercase tracking-wider mb-2">App Store Version</p>
            <div className="flex items-center gap-3">
              <span className="text-sm text-white font-medium">{project.appStoreVersionNumber}</span>
              {project.appStoreVersionState && (
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  ['PREPARE_FOR_SUBMISSION', 'METADATA_REJECTED', 'DEVELOPER_REJECTED'].includes(project.appStoreVersionState)
                    ? 'bg-green-500/10 text-green-400'
                    : 'bg-yellow-500/10 text-yellow-400'
                }`}>
                  {project.appStoreVersionState.replace(/_/g, ' ')}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Actions Grid */}
      <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {actions.map((action) => (
          <Link
            key={action.title}
            href={action.href}
            className="group block rounded-2xl bg-white/[0.02] border border-white/[0.08] p-6 hover:bg-white/[0.04] hover:border-white/[0.15] transition-all"
          >
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${action.color} bg-opacity-20 border border-white/[0.08] flex items-center justify-center flex-shrink-0`}>
                <action.icon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-white mb-1 group-hover:text-purple-400 transition-colors">
                  {action.title}
                </h3>
                <p className="text-sm text-neutral-400">
                  {action.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
