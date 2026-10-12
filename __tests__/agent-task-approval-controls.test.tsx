import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovalControls } from '@/app/agent-tasks/[taskId]/approval-controls'

describe('agent task approval controls', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('records explicit approval and moves into the executing state', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task: { status: 'working' } }),
    })
    vi.stubGlobal('fetch', request)
    render(<ApprovalControls taskId="task-one" initialStatus="input_required" initialApproved={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve this exact change' }))

    await waitFor(() => expect(request).toHaveBeenCalledWith('/api/agent-tasks/task-one', { method: 'POST' }))
    expect(await screen.findByText(/executing this frozen preview/i)).toBeTruthy()
  })

  it('cancels without exposing an execution action', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ task: { status: 'cancelled' } }),
    })
    vi.stubGlobal('fetch', request)
    render(<ApprovalControls taskId="task-two" initialStatus="input_required" initialApproved={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }))

    expect(await screen.findByText(/cannot execute/i)).toBeTruthy()
  })
})
