import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { adminDb } from '@/lib/firebase/admin'
import { renderLegalMarkdown } from '@/lib/security/legal-markdown'

// ISR: Revalidate every hour (3600 seconds)
// This means the page is statically generated and cached at the edge
// Firestore is only hit once per hour per page, regardless of traffic
export const revalidate = 3600

interface PageProps {
  params: Promise<{ slug: string }>
}

async function getLegalContent(slug: string) {
  try {
    // Look up the project path from the slugLookup collection
    const slugDoc = await adminDb.collection('slugLookup').doc(slug).get()

    let projectPath = slugDoc.data()?.projectPath as string | undefined
    if (!projectPath) {
      console.log('[Public Terms] Slug lookup missing, falling back to collectionGroup:', slug)
      const projectsSnapshot = await adminDb.collectionGroup('projects')
        .where('publicSlug', '==', slug)
        .limit(1)
        .get()

      if (projectsSnapshot.empty) {
        return null
      }

      projectPath = projectsSnapshot.docs[0].ref.path
      await adminDb.collection('slugLookup').doc(slug).set({
        projectPath,
        repairedAt: new Date(),
      }, { merge: true })
    }

    // Get the project document using the stored or repaired path
    const projectDoc = await adminDb.doc(projectPath).get()
    if (!projectDoc.exists) {
      console.log('[Public Terms] Project not found at path:', projectPath)
      return null
    }

    const projectData = projectDoc.data()
    if (!projectData) {
      return null
    }

    // Get terms of service document
    const legalDoc = await projectDoc.ref.collection('legal').doc('terms_of_service').get()

    if (!legalDoc.exists) {
      return null
    }

    const legalData = legalDoc.data()

    if (!legalData?.isPublished) {
      return null
    }

    // Use publishedContent if available, fallback to content for backwards compatibility
    const content = legalData.publishedContent ?? legalData.content
    if (!content) {
      return null
    }

    return {
      content: content as string,
      appName: projectData.name || 'App',
      lastModified: legalData.lastPublishedAt?.toDate?.() || legalData.lastModifiedAt?.toDate?.() || null,
    }
  } catch (error) {
    console.error('Error fetching terms of service:', error)
    return null
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const data = await getLegalContent(slug)

  if (!data) {
    return {
      title: 'Terms of Service',
    }
  }

  return {
    title: `Terms of Service - ${data.appName}`,
    description: `Terms of Service for ${data.appName}`,
  }
}

export default async function TermsOfServicePage({ params }: PageProps) {
  const { slug } = await params
  const data = await getLegalContent(slug)

  if (!data) {
    notFound()
  }

  return (
    <article className="prose prose-gray max-w-none">
      <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
      <p className="text-gray-500 text-sm mb-8">
        {data.appName}
        {data.lastModified && (
          <> &middot; Last updated: {data.lastModified.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}</>
        )}
      </p>

      <div
        className="text-gray-700 leading-relaxed"
        dangerouslySetInnerHTML={{ __html: renderLegalMarkdown(data.content) }}
      />
    </article>
  )
}
