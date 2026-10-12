import { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  robots: 'noindex', // Don't index legal pages
}

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="bg-white text-gray-900 min-h-screen">
      {/* Simple header */}
      <header className="border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <Link
            href="/"
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Powered by App Listing Agent
          </Link>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        {children}
      </main>

      {/* Simple footer */}
      <footer className="border-t border-gray-200 mt-16">
        <div className="max-w-3xl mx-auto px-4 py-6 text-center text-sm text-gray-500">
          <p>
            Legal documents hosted by{' '}
            <a
              href="https://applistingagent.com"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              App Listing Agent
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}
