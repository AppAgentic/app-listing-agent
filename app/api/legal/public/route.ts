import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@/lib/firebase/admin'

// GET - Fetch legal document by public slug (no auth required)
// This endpoint is used by the public pages to fetch content
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const slug = searchParams.get('slug')
  const type = searchParams.get('type') // 'privacy' or 'terms'

  if (!slug || !type) {
    return NextResponse.json(
      { error: 'Missing slug or type parameter' },
      { status: 400 }
    )
  }

  // Map URL type to document type
  const docType = type === 'privacy' ? 'privacy_policy' : type === 'terms' ? 'terms_of_service' : null
  if (!docType) {
    return NextResponse.json(
      { error: 'Invalid type. Must be "privacy" or "terms"' },
      { status: 400 }
    )
  }

  try {
    // Search for project with this publicSlug in both users and organizations
    // First check users collection
    const usersSnapshot = await adminDb.collectionGroup('projects')
      .where('publicSlug', '==', slug)
      .limit(1)
      .get()

    if (usersSnapshot.empty) {
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404 }
      )
    }

    const projectDoc = usersSnapshot.docs[0]
    const projectData = projectDoc.data()

    // Get the legal document from the project's legal subcollection
    const legalDoc = await projectDoc.ref.collection('legal').doc(docType).get()

    if (!legalDoc.exists) {
      return NextResponse.json(
        { error: 'Legal document not found' },
        { status: 404 }
      )
    }

    const legalData = legalDoc.data()

    // Check if published
    if (!legalData?.isPublished) {
      return NextResponse.json(
        { error: 'Document not published' },
        { status: 404 }
      )
    }

    const content = legalData.publishedContent ?? legalData.content
    if (!content) {
      return NextResponse.json(
        { error: 'Published document is empty' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      content,
      appName: projectData.name || 'App',
      lastModified: legalData.lastPublishedAt?.toDate?.()?.toISOString()
        || legalData.lastModifiedAt?.toDate?.()?.toISOString()
        || null,
    }, {
      headers: {
        // Cache for 1 hour at CDN level
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      }
    })
  } catch (error) {
    console.error('Error fetching legal document:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
