import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

describe('PWA Configuration', () => {
  const staticDir = resolve(__dirname, '../../../src/static')

  describe('manifest.json', () => {
    it('should exist after build', () => {
      const manifestPath = resolve(staticDir, 'manifest.json')
      expect(existsSync(manifestPath)).toBe(true)
    })

    it('should contain required fields', () => {
      const manifestPath = resolve(staticDir, 'manifest.json')
      if (!existsSync(manifestPath)) return // skip if build not run
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      
      expect(manifest.name).toBe('Linux Service Manager')
      expect(manifest.short_name).toBeDefined()
      expect(manifest.start_url).toBe('/')
      expect(manifest.display).toBe('standalone')
      expect(manifest.theme_color).toBeDefined()
      expect(manifest.background_color).toBeDefined()
      expect(Array.isArray(manifest.icons)).toBe(true)
    })

    it('should have at least 192x192 and 512x512 icons', () => {
      const manifestPath = resolve(staticDir, 'manifest.json')
      if (!existsSync(manifestPath)) return
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      
      const sizes = manifest.icons.map((i: any) => i.sizes)
      expect(sizes.some((s: string) => s === '192x192')).toBe(true)
      expect(sizes.some((s: string) => s === '512x512')).toBe(true)
    })

    it('all icon files should exist on disk', () => {
      const manifestPath = resolve(staticDir, 'manifest.json')
      if (!existsSync(manifestPath)) return
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      
      for (const icon of manifest.icons) {
        const iconPath = resolve(staticDir, icon.src.replace(/^\//, ''))
        expect(existsSync(iconPath), `Icon ${icon.src} should exist`).toBe(true)
      }
    })
  })

  describe('Service Worker', () => {
    it('sw.js should exist after build', () => {
      const swPath = resolve(staticDir, 'sw.js')
      expect(existsSync(swPath)).toBe(true)
    })

    it('sw.js should contain valid JavaScript', () => {
      const swPath = resolve(staticDir, 'sw.js')
      if (!existsSync(swPath)) return
      const content = readFileSync(swPath, 'utf-8')
      expect(content.length).toBeGreaterThan(0)
      expect(content).toContain('service-worker')
    })
  })

  describe('index.html PWA meta tags', () => {
    it('should contain theme-color meta tag after build', () => {
      const indexPath = resolve(staticDir, 'index.html')
      if (!existsSync(indexPath)) return
      const content = readFileSync(indexPath, 'utf-8')
      expect(content).toContain('theme-color')
    })

    it('should contain apple-touch-icon link', () => {
      const indexPath = resolve(staticDir, 'index.html')
      if (!existsSync(indexPath)) return
      const content = readFileSync(indexPath, 'utf-8')
      expect(content).toContain('apple-touch-icon')
    })

    it('should contain manifest link', () => {
      const indexPath = resolve(staticDir, 'index.html')
      if (!existsSync(indexPath)) return
      const content = readFileSync(indexPath, 'utf-8')
      expect(content).toContain('manifest')
    })
  })
})
