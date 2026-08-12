<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  searchText: string
  regexMode: boolean
  regexError: string | null
  filteredCount: number
  totalCount?: number
  loading: boolean
  showRefresh?: boolean
}>(), {
  regexError: null,
  showRefresh: false,
  totalCount: 0,
})

const emit = defineEmits<{
  'update:searchText': [value: string]
  'toggle-regex': []
  'clear-search': []
  'refresh': []
}>()

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
</script>

<template>
  <div class="toolbar">
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

    <!-- 計數：顯示 X / 共 Y（與表格視圖一致：tab + 狀態 + 搜尋） -->
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
