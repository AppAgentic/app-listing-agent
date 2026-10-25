import { AlertCircle, AlertTriangle, CheckCircle, Info, Lightbulb } from 'lucide-react'

type CalloutType = 'info' | 'warning' | 'error' | 'success' | 'tip'

interface CalloutProps {
  type?: CalloutType
  title?: string
  children: React.ReactNode
}

const styles: Record<
  CalloutType,
  { icon: typeof Info; bg: string; border: string; iconColor: string }
> = {
  info: {
    icon: Info,
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    iconColor: 'text-blue-400'
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    iconColor: 'text-amber-400'
  },
  error: {
    icon: AlertCircle,
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    iconColor: 'text-red-400'
  },
  success: {
    icon: CheckCircle,
    bg: 'bg-green-500/10',
    border: 'border-green-500/30',
    iconColor: 'text-green-400'
  },
  tip: {
    icon: Lightbulb,
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    iconColor: 'text-purple-400'
  }
}

export function Callout({ type = 'info', title, children }: CalloutProps) {
  const { icon: Icon, bg, border, iconColor } = styles[type]

  return (
    <div
      className={`my-6 flex gap-3 rounded-xl border ${border} ${bg} p-4`}
      role="alert"
      data-callout={type}
    >
      <Icon className={`h-5 w-5 flex-shrink-0 ${iconColor}`} />
      <div className="flex-1 space-y-1">
        {title && (
          <p className={`font-medium ${iconColor}`} data-callout-title="">{title}</p>
        )}
        <div className="text-sm text-white/70 [&>p]:mb-2 last:[&>p]:mb-0">
          {children}
        </div>
      </div>
    </div>
  )
}
