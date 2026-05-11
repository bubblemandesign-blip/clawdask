// =============================================================
// ClawdAsk — Icon Generator
// Converts build/icon.png to build/icon.ico for Windows builds
// Run with: node scripts/generate-icon.js
// =============================================================

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const buildDir = path.join(__dirname, '..', 'build')
const iconPng = path.join(buildDir, 'icon.png')
const iconIco = path.join(buildDir, 'icon.ico')

if (!fs.existsSync(iconPng)) {
  console.error('❌ build/icon.png not found. Place the ClawdAsk logo PNG there first.')
  process.exit(1)
}

// Try png2icons (node), fallback to ImageMagick (system)
try {
  const png2icons = require('png2icons')
  const input = fs.readFileSync(iconPng)
  const output = png2icons.createICO(input, png2icons.BILINEAR, 0, false, true)
  if (output) {
    fs.writeFileSync(iconIco, output)
    console.log('✅ build/icon.ico generated successfully')
  }
} catch {
  // Fallback: use magick CLI if installed
  try {
    execSync(`magick convert "${iconPng}" -define icon:auto-resize=256,128,64,48,32,16 "${iconIco}"`)
    console.log('✅ build/icon.ico generated via ImageMagick')
  } catch {
    console.warn('⚠️  Could not auto-generate .ico. Install ImageMagick or run: npm install --save-dev png2icons')
  }
}
