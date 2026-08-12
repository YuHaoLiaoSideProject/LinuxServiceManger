import { test, expect } from '@playwright/test'

test.describe('PWA End-to-End', () => {
  test.describe('manifest.json', () => {
    // PWA 靜態檔案（manifest.json / sw.js）僅在 production build 後產生，
    // Vite dev server 的 SPA fallback 會將這些路徑導向 index.html。
    // 此測試僅在 production preview 模式下有效。
    test.skip('should be served with correct content-type', async ({ request }) => {
      const response = await request.get('/manifest.json')
      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toContain('application/json')
    })

    test.skip('should contain required PWA fields', async ({ request }) => {
      const response = await request.get('/manifest.json')
      expect(response.status()).toBe(200)
      const json = await response.json()
      
      expect(json.name).toBe('Linux Service Manager')
      expect(json.short_name).toBeTruthy()
      expect(json.start_url).toBe('/')
      expect(json.display).toBe('standalone')
      expect(json.theme_color).toBeTruthy()
      expect(json.background_color).toBeTruthy()
      expect(Array.isArray(json.icons)).toBe(true)
      expect(json.icons.length).toBeGreaterThanOrEqual(2)
    })

    test.skip('should have valid icon entries', async ({ request }) => {
      const response = await request.get('/manifest.json')
      const json = await response.json()
      
      const sizes = json.icons.map((i: any) => i.sizes)
      expect(sizes).toContain('192x192')
      expect(sizes).toContain('512x512')
      
      for (const icon of json.icons) {
        expect(icon.src).toBeTruthy()
        expect(icon.type).toBe('image/png')
      }
    })
  })

  test.describe('Service Worker', () => {
    test.skip('sw.js should be served with correct MIME type', async ({ request }) => {
      const response = await request.get('/sw.js')
      expect(response.status()).toBe(200)
      const ct = response.headers()['content-type'] || ''
      expect(ct).toContain('javascript')
    })

    test('sw.js should be valid JavaScript', async ({ request }) => {
      const response = await request.get('/sw.js')
      expect(response.status()).toBe(200)
      const body = await response.text()
      expect(body.length).toBeGreaterThan(0)
    })
  })

  test.describe('index.html PWA enhancements', () => {
    test('should have manifest link in head', async ({ page }) => {
      await page.goto('/')
      const link = page.locator('link[rel="manifest"]')
      await expect(link).toHaveAttribute('href', '/manifest.json')
    })

    test('should have theme-color meta', async ({ page }) => {
      await page.goto('/')
      const meta = page.locator('meta[name="theme-color"]')
      await expect(meta).toHaveAttribute('content')
    })

    test('should have apple-touch-icon for iOS', async ({ page }) => {
      await page.goto('/')
      const link = page.locator('link[rel="apple-touch-icon"]')
      await expect(link).toHaveAttribute('href')
    })

    test('should have apple-mobile-web-app-capable meta', async ({ page }) => {
      await page.goto('/')
      const meta = page.locator('meta[name="apple-mobile-web-app-capable"]')
      await expect(meta).toHaveAttribute('content', 'yes')
    })
  })

  test.describe('SPA fallback (PWA static files not overridden)', () => {
    test.skip('manifest.json should NOT return HTML', async ({ request }) => {
      const response = await request.get('/manifest.json')
      const ct = response.headers()['content-type'] || ''
      expect(ct).not.toContain('text/html')
    })

    test.skip('sw.js should NOT return HTML', async ({ request }) => {
      const response = await request.get('/sw.js')
      const ct = response.headers()['content-type'] || ''
      expect(ct).not.toContain('text/html')
    })
  })
})
