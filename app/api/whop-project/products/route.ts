import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getProjectContext } from '@/lib/org/context'
import { getMutableProjectContext } from '@/lib/org/project-authorization'
import { getWhopProjectHelper } from '@/lib/services/whop-project'

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  const projectContext = await getProjectContext(session.userId, projectId)
  if (!projectContext) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const helper = await getWhopProjectHelper(session.userId, projectId, projectContext.orgId)
  if (!helper) {
    return NextResponse.json({ error: 'Whop not configured for this project' }, { status: 400 })
  }

  try {
    const after = searchParams.get('after') || undefined
    const result = await helper.listProducts({ after })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch products' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { projectId, ...productData } = body

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
  }

  if (!productData.title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const projectContext = await getMutableProjectContext(session.userId, projectId)
  if (!projectContext) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const helper = await getWhopProjectHelper(session.userId, projectId, projectContext.orgId)
  if (!helper) {
    return NextResponse.json({ error: 'Whop not configured for this project' }, { status: 400 })
  }

  try {
    const product = await helper.createProduct(productData)
    return NextResponse.json({ success: true, product })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create product' },
      { status: 500 }
    )
  }
}
