import { readBoundedJson } from '@/lib/api/bounded-body'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const requestSchema = z.object({
  appIdOrUrl: z.string().min(1),
})

interface ITunesResult {
  trackId: number
  trackName: string
  artworkUrl512?: string
  artworkUrl100?: string
  screenshotUrls?: string[]
  ipadScreenshotUrls?: string[]
  appletvScreenshotUrls?: string[]
  sellerName?: string
  primaryGenreName?: string
  trackViewUrl?: string
}

// Scrape screenshots from App Store web page as fallback
async function scrapeAppStoreScreenshots(appId: string): Promise<{ url: string; type: 'iphone' | 'ipad' }[]> {
  try {
    const url = `https://apps.apple.com/us/app/id${appId}`
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    })

    if (!response.ok) {
      console.error(`App Store page fetch failed: ${response.status}`)
      return []
    }

    const html = await response.text()
    const screenshots: { url: string; type: 'iphone' | 'ipad' }[] = []

    // Extract screenshot paths from HTML - looking for PurpleSource patterns
    // Pattern: thumb/PurpleSource{num}/v4/{uuid-parts}/{number}.png
    const screenshotPattern = /thumb\/PurpleSource\d+\/v4\/[a-f0-9\-\/]+\/\d+\.png/gi
    const matches = html.match(screenshotPattern) || []

    // Get unique paths
    const seen = new Set<string>()
    for (const match of matches) {
      if (seen.has(match)) continue
      seen.add(match)

      // Build full URL with a good resolution (600x1300 works well for phone screenshots)
      const fullUrl = `https://is1-ssl.mzstatic.com/image/${match}/600x1300bb.jpg`

      screenshots.push({
        url: fullUrl,
        type: 'iphone', // Default to iPhone, could detect iPad from path if needed
      })
    }

    console.log(`[Scrape] Found ${screenshots.length} screenshots for app ${appId}`)
    return screenshots.slice(0, 10)
  } catch (error) {
    console.error('App Store scrape error:', error)
    return []
  }
}

export async function POST(request: NextRequest) {
  let body
  try {
    body = requestSchema.parse(await readBoundedJson(request))
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { appIdOrUrl } = body

  // Extract app ID from URL or use directly
  const appIdMatch = appIdOrUrl.match(/id(\d+)/) || appIdOrUrl.match(/^(\d+)$/)
  if (!appIdMatch) {
    return Response.json({ error: 'Invalid App Store URL or ID' }, { status: 400 })
  }
  const appId = appIdMatch[1]

  try {
    // Fetch from iTunes API (public, no auth required)
    const response = await fetch(`https://itunes.apple.com/lookup?id=${appId}`)

    if (!response.ok) {
      return Response.json({ error: 'Failed to fetch from iTunes API' }, { status: 500 })
    }

    const data = await response.json()

    if (!data.results || data.results.length === 0) {
      return Response.json({ error: 'App not found in App Store' }, { status: 404 })
    }

    const app = data.results[0] as ITunesResult

    // Collect all screenshots from iTunes API
    let screenshots: { url: string; type: 'iphone' | 'ipad' | 'appletv' }[] = []

    // iPhone screenshots (most common)
    if (app.screenshotUrls?.length) {
      for (const url of app.screenshotUrls) {
        screenshots.push({ url, type: 'iphone' })
      }
    }

    // iPad screenshots
    if (app.ipadScreenshotUrls?.length) {
      for (const url of app.ipadScreenshotUrls) {
        screenshots.push({ url, type: 'ipad' })
      }
    }

    // Apple TV screenshots (rare but included)
    if (app.appletvScreenshotUrls?.length) {
      for (const url of app.appletvScreenshotUrls) {
        screenshots.push({ url, type: 'appletv' })
      }
    }

    // If iTunes API returns no screenshots, try scraping the App Store page
    if (screenshots.length === 0) {
      console.log(`[iTunes] No screenshots from API for ${appId}, trying web scrape...`)
      const scrapedScreenshots = await scrapeAppStoreScreenshots(appId)
      if (scrapedScreenshots.length > 0) {
        console.log(`[iTunes] Found ${scrapedScreenshots.length} screenshots via scrape`)
        screenshots = scrapedScreenshots
      }
    }

    return Response.json({
      success: true,
      app: {
        id: app.trackId,
        name: app.trackName,
        iconUrl: app.artworkUrl512 || app.artworkUrl100?.replace('100x100', '512x512'),
        developer: app.sellerName,
        category: app.primaryGenreName,
      },
      screenshots,
    })
  } catch (error) {
    console.error('iTunes API error:', error)
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch app data' },
      { status: 500 }
    )
  }
}
