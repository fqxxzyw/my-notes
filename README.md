# 纸间

[打开纸间](https://fqxxzyw.github.io/my-notes/) · [使用指南](https://fqxxzyw.github.io/my-notes/guide.html)

Markdown 笔记软件，支持自选 GitHub 仓库同步。一册对应所选仓库中的 `docs/notebooks/<bookId>/`，册名写在 `index.md` 首行，每一章保存在同目录下的独立 Markdown 文件。连接自己的仓库后，可勾选多章并一次提交；网页版启用自动保存时也会自动提交。草稿保存在本机；网页版的精细访问令牌保存在浏览器本地存储（未加密），桌面版使用 Windows 当前账户加密保存。断开连接会删除保存的令牌。

书柜名称和笔记本归属记录在 `docs/cabinets.json`。移动笔记本时只更新归属，原文和提交历史保留在原目录。

本项目开发运行 `npm ci` 和 `npm run docs:dev`，生产构建使用 `npm run docs:build`。本项目的部署工作流会将应用发布到 `/my-notes/`；用户自行选择的笔记仓库不需要部署此工作流。
