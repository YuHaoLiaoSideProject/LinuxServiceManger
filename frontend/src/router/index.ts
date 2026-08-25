import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import LoginView from '../views/LoginView.vue'
import DashboardView from '../views/DashboardView.vue'

const AuditLogView = () => import('../views/AuditLogView.vue')
const NodeManagementView = () => import('../views/NodeManagementView.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { guest: true } },
    { path: '/', name: 'dashboard', component: DashboardView, meta: { auth: true } },
    { path: '/audit', name: 'audit', component: AuditLogView, meta: { auth: true } },
    { path: '/nodes', name: 'NodeManagement', component: NodeManagementView, meta: { auth: true } },
  ],
})

router.beforeEach((to, _from, next) => {
  const auth = useAuthStore()

  // Wait for auth to initialize
  if (auth.loading) {
    const unwatch = setInterval(() => {
      if (!auth.loading) {
        clearInterval(unwatch)
        proceed()
      }
    }, 50)
    return
  }
  proceed()

  function proceed() {
    if (to.meta.auth && !auth.isLoggedIn) {
      next('/login')
    } else if (to.meta.guest && auth.isLoggedIn) {
      next('/')
    } else {
      next()
    }
  }
})

export default router
