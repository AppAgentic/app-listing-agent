import type { AccountContext, ProjectContext } from './context'
import { getProjectContext, hasContextPermission } from './context'

export const PROJECT_MUTATION_FORBIDDEN = 'You do not have permission to modify this project.'

export function canMutateProject(context: AccountContext): boolean {
  return hasContextPermission(context, 'canCreateProjects')
}

export async function getMutableProjectContext(
  userId: string,
  projectId: string,
): Promise<ProjectContext | null> {
  const context = await getProjectContext(userId, projectId)
  return context && canMutateProject(context) ? context : null
}
