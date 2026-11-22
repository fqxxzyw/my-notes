import DefaultTheme from 'vitepress/theme'
import { defineComponent, h, nextTick, onBeforeUnmount, onMounted } from 'vue'
import { beginDesktopReveal } from './startupReveal'
import './paper.css'
import './theme-dark.css'
import './startup-reveal.css'

const Layout = defineComponent({
  setup() {
    let disposeReveal: (() => void) | undefined
    let disposed = false
    onMounted(async () => {
      await nextTick()
      if (!disposed) disposeReveal = beginDesktopReveal()
    })
    onBeforeUnmount(() => { disposed = true; disposeReveal?.() })
    return () => h(DefaultTheme.Layout)
  }
})

export default { ...DefaultTheme, Layout }
