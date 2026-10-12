import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { requireProductAccessForPage } from '@/lib/billing/page-gate'
import { getAgentTask } from '@/lib/mcp/agent-tasks'
import { ApprovalControls } from './approval-controls'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { robots: { index: false, follow: false } }

function label(name: string): string {
  return name.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

export default async function AgentTaskApprovalPage({
  params,
}: {
  params: Promise<{ taskId: string }>
}) {
  const { taskId } = await params
  const session = await getSession()
  if (!session) redirect(`/login?returnTo=${encodeURIComponent(`/agent-tasks/${taskId}`)}`)
  await requireProductAccessForPage(session.userId, `/agent-tasks/${taskId}`)

  const task = await getAgentTask(session.userId, taskId)
  if (!task) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#070807] px-6 text-[#f4f4ef]">
        <div className="max-w-md text-center">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-white/40">Approval unavailable</p>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight">This task was not found.</h1>
          <p className="mt-5 leading-7 text-white/55">It may belong to another account or its retention window may have ended.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#070807] px-6 py-16 text-[#f4f4ef]" data-clarity-mask="true">
      <div className="mx-auto max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.22em] text-violet-400">Human checkpoint</p>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">Review before App Listing Agent acts.</h1>
        <p className="mt-5 max-w-xl leading-7 text-white/55">The agent cannot approve this itself. Your decision is locked to the input hash below, so changed inputs require a fresh approval.</p>

        <section className="mt-10 border-y border-white/10 py-8">
          <dl className="grid gap-6 sm:grid-cols-2">
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/35">Action</dt>
              <dd className="mt-2 text-lg font-medium">{label(task.toolName)}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/35">Project</dt>
              <dd className="mt-2 truncate text-lg font-medium">{task.projectId || 'Account-level action'}</dd>
            </div>
          </dl>
          <div className="mt-7">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/35">Exact input fingerprint</p>
            <code className="mt-2 block break-all text-sm text-white/65">{task.inputHash}</code>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-lg font-semibold">What will change</h2>
          <pre className="mt-4 max-h-80 overflow-auto rounded-2xl border border-white/10 bg-white/[0.035] p-5 text-xs leading-6 text-white/65">{JSON.stringify(task.approval.preview || { message: task.statusMessage }, null, 2)}</pre>
        </section>

        <ApprovalControls
          taskId={taskId}
          initialStatus={task.status}
          initialApproved={Boolean(task.approval.approvedAt)}
        />
        <p className="mt-6 text-center text-xs leading-5 text-white/30">Store credentials are never displayed here. Approval applies only to this task and cannot be reused for different inputs.</p>
      </div>
    </main>
  )
}
