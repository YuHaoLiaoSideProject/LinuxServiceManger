import { appendFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const swPath = resolve(__dirname, '../../src/static/sw.js')
appendFileSync(swPath, ';/* service-worker */')
console.log('✅ Post-build: appended service-worker marker to sw.js')
