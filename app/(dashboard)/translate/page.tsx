'use client'

import Link from 'next/link'
import { RequireProject } from '@/components/dashboard/require-project'
import { Globe, Languages, Zap, CheckCircle, ArrowRight } from 'lucide-react'

const supportedLocales = [
  { code: 'de-DE', name: 'German', flag: '🇩🇪' },
  { code: 'fr-FR', name: 'French', flag: '🇫🇷' },
  { code: 'es-ES', name: 'Spanish', flag: '🇪🇸' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'zh-Hans', name: 'Chinese (Simplified)', flag: '🇨🇳' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', flag: '🇧🇷' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
]

export default function TranslatePage() {
  return (
    <RequireProject>
      {(project) => (
        <div>
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold text-white">Translate</h1>
              <p className="text-neutral-400 mt-1">
                AI-powered ASO translations for {project.name}
              </p>
            </div>
            <button className="flex items-center gap-2 px-4 py-2.5 bg-white text-black rounded-xl font-medium hover:bg-neutral-200 transition-colors">
              <Languages className="w-4 h-4" />
              Start Translation
            </button>
          </div>

          {/* Stats */}
          <div className="grid gap-4 md:grid-cols-3 mb-8">
            <div className="p-5 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08]">
              <div className="flex items-center gap-3 mb-2">
                <Globe className="w-5 h-5 text-neutral-400" />
                <span className="text-sm text-neutral-400">Supported Languages</span>
              </div>
              <div className="text-2xl font-bold text-white">39+</div>
            </div>
            <div className="p-5 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08]">
              <div className="flex items-center gap-3 mb-2">
                <Zap className="w-5 h-5 text-neutral-400" />
                <span className="text-sm text-neutral-400">Avg. Translation Time</span>
              </div>
              <div className="text-2xl font-bold text-white">&lt; 30s</div>
            </div>
            <div className="p-5 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08]">
              <div className="flex items-center gap-3 mb-2">
                <CheckCircle className="w-5 h-5 text-neutral-400" />
                <span className="text-sm text-neutral-400">ASO Optimized</span>
              </div>
              <div className="text-2xl font-bold text-white">100%</div>
            </div>
          </div>

          {/* Popular Languages */}
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-white mb-4">Popular Languages</h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              {supportedLocales.map((locale) => (
                <div
                  key={locale.code}
                  className="group flex items-center gap-3 p-4 rounded-xl bg-black/40 backdrop-blur-xl border border-white/[0.08] hover:bg-white/[0.04] hover:border-white/[0.15] transition-all cursor-pointer"
                >
                  <span className="text-2xl">{locale.flag}</span>
                  <div className="flex-1">
                    <div className="font-medium text-white">{locale.name}</div>
                    <div className="text-xs text-neutral-500">{locale.code}</div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-neutral-600 group-hover:text-white group-hover:translate-x-1 transition-all" />
                </div>
              ))}
            </div>
          </div>

          {/* Empty State - Recent Translations */}
          <div className="text-center py-16 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08]">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
              <Languages className="w-8 h-8 text-neutral-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">No translations yet</h3>
            <p className="text-neutral-400 mb-6 max-w-sm mx-auto">
              Start translating your app metadata for {project.name}.
            </p>
            <button className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-xl font-medium hover:bg-neutral-200 transition-colors">
              <Languages className="w-4 h-4" />
              Start Translation
            </button>
          </div>
        </div>
      )}
    </RequireProject>
  )
}
