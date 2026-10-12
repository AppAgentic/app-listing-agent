const ALLOWED_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function safeHref(value: string): string | null {
  const href = value.trim()

  if (!href || /[\u0000-\u001f\u007f]/.test(href)) {
    return null
  }

  if (href.startsWith('#') || (href.startsWith('/') && !href.startsWith('//'))) {
    return href
  }

  try {
    const url = new URL(href)
    return ALLOWED_LINK_SCHEMES.has(url.protocol.toLowerCase()) ? href : null
  } catch {
    return null
  }
}

function renderInline(content: string): string {
  const links: string[] = []
  const withLinkTokens = content.replace(/\[([^\]]+)]\(([^\s)]+)\)/g, (_match, label: string, href: string) => {
    const safeUrl = safeHref(href)
    const safeLabel = renderInline(label)
    const rendered = safeUrl
      ? `<a href="${escapeHtml(safeUrl)}" class="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`
      : safeLabel

    links.push(rendered)
    return `\u0000LINK${links.length - 1}\u0000`
  })

  let rendered = escapeHtml(withLinkTokens)
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')

  rendered = rendered.replace(/\u0000LINK(\d+)\u0000/g, (_match, index: string) => links[Number(index)] || '')
  return rendered
}

/**
 * Render the deliberately small Markdown subset supported by public legal pages.
 * Raw HTML is always escaped and link destinations are restricted to web, email,
 * same-origin path, and fragment URLs before being placed in an HTML attribute.
 */
export function renderLegalMarkdown(content: string): string {
  const blocks: string[] = []
  let paragraph: string[] = []
  let listItems: { ordered: boolean; content: string }[] = []

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p class="mb-4">${paragraph.map(renderInline).join('<br>')}</p>`)
      paragraph = []
    }
  }

  const flushList = () => {
    if (listItems.length > 0) {
      const ordered = listItems[0].ordered
      const tag = ordered ? 'ol' : 'ul'
      const listClass = ordered ? 'list-decimal' : 'list-disc'
      blocks.push(`<${tag} class="${listClass} ml-6 mb-4">${listItems.map(item => `<li>${renderInline(item.content)}</li>`).join('')}</${tag}>`)
      listItems = []
    }
  }

  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line)
    const unorderedItem = /^\s*[-*]\s+(.+)$/.exec(line)
    const orderedItem = /^\s*\d+\.\s+(.+)$/.exec(line)

    if (heading) {
      flushParagraph()
      flushList()
      const level = heading[1].length
      const className = level === 1
        ? 'text-2xl font-bold mt-8 mb-4'
        : level === 2
          ? 'text-xl font-semibold mt-8 mb-3'
          : 'text-lg font-semibold mt-6 mb-2'
      blocks.push(`<h${level} class="${className}">${renderInline(heading[2])}</h${level}>`)
      continue
    }

    const item = unorderedItem || orderedItem
    if (item) {
      flushParagraph()
      const ordered = Boolean(orderedItem)
      if (listItems.length > 0 && listItems[0].ordered !== ordered) flushList()
      listItems.push({ ordered, content: item[1] })
      continue
    }

    if (!line.trim()) {
      flushParagraph()
      flushList()
      continue
    }

    flushList()
    paragraph.push(line)
  }

  flushParagraph()
  flushList()
  return blocks.join('')
}
