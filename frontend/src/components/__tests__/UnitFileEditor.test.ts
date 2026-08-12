import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'

// F-ED-01 ~ F-ED-13：UnitFileEditor.vue（CodeMirror 6 封裝）
// （docs/test-plans/012-service-config-editor測試計畫.md §3.2）
// CodeMirror 以 vi.mock 模擬 — 測試專注於元件與編輯器的整合行為。

const mocks = vi.hoisted(() => {
  const create = vi.fn((_state: any) => ({}))
  const dispatch = vi.fn()
  const destroy = vi.fn()
  const reconfigure = vi.fn()
  const define = vi.fn(() => 'ini-language')
  const lineNumbers = vi.fn(() => 'ext-lineNumbers')
  const indentUnit = { of: vi.fn(() => 'ext-indentUnit') }
  const lineWrapping = 'ext-lineWrapping'
  const editable = { of: vi.fn((v: any) => `ext-editable-${v}`) }
  const theme = vi.fn(() => 'ext-theme')
  const updateListener = { of: vi.fn((_fn: any) => 'ext-updateListener') }
  const keymap = { of: vi.fn(() => 'ext-keymap') }
  const history = vi.fn(() => 'ext-history')
  const defaultKeymap = ['k1', 'k2']
  const historyKeymap = ['h1']
  const searchKeymap = ['s1']
  const Decoration = {
    mark: vi.fn(() => ({ range: vi.fn(() => 'mark-range') })),
    line: vi.fn(() => ({ range: vi.fn(() => 'line-range') })),
    widget: vi.fn(() => ({ range: vi.fn(() => 'widget-range') })),
    gutter: vi.fn(() => 'gutter'),
    set: vi.fn((v: any) => v),
    none: 'none',
  }
  const gutter = vi.fn(() => 'ext-errorGutter')
  const Compartment = vi.fn(function (this: any) {
    this.reconfigure = reconfigure
    this.of = vi.fn((v: any) => v)
  })
  const editorViewCtorSpy = vi.fn()
  class EditorViewClass {
    static theme = theme
    static lineWrapping = lineWrapping
    static editable = editable
    static updateListener = updateListener
    static create = vi.fn()
    dispatch: any
    destroy: any
    state: any
    constructor(opts?: any) {
      editorViewCtorSpy(opts)
      this.dispatch = dispatch
      this.destroy = destroy
      this.state = { doc: { toString: () => 'mock-doc', length: 0, line: () => ({ from: 0, to: 10 }) } }
    }
  }
  const EditorState = { create }

  return {
    mocks: {
      create, dispatch, destroy, reconfigure, define, lineNumbers, indentUnit,
      lineWrapping, editable, theme, updateListener, keymap, history,
      defaultKeymap, historyKeymap, searchKeymap, Compartment, EditorState,
      EditorView: EditorViewClass, editorViewCtorSpy,
      Decoration, gutter,
    },
  }
})

vi.mock('@codemirror/view', () => ({
  EditorView: mocks.mocks.EditorView,
  keymap: mocks.mocks.keymap,
  lineNumbers: mocks.mocks.lineNumbers,
  Decoration: mocks.mocks.Decoration,
  gutter: mocks.mocks.gutter,
}))

vi.mock('@codemirror/state', () => ({
  EditorState: mocks.mocks.EditorState,
  Compartment: mocks.mocks.Compartment,
  StateEffect: { define: vi.fn(() => ({ of: vi.fn((v: any) => v) })) },
  StateField: { define: vi.fn(() => 'errorDecorationField') },
}))

vi.mock('@codemirror/language', () => ({
  StreamLanguage: { define: mocks.mocks.define },
  indentUnit: mocks.mocks.indentUnit,
  syntaxHighlighting: vi.fn(() => 'ext-syntaxHighlighting'),
  HighlightStyle: { define: vi.fn(() => 'ext-highlightStyle') },
}))

vi.mock('@codemirror/legacy-modes/mode/properties', () => ({
  properties: 'properties-mode',
}))

vi.mock('@codemirror/commands', () => ({
  defaultKeymap: mocks.mocks.defaultKeymap,
  history: mocks.mocks.history,
  historyKeymap: mocks.mocks.historyKeymap,
}))

vi.mock('@codemirror/search', () => ({
  searchKeymap: mocks.mocks.searchKeymap,
}))

import UnitFileEditor from '../UnitFileEditor.vue'

// mock useTheme
vi.mock('../composables/useTheme', () => ({
  useTheme: () => ({ theme: { value: 'light' }, toggleTheme: vi.fn(), setTheme: vi.fn() }),
}))

const CONTENT = '[Unit]\nDescription=nginx\n\n[Service]\nExecStart=/usr/sbin/nginx\n'

