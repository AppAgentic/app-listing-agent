'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import { CodeBlock } from './code-block'
import { TabGroup } from './tab-group'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface Parameter {
  name: string
  type: string
  required: boolean
  description: string
  default?: string
}

interface APIEndpointProps {
  method: HttpMethod
  path: string
  title: string
  description: string
  auth?: 'required' | 'optional' | 'none'
  parameters?: Parameter[]
  bodyParameters?: Parameter[]
  responseExample?: string
  codeExamples?: {
    curl?: string
    javascript?: string
    python?: string
  }
}

const methodColors: Record<HttpMethod, string> = {
  GET: 'bg-green-500/20 text-green-400 border-green-500/30',
  POST: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  PUT: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  PATCH: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  DELETE: 'bg-red-500/20 text-red-400 border-red-500/30'
}

export function APIEndpoint({
  method,
  path,
  title,
  description,
  auth = 'required',
  parameters,
  bodyParameters,
  responseExample,
  codeExamples
}: APIEndpointProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  const copyPath = async () => {
    await navigator.clipboard.writeText(path)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-8 rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-4 p-4 text-left hover:bg-white/[0.02] transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-5 w-5 text-white/50" />
        ) : (
          <ChevronRight className="h-5 w-5 text-white/50" />
        )}

        <span
          className={`rounded border px-2 py-1 text-xs font-bold ${methodColors[method]}`}
        >
          {method}
        </span>

        <code className="flex-1 font-mono text-sm text-white/80">{path}</code>

        <span className="text-sm text-white/60">{title}</span>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-white/[0.08] p-6 space-y-8">
          {/* Description */}
          <p className="text-white/70 leading-relaxed">{description}</p>

          {/* Path with copy */}
          <div className="flex items-center gap-3">
            <code className="flex-1 rounded-lg bg-white/[0.05] px-3 py-2 font-mono text-sm text-white/80">
              {method} {path}
            </code>
            <button
              onClick={copyPath}
              className="rounded-lg border border-white/[0.08] p-2 hover:bg-white/[0.05]"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-400" />
              ) : (
                <Copy className="h-4 w-4 text-white/50" />
              )}
            </button>
          </div>

          {/* Authentication */}
          <div>
            <h4 className="mb-3 text-sm font-semibold text-white">
              Authentication
            </h4>
            <p className="text-sm text-white/60 leading-relaxed">
              {auth === 'required' && (
                <>
                  Requires API key with <code className="text-purple-400">Authorization: Bearer {'<api_key>'}</code> header
                </>
              )}
              {auth === 'optional' && 'API key optional'}
              {auth === 'none' && 'No authentication required'}
            </p>
          </div>

          {/* URL Parameters */}
          {parameters && parameters.length > 0 && (
            <div>
              <h4 className="mb-4 text-sm font-semibold text-white">
                URL Parameters
              </h4>
              <ParameterTable parameters={parameters} />
            </div>
          )}

          {/* Body Parameters */}
          {bodyParameters && bodyParameters.length > 0 && (
            <div>
              <h4 className="mb-4 text-sm font-semibold text-white">
                Request Body
              </h4>
              <ParameterTable parameters={bodyParameters} />
            </div>
          )}

          {/* Response Example */}
          {responseExample && (
            <div>
              <h4 className="mb-4 text-sm font-semibold text-white">
                Response Example
              </h4>
              <CodeBlock code={responseExample} language="json" />
            </div>
          )}

          {/* Code Examples */}
          {codeExamples && (
            <div>
              <h4 className="mb-4 text-sm font-semibold text-white">
                Code Examples
              </h4>
              <TabGroup
                tabs={[
                  ...(codeExamples.curl
                    ? [
                        {
                          label: 'cURL',
                          content: (
                            <CodeBlock
                              code={codeExamples.curl}
                              language="bash"
                            />
                          )
                        }
                      ]
                    : []),
                  ...(codeExamples.javascript
                    ? [
                        {
                          label: 'JavaScript',
                          content: (
                            <CodeBlock
                              code={codeExamples.javascript}
                              language="javascript"
                            />
                          )
                        }
                      ]
                    : []),
                  ...(codeExamples.python
                    ? [
                        {
                          label: 'Python',
                          content: (
                            <CodeBlock
                              code={codeExamples.python}
                              language="python"
                            />
                          )
                        }
                      ]
                    : [])
                ]}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ParameterTable({ parameters }: { parameters: Parameter[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/[0.08]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.08] bg-white/[0.02]">
            <th className="px-4 py-2 text-left font-medium text-white/60">
              Name
            </th>
            <th className="px-4 py-2 text-left font-medium text-white/60">
              Type
            </th>
            <th className="px-4 py-2 text-left font-medium text-white/60">
              Required
            </th>
            <th className="px-4 py-2 text-left font-medium text-white/60">
              Description
            </th>
          </tr>
        </thead>
        <tbody>
          {parameters.map((param) => (
            <tr
              key={param.name}
              className="border-b border-white/[0.05] last:border-0"
            >
              <td className="px-4 py-3">
                <code className="text-purple-400">{param.name}</code>
              </td>
              <td className="px-4 py-3">
                <code className="text-amber-400">{param.type}</code>
              </td>
              <td className="px-4 py-3">
                {param.required ? (
                  <span className="text-red-400">Yes</span>
                ) : (
                  <span className="text-white/40">No</span>
                )}
              </td>
              <td className="px-4 py-3 text-white/70">
                {param.description}
                {param.default && (
                  <span className="text-white/40">
                    {' '}
                    (default: <code>{param.default}</code>)
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
