<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '../composables/useI18n'

const { t } = useI18n()
const search = ref('')
const emit = defineEmits<{ search: [term: string] }>()

function onInput() {
  emit('search', search.value)
}

function clear() {
  search.value = ''
  emit('search', '')
}
</script>

<template>
  <div class="toolbar">
    <div class="search-wrap">
      <span class="search-icon">🔍</span>
      <input
        type="search"
        v-model="search"
        :placeholder="t('search.placeholder')"
        :aria-label="t('search.aria')"
        @input="onInput"
        autocomplete="off"
      />
      <button
        v-show="search.length > 0"
        class="search-clear visible"
        @click="clear"
        :aria-label="t('search.clear.aria')"
        :title="t('search.clear.title')"
      >✕</button>
    </div>
  </div>
</template>
