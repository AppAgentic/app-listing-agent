'use client'

import { Coins, AlertTriangle, CheckCircle2, Sparkles, TrendingUp } from 'lucide-react'
import { CreditEstimate } from '../WizardContext'

interface CreditBreakdownProps {
  credits: CreditEstimate | null
  isLoading?: boolean
}

export function CreditBreakdown({ credits, isLoading }: CreditBreakdownProps) {
  if (isLoading) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-white/[0.03] to-transparent border border-white/[0.08] p-5 animate-pulse">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-white/[0.1]" />
          <div className="h-4 bg-white/[0.1] rounded w-32" />
        </div>
        <div className="space-y-3">
          <div className="h-10 bg-white/[0.05] rounded-xl" />
          <div className="h-10 bg-white/[0.05] rounded-xl" />
          <div className="h-2 bg-white/[0.05] rounded-full mt-4" />
        </div>
      </div>
    )
  }

  if (!credits) {
    return null
  }

  const usagePercentage = Math.min(100, ((credits.limit - credits.remaining + credits.total) / credits.limit) * 100)
  const willExceed = credits.wouldExceedLimit || !credits.allowed
  const isNearLimit = usagePercentage > 80

  return (
    <div className="rounded-2xl bg-gradient-to-br from-white/[0.03] to-transparent border border-white/[0.08] p-5">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
          <Coins className="w-4 h-4 text-purple-400" />
        </div>
        <h4 className="text-sm font-semibold text-white">Credit Breakdown</h4>
      </div>

      <div className="space-y-4">
        {/* Line items */}
        <div className="space-y-2">
          {credits.screenshotGeneration > 0 && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-blue-400" />
                </div>
                <span className="text-sm text-neutral-300">Screenshot generation</span>
              </div>
              <span className="text-sm font-semibold text-white">{credits.screenshotGeneration}</span>
            </div>
          )}
          {credits.variantGeneration > 0 && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-purple-400" />
                </div>
                <span className="text-sm text-neutral-300">Variant generation</span>
              </div>
              <span className="text-sm font-semibold text-white">{credits.variantGeneration}</span>
            </div>
          )}
        </div>

        {/* Total */}
        <div className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-purple-500/10 to-blue-500/5 border border-purple-500/20">
          <span className="text-sm font-medium text-white">Total credits</span>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-white">{credits.total}</span>
            <span className="text-xs text-neutral-500">credits</span>
          </div>
        </div>

        {/* Usage bar */}
        <div className="pt-2">
          <div className="flex justify-between text-xs text-neutral-500 mb-2">
            <span>Monthly usage</span>
            <span className="tabular-nums">
              {credits.limit - credits.remaining + credits.total} / {credits.limit}
            </span>
          </div>
          <div className="h-2.5 bg-white/[0.05] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                willExceed
                  ? 'bg-red-500'
                  : isNearLimit
                  ? 'bg-yellow-500'
                  : 'bg-gradient-to-r from-purple-500 to-blue-500'
              }`}
              style={{ width: `${usagePercentage}%` }}
            />
          </div>
          <div className="flex justify-between items-center mt-2">
            <span className="text-xs text-neutral-500">
              {credits.remaining} remaining
            </span>
            {!willExceed && credits.remaining >= credits.total && (
              <span className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Within limits
              </span>
            )}
          </div>
        </div>

        {/* Hard-limit warning */}
        {willExceed && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20 animate-fade-in">
            <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-4 h-4 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-yellow-400">
                Not enough credits for this generation
              </p>
              <p className="text-xs text-yellow-400/70 mt-1">
                Choose fewer outputs or upgrade your plan before generating.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
