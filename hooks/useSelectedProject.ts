'use client'

import { useProjectContext, SelectedProject } from '@/components/dashboard/project-context'

export { type SelectedProject }

export function useSelectedProject() {
  const { selectedProject, setSelectedProject, isLoading, clearSelection } = useProjectContext()

  return {
    selectedProject,
    setSelectedProject,
    isLoading,
    clearSelection,
    hasProject: selectedProject !== null
  }
}

export function useProjects() {
  const { projects, projectsLoading, refetchProjects, setSelectedProject } = useProjectContext()

  return {
    projects,
    loading: projectsLoading,
    refetch: refetchProjects,
    selectProject: setSelectedProject
  }
}
