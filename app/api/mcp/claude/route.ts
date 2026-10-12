import { NextRequest } from 'next/server'
import { handleMCPGet, handleMCPPost } from '@/lib/mcp/http-route'

export const maxDuration = 300

export async function GET(request: NextRequest) {
  return handleMCPGet(request, 'claude')
}

export async function POST(request: NextRequest) {
  return handleMCPPost(request, 'claude')
}
