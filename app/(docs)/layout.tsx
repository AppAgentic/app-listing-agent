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
      <DocsNavbar />

      <div className="flex pt-16 flex-1">
        {/* Sidebar */}
        <DocsSidebar />

        {/* Main content */}
        <main className="flex-1 lg:pl-72">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
            {children}
          </div>
        </main>
      </div>

      {/* Footer */}
      <div className="lg:pl-72">
        <DocsFooter />
      </div>
    </div>
  )
}
