'use client'

import Link from 'next/link'
import Image from 'next/image'

const footerLinks = {
  product: [
    { name: 'How it works', href: '/#how-it-works' },
    { name: 'Pricing', href: '/#pricing' },
    { name: 'Changelog', href: '/changelog' },
  ],
  docs: [
    { name: 'Getting Started', href: '/docs/getting-started' },
    { name: 'MCP Server', href: '/docs/mcp' },
    { name: 'Tool reference', href: '/docs/mcp/tools' },
    { name: 'Authentication', href: '/docs/authentication' },
  ],
  company: [
    { name: 'Privacy', href: '/privacy' },
    { name: 'Terms', href: '/terms' },
  ],
  support: [
    { name: 'Contact', href: '/contact' },
  ],
}

export function DocsFooter() {
  return (
    <footer className="border-t border-white/[0.05] bg-[#050505]">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <h3 className="text-sm font-semibold text-white mb-4">Product</h3>
            <ul className="space-y-3">
              {footerLinks.product.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-white/50 hover:text-white transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-4">Documentation</h3>
            <ul className="space-y-3">
              {footerLinks.docs.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-white/50 hover:text-white transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-4">Company</h3>
            <ul className="space-y-3">
              {footerLinks.company.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-white/50 hover:text-white transition-colors"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-white mb-4">Support</h3>
            <ul className="space-y-3">
              {footerLinks.support.map((link) => (
                <li key={link.name}>
                  <Link
                    href={link.href}
                    className="text-sm text-white/50 hover:text-white transition-colors"
                    {...(link.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-white/[0.05] flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Image
              src="/copilot-icon.png"
              alt="App Listing Agent"
              width={20}
              height={20}
              className="w-5 h-5"
              unoptimized
            />
            <span className="text-sm text-white/50 font-brand">
              © {new Date().getFullYear()} App Agentic Ltd · App Listing Agent is operated by App Agentic Ltd
            </span>
          </div>

        </div>
      </div>
    </footer>
  )
}
