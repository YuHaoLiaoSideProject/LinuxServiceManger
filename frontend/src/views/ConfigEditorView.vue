<script setup lang="ts">
// ConfigEditorView.vue — 服務設定檔編輯器全頁路由 shell（012 UIUX v2：手機 ≤767px 全頁）
// 桌面 ≥768px 由 ConfigEditorModal 呈現；此路由保留作為手機全頁與 deep link 進入點。
// dirty 防護：onBeforeRouteLeave（第一層）+ ConfigEditorContent 內頁內 Cancel（第二層）
// + beforeunload（第三層，於 ConfigEditorContent 內註冊）。
import { ref, computed } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import ConfigEditorContent from '../components/ConfigEditorContent.vue'
import ToastContainer from '../components/ToastContainer.vue'
import { useServiceStore } from '../stores/service'

const route = useRoute()
const router = useRouter()
const store = useServiceStore()
const serviceName = route.params.name as string

// readOnly：View Config 進入（?readonly=1）或 store 中該服務 locked=true
const readOnly = computed(
  () => route.query.readonly === '1' || store.services.find(s => s.name === serviceName)?.locked === true,
)

const contentRef = ref<InstanceType<typeof ConfigEditorContent> | null>(null)

// 第一層：route guard（含瀏覽器返回鍵/程式導航）— 交由 content 的 confirmLeave 決策
onBeforeRouteLeave(() => {
  return contentRef.value ? contentRef.value.confirmLeave() : true
})

function onClose() {
  router.push('/')
}
</script>

<template>
  <div class="config-editor-page">
    <ConfigEditorContent
      ref="contentRef"
      :service-name="serviceName"
      :read-only="readOnly"
      variant="page"
      @close="onClose"
    />
    <ToastContainer />
  </div>
</template>

<style scoped>
.config-editor-page {
  max-width: 960px;
  margin: 0 auto;
  padding: 1rem 0 2rem;
}
@media (max-width: 767px) {
  .config-editor-page {
    padding: 1rem 0.75rem 2rem;
  }
}
</style>
