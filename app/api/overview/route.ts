import { NextRequest } from 'next/server'
import { authenticateRequest, errorResponse, unauthorizedResponse } from '@/lib/api/auth'
import { adminDb } from '@/lib/firebase/admin'
import type { Project, MetadataHistoryEntry } from '@/lib/firebase/firestore'
import {
  hasInternalIntegrationAccess,
  stripInternalProjectFields,
} from '@/lib/features/internal-integrations'

interface ProjectWithStats extends Project {
  id: string
  recentActivity: {
    source: string
    description: string
    localesCount: number
    createdAt: FirebaseFirestore.Timestamp
  } | null
}

interface ActivityEntry {
  projectId: string
  projectName: string
  source: string
  description: string
  localesCount: number
  createdAt: FirebaseFirestore.Timestamp
}

export async function GET(request: NextRequest) {
  // Authenticate
  const auth = await authenticateRequest(request)
  if (!auth.authenticated || !auth.context) {
    return unauthorizedResponse(auth.error)
  }

  const { userId, orgId } = auth.context
  const internalAccess = hasInternalIntegrationAccess(auth.context)

  // Get base path for projects
  const projectsRef = orgId
    ? adminDb.collection('organizations').doc(orgId).collection('projects')
    : adminDb.collection('users').doc(userId).collection('projects')

  // Get all projects (limit to 20 for overview page)
  const projectsSnapshot = await projectsRef.orderBy('updatedAt', 'desc').limit(20).get()

  const projects: ProjectWithStats[] = []
  const allActivity: ActivityEntry[] = []

  // Process each project in parallel - single query per project (not duplicate loops)
  const projectPromises = projectsSnapshot.docs.map(async (doc) => {
    const rawProject = { id: doc.id, ...doc.data() } as ProjectWithStats
    if (!internalAccess && rawProject.storeType === 'web') return null
    const project = (internalAccess
      ? rawProject
      : stripInternalProjectFields(rawProject as unknown as Record<string, unknown>)) as unknown as ProjectWithStats

    // Get up to 3 history entries (we'll use first for recentActivity, all for feed)
    const historySnapshot = await doc.ref
      .collection('metadataHistory')
      .orderBy('createdAt', 'desc')
      .limit(3)
      .get()

    const activities: ActivityEntry[] = []

    if (!historySnapshot.empty) {
      // Process all history entries
      historySnapshot.docs.forEach((histDoc, index) => {
        const entry = histDoc.data() as MetadataHistoryEntry
        const activityEntry = {
          projectId: doc.id,
          projectName: project.name,
          source: entry.source,
          description: entry.changesSummary?.description || getSourceDescription(entry.source, project.storeType),
          localesCount: entry.changesSummary?.localesModified?.length || Object.keys(entry.locales || {}).length,
          createdAt: entry.createdAt,
        }

        // First entry is the most recent activity for this project
        if (index === 0) {
          project.recentActivity = {
            source: entry.source,
            description: activityEntry.description,
            localesCount: activityEntry.localesCount,
            createdAt: entry.createdAt,
          }
        }

        activities.push(activityEntry)
      })
    } else {
      project.recentActivity = null
    }

    return { project, activities }
  })

  const results = (await Promise.all(projectPromises)).filter(result => result !== null)

  // Collect projects and activities from results
  for (const { project, activities } of results) {
    projects.push(project)
    allActivity.push(...activities)
  }

  // Sort and limit combined activity
  const combinedActivity = allActivity
    .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
    .slice(0, 10)

  return Response.json({
    success: true,
    projects,
    recentActivity: combinedActivity,
    stats: {
      totalProjects: projects.length,
      projectsWithChanges: projects.filter(p => p.syncStatus === 'local_changes').length,
      activityThisWeek: combinedActivity.filter(a => {
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
        return a.createdAt.toMillis() > weekAgo
      }).length,
    },
  })
}

function getSourceDescription(source: string, storeType?: string): string {
  const storeName = storeType === 'android' ? 'Play Store' : 'App Store'
  switch (source) {
    case 'pull':
      return `Pulled from ${storeName}`
    case 'publish':
      return `Published to ${storeName}`
    case 'ai_translation':
      return 'AI translated'
    case 'manual_edit':
      return 'Manually edited'
    case 'rollback':
      return 'Rolled back'
    default:
      return 'Updated'
  }
}
