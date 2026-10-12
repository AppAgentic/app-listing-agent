import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { getClientIp } from '@/lib/api/client-ip'

const req = (headers: Record<string, string>) => new NextRequest('https://applistingagent.com/api/x', { headers })

describe('getClientIp', () => {
  it('prefers the App Hosting client IP over a client-supplied X-Forwarded-For', () => {
    expect(getClientIp(req({ 'x-fah-client-ip': '198.51.100.7', 'x-forwarded-for': '203.0.113.1, 198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('falls back to X-Forwarded-For, then X-Real-IP, off App Hosting', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' }))).toBe('203.0.113.1')
    expect(getClientIp(req({ 'x-real-ip': '203.0.113.2' }))).toBe('203.0.113.2')
    expect(getClientIp(req({}))).toBe('unknown')
  })
})
