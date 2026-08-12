<script setup lang="ts">
/**
 * DateRangeGroup — 日期範圍群組（單一外框）
 *
 * 規格：docs/uiux/013-toolbar-audit-design.html
 *  - 起訖共用一個外框 + 中間「–」分隔 + focus-within 光圈（36px / 44px）
 *  - 原生 <input type="date">：桌面/行動瀏覽器皆有內建日期選擇器
 *    （Chrome/Firefox/Edge 指示器、iOS/Android 原生 picker）
 *  - 純展示元件：validity（起 > 迄）由父層判定並以 prop `invalid` 傳入
 */
const props = withDefaults(defineProps<{
  from: string
  to: string
  disabled?: boolean
  invalid?: boolean
  fromLabel?: string
  toLabel?: string
}>(), {
  disabled: false,
  invalid: false,
  fromLabel: '開始日期',
  toLabel: '結束日期',
})

const emit = defineEmits<{
  'update:from': [value: string]
  'update:to': [value: string]
  change: []
}>()

function onFromInput(e: Event): void {
  emit('update:from', (e.target as HTMLInputElement).value)
  emit('change')
}

function onToInput(e: Event): void {
  emit('update:to', (e.target as HTMLInputElement).value)
  emit('change')
}
</script>

<template>
  <!-- 不加 role="group"：Pico 對 [role=group] 注入 width:100%/margin-bottom，會破壞單外框自然寬度；
       可達性由 input 的 aria-label 提供（規格：docs/uiux/013 a11y 檢查項）。
       日期選擇器由原生 type="date" 提供（main.css 已還原 appearance:auto 並顯示原生
       行事曆圖示，iOS/Android/桌面皆可跳出 picker）。 -->
  <div
    class="daterange"
    :class="{ invalid }"
    :aria-invalid="invalid || undefined"
  >
    <input
      type="date"
      name="audit-date-from"
      :value="from"
      :disabled="disabled"
      :aria-label="fromLabel"
      autocomplete="off"
      @input="onFromInput"
    >
    <span class="sep" aria-hidden="true">–</span>
    <input
      type="date"
      name="audit-date-to"
      :value="to"
      :disabled="disabled"
      :aria-label="toLabel"
      autocomplete="off"
      @input="onToInput"
    >
  </div>
</template>
