# 纸间 Android 客户端

基于 **Kotlin + Jetpack Compose** 构建的原生安卓客户端，专为手机单手触摸、滑动与系统返回手势重新设计，并完全兼容现有 Windows 桌面版与网页版的 GitHub 仓库数据结构。

## 源码位置与架构

- `android/app/src/main/java/com/papernotes/android/`
  - `data/`：仓库规范化与按仓库隔离存储（`RepositoryIdentity`, `WorkspaceStorage`）、Android Keystore AES-256-GCM 令牌加密库（`TokenVault`）、跨端兼容编解码（`CompatibilityCodecs`：`cabinets.json`、`index.md` 简介与章节顺序注释、编码 ID、Git Blob SHA-1）、书柜离线日志（`CabinetJournal`）、图片附件策略与不可变存储（`AttachmentPolicy`, `AttachmentFileStore`）、SAF 文档/文件夹导入与旧笔记补图引擎（`ImportEngine`, `SafDocumentReader`）、GitHub Git Data API 原子同步/恢复/删除客户端（`GitHubNotebookClient`）、统一工作区仓库（`PaperNotesRepository`）、Markdown 大纲解析（`MarkdownOutlineParser`）与使用说明去重（`WelcomeSeed`）。
  - `ui/theme/` & `ui/components/`：5 套主题（日间、夜间、浅绿护眼、浅黄阅读、跟随系统）、减少动态效果支持、与 `desktop/make-icon.ps1` 几何一致的矢量图标及硬偏移阴影线框组件。
  - `ui/editor/`：`MarkdownWebEditor`（使用 `WebViewAssetLoader` 安全离线加载本地打包的 CodeMirror 6 + `markdown-it` 引擎与内部私有目录图片附件）。
  - `ui/screens/`：启动动画与可跳过引导（`SplashAndOnboarding`）、书柜首页（`CabinetHomeScreen`）、无穿模 3D 侧放书架（`BookshelfScreen`）、支持整行跟随手指拖动与 `↑/↓` 按钮排序的章节页（`NotebookDetailScreen`）、Markdown 编辑器与键盘上方格式条/独立滚动目录抽屉（`MarkdownEditorScreen`）、以及同步/恢复/冲突对比/主题/导入/全局搜索弹窗（`SyncAndUtilitySheets`）。
- `android/editor-web/src/main.ts`：复用了 `docs/.vitepress/theme/` 中经测试验证的 `liveMarkdown.ts`、`inlineFormatting.js`、`inlineDeletion.js`、`editorHighlight.js`、`safeHtmlImage.ts`、`markdownTasks.ts`，经 `esbuild` 打包为纯离线资产 `android/app/src/main/assets/editor/editor.bundle.js`。

## 跨端兼容说明

- 与 Windows 桌面版、网页版可连接同一个 GitHub 仓库：
  - `docs/cabinets.json`（`schemaVersion: 2`，保护默认书柜 `general`，保留独立书页 `page_<id>` 归属）
  - `docs/notebooks/<bookId>/index.md`（保留原有 Markdown 文本与未知行，仅更新末尾的 `paper-notes-chapter-order` 与 `paper-notes-description` 注释）
  - `docs/notebooks/<bookId>/<chapterId>.md` 与 `assets/<32hex>.<ext>`
  - `docs/pages/<pageId>.md` 与 `docs/pages/assets/<32hex>.<ext>`
- 不写死任何仓库地址；令牌经 **Android Keystore（AES-256-GCM）** 加密并按仓库隔离，绝不写入日志或笔记仓库。
- 明确区分「同步」（原子提交勾选的本机改动与引用图片，`force: false`，冲突时弹出本机/远端对比由用户选择）与「恢复」（下载完整离线副本并保留未同步草稿）。
- 文件与图片选择全部采用 Android SAF / Photo Picker，无需请求全局外部存储权限。

## 构建环境与构建方式

### 环境要求

- **JDK 17 或 JDK 21**（例如 Android Studio 内置 `jbr`）
- **Android SDK**（`compileSdk 35`，`minSdk 26`，`targetSdk 35`）
- **Node.js + npm**（仅在修改 `android/editor-web/` 或 `docs/.vitepress/theme/` 编辑器源码后需要重新打包离线 JS 资产）

### 方式一：一键 PowerShell 脚本（推荐）

在仓库根目录执行：

```powershell
npm ci
powershell -ExecutionPolicy Bypass -File .\android\build.ps1
```

脚本会依次打包离线编辑器资产、运行全部隔离单元测试、构建 Release APK，并输出到：

- `release/paper-notes-android.apk`
- `android/app/build/outputs/apk/release/app-release.apk`

### 方式二：直接使用 Gradle Wrapper

在 `android/` 目录中确保 `local.properties`（或环境变量 `ANDROID_HOME`）指向本地 Android SDK，然后运行：

```powershell
cd android
.\gradlew.bat testDebugUnitTest
.\gradlew.bat assembleRelease
```

> 注：默认 Release 配置使用调试密钥签名以方便本地直接安装测试；如需上架应用商店，请在 `android/app/build.gradle.kts` 中配置正式 `signingConfigs.release`。
