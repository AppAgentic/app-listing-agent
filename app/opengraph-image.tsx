import { ImageResponse } from 'next/og'

export const alt = 'App Listing Agent — AI operations for the app stores'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#090a08',
          color: '#f5f1df',
          padding: '64px 72px',
          fontFamily: 'Arial, sans-serif',
          border: '1px solid #24261f',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://applistingagent.com/copilot-icon-hires.png"
            alt=""
            width={60}
            height={60}
            style={{ borderRadius: 14 }}
          />
          <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-1px' }}>
            App Listing Agent
          </span>
          <span
            style={{
              marginLeft: 'auto',
              border: '1px solid #34382d',
              borderRadius: 999,
              padding: '10px 16px',
              color: '#c9f27b',
              fontSize: 16,
              letterSpacing: '1px',
            }}
          >
            BUILT FOR AI AGENTS
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 980 }}>
          <span style={{ color: '#c9f27b', fontSize: 20, letterSpacing: '2px', marginBottom: 20 }}>
            APP STORE CONNECT + GOOGLE PLAY
          </span>
          <span style={{ fontSize: 72, lineHeight: 1.02, fontWeight: 700, letterSpacing: '-4px' }}>
            Run your app-store operations with AI.
          </span>
          <span style={{ marginTop: 24, color: '#a7aa9e', fontSize: 27, lineHeight: 1.35 }}>
            Audit, localize, create screenshots, and publish approved changes.
          </span>
        </div>

        <div style={{ display: 'flex', gap: 34, color: '#777b70', fontSize: 18 }}>
          <span>ChatGPT</span>
          <span>Claude</span>
          <span>Codex</span>
          <span>Cursor</span>
          <span style={{ marginLeft: 'auto', color: '#c9f27b' }}>applistingagent.com</span>
        </div>
      </div>
    ),
    size,
  )
}
