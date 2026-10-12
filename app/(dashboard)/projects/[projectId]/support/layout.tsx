import { notFound } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { isInternalIntegrationIdentity } from '@/lib/features/internal-integrations'

export default async function SupportLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session || !isInternalIntegrationIdentity({
    email: session.email,
    userId: session.userId,
    orgId: session.organizationId,
  })) {
    notFound()
  }

  return children
}
