<script setup lang="ts">
import { useI18n } from '../composables/useI18n'
import { useTheme } from '../composables/useTheme'

const { t, toggleLang } = useI18n()
const { theme, toggleTheme } = useTheme()
</script>

<template>
  <header class="app-header">
    <div class="app-header-left">
      <h1><span class="header-icon">🖥</span> Linux Service Manager</h1>
      <span class="user-badge">👤 {{ $props.username }}</span>
    </div>
    <div class="app-header-right">
      <button class="lang-toggle" @click="toggleLang" :title="t('lang.toggle.title')" aria-label="切換語言">🌐</button>
      <button class="theme-toggle" @click="toggleTheme" :title="t('theme.toggle.title')" :aria-label="t('theme.toggle')">
        <span v-if="theme === 'light'">☀️</span>
        <span v-else>🌙</span>
      </button>
      <button class="btn-refresh secondary" @click="$emit('refresh')" :aria-label="t('header.refresh.aria')">
        {{ t('header.refresh') }}
      </button>
      <button class="secondary" @click="$emit('logout')" :aria-label="t('header.logout.aria')">
        {{ t('header.logout') }}
      </button>
    </div>
  </header>
</template>

<script lang="ts">
export default {
  props: { username: String },
  emits: ['refresh', 'logout'],
}
</script>
