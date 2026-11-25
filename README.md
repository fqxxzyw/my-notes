# 纸间

一款以书柜和立体书架整理 Markdown 的跨端笔记软件，支持 **Windows 桌面版**、**Android 客户端** 与 **浏览器网页版**。可以先离线在本机写作，再连接自己的 GitHub 仓库实现多端同步与离线恢复。

[使用指南](docs/guide.md) · [下载 Windows 单文件版](https://github.com/fqxxzyw/my-notes/releases/latest/download/paper-notes-windows-x64.exe) · [下载 Windows 便携版 ZIP](https://github.com/fqxxzyw/my-notes/releases/latest/download/paper-notes-portable-windows-x64.zip) · [下载 Android APK](https://github.com/fqxxzyw/my-notes/releases/latest/download/paper-notes-android.apk)

## 界面预览

以下为程序实际界面截图，笔记内容为演示数据。

**书柜首页**

![纸间书柜首页](docs/images/home.png)

**立体书架**

![纸间立体书架](docs/images/bookshelf.png)

**Markdown 编辑**

![纸间 Markdown 编辑器](docs/images/editor.png)

## 核心功能

- **书柜、立体书架与双格式管理**：用书柜、笔记本、章节和独立书页整理内容，支持批量移动/删除、双击重命名（书柜/笔记本/书页/章节），以及新建 `.md` Markdown 或 `.txt` 纯文本笔记。
- **Typora 级 Markdown 渲染与编辑（全离线）**：
  - 支持「所见即写」与「源代码」双模式、Markdown 与 27 种常见语言离线代码语法高亮、离线 **Mermaid 流程图/节点图**、离线 **KaTeX 数学公式**（`$...$` 与 `$$...$$`，与同行货币符号互不干扰）、交互式表格编辑（单元格编辑、增删行列与对齐）。
  - 支持 Callout 提示框（`NOTE`/`TIP`/`IMPORTANT`/`WARNING`/`CAUTION`）、`==高亮==`、上下标、`<u>`/`<kbd>`/`<details>`、脚注双向跳转、`[TOC]` 内嵌目录、阅读态勾选任务列表及点击图片灯箱放大。
  - 支持文内查找替换（`Ctrl+F`/`Ctrl+H`，含大小写与正则）、智能回车续行/列表缩进、粘贴链接自动包裹选中文字、专注模式、打字机模式、字数与阅读时长统计，以及导出 `.md`/`.txt`、独立离线 HTML 与打印/另存为 PDF。
  - 支持同级与相对路径 `.md` 站内跳转（含返回上一篇历史），以及侧边独立滚动目录与章节拖动排序。
- **多格式导入与嵌套目录智能排序**：
  - 拖入或选择 `.md`/`.txt` 文件及嵌套文件夹（文件夹自动导入为笔记本，按目录层级与自然编号顺序展开并保留所属子目录标签，自动清洗标题行内反引号等 Markdown 语法并携带相对路径/Typora `.assets` 图片）；另支持导入 `.pdf`、`.doc`/`.docx`、`.ppt`/`.pptx`、`.xls`/`.xlsx`、`.csv`、`.rtf` 作为只读文档预览或调用系统默认程序打开。
  - 支持粘贴 PNG/JPEG/GIF/WebP 图片（单张 ≤ 20 MiB），以独立附件同步并在正文保持 `assets/` 相对路径，支持旧笔记补图。
- **丝滑滑动交互与离线音效**：
  - 书柜缩略图支持鼠标悬停自动滑览全部书脊（安卓端支持手指横向拖动），3D 书架支持左右边缘悬停自动滑动、滚轮横滑、可拖动进度轨与 60fps 零回流渲染。
  - 内置纯离线合成的纸张/木脊滑动音效（顶栏一键切换静音），安卓端同步提供细腻微震动反馈。
- **全层级跨端分享与链接导入**：
  - 书柜/书架页、笔记本页、具体章节与独立书页均可一键生成分享链接（支持离线压缩链接 `paper-share://v1/...`，带 512 KB 内存上限保护；已同步至 GitHub 的内容另支持超短 GitHub 链接）。
  - 桌面端、网页版与安卓端完全互通，在「导入」中粘贴链接即可预览内容并安全还原到本机（自动去重，不覆盖原有笔记）。
- **本地优先与 GitHub 多端同步**：
  - 已恢复到本机的笔记启动即优先从本地瞬间加载；首次连接 GitHub 时顶部实时显示恢复进度条；明确区分「同步」与「恢复」，冲突时保留草稿并展示对比。
  - 支持日间、夜间、浅绿护眼、浅黄阅读与跟随系统 5 套主题；默认使用说明为普通可编辑/可删除笔记。

## Android 客户端

原生 Kotlin + Jetpack Compose 客户端（`paper-notes-android.apk`，支持 Android 8.0 / API 26 及以上），为手机单手触摸、滑动与系统返回手势重新设计，与 Windows 桌面版、网页版共用同一 GitHub 仓库数据结构（`docs/cabinets.json`、`docs/notebooks/`、`docs/pages/`）：

- 支持离线优先写作、所见即写与源码双模式、5 套主题、书柜缩略图横向拖动、3D 书架完整滑动（附带滑动音效与微震动）、章节拖放排序、全层级分享与链接导入。
- 令牌通过 Android Keystore（AES-256-GCM）按仓库隔离加密，文件与图片导入采用系统 SAF / Photo Picker，无需全局存储权限。
- 源码与构建说明见 [android/README.md](android/README.md)。

## Windows 版数据位置

单文件版的数据保存在 `%LOCALAPPDATA%\PaperNotes`。便携版 ZIP 需要先完整解压，保留同目录的 `portable.mode` 并运行 `纸间.exe` 后，数据保存在解压目录下的 `纸间数据` 文件夹。两种版本的数据独立；如需迁移可直接复制数据文件夹内容，详情见[使用指南](docs/guide.md)。

桌面版图片与外部文档附件位于上述数据目录并按仓库隔离；网页版图片保存在浏览器 IndexedDB 中，清理网站数据前请先同步或备份。Windows 桌面版需要 Windows x64、Microsoft Edge WebView2 Runtime 和 .NET Framework 4.6.2 或更高版本。令牌在桌面版使用当前 Windows 账户 DPAPI 加密保存，连接仓库和令牌设置步骤见[使用指南](docs/guide.md)。

## 本地开发

在项目目录运行 `npm ci`，然后使用 `npm run docs:dev`；生产构建使用 `npm run docs:build`。

- Windows 桌面版构建说明见 [desktop/README.md](desktop/README.md)
- Android 客户端构建说明见 [android/README.md](android/README.md)
