'use client'

import { useEffect } from 'react'
import { useSelectedProject } from '@/hooks/useSelectedProject'

interface AutoSelectProjectProps {
  project: {
    id: string
    name: string
    storeType?: 'ios' | 'android' | 'web'
    appStoreAppId: string | null
    playStorePackage: string | null
    linkedProjectId?: string | null
    primaryLocale: string
  }
}

/**
 * Client component that auto-selects a project when mounted.
 * Used on project detail pages to keep the sidebar in sync.
 */
export function AutoSelectProject({ project }: AutoSelectProjectProps) {
  const { selectedProject, setSelectedProject } = useSelectedProject()

  useEffect(() => {
    // Only update if different project is selected
    if (selectedProject?.id !== project.id) {
      setSelectedProject({
        id: project.id,
        name: project.name,
        storeType: project.storeType || 'ios',
        appStoreAppId: project.appStoreAppId,
        playStorePackage: project.playStorePackage,
        linkedProjectId: project.linkedProjectId || null,
        primaryLocale: project.primaryLocale,
      })
    }
  }, [project, selectedProject?.id, setSelectedProject])

  return null
}
