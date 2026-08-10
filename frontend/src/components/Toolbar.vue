<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../composables/useI18n'
import type { StatusFilter } from '../composables/useServiceFilter'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  statusFilter: StatusFilter
  searchText: string
  regexMode: boolean
  regexError: string | null
  filteredCount: number
  loading: boolean
}>(), {
  statusFilter: 'all',
  regexError: null,
})

const emit = defineEmits<{
  'update:searchText': [value: string]
  'set-status-filter': [status: StatusFilter]
  'toggle-regex': []
  'clear-search': []
}>()

const statusOptions: { value: StatusFilter; label: string; icon: string }[] = [
  { value: 'all', label: 'All', icon: '' },
  { value: 'running', label: 'Running', icon: '🟢' },
  { value: 'failed', label: 'Failed', icon: '🔴' },
  { value: 'inactive', label: 'Inactive', icon: '⚪' },
]

const placeholderText = computed(() => {
  return props.regexMode ? '正則搜尋，例如：nginx-.*' : t('search.placeholder')
})

function onSearchInput(e: Event) {
  emit('update:searchText', (e.target as HTMLInputElement).value)
}

function onClear() {
  emit('clear-search')
}

function onToggleRegex() {
  emit('toggle-regex')
}

function onStatusClick(status: StatusFilter) {
  emit('set-status-filter', status)
}
</script>

<template>
  <div class="toolbar">
    <div class="status-filters">
      <button
        v-for="opt in statusOptions"
        :key="opt.value"
        class="btn btn-status"
        :class="{ active: statusFilter === opt.value }"
        :disabled="loading"
        @click="onStatusClick(opt.value)"
      >
        <span v-if="opt.icon" class="status-btn-icon">{{ opt.icon }}</span>
        {{ opt.label }}
      </button>
    </div>
    <div class="search-wrap">
      <span class="search-icon">🔍</span>
      <input
        type="search"
        :value="searchText"
        :placeholder="placeholderText"
        :aria-label="t('search.aria')"
        @input="onSearchInput"
        autocomplete="off"
      />
      <button
        class="btn-regex"
        :class="{ active: regexMode }"
        :disabled="loading"
        @click="onToggleRegex"
        title="正則表達式搜尋"
      >.*</button>
      <button
        v-show="searchText.length > 0"
        class="search-clear visible"
        @click="onClear"
        :aria-label="t('search.clear.aria')"
        :title="t('search.clear.title')"
      >✕</button>
    </div>
    <div v-if="regexError" class="regex-error">{{ regexError }}</div>
    <div class="filtered-count">{{ filteredCount }} 個服務</div>
  </div>
</template>
