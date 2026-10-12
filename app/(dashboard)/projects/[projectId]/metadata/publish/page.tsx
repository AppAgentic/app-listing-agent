'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { PublishWizard } from '@/components/metadata'

export default function PublishPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.projectId as string

  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [availableLocales, setAvailableLocales] = useState<string[]>([])
  const [projectName, setProjectName] = useState<string>('')

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch(`/api/metadata?projectId=${projectId}`)
        if (!response.ok) {
          throw new Error('Failed to fetch project data')
        }
        const data = await response.json()
        setProjectName(data.project.name)
        setAvailableLocales(data.locales || data.project.enabledLocales || ['en-US'])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [projectId])

  const handleComplete = () => {
    router.push(`/projects/${projectId}/metadata`)
  }

  const handleCancel = () => {
    router.push(`/projects/${projectId}/metadata`)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3 text-neutral-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <p className="text-red-400 mb-4">{error}</p>
        <Link
          href={`/projects/${projectId}/metadata`}
          className="px-4 py-2 rounded-xl bg-white/[0.05] text-white hover:bg-white/[0.1] transition-colors"
        >
          Back to Metadata
        </Link>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link
          href={`/projects/${projectId}/metadata`}
          className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Metadata
        </Link>
        <span className="text-neutral-600">/</span>
        <h1 className="text-xl font-bold text-white">Publish to Store</h1>
      </div>

      {/* Project Name */}
      <p className="text-neutral-400 mb-6">
        Publishing metadata for <span className="text-white font-medium">{projectName}</span>
      </p>

      {/* Wizard */}
      <PublishWizard
        projectId={projectId}
        availableLocales={availableLocales}
        onComplete={handleComplete}
        onCancel={handleCancel}
      />
    </div>
  )
}
