import { AccountContext } from '@/lib/org/context'
import { getProjectContext } from '@/lib/org/context'
import { adminDb } from '@/lib/firebase/admin'
import { Timestamp } from 'firebase-admin/firestore'

function getBasePath(projectContext: any, userId: string, projectId: string) {
  return projectContext.type === 'organization' && projectContext.orgId
    ? adminDb.collection('organizations').doc(projectContext.orgId).collection('projects').doc(projectId)
    : adminDb.collection('users').doc(userId).collection('projects').doc(projectId)
}

// ---------------------------------------------------------------------------
// list_store_experiments
// ---------------------------------------------------------------------------

export interface ListStoreExperimentsParams {
  projectId: string
}

export interface ListStoreExperimentsResult {
  success: boolean
  experiments?: any[]
  error?: string
}

export async function listStoreExperiments(
  params: ListStoreExperimentsParams,
  context: AccountContext
): Promise<ListStoreExperimentsResult> {
  const { projectId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return { success: false, error: 'Project not found' }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const snapshot = await basePath.collection('customPageExperiments')
      .orderBy('createdAt', 'desc')
      .get()

    const experiments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
    return { success: true, experiments }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to list experiments' }
  }
}

// ---------------------------------------------------------------------------
// create_store_experiment
// ---------------------------------------------------------------------------

export interface CreateStoreExperimentParams {
  projectId: string
  pageId: string
  name: string
  storeType: 'ios' | 'android'
  variants?: Array<{ name: string; trafficPercentage: number }>
}

export interface CreateStoreExperimentResult {
  success: boolean
  experiment?: any
  error?: string
}

export async function createStoreExperiment(
  params: CreateStoreExperimentParams,
  context: AccountContext
): Promise<CreateStoreExperimentResult> {
  const { projectId, pageId, name, storeType, variants } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return { success: false, error: 'Project not found' }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const now = Timestamp.now()

    const experimentData = {
      storeId: null,
      storeType,
      pageId,
      name,
      state: 'DRAFT' as const,
      variants: variants || [
        { name: 'Control', trafficPercentage: 50 },
        { name: 'Variant A', trafficPercentage: 50 },
      ],
      results: null,
      startedAt: null,
      stoppedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    const ref = basePath.collection('customPageExperiments').doc()
    await ref.set(experimentData)

    return { success: true, experiment: { id: ref.id, ...experimentData } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create experiment' }
  }
}

// ---------------------------------------------------------------------------
// get_experiment_results
// ---------------------------------------------------------------------------

export interface GetExperimentResultsParams {
  projectId: string
  experimentId: string
}

export interface GetExperimentResultsResult {
  success: boolean
  experiment?: any
  error?: string
}

export async function getExperimentResults(
  params: GetExperimentResultsParams,
  context: AccountContext
): Promise<GetExperimentResultsResult> {
  const { projectId, experimentId } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return { success: false, error: 'Project not found' }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const doc = await basePath.collection('customPageExperiments').doc(experimentId).get()

    if (!doc.exists) return { success: false, error: 'Experiment not found' }

    return { success: true, experiment: { id: doc.id, ...doc.data() } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to get experiment results' }
  }
}

// ---------------------------------------------------------------------------
// manage_store_experiment
// ---------------------------------------------------------------------------

export interface ManageStoreExperimentParams {
  projectId: string
  experimentId: string
  action: 'start' | 'stop' | 'apply_winner'
  winnerVariant?: string
}

export interface ManageStoreExperimentResult {
  success: boolean
  experiment?: any
  error?: string
}

export async function manageStoreExperiment(
  params: ManageStoreExperimentParams,
  context: AccountContext
): Promise<ManageStoreExperimentResult> {
  const { projectId, experimentId, action, winnerVariant } = params

  const projectContext = await getProjectContext(context.userId, projectId)
  if (!projectContext) return { success: false, error: 'Project not found' }

  try {
    const basePath = getBasePath(projectContext, context.userId, projectId)
    const ref = basePath.collection('customPageExperiments').doc(experimentId)
    const doc = await ref.get()

    if (!doc.exists) return { success: false, error: 'Experiment not found' }

    const now = Timestamp.now()
    const updateData: any = { updatedAt: now }

    switch (action) {
      case 'start':
        updateData.state = 'RUNNING'
        updateData.startedAt = now
        break
      case 'stop':
        updateData.state = 'STOPPED'
        updateData.stoppedAt = now
        break
      case 'apply_winner':
        if (!winnerVariant) return { success: false, error: 'winnerVariant is required for apply_winner action' }
        updateData.state = 'COMPLETED'
        updateData.stoppedAt = now
        break
      default:
        return { success: false, error: `Invalid action: ${action}` }
    }

    await ref.update(updateData)

    const updated = await ref.get()
    return { success: true, experiment: { id: updated.id, ...updated.data() } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to manage experiment' }
  }
}
