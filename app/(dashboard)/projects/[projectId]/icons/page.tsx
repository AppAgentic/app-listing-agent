'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { IconGenerator } from '@/components/dashboard/icon-generator'

interface ProjectMetadata {
  title: string
  subtitle: string
  description: string
  keywords: string
  category?: string
}

interface ProjectData {
  id: string
  name: string
  appStoreAppId: string | null
}

export default function IconsPage() {
  const params = useParams()
  const projectId = params.projectId as string

  const [project, setProject] = useState<ProjectData | null>(null)
  const [metadata, setMetadata] = useState<ProjectMetadata | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentIconUrl, setCurrentIconUrl] = useState<string | null>(null)
  const [currentIconSource, setCurrentIconSource] = useState<'store' | 'build' | null>(null)

  useEffect(() => {
    async function fetchProject() {
      try {
        const res = await fetch(`/api/projects/${projectId}`)
        if (res.ok) {
          const data = await res.json()
          const projectData = data.data?.project || data.project

          setProject({
            id: projectId,
            name: projectData?.name || '',
            appStoreAppId: projectData?.appStoreAppId || null,
          })

          if (projectData?.metadata) {
            setMetadata({
              title: projectData.metadata.title || projectData.name || '',
              subtitle: projectData.metadata.subtitle || '',
              description: projectData.metadata.description || '',
              keywords: projectData.metadata.keywords || '',
              category: projectData.category,
            })
          } else {
            setMetadata({
              title: projectData?.name || '',
              subtitle: '',
              description: '',
              keywords: '',
            })
          }
        }
      } catch (err) {
        console.error('Failed to fetch project:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchProject()
  }, [projectId])

  useEffect(() => {
    let active = true
    setCurrentIconUrl(null)
    setCurrentIconSource(null)
    if (project?.id !== projectId || !project.appStoreAppId) return
    const appId = project.appStoreAppId
    void fetch('/api/stores/apps/icons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appIds: [appId], size: 1024, prefer: 'store' }),
    })
      .then(async (response) => {
        if (response.ok) {
          const data = await response.json()
          if (active) {
            setCurrentIconUrl(data.icons?.[appId] || null)
            setCurrentIconSource(data.sources?.[appId] || null)
          }
        }
      })
      .catch(() => {
        /* Import remains available if the store lookup is unavailable. */
      })
    return () => {
      active = false
    }
  }, [project, projectId])

  if (!loading && !project)
    return (
      <div
        role="alert"
        className="rounded-2xl bg-neutral-900 p-8 text-neutral-300"
      >
        Could not load this project.{' '}
        <button
          className="underline underline-offset-4"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    )

  if (loading || !project) {
    return (
      <div
        className="h-96 rounded-3xl bg-neutral-900 motion-safe:animate-pulse"
        role="status"
        aria-label="Loading app icons"
      >
        <span className="sr-only">Loading app icons</span>
      </div>
    )
  }

  return (
    <div>
      {/* Icon Generator */}
      <IconGenerator
        currentIconUrl={currentIconUrl}
        currentIconSource={currentIconSource}
        projectId={project.id}
        appStoreAppId={project.appStoreAppId}
        metadata={metadata || undefined}
      />
    </div>
  )
}
