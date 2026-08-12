<script setup lang="ts">
// UnitFileEditor.vue — CodeMirror 6 封裝（唯一接觸 CodeMirror 的元件）
// 決策 D-1：language=ini → StreamLanguage.define(ini)；tabSize=2 → indentUnit.of('  ')
//          wordWrap=on → EditorView.lineWrapping；minimap=off → CodeMirror 無此概念
// 深淺主題：Compartment + EditorView.theme（隨 [data-theme] 切換）
// props: modelValue / readOnly；emits: update:modelValue
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useTheme } from '../composables/useTheme'

const props = withDefaults(defineProps<{
  modelValue: string
  readOnly?: boolean
}>(), { readOnly: false })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const host = ref<HTMLElement | null>(null)
const loading = ref(true)

let view: any = null
let themeCompartment: any = null
let gutterCompartment: any = null
let errorLines = new Set<number>()

const { theme } = useTheme()

// ── 深淺主題（與既有 --lms-* 色系對應）──
function buildTheme(dark: boolean) {
  return (EditorViewMod: any) => EditorViewMod.theme({
    '&': {
      backgroundColor: 'var(--lms-surface, #fff)',
      color: 'var(--lms-text, #1f2937)',
      fontFamily: "var(--lms-mono, 'SFMono-Regular', Consolas, Menlo, monospace)",
      fontSize: '0.85rem',
      height: 'auto',
    },
    '&.cm-focused': { outline: '2px solid var(--lms-accent-light, rgba(37,99,235,0.25))' },
    '.cm-content': { caretColor: dark ? 'var(--lms-accent, #60a5fa)' : 'var(--lms-accent, #2563eb)' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--lms-muted, #9ca3af)',
      borderRight: '1px solid var(--lms-border, #e5e7eb)',
    },
    '.cm-activeLine': { backgroundColor: dark ? 'rgba(96,165,250,0.08)' : 'rgba(37,99,235,0.06)' },
    '.cm-selectionBackground': {
      backgroundColor: dark ? 'rgba(96,165,250,0.25) !important' : 'rgba(37,99,235,0.15) !important',
    },
    '.cm-error-line': { textDecoration: 'underline wavy ' + (dark ? '#f87171' : '#c62828') + ' 1px' },
    '.cm-error-gutter': { color: dark ? '#f87171' : '#c62828' },
  })
}

onMounted(async () => {
  // 動態 import CodeMirror 套件（Vite 拆為獨立 chunk，納入 PWA precache）
  const [
    { EditorView, keymap, lineNumbers, Decoration, gutter },
    { EditorState, Compartment, StateEffect, StateField },
    { StreamLanguage, indentUnit, syntaxHighlighting, HighlightStyle },
    { properties },
    { defaultKeymap, history, historyKeymap },
  ] = await Promise.all([
    import('@codemirror/view'),
    import('@codemirror/state'),
    import('@codemirror/language'),
    import('@codemirror/legacy-modes/mode/properties'),
    import('@codemirror/commands'),
  ])

  const iniHighlight = HighlightStyle.define([
    { tag: 'section-tag' as unknown as any, color: 'var(--lms-accent, #2563eb)', fontWeight: '600' },
  ])

  const clampLine = (lineNo: number, totalLines: number) =>
    Math.min(Math.max(lineNo, 1), totalLines)

  // ── 錯誤 gutter：以目前 errorLines 動態產生 ❌ 標記 ──
  const errorGutterExt = gutter({
    class: 'cm-error-gutter',
    markers: (v: any) => {
      const marks: any[] = []
      for (const lineNo of errorLines) {
        const line = v.state.doc.line(clampLine(lineNo, v.state.doc.lines))
        const el = document.createElement('span')
        el.textContent = '❌'
        el.style.fontSize = '0.7rem'
        el.style.color = 'var(--lms-danger, #c62828)'
        marks.push(
          Decoration.widget({ widget: { toDOM: () => el } as any, side: 0 }).range(line.from),
        )
      }
      return marks
    },
  })

  const errorMark = Decoration.mark({ class: 'cm-error-line' })

  // ── 錯誤行 decorations：以 StateEffect + StateField 管理（動態 set 標準做法）──
  const setErrorDecorations = StateEffect.define<any>()
  const errorDecorationField = StateField.define<any>({
    create: () => Decoration.none,
    update(value: any, tr: any) {
      value = value.map(tr.changes)
      for (const e of tr.effects) {
        if (e.is(setErrorDecorations)) value = e.value
      }
      return value
    },
    provide: (f: any) => EditorView.decorations.from(f),
  })

  themeCompartment = new Compartment()
  gutterCompartment = new Compartment()

  const editorExts = [
    lineNumbers(),
    syntaxHighlighting(iniHighlight),
    StreamLanguage.define(properties),
    indentUnit.of('  '),
    EditorView.lineWrapping,
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.updateListener.of((u: any) => {
      if (u.docChanged && !props.readOnly) {
        emit('update:modelValue', u.state.doc.toString())
      }
    }),
    EditorView.editable.of(!props.readOnly),
    errorDecorationField,
    themeCompartment.of(buildTheme(theme.value === 'dark')(EditorView)),
    gutterCompartment.of(errorGutterExt),
  ]

  const state = EditorState.create({
    doc: props.modelValue,
    extensions: editorExts,
  })

  view = new EditorView({ state, parent: host.value! })

  // 供 setErrorMarks / clearMarks 使用
  view.__Decoration = Decoration
  view.__errorMark = errorMark
  view.__gutterCompartment = gutterCompartment
  view.__errorGutterExt = errorGutterExt
  view.__clampLine = clampLine
  view.__setErrorDecorations = setErrorDecorations

  loading.value = false
})

