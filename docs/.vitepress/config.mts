import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/my-notes/',
  title: 'My Tech Notes',
  description: '学习与开发笔记',
  lang: 'zh-CN',
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '开始写笔记', link: '/guide' }
    ],
    sidebar: [
      { text: '笔记', items: [{ text: '开始写笔记', link: '/guide' }] }
    ],
    search: { provider: 'local' }
  }
})
