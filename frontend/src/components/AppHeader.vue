<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '../composables/useI18n'
import { useTheme } from '../composables/useTheme'
import type { ConnectionStatus } from '../composables/useWebSocket'

const { t, toggleLang } = useI18n()
const { toggleTheme } = useTheme()
const route = useRoute()

const props = defineProps<{
  username?: string
  wsStatus?: ConnectionStatus
}>()

const emit = defineEmits<{
  logout: []
}>()

const menuOpen = ref(false)

const connectionClass = computed(() => ({
  'indicator-connected': props.wsStatus === 'connected',
  'indicator-reconnecting': props.wsStatus === 'connecting',
  'indicator-offline': props.wsStatus === 'offline',
}))

const isDashboard = computed(() => route.path === '/')
const isAudit = computed(() => route.path === '/audit')
const isNodes = computed(() => route.path === '/nodes')

const avatarInitial = computed(() => (props.username || '?').charAt(0).toUpperCase())

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
}

function closeMenu(): void {
  menuOpen.value = false
}

function handleToggleTheme(): void {
  toggleTheme()
  closeMenu()
}

function handleToggleLang(): void {
  toggleLang()
  closeMenu()
}

// Close menu on outside click / Escape
function onDocumentClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  if (target && typeof target.closest === 'function' && !target.closest('.account')) {
    closeMenu()
  }
}

function onDocumentKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeMenu()
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <header class="app-header">
    <div class="app-header-left">
      <h1>
        <router-link to="/" class="home-link">
          <span class="header-icon">🖥</span> Linux Service Manager
        </router-link>
      </h1>
    </div>

    <!-- Primary navigation -->
    <nav v-if="username" class="nav-group" aria-label="主導航">
      <router-link
        to="/"
        class="nav-item"
        :class="{ active: isDashboard }"
        data-testid="nav-dashboard"
      >🏠 {{ t('nav.dashboard') }}</router-link>
      <router-link
        to="/audit"
        class="nav-item"
        :class="{ active: isAudit }"
        data-testid="nav-audit"
      >📋 {{ t('nav.audit') }}</router-link>
      <router-link
        to="/nodes"
        class="nav-item"
        :class="{ active: isNodes }"
        data-testid="nav-nodes"
      >🖥️ 節點管理</router-link>
    </nav>

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

      <!-- Account menu -->
      <div v-if="username" class="account">
        <button
          class="account-btn"
          data-testid="account-btn"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          :title="t('account.toggle.title')"
          @click="toggleMenu"
        >
          <span class="avatar" aria-hidden="true">{{ avatarInitial }}</span>
          <span class="account-name">{{ username }}</span>
          <span class="chevron" aria-hidden="true">▾</span>
        </button>
        <div
          class="menu-pop"
          :class="{ open: menuOpen }"
          role="menu"
          data-testid="account-menu"
        >
          <div class="menu-head">
            <div class="who">👤 {{ username }}</div>
            <div class="meta">{{ t('account.signedIn') }}</div>
          </div>
          <button
            class="menu-item"
            role="menuitem"
            type="button"
            data-testid="menu-theme"
            @click="handleToggleTheme"
          >{{ t('menu.toggleTheme') }}</button>
          <button
            class="menu-item"
            role="menuitem"
            type="button"
            data-testid="menu-lang"
            @click="handleToggleLang"
          >{{ t('menu.toggleLang') }}</button>
          <hr class="menu-divider">
          <button
            class="menu-item danger"
            role="menuitem"
            type="button"
            data-testid="menu-logout"
            :aria-label="t('menu.logout.aria')"
            @click="emit('logout')"
          >{{ t('menu.logout') }}</button>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.home-link {
  color: inherit;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.home-link:hover {
  color: var(--lms-accent);
}
</style>
