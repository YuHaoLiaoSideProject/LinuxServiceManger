<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'

const auth = useAuthStore()
const router = useRouter()

onMounted(() => {
  auth.init()
})

// When session expires (detected by 401 interceptor), redirect to login
watch(() => auth.isLoggedIn, (loggedIn) => {
  if (!loggedIn && !auth.loading) {
    router.replace('/login')
  }
})
</script>

<template>
  <RouterView />
</template>
