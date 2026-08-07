import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { checkSession, login as apiLogin, logout as apiLogout } from '../api/client'

export const useAuthStore = defineStore('auth', () => {
  const username = ref('')
  const authenticated = ref(false)
  const loading = ref(true)

  const isLoggedIn = computed(() => authenticated.value)

  async function init() {
    try {
      const session = await checkSession()
      authenticated.value = session.authenticated
      username.value = session.username || ''
    } catch {
      authenticated.value = false
      username.value = ''
    } finally {
      loading.value = false
    }
  }

  async function login(user: string, pass: string): Promise<string | null> {
    try {
      const res = await apiLogin(user, pass)
      username.value = res.username
      authenticated.value = true
      return null
    } catch (err: any) {
      return err.response?.data?.error || 'Login failed'
    }
  }

  async function logout() {
    try {
      await apiLogout()
    } finally {
      username.value = ''
      authenticated.value = false
    }
  }

  return { username, authenticated, loading, isLoggedIn, init, login, logout }
})
