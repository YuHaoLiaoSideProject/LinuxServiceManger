import { writeFileSync } from 'fs'
import { deflateSync } from 'zlib'

// Minimal valid PNG generator
function createPNG(width, height) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8  // bit depth
  ihdrData[9] = 2  // color type (RGB)
  ihdrData[10] = 0 // compression
  ihdrData[11] = 0 // filter
  ihdrData[12] = 0 // interlace
  const ihdr = createChunk('IHDR', ihdrData)
  
  // IDAT chunk (minimal image data: each row: filter byte + RGB pixels)
  const rawData = []
  for (let y = 0; y < height; y++) {
    rawData.push(0) // filter: none
    for (let x = 0; x < width; x++) {
      rawData.push(26, 26, 46) // #1a1a2e (theme color)
    }
  }
  const compressed = deflate(Buffer.from(rawData))
  const idat = createChunk('IDAT', compressed)
  
  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0))
  
  return Buffer.concat([signature, ihdr, idat, iend])
}

function createChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = crc32(Buffer.concat([typeBuffer, data]))
  const crcBuffer = Buffer.alloc(4)
  crcBuffer.writeUInt32BE(crc, 0)
  return Buffer.concat([length, typeBuffer, data, crcBuffer])
}

function crc32(buf) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function deflate(data) {
  return deflateSync(data)
}

const icon192 = createPNG(192, 192)
const icon512 = createPNG(512, 512)

writeFileSync('public/icon-192.png', icon192)
writeFileSync('public/icon-512.png', icon512)

console.log('✅ Generated icon-192.png and icon-512.png')
