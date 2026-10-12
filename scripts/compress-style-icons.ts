#!/usr/bin/env npx tsx
/**
 * Compress style sample icons for web use
 */

import * as fs from 'fs'
import * as path from 'path'
import sharp from 'sharp'

const ICONS_DIR = path.join(__dirname, '../public/images/icon-styles')

async function compressIcons() {
  const files = fs.readdirSync(ICONS_DIR).filter(f => f.endsWith('.png'))

  for (const file of files) {
    const inputPath = path.join(ICONS_DIR, file)
    const outputPath = path.join(ICONS_DIR, file)

    const originalSize = fs.statSync(inputPath).size

    // Resize to 200x200 and compress
    const buffer = await sharp(inputPath)
      .resize(200, 200, { fit: 'cover' })
      .png({ quality: 85, compressionLevel: 9 })
      .toBuffer()

    fs.writeFileSync(outputPath, buffer)

    const newSize = buffer.length
    const reduction = ((1 - newSize / originalSize) * 100).toFixed(1)

    console.log(`${file}: ${(originalSize / 1024).toFixed(0)}KB → ${(newSize / 1024).toFixed(0)}KB (${reduction}% reduction)`)
  }

  console.log('\nDone!')
}

compressIcons()
