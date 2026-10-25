import type { NextConfig } from "next";
import { securityHeaders } from './lib/security/headers'
import { REMOVED_DOCS_REDIRECTS } from './lib/docs/redirects'
import { PUBLIC_DOCS_PATHS } from './lib/docs/public-paths'

const allowedDevOrigins = process.env.NEXT_ALLOWED_DEV_ORIGINS
  ?.split(',')
  .map(origin => origin.trim())
  .filter(Boolean)

const nextConfig: NextConfig = {
  // Enable standalone output for Firebase App Hosting
  output: 'standalone',
  poweredByHeader: false,
  allowedDevOrigins,

  // Security headers
  async headers() {
    return [
      {
        // Apply to all routes
        source: '/:path*',
        headers: securityHeaders,
      },
      // Public docs pages: short-lived and revalidated against the ETag, so agents see edits at
      // once. The same URLs serve markdown on `Accept: text/markdown` (proxy.ts); Next rewrites
      // Vary on pages, so max-age=0 is what keeps shared caches from mixing the two. Internal-only
      // docs keep Next's private default.
      ...PUBLIC_DOCS_PATHS.map(source => ({
        source,
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      })),
    ]
  },

  // Removed docs pages that described a REST API, CLI and SDKs that do not
  // exist, plus the hand-written MCP tool pages (replaced by the generated
  // /docs/mcp/tools reference). Keep old links working.
  async redirects() {
    return REMOVED_DOCS_REDIRECTS.map(([source, destination]) => ({
      source,
      destination,
      permanent: true,
    }))
  },

  // Image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.r2.cloudflarestorage.com',
      },
      {
        protocol: 'https',
        hostname: 'is1-ssl.mzstatic.com',
      },
      {
        protocol: 'https',
        hostname: 'is2-ssl.mzstatic.com',
      },
      {
        protocol: 'https',
        hostname: 'is3-ssl.mzstatic.com',
      },
      {
        protocol: 'https',
        hostname: 'is4-ssl.mzstatic.com',
      },
      {
        protocol: 'https',
        hostname: 'is5-ssl.mzstatic.com',
      },
      {
        protocol: 'https',
        hostname: 'play-lh.googleusercontent.com',
      },
    ],
  },

  // Experimental features
  experimental: {
    // Enable server actions
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  // Ignore TypeScript errors in production builds (handled by CI)
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
