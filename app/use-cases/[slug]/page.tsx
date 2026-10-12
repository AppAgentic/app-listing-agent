import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DiscoveryPageLayout } from '@/components/discovery/DiscoveryPageLayout'
import { DISCOVERY_PAGES, getDiscoveryPage } from '@/lib/discovery-pages'
import { pageMetadata } from '@/lib/seo/site'

export const dynamicParams = false

export function generateStaticParams() {
  return DISCOVERY_PAGES.map(page => ({ slug: page.slug }))
}
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const page = getDiscoveryPage(slug)
  if (!page) return {}
  return pageMetadata({
    title: page.eyebrow,
    description: page.description,
    path: `/use-cases/${page.slug}`,
    socialTitle: page.title,
  })
}

export default async function DiscoveryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = getDiscoveryPage(slug)
  if (!page) notFound()
  return <DiscoveryPageLayout page={page} />
}