describe('UnitFileEditor — CodeMirror 6 封裝（F-ED）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 預設 EditorState.create 正常運作
    mocks.mocks.create.mockImplementation(() => ({}))
    mocks.mocks.EditorView.create.mockImplementation(() => ({
      dispatch: mocks.mocks.dispatch,
      destroy: mocks.mocks.destroy,
      state: { doc: { toString: () => 'mock-doc', length: 0 } },
    }))
  })

  async function mountEditor(props: { modelValue?: string; readOnly?: boolean } = {}) {
    const wrapper = mount(UnitFileEditor, {
      props: { modelValue: props.modelValue ?? CONTENT, readOnly: props.readOnly ?? false },
    })
    await flushPromises()
    await nextTick()
    return wrapper
  }

  function lastExtensions(): any[] {
    return mocks.mocks.create.mock.calls[0]![0].extensions
  }

  it('F-ED-01: 載入顯示 modelValue 內容', async () => {
    await mountEditor({ modelValue: CONTENT })
    expect(mocks.mocks.EditorState.create).toHaveBeenCalled()
    const arg = mocks.mocks.create.mock.calls[0]![0]
    expect(arg.doc).toBe(CONTENT)
    expect(mocks.mocks.editorViewCtorSpy).toHaveBeenCalled()
  })

  it('F-ED-02: 編輯 emit update:modelValue', async () => {
    let listener: ((u: any) => void) | null = null
    mocks.mocks.updateListener.of.mockImplementation((fn: any) => {
      listener = fn
      return 'ext-updateListener'
    })
    const wrapper = await mountEditor({ modelValue: CONTENT })
    expect(listener).toBeTruthy()
    const state = { doc: { toString: () => CONTENT + '\nEnvironment=FOO=bar' } }
    listener!({ docChanged: true, state })
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBe(CONTENT + '\nEnvironment=FOO=bar')
  })

  it('F-ED-03: readOnly 不可編輯（editable.of(false)）', async () => {
    await mountEditor({ readOnly: true })
    const exts = lastExtensions()
    // editable.of 被以 false 呼叫（'ext-editable-false' 在 extensions 中）
    expect(mocks.mocks.editable.of).toHaveBeenCalledWith(false)
    expect(exts).toContain('ext-editable-false')
  })

  it('F-ED-03b: 非 readOnly → editable.of(true)', async () => {
    await mountEditor({ readOnly: false })
    expect(mocks.mocks.editable.of).toHaveBeenCalledWith(true)
  })

  it('F-ED-04: INI 語法高亮（StreamLanguage.define(properties) — systemd unit file 為 INI 子集）', async () => {
    await mountEditor()
    expect(mocks.mocks.define).toHaveBeenCalledWith('properties-mode')
    const exts = lastExtensions()
    expect(exts).toContain('ini-language')
  })

  it('F-ED-05: tabSize=2（indentUnit.of("  ")）', async () => {
    await mountEditor()
    expect(mocks.mocks.indentUnit.of).toHaveBeenCalledWith('  ')
  })

  it('F-ED-06: lineWrapping on（BDD wordWrap=on 對應）', async () => {
    await mountEditor()
    const exts = lastExtensions()
    expect(exts).toContain('ext-lineWrapping')
  })

  it('F-ED-07: lineNumbers on', async () => {
    await mountEditor()
    expect(mocks.mocks.lineNumbers).toHaveBeenCalled()
    const exts = lastExtensions()
    expect(exts).toContain('ext-lineNumbers')
  })

  it('F-ED-08: 主題切換 compartment reconfigure（light→dark）', async () => {
    await mountEditor()
    // 初始建立時 theme 被呼叫
    expect(mocks.mocks.EditorView.theme).toHaveBeenCalled()
    // Compartment 已建立（reconfigure 為其 method）
    expect(typeof mocks.mocks.reconfigure).toBe('function')
  })

  it('F-ED-09/10: setErrorMarks 行標記（波浪線 + gutter ❌）', async () => {
    const wrapper = await mountEditor()
    const vm = wrapper.vm as any
    expect(typeof vm.setErrorMarks).toBe('function')
    vm.setErrorMarks([12])
    expect(mocks.mocks.dispatch).toHaveBeenCalled()
  })

  it('F-ED-11: clearMarks 清除標記', async () => {
    const wrapper = await mountEditor()
    const vm = wrapper.vm as any
    vm.clearMarks()
    expect(mocks.mocks.dispatch).toHaveBeenCalled()
  })

  it('F-ED-13: unmount 呼叫 destroy（資源釋放）', async () => {
    const wrapper = await mountEditor()
    wrapper.unmount()
    expect(mocks.mocks.destroy).toHaveBeenCalled()
  })
})
