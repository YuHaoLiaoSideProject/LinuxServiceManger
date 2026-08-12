<script setup lang="ts">
import { useToast } from '../composables/useToast'

const { toasts } = useToast()
</script>

<template>
  <Teleport to="body">
    <div id="toast-container" aria-live="polite">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast"
        :class="'toast-' + toast.type"
        role="status"
      >
        <span>{{ toast.type === 'success' ? '✅' : toast.type === 'warning' ? '⚠️' : '❌' }} {{ toast.message }}</span>
      </div>
    </div>
  </Teleport>
</template>
