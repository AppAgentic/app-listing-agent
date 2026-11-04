/**
 * Fazier launch badge (2026-10-26). Fazier's free tier approves a launch
 * only after it detects this badge on our site, so it sits in every public
 * footer. Keep the link plain (no rel="nofollow") and the image at least
 * 120px wide, or auto-detection can fail. CSP allows https://fazier.com in img-src.
 */
export function FazierBadge({ className }: { className?: string }) {
  return (
    <a href="https://fazier.com" target="_blank" className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="https://fazier.com/api/v1//public/badges/launch_badges.svg?badge_type=featured&theme=dark"
        alt="Fazier badge"
        width={160}
        height={38}
        loading="lazy"
        fetchPriority="low"
      />
    </a>
  )
}
