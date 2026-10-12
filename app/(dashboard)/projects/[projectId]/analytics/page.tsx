import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { adminDb } from '@/lib/firebase/admin'
import { AutoSelectProject } from '@/components/dashboard/auto-select-project'
import { AnalyticsContent } from './analytics-content'
import type { Project } from '@/lib/firebase/firestore'

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

export default async function AnalyticsPage({ params }: PageProps) {
  const { projectId } = await params
  const session = await getSession()
  if (!session) return null

  const project = await getProject(session.userId, projectId, session.organizationId)
  if (!project) notFound()

  return (
    <div>
      <AutoSelectProject
        project={{
          id: projectId,
          name: project.name,
          appStoreAppId: project.appStoreAppId || null,
          playStorePackage: project.playStorePackage || null,
          primaryLocale: project.primaryLocale || 'en-US',
        }}
      />

      <AnalyticsContent
        projectId={projectId}
        projectName={project.name}
        hasVendorNumber={!!project.vendorNumber}
      />
    </div>
  )
}
