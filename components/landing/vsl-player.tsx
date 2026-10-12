'use client'

import { useRef, useState } from 'react'
import { Play } from 'lucide-react'

const VSL_BASE = 'https://screens.appstorecopilot.com/marketing/vsl/v6'

/**
 * Landing-page video sales letter. Click-to-play with sound (autoplay would have to be muted, and
 * the voiceover is the point). 720p on narrow screens, 1080p otherwise; files live on the R2 CDN.
 */
export function VslPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)

  const start = () => {
    const video = videoRef.current
    if (!video) return
    setStarted(true)
    void video.play().catch(() => setStarted(false))
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/[0.1] bg-black shadow-2xl shadow-purple-500/10">
      <video
        ref={videoRef}
        className="h-full w-full"
        poster={`${VSL_BASE}/poster.jpg`}
        preload="metadata"
        playsInline
        controls={started}
        aria-label="App Listing Agent in 85 seconds"
      >
        <source src={`${VSL_BASE}/app-listing-agent-720.mp4`} type="video/mp4" media="(max-width: 768px)" />
        <source src={`${VSL_BASE}/app-listing-agent-1080.mp4`} type="video/mp4" />
      </video>
      {!started && (
        <button
          type="button"
          onClick={start}
          className="group absolute inset-0 flex items-center justify-center bg-black/10 transition-colors hover:bg-black/0"
          aria-label="Play video with sound"
        >
          <span className="flex items-center gap-2.5 rounded-full bg-white px-4 py-2.5 text-[13px] sm:gap-3 sm:px-6 sm:py-3.5 sm:text-[15px] font-bold text-black shadow-[0_10px_40px_rgba(0,0,0,0.45)] transition-transform group-hover:scale-105 group-active:scale-95">
            <Play className="h-4 w-4 fill-black sm:h-5 sm:w-5" aria-hidden="true" />
            Watch the 85-second demo
          </span>
        </button>
      )}
    </div>
  )
}
