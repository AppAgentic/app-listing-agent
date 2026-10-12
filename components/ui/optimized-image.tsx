'use client'

import { useState, useCallback } from 'react'
import { getThumbnailUrl } from '@/lib/utils/image'

interface OptimizedImageProps {
  src: string
  alt: string
  className?: string
  aspectRatio?: string
  useThumbnail?: boolean  // Use thumbnail version (default: true)
  onLoad?: () => void
  onClick?: () => void
}

/**
 * Optimized image component that uses Cloudflare Image Resizing for thumbnails.
 *
 * Features:
 * - Automatic thumbnail URL transformation via Cloudflare
 * - Lazy loading with native browser support
 * - Skeleton placeholder while loading
 * - Fallback to original URL if transformation fails
 * - Smooth fade-in animation on load
 */
export function OptimizedImage({
  src,
  alt,
  className = '',
  aspectRatio,
  useThumbnail = true,
  onLoad,
  onClick,
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [useFallback, setUseFallback] = useState(false)

  const imageSrc = useThumbnail && !useFallback ? getThumbnailUrl(src) : src

  const handleLoad = useCallback(() => {
    setLoaded(true)
    onLoad?.()
  }, [onLoad])

  const handleError = useCallback(() => {
    // If thumbnail failed and we haven't tried fallback yet, try original URL
    if (useThumbnail && !useFallback) {
      setUseFallback(true)
      setLoaded(false)
    } else {
      setError(true)
    }
  }, [useThumbnail, useFallback])

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={aspectRatio ? { aspectRatio } : undefined}
      onClick={onClick}
    >
      {/* Skeleton placeholder */}
      {!loaded && !error && (
        <div className="absolute inset-0 animate-pulse bg-white/5" />
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/5">
          <span className="text-white/30 text-xs">Failed to load</span>
        </div>
      )}

      {!error && (
        <img
          src={imageSrc || src}
          alt={alt}
          className={`w-full h-full object-cover transition-opacity duration-200 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          loading="lazy"
          decoding="async"
          onLoad={handleLoad}
          onError={handleError}
        />
      )}
    </div>
  )
}
