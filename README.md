# 纸间

[打开我的书柜](https://fqxxzyw.github.io/my-notes/) · [使用指南](https://fqxxzyw.github.io/my-notes/guide.html)

个人 Markdown 笔记站。一册对应 `docs/notebooks/<bookId>/`，册名写在 `index.md` 首行，每一章保存在同目录下的独立 Markdown 文件。GitHub Pages 开启连接后会自动保存。本地开发或预览网页支持勾选多章并一次提交到 GitHub。草稿保存在本机；网页版的精细访问令牌保存在浏览器本地存储（未加密），桌面版使用 Windows 当前账户加密保存。断开连接会删除保存的令牌。

书柜名称和笔记本归属记录在 `docs/cabinets.json`。移动笔记本时只更新归属，原文和提交历史保留在原目录。

本地运行 `npm ci` 和 `npm run docs:dev`，生产构建使用 `npm run docs:build`。推送到 `main` 会触发 GitHub Actions 发布到 `/my-notes/`。
