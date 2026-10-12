#!/usr/bin/env npx tsx
/**
 * Generate sample icons for each style to use in the style selector.
 * These will be saved to public/images/icon-styles/
 */

import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const FAL_GENERATE_URL = 'https://fal.run/fal-ai/nano-banana-pro'

interface StyleConfig {
  name: string
  prompt: string
  filename: string
}

// Simple, direct prompts - avoid "app icon" phrase, keep instructions minimal
const STYLES: StyleConfig[] = [
  // === CLASSIC STYLES ===
  {
    name: 'flat',
    prompt: `White star shape on solid sky blue background. Flat design, no shadows, no gradients, clean geometric. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'flat.png',
  },
  {
    name: '3d',
    prompt: `Purple crystal gem, 3D render, glossy reflective surface, volumetric lighting. Dark purple gradient background. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: '3d.png',
  },
  {
    name: 'minimalist',
    prompt: `Single thin white circle outline on pure black background. Ultra minimal, maximum negative space. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'minimalist.png',
  },
  {
    name: 'gradient',
    prompt: `Abstract flowing glass shape, vibrant orange to pink gradient, modern glassmorphism effect. Gradient background fills entire frame. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'gradient.png',
  },

  // === CHARACTER STYLES ===
  {
    name: 'cute',
    prompt: `Kawaii smiling star character with sparkles, pastel pink and yellow colors, soft rounded shapes. Light pastel gradient background. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'cute.png',
  },
  {
    name: 'mascot',
    prompt: `Friendly robot mascot character with expressive eyes, blue and white colors, cheerful expression. Soft blue gradient background. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'mascot.png',
  },

  // === MODERN STYLES ===
  {
    name: 'glassmorphism',
    prompt: `Frosted glass card with blurred translucent layers, white icon silhouette, subtle reflections. Purple and blue gradient background showing through glass. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'glassmorphism.png',
  },
  {
    name: 'neon',
    prompt: `Glowing neon lightning bolt, bright cyan and pink neon glow effect, cyberpunk style. Dark black-purple background. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'neon.png',
  },
  {
    name: 'duotone',
    prompt: `Bold geometric mountain shape, two-color design using only deep blue and bright coral orange, high contrast, striking. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'duotone.png',
  },
  {
    name: 'clay',
    prompt: `Soft 3D clay heart shape, matte finish, rounded puffy inflated appearance, pastel pink color. Light cream background. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'clay.png',
  },

  // === ARTISTIC STYLES ===
  {
    name: 'watercolor',
    prompt: `Watercolor painted flower, soft organic edges, artistic paint blending, pink and purple hues. Soft white paper texture background. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'watercolor.png',
  },
  {
    name: 'sketch',
    prompt: `Hand-drawn pencil sketch of a lightbulb, organic imperfect lines, black pencil strokes on white. White paper background. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'sketch.png',
  },
  {
    name: 'pixel',
    prompt: `Retro 8-bit pixel art sword, chunky colorful pixels, nostalgic video game style, bright colors. Dark purple pixel background. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'pixel.png',
  },
  {
    name: 'isometric',
    prompt: `3D isometric cube stack, geometric precision, clean 45-degree angles, blue and teal colors. Light gray background. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'isometric.png',
  },

  // === PREMIUM STYLES ===
  {
    name: 'metallic',
    prompt: `Golden metallic shield emblem, polished gold chrome finish, reflective luxury surface, premium feel. Dark navy background. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'metallic.png',
  },
  {
    name: 'geometric',
    prompt: `Abstract geometric composition, overlapping triangles and circles, modern art style, vibrant teal and orange. White background. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'geometric.png',
  },
  {
    name: 'line',
    prompt: `Simple line art camera, single stroke weight outline, minimalist black strokes on white. Clean white background. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'line.png',
  },
  {
    name: 'retro',
    prompt: `70s vintage sun with groovy rays, warm orange yellow and brown retro colors, psychedelic curves. Warm cream background. Square image, background fills entire frame edge to edge, no rounded corners, no border.`,
    filename: 'retro.png',
  },
]

async function generateIcon(prompt: string): Promise<Buffer> {
  const apiKey = process.env.FAL_KEY
  if (!apiKey) {
    throw new Error('FAL_KEY environment variable not set')
  }

  const response = await fetch(FAL_GENERATE_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      num_images: 1,
      resolution: '1K',
      aspect_ratio: '1:1',
      output_format: 'png',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`fal.ai API error: ${response.status} - ${errorText}`)
  }

  const result = await response.json()

  if (!result.images || result.images.length === 0) {
    throw new Error('No image generated')
  }

  const imageUrl = result.images[0].url
  const imageResponse = await fetch(imageUrl)
  return Buffer.from(await imageResponse.arrayBuffer())
}

async function main() {
  console.log(`Generating ${STYLES.length} style sample icons...\n`)

  const outputDir = path.join(__dirname, '../public/images/icon-styles')

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  let successCount = 0
  let failCount = 0

  for (const style of STYLES) {
    console.log(`[${successCount + failCount + 1}/${STYLES.length}] Generating ${style.name}...`)
    console.log(`  Prompt: ${style.prompt.slice(0, 60)}...`)

    try {
      const imageBuffer = await generateIcon(style.prompt)
      const outputPath = path.join(outputDir, style.filename)
      fs.writeFileSync(outputPath, imageBuffer)
      console.log(`  ✓ Saved to: ${outputPath}\n`)
      successCount++
    } catch (error) {
      console.error(`  ✗ Error: ${error instanceof Error ? error.message : 'Unknown error'}\n`)
      failCount++
    }

    // Small delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1500))
  }

  console.log(`\nDone! Generated ${successCount}/${STYLES.length} icons.`)
  if (failCount > 0) {
    console.log(`Failed: ${failCount} icons`)
  }
  console.log('\nRun compress-style-icons.ts to optimize for web.')
}

main()
