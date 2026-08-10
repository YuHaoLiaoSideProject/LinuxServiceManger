import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import type { Router } from 'vue-router'
import type { Service } from '../types/service'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StatusFilter = 'all' | 'running' | 'failed' | 'inactive'

const VALID_STATUSES: StatusFilter[] = ['all', 'running', 'failed', 'inactive']

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function useServiceFilter(services: Ref<Service[]>, router?: Router) {
  // -- reactive state -------------------------------------------------------

  const statusFilter = ref<StatusFilter>('all')
  const searchText = ref('')
  const regexMode = ref(false)
  const regexError = ref<string | null>(null)

  // Debounced version of searchText — this is what the computed filter reacts to
  const debouncedSearchText = ref('')
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  // Watch searchText for debounce
  watch(searchText, (val) => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debouncedSearchText.value = val
    }, 150)
  })

  // -- computed -------------------------------------------------------------

  const filteredServices = computed<Service[]>(() => {
    let result = services.value

    // 1. Status filter
    if (statusFilter.value !== 'all') {
      result = result.filter(s => s.active === statusFilter.value)
    }

    // 2. Text / regex filter (using debounced text)
    const term = debouncedSearchText.value
    if (term) {
      if (regexMode.value) {
        try {
          const regex = new RegExp(term, 'i')
          result = result.filter(s => regex.test(s.name))
          // Clear error on success — but only if it was previously set.
          // We clear inside the computed because it's derived state.
          regexError.value = null
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          regexError.value = msg
          // When regex is invalid, don't apply text filter — list stays as-is
          // (already filtered only by status above)
        }
      } else {
        const lower = term.toLowerCase()
        result = result.filter(s => s.name.toLowerCase().includes(lower))
        // Clear any stale regex error
        if (regexError.value) regexError.value = null
      }
    } else {
      // No search term — clear regex error if any
      if (regexError.value) regexError.value = null
    }

    return result
  })

  // -- actions --------------------------------------------------------------

  function setStatusFilter(status: StatusFilter): void {
    if (statusFilter.value === status) {
      statusFilter.value = 'all'
    } else {
      statusFilter.value = status
    }
  }

  function clearSearch(): void {
    searchText.value = ''
    debouncedSearchText.value = ''
    regexError.value = null
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  function toggleRegex(): void {
    regexMode.value = !regexMode.value
    if (!regexMode.value) {
      regexError.value = null
    }
  }

  function clearAllFilters(): void {
    statusFilter.value = 'all'
    searchText.value = ''
    debouncedSearchText.value = ''
    regexMode.value = false
    regexError.value = null
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  function initFromQuery(): void {
    if (!router) return
    const query = router.currentRoute.value.query

    if (query.status && typeof query.status === 'string' && VALID_STATUSES.includes(query.status as StatusFilter)) {
      statusFilter.value = query.status as StatusFilter
    }

    if (query.search && typeof query.search === 'string') {
      searchText.value = query.search
      debouncedSearchText.value = query.search
    }

    if (query.regex !== undefined) {
      regexMode.value = query.regex === 'true'
    }
  }

  // -- URL sync -------------------------------------------------------------

  if (router) {
    watch(
      [statusFilter, debouncedSearchText, regexMode],
      () => {
        const query: Record<string, string> = {}

        if (statusFilter.value !== 'all') {
          query.status = statusFilter.value
        }
        if (debouncedSearchText.value) {
          query.search = debouncedSearchText.value
        }
        if (regexMode.value) {
          query.regex = 'true'
        }

        router.replace({ query })
      },
      { deep: false },
    )
  }

  // -- public API -----------------------------------------------------------

  return {
    // reactive state
    statusFilter,
    searchText,
    regexMode,
    regexError,

    // computed
    filteredServices,

    // actions
    setStatusFilter,
    clearSearch,
    toggleRegex,
    clearAllFilters,
    initFromQuery,
  }
}
