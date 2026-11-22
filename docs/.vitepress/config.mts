import { defineConfig } from 'vitepress'

export default defineConfig({
  base: '/my-notes/',
  title: '纸间',
  description: '个人笔记书架，按笔记本整理和书写章节。',
  lang: 'zh-CN',
  appearance: false,
  vite: {
    define: { __PAPER_BUILD_SHA__: JSON.stringify(process.env.GITHUB_SHA || '') }
  },
  // Note Markdown is user content. The desk reads it as text.
  srcExclude: ['notebooks/**', 'pages/**'],
  themeConfig: {
    nav: [
      { text: '我的书柜', link: '/', activeMatch: '^/$' },
      { text: '使用指南', link: '/guide' }
    ],
    outline: { label: '本页目录' },
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换为浅色',
    darkModeSwitchTitle: '切换为深色',
    sidebarMenuLabel: '目录',
    returnToTopLabel: '回到顶部',
    skipToContentLabel: '跳至正文'
  }
})
