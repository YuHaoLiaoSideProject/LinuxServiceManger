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
  totalCount?: number
  counts?: Partial<Record<StatusFilter, number>>
  loading: boolean
  showRefresh?: boolean
}>(), {
  statusFilter: 'all',
  regexError: null,
  showRefresh: false,
  totalCount: 0,
  counts: () => ({ all: 0, running: 0, failed: 0, inactive: 0 }),
})

const emit = defineEmits<{
  'update:searchText': [value: string]
  'set-status-filter': [status: StatusFilter]
  'toggle-regex': []
  'clear-search': []
  'refresh': []
}>()

const statusOptions: { value: StatusFilter; i18nKey: string; dot: string }[] = [
  { value: 'all', i18nKey: 'filter.all', dot: 'all' },
  { value: 'running', i18nKey: 'filter.running', dot: 'run' },
  { value: 'failed', i18nKey: 'filter.failed', dot: 'fail' },
  { value: 'inactive', i18nKey: 'filter.inactive', dot: 'inact' },
]

function statusCount(value: StatusFilter): number {
  return props.counts?.[value] ?? 0
}

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
    <!-- 狀態過濾 pill 群組（radio 行為，aria-pressed 同步） -->
    <div class="status-filters" role="group" aria-label="狀態過濾">
      <button
        v-for="opt in statusOptions"
        :key="opt.value"
        class="btn btn-status"
        :class="{ active: statusFilter === opt.value }"
        :disabled="loading"
        :aria-pressed="statusFilter === opt.value"
        @click="onStatusClick(opt.value)"
      >
        <span class="dotp" :class="opt.dot" aria-hidden="true"></span>
        <span>{{ t(opt.i18nKey) }}</span>
        <b class="cnt" aria-hidden="true">{{ statusCount(opt.value) }}</b>
      </button>
    </div>

    <!-- 搜尋框：SVG 放大鏡 + clear + regex 開關 -->
    <div
      class="search-wrap"
      :class="{ 'has-value': searchText.length > 0, error: !!regexError }"
    >
      <svg class="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7"></circle>
        <path d="M21 21l-4.3-4.3"></path>
      </svg>
      <input
        type="search"
        id="service-search"
        name="service-search"
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
        :aria-pressed="regexMode"
        :title="t('search.regex.title')"
        @click="onToggleRegex"
      >.*</button>
      <button
        v-show="searchText.length > 0"
        class="search-clear visible"
        @click="onClear"
        :aria-label="t('search.clear.aria')"
        :title="t('search.clear.title')"
      >✕</button>
      <span v-if="regexError" class="regex-error" role="alert">{{ regexError }}</span>
    </div>

    <!-- 計數：顯示 X / 共 Y -->
    <div class="filtered-count">
      <span>{{ t('filter.count.shown') }} <b>{{ filteredCount }}</b> {{ t('filter.count.total') }} <b>{{ totalCount }}</b></span>
    </div>

    <button
      v-if="showRefresh"
      class="btn-refresh secondary"
      data-testid="btn-refresh"
      :disabled="loading"
      :class="{ loading }"
      :aria-label="t('header.refresh.aria')"
      @click="emit('refresh')"
    >
      <span class="spin" aria-hidden="true"></span>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-2.6-6.3"></path>
        <path d="M21 3v6h-6"></path>
      </svg>
      {{ t('header.refresh') }}
    </button>
  </div>
</template>
