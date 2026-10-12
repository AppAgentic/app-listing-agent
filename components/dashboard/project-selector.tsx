'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useProjectContext } from './project-context'
import { ChevronDown, Check, FolderKanban, LayoutGrid, Search, Apple, Play } from 'lucide-react'

export function ProjectSelector() {
  const router = useRouter()
  const { selectedProject, setSelectedProject, projects, projectsLoading, isLoading } = useProjectContext()
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setSearchQuery('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [isOpen])

  const filteredProjects = projects.filter(project =>
    project.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleSelectProject = (project: typeof selectedProject) => {
    setSelectedProject(project)
    setIsOpen(false)
    setSearchQuery('')
    // Navigate to the project's overview page (first item in sidebar)
    router.push(`/projects/${project?.id}`)
  }

  const loading = isLoading || projectsLoading

  return (
    <div className="relative px-3 py-3" ref={dropdownRef}>
      {/* Selector Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
          <FolderKanban className="w-4 h-4 text-neutral-400" />
        </div>
        <div className="flex-1 text-left min-w-0">
          {loading ? (
            <div className="h-4 w-24 bg-white/[0.1] rounded animate-pulse" />
          ) : selectedProject ? (
            <>
              <p className="text-[13px] font-medium text-white truncate">{selectedProject.name}</p>
              <p className="text-[10px] text-neutral-500 truncate">
                {selectedProject.appStoreAppId ? 'App Store' : ''}
                {selectedProject.appStoreAppId && selectedProject.playStorePackage ? ' • ' : ''}
                {selectedProject.playStorePackage ? 'Play Store' : ''}
                {!selectedProject.appStoreAppId && !selectedProject.playStorePackage ? 'No store connected' : ''}
              </p>
            </>
          ) : (
            <p className="text-[13px] text-neutral-400">Select a project</p>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-neutral-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-3 right-3 top-full mt-2 z-50 bg-[#141414] border border-white/[0.08] rounded-xl shadow-xl overflow-hidden">
          {/* Search Input */}
          {projects.length > 3 && (
            <div className="p-2 border-b border-white/[0.08]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search projects..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white/[0.03] border border-white/[0.08] rounded-lg text-[13px] text-white placeholder-neutral-500 focus:outline-none focus:border-white/[0.2]"
                />
              </div>
            </div>
          )}

          {/* Projects List */}
          <div className="max-h-[280px] overflow-y-auto">
            {filteredProjects.length === 0 ? (
              <div className="px-3 py-4 text-center">
                <p className="text-[13px] text-neutral-500">
                  {projects.length === 0 ? 'No projects yet' : 'No matching projects'}
                </p>
              </div>
            ) : (
              filteredProjects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleSelectProject(project)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.05] transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.06] flex items-center justify-center flex-shrink-0">
                    <FolderKanban className="w-4 h-4 text-neutral-500" />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-[13px] text-white truncate">{project.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {project.appStoreAppId && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-neutral-400">
                          <Apple className="w-3 h-3" />
                        </span>
                      )}
                      {project.playStorePackage && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-neutral-400">
                          <Play className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  </div>
                  {selectedProject?.id === project.id && (
                    <Check className="w-4 h-4 text-white flex-shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-white/[0.08] p-2">
            <Link
              href="/dashboard"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/[0.05] transition-colors text-[13px] text-neutral-400 hover:text-white"
            >
              <LayoutGrid className="w-4 h-4" />
              View all projects
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
