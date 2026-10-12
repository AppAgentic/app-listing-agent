'use client'

import { useEffect, useState } from 'react'

type TaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled'

export function ApprovalControls({
  taskId,
  initialStatus,
  initialApproved,
}: {
  taskId: string
  initialStatus: TaskStatus
  initialApproved: boolean
}) {
  const [status, setStatus] = useState<TaskStatus>(initialStatus)
  const [approved, setApproved] = useState(initialApproved)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (status !== 'working') return
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/agent-tasks/${encodeURIComponent(taskId)}`, { cache: 'no-store' })
      if (!response.ok) return
      const payload = await response.json()
      const nextStatus = payload.task?.status as TaskStatus | undefined
      if (nextStatus) setStatus(nextStatus)
      setApproved(Boolean(payload.approved))
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [status, taskId])

  async function decide(method: 'POST' | 'DELETE') {
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`/api/agent-tasks/${encodeURIComponent(taskId)}`, { method })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to update task')
      setStatus(payload.task.status)
      if (method === 'POST') setApproved(true)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update task')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'completed') {
    return <p className="mt-8 rounded-2xl border border-violet-400/25 bg-violet-400/10 px-5 py-4 text-sm text-violet-200">Completed. The agent can now retrieve the content-addressed completion proof.</p>
  }
  if (status === 'failed') {
    return <p className="mt-8 rounded-2xl border border-red-400/25 bg-red-400/10 px-5 py-4 text-sm text-red-200">The approved operation failed. No retry will run without a new task.</p>
  }
  if (status === 'cancelled') {
    return <p className="mt-8 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-white/60">Cancelled. This task cannot execute.</p>
  }
  if (status === 'working') {
    return <p className="mt-8 rounded-2xl border border-violet-400/20 bg-violet-400/5 px-5 py-4 text-sm text-white/70">{approved ? 'Approved. App Listing Agent is executing this frozen preview; this page will update automatically.' : 'App Listing Agent is preparing the preview. No live store data has changed.'}</p>
  }

  return (
    <div className="mt-8">
      <button
        type="button"
        disabled={busy}
        onClick={() => decide('POST')}
        className="w-full rounded-full bg-violet-600 px-6 py-4 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-wait disabled:opacity-50"
      >
        {busy ? 'Recording decision…' : 'Approve this exact change'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => decide('DELETE')}
        className="mt-3 w-full rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-white/60 transition hover:border-white/30 hover:text-white"
      >
        Cancel task
      </button>
      {message && <p role="alert" className="mt-4 text-sm text-red-300">{message}</p>}
    </div>
  )
}
