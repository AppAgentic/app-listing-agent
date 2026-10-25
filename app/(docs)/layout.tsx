import { DocsSidebar } from '@/components/docs/docs-sidebar'
import { DocsNavbar } from '@/components/docs/docs-navbar'
import { DocsFooter } from '@/components/docs/docs-footer'

export const metadata = {
  title: {
    template: '%s | App Listing Agent Docs',
    default: 'Documentation | App Listing Agent'
  },
  description: 'Documentation for App Listing Agent: connecting AI agents over MCP, tools, and store credentials.'
}

export default function DocsLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Main content comes first in the HTML so agents reach it before the navigation.
          The navbar and sidebar are fixed-position, so the visual layout is unchanged. */}
      <div className="flex pt-16 flex-1">
        <main className="flex-1 lg:pl-72">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
            <p className="mb-6 text-xs text-white/50" data-md-skip="">
              For AI agents: an index of these docs is at{' '}
              <a href="/llms.txt" className="underline hover:text-white/70">/llms.txt</a>, and every page has a
              markdown version (add .md to the URL).
            </p>
            {children}
          </div>
        </main>

        <DocsSidebar />
      </div>

      <DocsNavbar />

      {/* Footer */}
      <div className="lg:pl-72">
        <DocsFooter />
      </div>
    </div>
  )
}
