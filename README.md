# 纸间

一款以书柜和立体书架整理 Markdown 的笔记软件。可以先在本机写作，再选择自己的 GitHub 仓库同步；也支持在浏览器中使用。

[使用指南](docs/guide.md) · [下载 Windows 单文件版](https://github.com/fqxxzyw/my-notes/releases/latest/download/paper-notes-windows-x64.exe) · [下载 Windows 便携版 ZIP](https://github.com/fqxxzyw/my-notes/releases/latest/download/paper-notes-portable-windows-x64.zip)

## 界面预览

以下为程序实际界面截图，笔记内容为演示数据。

**书柜首页**

![纸间书柜首页](docs/images/home.png)

**立体书架**

![纸间立体书架](docs/images/bookshelf.png)

**Markdown 编辑**

![纸间 Markdown 编辑器](docs/images/editor.png)

## 功能

- 用书柜、笔记本、章节和独立书页整理内容，支持批量移动和删除。
- 拖入或选择 Markdown 文件和文件夹：文件可以作为书页或章节，文件夹可以作为一本笔记本导入；文件夹中可解析的相对路径图片会一同导入。
- Markdown 编辑器支持源代码和所见即写模式；目录支持折叠标题、拖动标题调整层级及撤销。
- 支持粘贴 PNG、JPEG、GIF、WebP 图片（每张不超过 20 MiB），图片作为独立附件与笔记同步，正文使用 `assets/` 相对路径。
- 连接自己选择的 GitHub 仓库；同步将本机改动提交到仓库，恢复将仓库内容下载为本机离线副本。
- 支持夜间模式；使用说明也是普通笔记，可以编辑或删除。

## Windows 版数据位置

单文件版的数据保存在 `%LOCALAPPDATA%\PaperNotes`。便携版 ZIP 需要先完整解压，运行其中的 EXE 后，数据保存在解压目录下的 `纸间数据` 文件夹。两种版本的数据独立；迁移步骤见便携包中的说明。

桌面版图片文件位于上述数据目录的 `附件` 文件夹，并按仓库隔离。网页版图片保存在浏览器的 IndexedDB 中，清理网站数据前请先同步或备份。导入文件夹时，标准 Markdown 相对路径图片（包括 Typora 的 `.assets` 文件夹）会一起导入；单张图片不超过 20 MiB，每次图片合计不超过 100 MiB。绝对路径、选定文件夹外的资源、HTML 图片及其他类型的附件不会自动导入，请检查提示。

需要 Windows x64、Microsoft Edge WebView2 Runtime 和 .NET Framework 4.6.2 或更高版本。网页版令牌保存在浏览器本地存储中，桌面版使用当前 Windows 账户加密保存。公开仓库中的笔记可被任何人查看，连接仓库和令牌设置步骤见[使用指南](docs/guide.md)。

## 本地开发

在项目目录运行 `npm ci`，然后使用 `npm run docs:dev`；生产构建使用 `npm run docs:build`。Windows 桌面版的构建说明见 [desktop/README.md](desktop/README.md)。
