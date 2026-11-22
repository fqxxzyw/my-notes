# 开始写笔记

在 `docs` 目录下新建 Markdown 文件即可添加笔记。例如，新建 `docs/java.md`，然后在 `docs/.vitepress/config.mts` 的 `sidebar` 中添加链接：

```ts
{ text: 'Java 笔记', link: '/java' }
```

在项目根目录运行 `npm run docs:dev`，然后访问终端显示的本地地址预览。完成后运行 `npm run docs:build` 检查构建，将更改提交并推送到 `main` 分支即可自动部署。

> 注意：公开仓库中的笔记和网站内容对所有人可见，请勿写入密码、密钥或其他敏感信息。
