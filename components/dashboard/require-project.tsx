'use client'

import { ReactNode } from 'react'
import Link from 'next/link'
import { useSelectedProject, SelectedProject } from '@/hooks/useSelectedProject'
import { FolderKanban, ArrowRight } from 'lucide-react'

interface RequireProjectProps {
  children: (project: SelectedProject) => ReactNode
  loadingComponent?: ReactNode
}

export function RequireProject({ children, loadingComponent }: RequireProjectProps) {
  const { selectedProject, isLoading } = useSelectedProject()

  // Loading state
  if (isLoading) {
    return loadingComponent || (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // No project selected
  if (!selectedProject) {
    return (
      <div className="text-center py-16 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08]">
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
          <FolderKanban className="w-8 h-8 text-neutral-400" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">Select a project</h3>
        <p className="text-neutral-400 mb-6 max-w-sm mx-auto">
          Choose a project from the dropdown above or browse all your projects to get started.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-xl font-medium hover:bg-neutral-200 transition-colors"
        >
          View Projects
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    )
  }

  // Project selected - render children
  return <>{children(selectedProject)}</>
}
