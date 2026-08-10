<script setup lang="ts">
defineEmits<{
  clear: []
}>()
</script>

<template>
  <div class="empty-state">
    <div class="empty-icon">🔍</div>
    <p>沒有符合條件的服務</p>
    <button class="btn btn-secondary" @click="$emit('clear')">清除過濾</button>
  </div>
</template>
