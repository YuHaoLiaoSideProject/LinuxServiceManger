<script setup lang="ts">
defineProps<{
  message?: string
  showButton?: boolean
}>()

defineEmits<{
  clear: []
}>()
</script>

<template>
  <div class="empty-state">
    <div class="empty-icon">🔍</div>
    <p>{{ message || '沒有符合條件的服務' }}</p>
    <button v-if="showButton !== false" class="btn btn-secondary" @click="$emit('clear')">清除過濾</button>
  </div>
</template>
