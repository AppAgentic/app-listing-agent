import { parse, type HTMLElement, type Node, NodeType } from 'node-html-parser'

// Converts a rendered docs page (the <article> the browser gets) into markdown, so the
// .md version and the HTML version always come from the same React source.

const SKIP_TAGS = new Set(['script', 'style', 'svg', 'button', 'noscript', 'template', 'nav', 'img', 'input'])
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'details', 'div', 'dl', 'dt', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'ol', 'p', 'pre',
  'section', 'summary', 'table', 'ul',
])

function tag(node: Node): string {
  return node.nodeType === NodeType.ELEMENT_NODE ? (node as HTMLElement).rawTagName?.toLowerCase() ?? '' : ''
}

function isSkipped(node: Node): boolean {
  if (node.nodeType === NodeType.COMMENT_NODE) return true
  if (node.nodeType !== NodeType.ELEMENT_NODE) return false
  const element = node as HTMLElement
  return SKIP_TAGS.has(tag(node)) || element.hasAttribute('data-md-skip') || element.getAttribute('aria-hidden') === 'true'
}

function hasBlockDescendant(element: HTMLElement): boolean {
  return element.childNodes.some(child =>
    child.nodeType === NodeType.ELEMENT_NODE && !isSkipped(child) &&
    (BLOCK_TAGS.has(tag(child)) || hasBlockDescendant(child as HTMLElement)))
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ')
}

function escapeInline(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1').replace(/^(\s*)([#>+-]|\d+\.)(\s)/, '$1\\$2$3')
}

function codeSpan(text: string): string {
  const value = collapse(text).trim()
  if (!value) return ''
  const fence = value.includes('`') ? '``' : '`'
  return fence.length > 1 ? `${fence} ${value} ${fence}` : `${fence}${value}${fence}`
}

function absoluteHref(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString()
  } catch {
    return href
  }
}

interface Context {
  baseUrl: string
}

function inline(node: Node, ctx: Context): string {
  if (isSkipped(node)) return ''
  if (node.nodeType === NodeType.TEXT_NODE) return escapeInline(collapse(node.text))
  const element = node as HTMLElement
  const children = () => element.childNodes.map(child => inline(child, ctx)).join('')
  switch (tag(node)) {
    case 'br':
      return '  \n'
    case 'strong':
    case 'b': {
      const inner = children().trim()
      return inner ? `**${inner}**` : ''
    }
    case 'em':
    case 'i': {
      const inner = children().trim()
      return inner ? `*${inner}*` : ''
    }
    case 'code':
    case 'kbd':
      return codeSpan(element.text)
    case 'a': {
      const inner = children().trim()
      const href = element.getAttribute('href')
      if (!href || !inner) return inner
      return `[${inner}](${absoluteHref(href, ctx.baseUrl)})`
    }
    default:
      return children()
  }
}

function tidyInline(text: string): string {
  return text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim()
}

function codeBlock(pre: HTMLElement, title: string | null): string {
  const lines = pre.querySelectorAll('.token-line')
  const code = (lines.length > 0 ? lines.map(line => line.text).join('\n') : pre.text).replace(/\s+$/, '')
  const language = (pre.getAttribute('class') ?? '').match(/language-([\w-]+)/)?.[1] ?? ''
  const fence = code.includes('```') ? '````' : '```'
  const heading = title ? `${escapeInline(title)}${language ? ` ${language}` : ''}:\n\n` : ''
  return `${heading}${fence}${language === 'text' ? '' : language}\n${code}\n${fence}`
}

