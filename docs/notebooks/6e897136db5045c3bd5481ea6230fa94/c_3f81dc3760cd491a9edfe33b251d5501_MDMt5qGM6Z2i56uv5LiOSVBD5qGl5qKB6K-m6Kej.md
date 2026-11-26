# 03 · Electron 桌面端与 IPC 接口桥梁 (`electron/`)

如果说 `src/` 是网页，那么 **`electron/`** 就是包在网页外面的**桌面操作系统管家**。它运行在 Node.js 环境中，拥有操作电脑文件、启动后台程序、创建透明置顶窗口的全部权限。

---

## 1. 为什么需要 `preload.cjs`？（IPC 安全隔离）

新手常问："为什么不在 React 里直接 `require('fs')` 读写文件？"
因为网页里可能加载外部内容或脚本，如果网页直接拥有 Node.js 权限，一旦遇到 XSS 漏洞就会危害整个电脑。
Electron 的标准安全架构是**三层隔离**：
1. **渲染进程 (`src/`)**：纯浏览器沙箱，只管画界面，不能碰硬盘。
2. **预加载脚本 (`electron/preload.cjs`)**：唯一的"安检窗口"。它通过 `contextBridge.exposeInMainWorld('desktop', { ... })` 只把允许的功能暴露给网页的 `window.desktop` 对象。
3. **主进程 (`electron/main.cjs`)**：真正干活的后端大脑，监听 `ipcMain.handle(...)` 并执行实际操作。

---

## 2. `electron/` 核心文件地图

### 2.1 窗口与桌宠界面
- `electron/main.cjs`：程序总入口，负责创建主窗口、托盘图标、全局快捷键以及协调各模块。
- `electron/companion-view/`：桌面宠物（透明无边框小窗）的专属页面和动画逻辑。
- `electron/camera-preview-view/`：摄像头画面预览小窗。
- `electron/window-bounds-transition.cjs`：窗口大小/位置切换时的平滑过渡动画。
- `electron/desktop-model-scale.mjs`：根据显示器 DPI 缩放率调整桌宠 3D 模型的大小。

### 2.2 `window.desktop` 暴露的主要本地接口 (`electron/preload.cjs`)
在前端 React 代码里，你会经常看到 `window.desktop.xxx()`，它们对应的就是以下能力：
- **对话与命令**：`send()`（发消息）、`stop()`（中断生成）、`onChunk()`（接收流式打字机片段）。
- **本地大模型**：`localChatLoad()`、`localChatUnload()`、`localChatProbe()`（探测显卡与模型状态）。
- **本地语音**：`voiceLoad()`、`voiceSynthesize()`（单句合成）、`voiceSynthesizeBatch()`（批量预合成）、`voiceCloneCreate()`（录音克隆声音）。
- **语音识别 (ASR)**：`asrStart()`、`asrAudio()`、`asrFinish()`。
- **本地翻译**：`translate()`、`translationInstall()`。
- **系统与资源**：`setupInstall()`（一键环境配置）、`wallpaperPick()`（选壁纸）、`sceneImport()`（导入 3D 场景）、`appUpdateCheck()`（检查软件更新）。

### 2.3 工程化细节模块
- `resource-download.cjs` & `resource-jobs.cjs`：大文件（几个 GB 的 AI 模型包）下载队列管理、进度回调、以及使用 `yauzl` 流式解压 `.zip`。
- `speech-cache.cjs` & `speech-cache-key.cjs`：把合成过的语音 WAV 缓存在本地，并用配置+文本生成唯一缓存 Key，下次说同一句话直接秒播。
- `app-update.cjs` & `update-blockmap.cjs`：软件自动更新，支持 Blockmap 差分更新（只下载修改过的数据块，省流量）。
- `atomic-json.cjs`：原子写 JSON 文件（先写临时文件再重命名），防止写配置到一半电脑断电导致配置文件损坏。
