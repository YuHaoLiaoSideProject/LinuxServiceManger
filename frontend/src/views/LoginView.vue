<script setup lang="ts">
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import LoginForm from '../components/LoginForm.vue'

const auth = useAuthStore()
const router = useRouter()

watch(() => auth.isLoggedIn, (val) => {
  if (val) router.replace('/')
})
</script>

<template>
  <main class="app-container">
    <LoginForm />
  </main>
</template>
