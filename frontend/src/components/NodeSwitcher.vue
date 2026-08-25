<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useNodeStore } from '../stores/node'

const router = useRouter()
const nodeStore = useNodeStore()

function onSelectChange(e: Event) {
  const val = (e.target as HTMLSelectElement).value
  if (val === '__all__') {
    nodeStore.setCurrentNodeId(null)
    router.push('/')
  } else {
    nodeStore.setCurrentNodeId(val)
    router.push(`/?node=${val}`)
  }
}

function showAll() {
  nodeStore.setCurrentNodeId(null)
  router.push('/')
}
</script>

<template>
  <div v-if="nodeStore.currentNode" class="node-switcher">
    <span class="node-switcher__label">目前節點：{{ nodeStore.currentNode.name }}</span>
    <select
      class="node-switcher__select"
      :value="nodeStore.currentNodeId ?? '__all__'"
      @change="onSelectChange"
    >
      <option value="__all__">所有節點</option>
      <option v-for="n in nodeStore.nodes" :key="n.id" :value="n.id">
        {{ n.name }} ({{ n.status === 'online' ? '線上' : n.status === 'warning' ? '延遲' : '離線' }})
      </option>
    </select>
    <button class="secondary node-switcher__all-btn" @click="showAll">所有節點</button>
  </div>
  <div v-else-if="nodeStore.nodes.length > 1" class="node-switcher">
    <select
      class="node-switcher__select"
      :value="nodeStore.currentNodeId ?? '__all__'"
      @change="onSelectChange"
    >
      <option value="__all__">所有節點</option>
      <option v-for="n in nodeStore.nodes" :key="n.id" :value="n.id">
        {{ n.name }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.node-switcher {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.node-switcher__label {
  font-weight: 600;
  font-size: 0.9rem;
}

.node-switcher__select {
  padding: 0.3rem 0.6rem;
  border-radius: var(--lms-radius-sm);
  border: 1px solid var(--lms-border);
  background: var(--lms-surface);
  font-size: 0.85rem;
}

.node-switcher__all-btn {
  font-size: 0.8rem;
  padding: 0.25rem 0.6rem;
}
</style>
