# My Tech Notes

基于 VitePress 的学习与开发笔记。

```bash
npm ci
npm run docs:dev
```

打开终端显示的地址（通常是 `http://localhost:5173/my-notes/`）预览。笔记放在 `docs/`，导航和侧边栏在 `docs/.vitepress/config.mts` 中配置。运行 `npm run docs:build` 验证生产构建。

推送到 `main` 分支后，GitHub Actions 会部署到 GitHub Pages。仓库的 Pages 构建来源需设置为 **GitHub Actions**。当前 `base` 为 `/my-notes/`，如果仓库名称变化，请同步修改它。