function tableBlock(table: HTMLElement, ctx: Context): string {
  const rows = table.querySelectorAll('tr').map(row =>
    row.childNodes
      .filter(cell => tag(cell) === 'td' || tag(cell) === 'th')
      .map(cell => {
        const element = cell as HTMLElement
        // Block children inside a cell (e.g. an "One of: …" line) become a <br>.
        const parts = element.childNodes.map(child =>
          child.nodeType === NodeType.ELEMENT_NODE && (child as HTMLElement).classList?.contains('block')
            ? ` <br>${inline(child, ctx)}`
            : inline(child, ctx))
        return tidyInline(parts.join('')).replace(/\n/g, ' ').replace(/\|/g, '\\|')
      }))
  if (rows.length === 0) return ''
  const width = Math.max(...rows.map(row => row.length))
  const pad = (row: string[]) => [...row, ...Array(width - row.length).fill('')]
  const [head, ...body] = rows
  return [
    `| ${pad(head).join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...body.map(row => `| ${pad(row).join(' | ')} |`),
  ].join('\n')
}

function prefixLines(text: string, prefix: string, firstPrefix = prefix): string {
  return text.split('\n').map((line, index) => {
    const lead = index === 0 ? firstPrefix : prefix
    return line ? `${lead}${line}` : lead.trimEnd()
  }).join('\n')
}

function listBlock(list: HTMLElement, ctx: Context): string {
  const ordered = tag(list) === 'ol'
  const items = list.childNodes.filter(child => tag(child) === 'li') as HTMLElement[]
  return items.map((item, index) => {
    const marker = ordered ? `${index + 1}. ` : '- '
    const content = blocks(item, ctx).join('\n\n') || ''
    return prefixLines(content, ' '.repeat(marker.length), marker)
  }).join('\n')
}

function linkCard(link: HTMLElement, ctx: Context): string {
  const href = link.getAttribute('href')
  const parts = blocks(link, ctx).map(part => part.replace(/^#+\s+/, '').trim()).filter(Boolean)
  if (parts.length === 0) return ''
  const [title, ...rest] = parts
  const label = href ? `[${title}](${absoluteHref(href, ctx.baseUrl)})` : title
  return `- ${label}${rest.length ? `: ${rest.join(' ')}` : ''}`
}

function block(element: HTMLElement, ctx: Context): string[] {
  const name = tag(element)
  if (/^h[1-6]$/.test(name)) {
    const text = tidyInline(inline(element, ctx))
    return text ? [`${'#'.repeat(Number(name[1]))} ${text.replace(/\n/g, ' ')}`] : []
  }
  if (name === 'p') {
    const text = tidyInline(inline(element, ctx))
    return text ? [text] : []
  }
  if (name === 'pre') return [codeBlock(element, null)]
  if (name === 'ul' || name === 'ol') {
    const text = listBlock(element, ctx)
    return text ? [text] : []
  }
  if (name === 'table') {
    const text = tableBlock(element, ctx)
    return text ? [text] : []
  }
  if (name === 'hr') return ['---']
  if (name === 'blockquote') {
    const inner = blocks(element, ctx).join('\n\n')
    return inner ? [prefixLines(inner, '> ')] : []
  }
  if (name === 'a') {
    const text = linkCard(element, ctx)
    return text ? [text] : []
  }
  if (element.hasAttribute('data-callout')) {
    const titleNode = element.querySelector('[data-callout-title]')
    const title = titleNode ? tidyInline(inline(titleNode, ctx)) : ''
    titleNode?.remove()
    const inner = blocks(element, ctx).join('\n\n')
    const content = [title ? `**${title}**` : '', inner].filter(Boolean).join('\n\n')
    return content ? [prefixLines(content, '> ')] : []
  }
  if (element.hasAttribute('data-code-block')) {
    const pre = element.querySelector('pre')
    return pre ? [codeBlock(pre, element.getAttribute('data-code-title') ?? null)] : []
  }
  return blocks(element, ctx)
}

/** Converts the children of a container into markdown blocks, grouping inline runs into paragraphs. */
function blocks(container: HTMLElement, ctx: Context): string[] {
  const out: string[] = []
  let run = ''
  const flush = () => {
    const text = tidyInline(run)
    if (text) out.push(text)
    run = ''
  }
  for (const child of container.childNodes) {
    if (isSkipped(child)) continue
    if (child.nodeType === NodeType.ELEMENT_NODE) {
      const element = child as HTMLElement
      const name = tag(child)
      const isBlock = BLOCK_TAGS.has(name) || element.hasAttribute('data-callout') || element.hasAttribute('data-code-block') ||
        hasBlockDescendant(element)
      if (isBlock) {
        flush()
        out.push(...block(element, ctx))
        continue
      }
    }
    run += inline(child, ctx)
  }
  flush()
  return out
}

export interface ConvertedDocsPage {
  title: string
  description: string
  markdown: string
}

/**
 * Converts a full HTML document into markdown. Only the main content (the first <article>, or
 * <main>) is converted; navigation, sidebars and footers are left out.
 */
export function docsHtmlToMarkdown(html: string, pageUrl: string, preamble: string[] = []): ConvertedDocsPage {
  const root = parse(html, { comment: false, blockTextElements: { script: true, noscript: true, style: true } })
  const title = root.querySelector('title')?.text.trim() ?? ''
  const description = root.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? ''
  const content = root.querySelector('article') ?? root.querySelector('main') ?? root
  const parts = blocks(content, { baseUrl: pageUrl })
  // Put the agent preamble right after the H1 so the page still opens with its title.
  const h1Index = parts.findIndex(part => part.startsWith('# '))
  if (preamble.length) parts.splice(h1Index + 1, 0, ...preamble)
  const markdown = `${parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
  return { title, description, markdown }
}
