import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { requireInternalOperator } from '@/lib/concierge-server'
import { SetupCallQueue, type SetupLead } from './setup-call-queue'

function iso(value: unknown): string | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString()
  }
  return null
}
export const dynamic = 'force-dynamic'

export default async function SetupCallsPage() {
  if (!await requireInternalOperator()) notFound()

  const snapshot = await adminDb.collection('conciergeLeads').orderBy('createdAt', 'desc').limit(200).get()
  const leads = snapshot.docs.map(doc => {
    const data = doc.data()
    return {
      id: doc.id,
      name: String(data.name || ''),
      email: String(data.email || ''),
      company: String(data.company || ''),
      appName: String(data.appName || ''),
      appStatus: String(data.appStatus || ''),
      platforms: Array.isArray(data.platforms) ? data.platforms.map(String) : [],
      appCount: String(data.appCount || ''),
      launchTiming: String(data.launchTiming || ''),
      customerType: String(data.customerType || ''),
      preferredPlan: String(data.preferredPlan || ''),
      preferredAgent: String(data.preferredAgent || ''),
      biggestStoreProblem: String(data.biggestStoreProblem || ''),
      status: String(data.status || 'applied'),
      qualificationScore: Number(data.qualificationScore || 0),
      qualificationReasons: Array.isArray(data.qualificationReasons) ? data.qualificationReasons.map(String) : [],
      operatorNotes: String(data.operatorNotes || ''),
      source: String(data.source || 'direct'),
      createdAt: iso(data.createdAt) || new Date(0).toISOString(),
      scheduledAt: iso(data.scheduledAt),
    } satisfies SetupLead
  })

  return <SetupCallQueue initialLeads={leads} />
}
