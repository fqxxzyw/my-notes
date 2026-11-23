import DefaultTheme from 'vitepress/theme'
import { defineComponent, h, nextTick, onBeforeUnmount, onMounted } from 'vue'
import { beginDesktopReveal } from './startupReveal'
import './paper.css'
import './theme-dark.css'
import './theme-picker.css'
import './startup-reveal.css'

const Layout = defineComponent({
  setup() {
    let disposeReveal: (() => void) | undefined
    let themeObserver: MutationObserver | undefined
    let disposed = false
    onMounted(async () => {
      await nextTick()
      if (disposed) return
      disposeReveal = beginDesktopReveal()
      const bridge = (window as unknown as { chrome?: { webview?: { postMessage: (message: object) => void } } }).chrome?.webview
      if (location.protocol === 'https:' && location.hostname === 'paper.local' && location.pathname === '/my-notes/index.html' && bridge) {
        const updateTheme = () => {
          try { bridge.postMessage({ channel: 'paper-notes', action: 'ui.theme', theme: document.documentElement.dataset.paperTheme || 'day' }) }
          catch { /* The browser UI still works if the window is closing. */ }
        }
        themeObserver = new MutationObserver(updateTheme)
        themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-paper-theme'] })
        updateTheme()
      }
    })
    onBeforeUnmount(() => { disposed = true; themeObserver?.disconnect(); disposeReveal?.() })
    return () => h(DefaultTheme.Layout)
  }
})

export default { ...DefaultTheme, Layout }
