import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { IconsPreview } from './preview'

export const metadata: Metadata = {
  title: 'App icon local preview',
  robots: { index: false, follow: false },
}
export default function IconsPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <IconsPreview />
}
