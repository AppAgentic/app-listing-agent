import { after, NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getAccountContext } from '@/lib/org/context'
import {
  approveAgentTask,
  cancelAgentTask,
  getAgentTask,
  serializeAgentTask,
} from '@/lib/mcp/agent-tasks'
import { executeAgentTaskOperation } from '@/lib/mcp/server'
import { isTrustedAppOrigin } from '@/lib/routing/request-origin'

async function authenticatedTask(taskId: string) {
  const session = await getSession()
  if (!session) return { error: 'Unauthorized', status: 401 as const }
  const task = await getAgentTask(session.userId, taskId)
  if (!task) return { error: 'Task not found', status: 404 as const }
  return { session, task }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params
  const auth = await authenticatedTask(taskId)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  return NextResponse.json({
    task: serializeAgentTask(auth.task),
    approval: auth.task.approval,
    approved: Boolean(auth.task.approval.approvedAt),
    proof: auth.task.proof || null,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  if (!isTrustedAppOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  const { taskId } = await params
  const auth = await authenticatedTask(taskId)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const context = await getAccountContext(auth.session.userId)
  if (!context) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  try {
    const approved = await approveAgentTask(
      auth.session.userId,
      taskId,
      auth.session.userId
    )
    after(() => executeAgentTaskOperation(taskId, context).then(() => undefined))
    return NextResponse.json({ task: serializeAgentTask(approved) })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to approve task',
    }, { status: 409 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  if (!isTrustedAppOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
  const { taskId } = await params
  const auth = await authenticatedTask(taskId)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const cancelled = await cancelAgentTask(auth.session.userId, taskId)
    return NextResponse.json({ task: serializeAgentTask(cancelled) })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to cancel task',
    }, { status: 409 })
  }
}