// 主題切換：compartment dispatch（即時生效，無需重載頁面）
watch(theme, (val) => {
  if (!view || !themeCompartment) return
  const mod = view.constructor
  view.dispatch({
    effects: themeCompartment.reconfigure(buildTheme(val === 'dark')(mod)),
  })
})

// props.modelValue 外部更新（409 重新載入等）
watch(() => props.modelValue, (v) => {
  if (view && v !== view.state.doc.toString()) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } })
  }
})

// ── 錯誤行標記（Validate 失敗時由父層呼叫；F-ED-09/10/11）──
function setErrorMarks(lines: number[]) {
  if (!view) return
  errorLines = new Set(lines)
  const Decoration = view.__Decoration
  const errorMark = view.__errorMark
  const ranges: any[] = []
  for (const lineNo of lines) {
    const line = view.state.doc.line(view.__clampLine(lineNo, view.state.doc.lines))
    // 排序規則：由 from 位置 + startSide 排序 — line decoration 的 startSide 較小，須在前
    ranges.push(Decoration.line({ class: 'cm-error-line' }).range(line.from))
    // 空行（from == to）不能建立 mark — 僅以 line decoration 標示
    if (line.from < line.to) {
      ranges.push(errorMark.range(line.from, line.to))
    }
  }
  view.dispatch({ effects: view.__setErrorDecorations.of(Decoration.set(ranges)) })
  // 重新掛載 gutter（markers 讀取最新 errorLines）
  view.dispatch({
    effects: view.__gutterCompartment.reconfigure(view.__errorGutterExt),
  })
}

function clearMarks() {
  if (!view) return
  errorLines = new Set()
  view.dispatch({ effects: view.__setErrorDecorations.of(view.__Decoration.none) })
  view.dispatch({ effects: view.__gutterCompartment.reconfigure(view.__errorGutterExt) })
}

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

defineExpose({ setErrorMarks, clearMarks })
</script>

<template>
  <div class="unit-file-editor-wrap">
    <div v-if="loading" class="config-loading editor-loading" role="status">
      <span class="spinner"></span>載入編輯器...
    </div>
    <div ref="host" class="unit-file-editor"></div>
  </div>
</template>

<style scoped>
.unit-file-editor-wrap {
  border: 1px solid var(--lms-border, #e5e7eb);
  border-radius: var(--lms-radius, 10px);
  background: var(--lms-surface, #fff);
  overflow: hidden;
}
.unit-file-editor {
  font-family: var(--lms-mono, 'SFMono-Regular', Consolas, Menlo, monospace);
  font-size: 0.85rem;
  line-height: 1.6;
  max-height: 60vh;
  overflow: auto;
}
.unit-file-editor :deep(.cm-editor) {
  outline: none;
}
.editor-loading {
  padding: 1.5rem 0;
  justify-content: center;
}
</style>
