'use client'

import { ApiKeyDisplay } from '@/components/dashboard/api-key-display'
import { ApiKeysManager } from '@/components/dashboard/api-keys-manager'
import { UsageDisplay } from '@/components/dashboard/usage-display'
import { StoreCredentials } from '@/components/dashboard/store-credentials'
import { Settings, Key, Sparkles, Building2, Store, Terminal } from 'lucide-react'
import { DeleteAccountSection } from '@/components/dashboard/delete-account-section'
import { OAuthAccessManager } from '@/components/dashboard/oauth-access-manager'
import { appOrigin } from '@/lib/routing/app-url'

// Client bundle: NEXT_PUBLIC_APP_URL must be read literally so Next inlines it at build time.
const APP_ORIGIN = appOrigin({ NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL })

interface SettingsContentProps {
  data: {
    apiKey: string | undefined
    plan: string | undefined
    limits: any
    usage: {
      translations: number
      screenshots: number
      uploads: number
    }
    organizationName: string | undefined
    appStoreConnected: boolean
    playStoreConnected: boolean
    email: string
  }
  internalAccess: boolean
}

export function SettingsContent({ data, internalAccess }: SettingsContentProps) {
  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-neutral-400 mt-1">Manage your account and API access</p>
      </div>

      {/* Plan & Usage Card */}
      <div className="rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08] p-6 mb-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-neutral-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Plan & Usage</h2>
            <p className="text-sm text-neutral-500">Your current plan and monthly usage</p>
          </div>
        </div>

        <div className="flex items-center gap-6 mb-6 pb-6 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">Current Plan:</span>
            <span className="px-3 py-1 rounded-lg bg-white/[0.05] text-white text-sm font-medium border border-white/[0.1] capitalize">
              {data.plan}
            </span>
          </div>
          {data.organizationName && (
            <>
              <div className="h-5 w-px bg-white/[0.08]" />
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-neutral-400" />
                <span className="text-neutral-400">Organization:</span>
                <span className="text-white font-medium">{data.organizationName}</span>
              </div>
            </>
          )}
        </div>

        <UsageDisplay usage={data.usage} limits={data.limits} />
      </div>

      {/* Legacy API key is retained only for allowlisted company accounts during migration. */}
      {internalAccess && data.apiKey && (
      <div className="rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08] p-6 mb-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
            <Key className="w-5 h-5 text-neutral-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">API Key</h2>
            <p className="text-sm text-neutral-500">Use this key to authenticate with the MCP server</p>
          </div>
        </div>

        <ApiKeyDisplay apiKey={data.apiKey || ''} />

        <div className="mt-6 p-4 rounded-xl bg-black/40 border border-white/[0.08]">
          <h3 className="font-medium text-white mb-3 flex items-center gap-2">
            <Settings className="w-4 h-4 text-neutral-400" />
            Claude Code Configuration
          </h3>
          <pre className="text-sm text-neutral-400 overflow-x-auto font-mono leading-relaxed">
{`{
  "mcpServers": {
    "applistingagent": {
      "url": "${APP_ORIGIN}/api/mcp",
      "headers": {
        "Authorization": "Bearer ${data.apiKey || 'YOUR_API_KEY'}"
      }
    }
  }
}`}
          </pre>
        </div>
      </div>
      )}

      {/* Scoped agent/API keys */}
      <div className="rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08] p-6 mb-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
            <Terminal className="w-5 h-5 text-neutral-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Agent &amp; API Keys</h2>
            <p className="text-sm text-neutral-500">Create scoped keys for your AI agent and automated workflows</p>
          </div>
        </div>

        <ApiKeysManager plan={data.plan || 'starter'} />
        <OAuthAccessManager />
      </div>

      {/* Store Credentials Card */}
      <div className="rounded-2xl bg-black/40 backdrop-blur-xl border border-white/[0.08] p-6 mb-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center">
            <Store className="w-5 h-5 text-neutral-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Store Credentials</h2>
            <p className="text-sm text-neutral-500">Connect your App Store and Play Store accounts</p>
          </div>
        </div>

        <StoreCredentials
          appStoreConnected={data.appStoreConnected}
          playStoreConnected={data.playStoreConnected}
        />
      </div>

      <DeleteAccountSection email={data.email} />

    </div>
  )
}
