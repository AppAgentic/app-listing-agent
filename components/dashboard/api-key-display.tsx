'use client'

import { useState } from 'react'
import { Eye, EyeOff, Copy, Check } from 'lucide-react'

interface ApiKeyDisplayProps {
  apiKey: string
}

export function ApiKeyDisplay({ apiKey }: ApiKeyDisplayProps) {
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)

  const maskedKey = apiKey.slice(0, 8) + '•'.repeat(32) + apiKey.slice(-4)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 font-mono text-sm bg-black/40 border border-white/[0.08] rounded-xl px-4 py-3 text-neutral-300">
        {visible ? apiKey : maskedKey}
      </div>
      <button
        onClick={() => setVisible(!visible)}
        className="flex items-center gap-2 px-4 py-2.5 text-sm text-neutral-400 hover:text-white border border-white/[0.08] rounded-xl hover:bg-white/[0.05] transition-colors"
      >
        {visible ? (
          <>
            <EyeOff className="w-4 h-4" />
            Hide
          </>
        ) : (
          <>
            <Eye className="w-4 h-4" />
            Show
          </>
        )}
      </button>
      <button
        onClick={handleCopy}
        className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-xl transition-colors ${
          copied
            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
            : 'text-neutral-400 hover:text-white border border-white/[0.08] hover:bg-white/[0.05]'
        }`}
      >
        {copied ? (
          <>
            <Check className="w-4 h-4" />
            Copied!
          </>
        ) : (
          <>
            <Copy className="w-4 h-4" />
            Copy
          </>
        )}
      </button>
    </div>
  )
}
