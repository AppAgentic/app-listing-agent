'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

// Redirect to dashboard - project creation is now inline on the dashboard page
export default function NewProjectPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/dashboard')
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
        <p className="text-neutral-400">Redirecting to dashboard...</p>
      </div>
    </div>
  )
}
