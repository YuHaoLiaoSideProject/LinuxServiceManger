import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'
import type { Service } from '../../types/service'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    name: 'test.service',
    load: 'loaded',
    active: 'running',
    sub: 'running',
    locked: false,
    unitFileState: 'enabled',
    fragmentPath: '/etc/systemd/system/test.service',
    ...overrides,
  }
}

const fixtureServices: Service[] = [
  // Systemd uses ActiveState='active' (not 'running') for running services.
  // SubState='running' is what actually indicates a running service.
  makeService({ name: 'nginx.service', active: 'active', sub: 'running' }),
  makeService({ name: 'ssh.service', active: 'active', sub: 'running' }),
  makeService({ name: 'docker.service', active: 'failed', sub: 'failed' }),
  makeService({ name: 'cron.service', active: 'inactive', sub: 'dead' }),
  makeService({ name: 'nginx-exporter.service', active: 'active', sub: 'running' }),
]

// Helper to create a minimal router with a single route so that
// router.replace() / router.currentRoute.value.query work.
function createTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'home', component: { template: '<div></div>' } }],
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useServiceFilter', () => {
  let useServiceFilter: typeof import('../useServiceFilter').useServiceFilter

  beforeEach(async () => {
    vi.resetModules()
    // Re-import the composable fresh for each test (like existing test patterns)
    const mod = await import('../useServiceFilter')
    useServiceFilter = mod.useServiceFilter
  })

  describe('statusFilter', () => {
    it('default value is "all"', () => {
      const services = ref<Service[]>([...fixtureServices])
      const { statusFilter } = useServiceFilter(services)

      expect(statusFilter.value).toBe('all')
    })

    it('setStatusFilter("running") → statusFilter becomes "running"', () => {
      const services = ref<Service[]>([...fixtureServices])
      const { statusFilter, setStatusFilter } = useServiceFilter(services)

      setStatusFilter('running')
      expect(statusFilter.value).toBe('running')
    })

    it('setStatusFilter same value twice → toggles back to "all"', () => {
      const services = ref<Service[]>([...fixtureServices])
      const { statusFilter, setStatusFilter } = useServiceFilter(services)

      setStatusFilter('running')
      expect(statusFilter.value).toBe('running')

      setStatusFilter('running')
      expect(statusFilter.value).toBe('all')
    })

    it('switching to different status → old one deactivates, new one active', () => {
      const services = ref<Service[]>([...fixtureServices])
      const { statusFilter, setStatusFilter } = useServiceFilter(services)

      setStatusFilter('running')
      expect(statusFilter.value).toBe('running')

      setStatusFilter('failed')
      expect(statusFilter.value).toBe('failed')
    })

    it('toggling "all" keeps it as "all"', () => {
      const services = ref<Service[]>([...fixtureServices])
      const { statusFilter, setStatusFilter } = useServiceFilter(services)

      setStatusFilter('all')
      expect(statusFilter.value).toBe('all')

      setStatusFilter('all')
      expect(statusFilter.value).toBe('all')
    })

    it('running filter matches sub===running, not active===active', async () => {
      // Systemd uses ActiveState='active' (not 'running') for running services.
      // A service with active='active' but sub='exited' should NOT match.
      const svcList: Service[] = [
        makeService({ name: 'running.service', active: 'active', sub: 'running' }),
        makeService({ name: 'exited.service', active: 'active', sub: 'exited' }),
        makeService({ name: 'failed.service', active: 'failed', sub: 'failed' }),
        makeService({ name: 'dead.service', active: 'inactive', sub: 'dead' }),
      ]
      const services = ref<Service[]>([...svcList])
      const { filteredServices, setStatusFilter } = useServiceFilter(services)

      setStatusFilter('running')
      await nextTick()

      expect(filteredServices.value).toHaveLength(1)
      expect(filteredServices.value[0].name).toBe('running.service')
    })
  })

  // ====================================================================
  // 2. textSearch (substring, case-insensitive) + debounce
  // ====================================================================
  describe('textSearch', () => {
    it('default searchText is empty string', () => {
      const services = ref<Service[]>([...fixtureServices])
      const { searchText } = useServiceFilter(services)

      expect(searchText.value).toBe('')
    })

    it('empty searchText → no filtering (all services returned)', async () => {
      const services = ref<Service[]>([...fixtureServices])
      const { filteredServices } = useServiceFilter(services)

      await nextTick()
      expect(filteredServices.value).toHaveLength(5)
    })

    it('search "nginx" → only services with "nginx" in name (case-insensitive)', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, filteredServices } = useServiceFilter(services)

      searchText.value = 'nginx'
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      expect(filteredServices.value).toHaveLength(2)
      expect(filteredServices.value.map(s => s.name)).toEqual([
        'nginx.service',
        'nginx-exporter.service',
      ])

      vi.useRealTimers()
    })

    it('search is case-insensitive', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, filteredServices } = useServiceFilter(services)

      searchText.value = 'NGINX'
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      expect(filteredServices.value).toHaveLength(2)
      expect(filteredServices.value.map(s => s.name)).toEqual([
        'nginx.service',
        'nginx-exporter.service',
      ])

      vi.useRealTimers()
    })

    it('debounces 150ms before applying filter', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, filteredServices } = useServiceFilter(services)

      // Type "n" - should not filter yet (before 150ms)
      searchText.value = 'n'
      await nextTick()
      // Only advance 100ms - debounce hasn't fired
      vi.advanceTimersByTime(100)
      await nextTick()

      // Filter should still show all services (debounce hasn't elapsed)
      expect(filteredServices.value).toHaveLength(5)

      // Complete the debounce
      vi.advanceTimersByTime(50)
      await nextTick()

      // Now "n" should be applied (matches nginx, nginx-exporter, cron)
      expect(filteredServices.value).toHaveLength(3)

      vi.useRealTimers()
    })

    it('rapid typing resets debounce timer', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, filteredServices } = useServiceFilter(services)

      // Type "ng"
      searchText.value = 'n'
      await nextTick()
      vi.advanceTimersByTime(50) // 50ms elapsed

      searchText.value = 'ng'
      await nextTick()
      vi.advanceTimersByTime(100) // total 150ms from first, but only 100ms from second
      await nextTick()

      // Still not elapsed since second change
      expect(filteredServices.value).toHaveLength(5)

      vi.advanceTimersByTime(50) // now 150ms from last change
      await nextTick()

      // Now "ng" should match
      expect(filteredServices.value).toHaveLength(2)

      vi.useRealTimers()
    })

    it('clearSearch() → searchText becomes "", full list restored', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, filteredServices, clearSearch } = useServiceFilter(services)

      searchText.value = 'nginx'
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      expect(filteredServices.value).toHaveLength(2)

      clearSearch()
      await nextTick()

      expect(searchText.value).toBe('')
      // After clearSearch, debounced text should also clear immediately
      expect(filteredServices.value).toHaveLength(5)

      vi.useRealTimers()
    })
  })

  // ====================================================================
  // 3. regexMode
  // ====================================================================
  describe('regexMode', () => {
    it('default regexMode is false', () => {
      const services = ref<Service[]>([...fixtureServices])
      const { regexMode } = useServiceFilter(services)

      expect(regexMode.value).toBe(false)
    })

    it('toggleRegex() → true, toggleRegex() again → false', () => {
      const services = ref<Service[]>([...fixtureServices])
      const { regexMode, toggleRegex } = useServiceFilter(services)

      expect(regexMode.value).toBe(false)

      toggleRegex()
      expect(regexMode.value).toBe(true)

      toggleRegex()
      expect(regexMode.value).toBe(false)
    })

    it('valid regex "nginx-.*" filters correctly', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, regexMode, filteredServices, toggleRegex } = useServiceFilter(services)

      toggleRegex()
      expect(regexMode.value).toBe(true)

      searchText.value = 'nginx-.*'
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      expect(filteredServices.value).toHaveLength(1)
      expect(filteredServices.value[0].name).toBe('nginx-exporter.service')

      vi.useRealTimers()
    })

    it('invalid regex "[invalid(regex" → regexError set, list unchanged', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, regexMode, regexError, filteredServices, toggleRegex } = useServiceFilter(services)

      toggleRegex()
      expect(regexMode.value).toBe(true)

      searchText.value = '[invalid(regex'
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      // Access filteredServices first to trigger computed evaluation (lazy computed)
      // List should still contain all services (unchanged)
      expect(filteredServices.value).toHaveLength(5)

      // regexError should be set (non-null)
      expect(regexError.value).not.toBeNull()
      expect(regexError.value).toContain('Invalid regular expression')

      vi.useRealTimers()
    })

    it('turning regex off → regexError cleared', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, regexMode, regexError, filteredServices, toggleRegex } = useServiceFilter(services)

      // First, set an invalid regex
      toggleRegex()
      searchText.value = '[invalid(regex'
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()
      // Access filteredServices to trigger the computed (lazy)
      expect(filteredServices.value).toHaveLength(5)
      expect(regexError.value).not.toBeNull()

      // Turn regex off
      toggleRegex()
      expect(regexMode.value).toBe(false)
      expect(regexError.value).toBeNull()

      vi.useRealTimers()
    })

    it('default regexError is null', () => {
      const services = ref<Service[]>([...fixtureServices])
      const { regexError } = useServiceFilter(services)

      expect(regexError.value).toBeNull()
    })

    it('regex mode with valid regex but no matches returns empty array', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, filteredServices, toggleRegex } = useServiceFilter(services)

      toggleRegex()
      searchText.value = 'zzz-nonexistent-.*'
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      expect(filteredServices.value).toHaveLength(0)

      vi.useRealTimers()
    })

    it('regex with case-insensitive flag (i) works', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, filteredServices, toggleRegex } = useServiceFilter(services)

      toggleRegex()
      searchText.value = 'NGINX'
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      // Regex is created with 'i' flag, so NGINX should match nginx
      expect(filteredServices.value).toHaveLength(2)

      vi.useRealTimers()
    })
  })

  // ====================================================================
  // 4. combined filtering (AND logic)
  // ====================================================================
  describe('combined filtering (AND)', () => {
    it('status=running + search=nginx → intersection', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, filteredServices, setStatusFilter } = useServiceFilter(services)

      setStatusFilter('running')
      searchText.value = 'nginx'
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      // running: nginx, ssh, nginx-exporter
      // name contains "nginx": nginx, nginx-exporter
      // intersection: nginx, nginx-exporter
      expect(filteredServices.value).toHaveLength(2)
      expect(filteredServices.value.map(s => s.name)).toEqual([
        'nginx.service',
        'nginx-exporter.service',
      ])

      vi.useRealTimers()
    })

    it('changing one condition recalculates intersection', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, filteredServices, setStatusFilter } = useServiceFilter(services)

      setStatusFilter('running')
      searchText.value = 'nginx'
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      expect(filteredServices.value).toHaveLength(2)

      // Change status to failed
      setStatusFilter('failed')
      await nextTick()

      // failed: docker
      // name contains "nginx": nginx, nginx-exporter
      // intersection: empty
      expect(filteredServices.value).toHaveLength(0)

      // Change status back to running
      setStatusFilter('running')
      await nextTick()

      expect(filteredServices.value).toHaveLength(2)

      vi.useRealTimers()
    })

    it('setStatusFilter toggling back to "all" clears only status filter', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, filteredServices, setStatusFilter } = useServiceFilter(services)

      searchText.value = 'nginx'
      setStatusFilter('running')
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      expect(filteredServices.value).toHaveLength(2)

      // Toggle "running" back to "all"
      setStatusFilter('running')
      await nextTick()

      // Now only text filter applied: all services with "nginx" in name
      expect(filteredServices.value).toHaveLength(2)
      expect(filteredServices.value.map(s => s.name)).toEqual([
        'nginx.service',
        'nginx-exporter.service',
      ])

      vi.useRealTimers()
    })
  })

  // ====================================================================
  // 5. clearAllFilters
  // ====================================================================
  describe('clearAllFilters', () => {
    it('resets all filters to defaults', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const {
        statusFilter,
        searchText,
        regexMode,
        regexError,
        filteredServices,
        setStatusFilter,
        toggleRegex,
        clearAllFilters,
      } = useServiceFilter(services)

      setStatusFilter('failed')
      searchText.value = 'nginx'
      toggleRegex() // regexMode = true

      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      // Verify filters are active
      expect(statusFilter.value).toBe('failed')
      expect(searchText.value).toBe('nginx')
      expect(regexMode.value).toBe(true)

      clearAllFilters()
      await nextTick()

      expect(statusFilter.value).toBe('all')
      expect(searchText.value).toBe('')
      expect(regexMode.value).toBe(false)
      expect(regexError.value).toBeNull()
      // Full list restored
      expect(filteredServices.value).toHaveLength(5)

      vi.useRealTimers()
    })
  })

  // ====================================================================
  // 6. URL sync
  // ====================================================================
  describe('URL sync', () => {
    it('filter changes → router.replace called with correct query', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const router = createTestRouter()
      await router.push('/')
      const replaceSpy = vi.spyOn(router, 'replace')

      const { searchText, setStatusFilter, toggleRegex } = useServiceFilter(services, router)

      setStatusFilter('running')
      searchText.value = 'nginx'
      toggleRegex()

      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      // router.replace should have been called
      expect(replaceSpy).toHaveBeenCalled()

      // Get the last call arguments
      const lastCall = replaceSpy.mock.calls[replaceSpy.mock.calls.length - 1][0] as {
        query: Record<string, string>
      }
      expect(lastCall.query).toMatchObject({
        status: 'running',
        search: 'nginx',
        regex: 'true',
      })

      vi.useRealTimers()
    })

    it('clearing filters removes query params', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const router = createTestRouter()
      await router.push('/')
      const replaceSpy = vi.spyOn(router, 'replace')

      const { searchText, setStatusFilter, clearAllFilters } = useServiceFilter(services, router)

      setStatusFilter('running')
      searchText.value = 'test'
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      replaceSpy.mockClear()

      clearAllFilters()
      await nextTick()

      expect(replaceSpy).toHaveBeenCalled()
      const lastCall = replaceSpy.mock.calls[replaceSpy.mock.calls.length - 1][0] as {
        query: Record<string, string>
      }
      // All params should be absent (clean query)
      expect(lastCall.query.status).toBeUndefined()
      expect(lastCall.query.search).toBeUndefined()
      expect(lastCall.query.regex).toBeUndefined()

      vi.useRealTimers()
    })

    it('initFromQuery reads route.query and initializes filters', async () => {
      const services = ref<Service[]>([...fixtureServices])
      const router = createTestRouter()

      // Set up route with query params
      await router.push({ query: { status: 'failed', search: 'docker', regex: 'true' } })
      await router.isReady()

      const { statusFilter, searchText, regexMode, initFromQuery } = useServiceFilter(services, router)

      initFromQuery()

      expect(statusFilter.value).toBe('failed')
      expect(searchText.value).toBe('docker')
      expect(regexMode.value).toBe(true)
    })

    it('initFromQuery with no query params keeps defaults', async () => {
      const services = ref<Service[]>([...fixtureServices])
      const router = createTestRouter()
      await router.push('/')
      await router.isReady()

      const { statusFilter, searchText, regexMode, initFromQuery } = useServiceFilter(services, router)

      initFromQuery()

      expect(statusFilter.value).toBe('all')
      expect(searchText.value).toBe('')
      expect(regexMode.value).toBe(false)
    })

    it('initFromQuery with invalid status value ignores it', async () => {
      const services = ref<Service[]>([...fixtureServices])
      const router = createTestRouter()
      await router.push({ query: { status: 'invalid_status', search: 'test' } })
      await router.isReady()

      const { statusFilter, searchText, initFromQuery } = useServiceFilter(services, router)

      initFromQuery()

      // Invalid status should be ignored, default stays 'all'
      expect(statusFilter.value).toBe('all')
      // Valid search should be applied
      expect(searchText.value).toBe('test')
    })

    it('initFromQuery with regex=false keeps regexMode false', async () => {
      const services = ref<Service[]>([...fixtureServices])
      const router = createTestRouter()
      await router.push({ query: { regex: 'false' } })
      await router.isReady()

      const { regexMode, initFromQuery } = useServiceFilter(services, router)

      initFromQuery()

      expect(regexMode.value).toBe(false)
    })

    it('works without router (no URL sync)', async () => {
      // Should not throw when no router is provided
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, filteredServices, setStatusFilter } = useServiceFilter(services)

      // These should work fine without router
      setStatusFilter('running')
      searchText.value = 'nginx'
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      expect(filteredServices.value).toHaveLength(2)

      vi.useRealTimers()
    })

    it('initFromQuery without router does nothing (no throw)', () => {
      const services = ref<Service[]>([...fixtureServices])
      const { initFromQuery } = useServiceFilter(services)

      // Should not throw
      expect(() => initFromQuery()).not.toThrow()
    })
  })

  // ====================================================================
  // 7. Edge cases
  // ====================================================================
  describe('edge cases', () => {
    it('empty services array returns empty filtered', async () => {
      const services = ref<Service[]>([])
      const { filteredServices } = useServiceFilter(services)

      await nextTick()
      expect(filteredServices.value).toHaveLength(0)
    })

    it('search with special regex characters in non-regex mode treats them as literal', async () => {
      vi.useFakeTimers()
      const specialService: Service = makeService({
        name: 'service[test].service',
        active: 'running',
      })
      const services = ref<Service[]>([...fixtureServices, specialService])
      const { searchText, filteredServices } = useServiceFilter(services)

      // In non-regex mode, "[" should be treated as literal character
      searchText.value = 'service[test]'
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      expect(filteredServices.value).toHaveLength(1)
      expect(filteredServices.value[0].name).toBe('service[test].service')

      vi.useRealTimers()
    })

    it('multiple rapid statusFilter toggles work correctly', () => {
      const services = ref<Service[]>([...fixtureServices])
      const { statusFilter, setStatusFilter } = useServiceFilter(services)

      setStatusFilter('running')
      setStatusFilter('failed')
      setStatusFilter('inactive')

      expect(statusFilter.value).toBe('inactive')

      setStatusFilter('inactive')
      expect(statusFilter.value).toBe('all')
    })

    it('reacts to external services array changes', async () => {
      const services = ref<Service[]>([...fixtureServices])
      const { filteredServices } = useServiceFilter(services)

      await nextTick()
      expect(filteredServices.value).toHaveLength(5)

      // Add a new service externally
      services.value = [
        ...fixtureServices,
        makeService({ name: 'new.service', active: 'running' }),
      ]
      await nextTick()

      expect(filteredServices.value).toHaveLength(6)
    })

    it('filters are reactive when services ref content changes', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, filteredServices, setStatusFilter } = useServiceFilter(services)

      setStatusFilter('running')
      searchText.value = 'nginx'
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      expect(filteredServices.value).toHaveLength(2)

      // Replace services list externally
      services.value = [
        makeService({ name: 'nginx.service', active: 'running' }),
        makeService({ name: 'other.service', active: 'running' }),
      ]
      await nextTick()

      // Status filter (running) + text filter (nginx) → 1 result
      expect(filteredServices.value).toHaveLength(1)
      expect(filteredServices.value[0].name).toBe('nginx.service')

      vi.useRealTimers()
    })

    it('clearSearch in regex mode also clears regexError', async () => {
      vi.useFakeTimers()
      const services = ref<Service[]>([...fixtureServices])
      const { searchText, regexError, filteredServices, toggleRegex, clearSearch } = useServiceFilter(services)

      toggleRegex()
      searchText.value = '[invalid(regex'
      await nextTick()
      vi.advanceTimersByTime(150)
      await nextTick()

      // Access filteredServices first to trigger the computed (lazy)
      expect(filteredServices.value).toHaveLength(5)
      expect(regexError.value).not.toBeNull()

      clearSearch()
      await nextTick()

      expect(searchText.value).toBe('')
      // Clearing search should also clear regexError since the invalid term is gone
      // (regexError should be re-evaluated when filtering runs again)
      vi.useRealTimers()
    })
  })
})
