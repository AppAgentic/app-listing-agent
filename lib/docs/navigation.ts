import {
  Book,
  Rocket,
  Key,
  Server,
  Plug,
  List,
  CheckCircle,
  type LucideIcon
} from 'lucide-react'

export interface NavItem {
  title: string
  href: string
  /** One line for llms.txt; keep it in step with the page's meta description. */
  description?: string
  icon?: LucideIcon
  badge?: string
  items?: NavItem[]
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export const docsNavigation: NavSection[] = [
  {
    title: 'Getting Started',
    items: [
      {
        title: 'Introduction',
        href: '/docs',
        description: 'What App Listing Agent is, what it automates and where to start.',
        icon: Book
      },
      {
        title: 'Quick Start',
        href: '/docs/getting-started',
        description: 'Create an App Listing Agent workspace, connect an AI agent and run your first readiness audit.',
        icon: Rocket
      },
      {
        title: 'Authentication',
        href: '/docs/authentication',
        description: 'How AI agents authenticate with App Listing Agent and how store credentials are connected.',
        icon: Key
      }
    ]
  },
  {
    title: 'MCP Server',
    items: [
      {
        title: 'Overview',
        href: '/docs/mcp',
        description: 'Give MCP-compatible AI agents access to App Listing Agent store-launch tools.',
        icon: Server,
        badge: '55 tools'
      },
      {
        title: 'Connect an AI agent',
        href: '/docs/mcp/installation',
        description: 'Connect ChatGPT, Claude, Codex, Cursor, or another remote-MCP client to App Listing Agent.',
        icon: Plug
      },
      {
        title: 'Tool reference',
        href: '/docs/mcp/tools',
        description: 'Every public App Listing Agent MCP tool with its description, parameters, required key scope and approval rule.',
        icon: List
      }
    ]
  },
  {
    title: 'Guides',
    items: [
      {
        title: 'Best Practices',
        href: '/docs/guides/best-practices',
        description: 'Best practices for app store listings, localization and keeping agent access secure.',
        icon: CheckCircle
      }
    ]
  }
]

// Helper to find current section and item
export function findCurrentNav(pathname: string): {
  section: NavSection | null
  item: NavItem | null
  parent: NavItem | null
} {
  for (const section of docsNavigation) {
    for (const item of section.items) {
      if (item.href === pathname) {
        return { section, item, parent: null }
      }
      if (item.items) {
        for (const subItem of item.items) {
          if (subItem.href === pathname) {
            return { section, item: subItem, parent: item }
          }
        }
      }
    }
  }
  return { section: null, item: null, parent: null }
}

// Get previous and next items for navigation
export function getPrevNextNav(pathname: string): {
  prev: NavItem | null
  next: NavItem | null
} {
  const allItems: NavItem[] = []

  for (const section of docsNavigation) {
    for (const item of section.items) {
      allItems.push(item)
      if (item.items) {
        allItems.push(...item.items)
      }
    }
  }

  const currentIndex = allItems.findIndex(item => item.href === pathname)

  return {
    prev: currentIndex > 0 ? allItems[currentIndex - 1] : null,
    next: currentIndex < allItems.length - 1 ? allItems[currentIndex + 1] : null
  }
}
