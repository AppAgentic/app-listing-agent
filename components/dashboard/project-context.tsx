'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

const STORAGE_KEY = 'appstorecopilot_selected_project'

export interface SelectedProject {
  id: string
  name: string
  storeType: 'ios' | 'android' | 'web'
  appStoreAppId: string | null
  playStorePackage: string | null
  linkedProjectId: string | null
  primaryLocale: string
}

interface StoredSelection {
  projectId: string
  selectedAt: number
  // Store full project data for demo/offline support
  projectData?: SelectedProject
}

export interface ProjectContextType {
  selectedProject: SelectedProject | null
  setSelectedProject: (project: SelectedProject | null) => void
  isLoading: boolean
  clearSelection: () => void
  projects: SelectedProject[]
  projectsLoading: boolean
  refetchProjects: () => Promise<void>
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined)

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [selectedProject, setSelectedProjectState] = useState<SelectedProject | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [projects, setProjects] = useState<SelectedProject[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)

  // Fetch all projects
  const fetchProjects = useCallback(async () => {
    try {
      setProjectsLoading(true)
      const response = await fetch('/api/projects', {
        credentials: 'include'
      })

      if (!response.ok) {
        if (response.status === 401) {
          setProjects([])
          return
        }
        throw new Error('Failed to fetch projects')
      }

      const data = await response.json()
      // API uses successResponse which wraps data in { success, data: {...} }
      const projectList = (data.data?.projects || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        storeType: p.storeType || 'ios',
        appStoreAppId: p.appStoreAppId || null,
        playStorePackage: p.playStorePackage || null,
        linkedProjectId: p.linkedProjectId || null,
        primaryLocale: p.primaryLocale || 'en-US'
      }))
      setProjects(projectList)
      return projectList
    } catch (err) {
      console.error('Failed to fetch projects:', err)
      setProjects([])
      return []
    } finally {
      setProjectsLoading(false)
    }
  }, [])

  // Load from localStorage and validate
  useEffect(() => {
    const loadSavedProject = async () => {
      setIsLoading(true)

      try {
        // Always fetch projects first
        const projectList = await fetchProjects()

        // Then check if we have a stored selection to restore
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) {
          const { projectId, projectData } = JSON.parse(stored) as StoredSelection

          // Skip demo projects - clear them from storage
          if (projectId === 'demo-project') {
            localStorage.removeItem(STORAGE_KEY)
            return
          }

          // First try to find in API results
          if (projectList && projectList.length > 0) {
            const foundProject = projectList.find((p: SelectedProject) => p.id === projectId)
            if (foundProject) {
              setSelectedProjectState(foundProject)
              return
            }
          }

          // If not found in API but we have stored project data, use that
          // Skip demo projects - they should not be restored
          if (projectData && projectId !== 'demo-project') {
            setSelectedProjectState(projectData)
            return
          }

          // Project no longer exists and no stored data, clear selection
          localStorage.removeItem(STORAGE_KEY)
        }
      } catch (err) {
        console.error('Failed to load saved project:', err)
        localStorage.removeItem(STORAGE_KEY)
      } finally {
        setIsLoading(false)
      }
    }

    loadSavedProject()
  }, [fetchProjects])

  const setSelectedProject = useCallback((project: SelectedProject | null) => {
    setSelectedProjectState(project)

    if (project) {
      const selection: StoredSelection = {
        projectId: project.id,
        selectedAt: Date.now(),
        // Store full project data for demo/offline support
        projectData: project
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedProjectState(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return (
    <ProjectContext.Provider
      value={{
        selectedProject,
        setSelectedProject,
        isLoading,
        clearSelection,
        projects,
        projectsLoading,
        refetchProjects: fetchProjects
      }}
    >
      {children}
    </ProjectContext.Provider>
  )
}

export function useProjectContext() {
  const context = useContext(ProjectContext)
  if (!context) {
    throw new Error('useProjectContext must be used within a ProjectProvider')
  }
  return context
}
