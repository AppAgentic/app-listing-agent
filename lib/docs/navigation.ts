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
        icon: Book
      },
      {
        title: 'Quick Start',
        href: '/docs/getting-started',
        icon: Rocket
      },
      {
        title: 'Authentication',
        href: '/docs/authentication',
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
        icon: Server,
        badge: '55 tools'
      },
      {
        title: 'Connect an AI agent',
        href: '/docs/mcp/installation',
        icon: Plug
      },
      {
        title: 'Tool reference',
        href: '/docs/mcp/tools',
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
