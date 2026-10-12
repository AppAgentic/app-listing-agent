'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Highlight, themes } from 'prism-react-renderer'

interface CodeBlockProps {
  code: string
  language: string
  title?: string
  showLineNumbers?: boolean
}

export function CodeBlock({
  code,
  language,
  title,
  showLineNumbers = false
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="group relative rounded-xl border border-white/[0.08] bg-[#0d0d0d] overflow-hidden my-6">
      {/* Header */}
      {title && (
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-2">
          <span className="text-xs text-white/50">{title}</span>
          <span className="rounded bg-white/[0.08] px-2 py-0.5 text-xs text-white/40">
            {language}
          </span>
        </div>
      )}

      {/* Copy button */}
      <button
        onClick={copyToClipboard}
        className="absolute right-3 top-3 rounded-lg border border-white/[0.08] bg-white/[0.05] p-2 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/[0.1]"
        aria-label="Copy code"
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-400" />
        ) : (
          <Copy className="h-4 w-4 text-white/60" />
        )}
      </button>

      {/* Code */}
      <Highlight theme={themes.nightOwl} code={code.trim()} language={language}>
        {({ className, style, tokens, getLineProps, getTokenProps }) => (
          <pre
            className={`${className} overflow-x-auto p-4 text-sm`}
            style={{ ...style, background: 'transparent' }}
          >
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })}>
                {showLineNumbers && (
                  <span className="mr-4 inline-block w-8 text-right text-white/30 select-none">
                    {i + 1}
                  </span>
                )}
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </div>
            ))}
          </pre>
        )}
      </Highlight>
    </div>
  )
}
