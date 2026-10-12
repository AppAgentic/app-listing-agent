'use client'

import { useEffect, useRef } from 'react'

interface StarfieldProps {
  mode?: 'float' | 'warp'
  /** Duration in ms to transition from float to warp (only applies when mode='warp') */
  transitionDuration?: number
}

export default function Starfield({ mode = 'float', transitionDuration = 2000 }: StarfieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number
    let stars: Star[] = []
    let startTime = Date.now()

    interface Star {
      x: number
      y: number
      z: number
      size: number
      opacity: number
    }

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    const createStars = (count: number) => {
      stars = []
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * canvas.width - canvas.width / 2,
          y: Math.random() * canvas.height - canvas.height / 2,
          z: Math.random() * 1000,
          size: Math.random() * 1.5 + 0.5,
          opacity: Math.random() * 0.5 + 0.5
        })
      }
    }

    const easeOutCubic = (t: number): number => {
      return 1 - Math.pow(1 - t, 3)
    }

    const getCurrentSpeed = (): number => {
      const floatSpeed = 0.5
      const warpSpeed = 15

      if (mode === 'float') {
        return floatSpeed
      }

      // If no transition, immediately use warp speed
      if (transitionDuration <= 0) {
        return warpSpeed
      }

      // Calculate transition progress
      const elapsed = Date.now() - startTime
      const progress = Math.min(1, elapsed / transitionDuration)
      const easedProgress = easeOutCubic(progress)

      // Interpolate between float and warp speed
      return floatSpeed + (warpSpeed - floatSpeed) * easedProgress
    }

    const getTrailLength = (): number => {
      if (mode === 'float') return 0

      // If no transition, full trail immediately
      if (transitionDuration <= 0) {
        return 1
      }

      const elapsed = Date.now() - startTime
      const progress = Math.min(1, elapsed / transitionDuration)
      const easedProgress = easeOutCubic(progress)

      return easedProgress
    }

    const drawStar = (star: Star, prevX?: number, prevY?: number, trailIntensity?: number) => {
      const centerX = canvas.width / 2
      const centerY = canvas.height / 2

      const scale = 1000 / (star.z + 1)
      const x = star.x * scale + centerX
      const y = star.y * scale + centerY

      if (x < 0 || x > canvas.width || y < 0 || y > canvas.height) return

      const size = star.size * scale * 0.5
      const opacity = Math.min(1, star.opacity * (1 - star.z / 1000))

      // Draw trail for warp effect (intensity based on transition progress)
      if (prevX !== undefined && prevY !== undefined && trailIntensity && trailIntensity > 0.1 &&
          isFinite(prevX) && isFinite(prevY) && isFinite(x) && isFinite(y)) {
        const gradient = ctx.createLinearGradient(prevX, prevY, x, y)
        gradient.addColorStop(0, `rgba(255, 255, 255, 0)`)
        gradient.addColorStop(1, `rgba(255, 255, 255, ${opacity * trailIntensity})`)

        ctx.beginPath()
        ctx.strokeStyle = gradient
        ctx.lineWidth = size * (1 + trailIntensity)
        ctx.moveTo(prevX, prevY)
        ctx.lineTo(x, y)
        ctx.stroke()
      }

      // Draw star point
      ctx.beginPath()
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fill()
    }

    const animate = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const speed = getCurrentSpeed()
      const trailIntensity = getTrailLength()
      const centerX = canvas.width / 2
      const centerY = canvas.height / 2

      stars.forEach(star => {
        // Store previous position for trails
        const prevScale = 1000 / (star.z + 1)
        const prevX = star.x * prevScale + centerX
        const prevY = star.y * prevScale + centerY

        // Move star towards viewer
        star.z -= speed

        // Reset star when it passes the viewer
        if (star.z <= 0) {
          star.z = 1000
          star.x = Math.random() * canvas.width - canvas.width / 2
          star.y = Math.random() * canvas.height - canvas.height / 2
        }

        drawStar(star, prevX, prevY, trailIntensity)
      })

      animationId = requestAnimationFrame(animate)
    }

    resize()
    createStars(mode === 'warp' ? 400 : 200)

    // Clear canvas initially
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    animate()

    const handleResize = () => {
      resize()
      createStars(mode === 'warp' ? 400 : 200)
    }

    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener('resize', handleResize)
    }
  }, [mode, transitionDuration])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-0 pointer-events-none"
      style={{ background: 'black' }}
    />
  )
}
