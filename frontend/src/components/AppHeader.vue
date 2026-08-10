<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../composables/useI18n'
import { useTheme } from '../composables/useTheme'
import type { ConnectionStatus } from '../composables/useWebSocket'

const { t, toggleLang } = useI18n()
const { theme, toggleTheme } = useTheme()

const props = defineProps<{
  username?: string
  wsStatus?: ConnectionStatus
}>()

const emit = defineEmits<{
  refresh: []
  logout: []
}>()

const connectionClass = computed(() => ({
  'indicator-connected': props.wsStatus === 'connected',
  'indicator-reconnecting': props.wsStatus === 'connecting',
  'indicator-offline': props.wsStatus === 'offline',
}))
</script>

<template>
  <header class="app-header">
    <div class="app-header-left">
      <h1><span class="header-icon">🖥</span> Linux Service Manager</h1>
      <span class="user-badge">👤 {{ username }}</span>
    </div>
    <div class="app-header-right">
      <!-- WebSocket connection indicator -->
      <span
        v-if="wsStatus"
        class="connection-indicator"
        :class="connectionClass"
      >
        <template v-if="wsStatus === 'connected'">🔗 已連線</template>
        <template v-else-if="wsStatus === 'connecting'">⟳ 重連中...</template>
        <template v-else>⚠ 離線</template>
      </span>
      <button class="lang-toggle" @click="toggleLang" :title="t('lang.toggle.title')" aria-label="切換語言">🌐</button>
      <button class="theme-toggle" @click="toggleTheme" :title="t('theme.toggle.title')" :aria-label="t('theme.toggle')">
        <span v-if="theme === 'light'">☀️</span>
        <span v-else>🌙</span>
      </button>
      <router-link v-if="username" to="/audit" class="nav-link">Audit Log</router-link>
      <button class="btn-refresh secondary" @click="emit('refresh')" :aria-label="t('header.refresh.aria')">
        {{ t('header.refresh') }}
      </button>
      <button class="secondary" @click="emit('logout')" :aria-label="t('header.logout.aria')">
        {{ t('header.logout') }}
      </button>
    </div>
  </header>
</template>
