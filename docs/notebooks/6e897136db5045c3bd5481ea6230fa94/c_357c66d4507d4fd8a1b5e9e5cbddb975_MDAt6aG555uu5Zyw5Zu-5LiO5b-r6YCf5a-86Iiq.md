# 00 · Yukino Companion 项目地图与小白快速导航

> **写给初学者的话**：这个项目是一个非常完整的全栈商业级应用（桌面端 + 网页端 + 官网 + 云端后端 + 本地 AI 模型）。初次打开几百个文件很容易迷路，这份地图帮你把**"什么代码放在哪里、资源放在哪里、接口在哪里"**一次性理清楚。

---

## 1. 一张表看懂所有文件夹（根目录 `e:\JAVA\yukino-companion`）

### 🌟 你最常需要看的核心代码目录
| 文件夹 | 它是干嘛的？ | 里面放了什么？（通俗解释） |
| :--- | :--- | :--- |
| **`src/`** | **桌面/网页端的前端界面** | 用 React 写的聊天窗口、设置面板、3D 角色舞台（Three.js）、语音播放控制。 |
| **`website/`** | **官方宣传网站 & 用户中心网页** | 纯静态 HTML/CSS/JS 写的官网首页、下载页、网页版账号登录注册页（`index.html`, `assets/app.mjs`）。 |
| **`electron/`** | **桌面端外壳（Node.js 主进程）** | 把 `src/` 网页变成 Windows `.exe` 桌面软件的壳子。负责创建透明桌宠窗口、读写本地硬盘、启动 Python AI 子进程。 |
| **`server/`** | **云端后端服务器（API 接口）** | 部署在 Cloudflare Workers 上的后端代码。处理用户注册登录、发邮件验证码、云端记忆同步、好感度/皮肤解锁。 |
| **`shared/`** | **前后端共享规则** | 前端和后端都要用的同一套规则，比如密码强度规则（`password-policy.mjs`）、皮肤解锁规则（`outfit-rules.json`）、离线验签公钥（`entitlement-public-key.json`）。 |
| **`motion-studio/`** | **独立 3D 动作编辑器** | 项目里附带的一个小软件（可单独打包为 `Yukino Motion Studio.exe`），用来给 3D 角色摆 Pose、调时间轴并导出 `.glb` 动画。 |

### 🤖 本地 AI 推理与微调目录
| 文件夹 | 它是干嘛的？ | 里面放了什么？ |
| :--- | :--- | :--- |
| **`inference/`** | **本地语音合成（TTS）** | Python 写的 **GPT-SoVITS** 推理服务，把文字变成雪乃的声音（`worker.py`）。 |
| **`model-service/`** | **本地大语言模型 & 微调** | Python 写的本地对话后端（基于 `Qwen2.5-1.5B-Instruct`），包含 LoRA 微调代码、知识蒸馏脚本、本地 RAG 检索（`yuki_model/`）。 |
| **`translation/`** | **本地离线翻译** | 基于 **HY-MT2** + `llama.cpp` 的本地中日/中英翻译服务。 |

### 🎨 资源、脚本与文档目录
| 文件夹 | 它是干嘛的？ | 里面放了什么？ |
| :--- | :--- | :--- |
| **`public/`** | **前端静态资源（直接打包进软件）** | 3D 角色模型（`characters/*.glb`）、壁纸（`wallpapers/`）、场景预览图（`scene-previews/`）、麦克风重采样脚本（`audio/`）、图标。 |
| **`resources/`** | **运行配置、Live2D 与下载清单** | 模型下载清单（`voice-models.json`, `translation-models.json`）、默认参考音频（`voice-presets/yukino-reference.wav`）、Live2D 运行时（`live2d/`）。 |
| **`characters/`** | **角色设定文档** | 雪乃的人设卡（`yukino/CHARACTER.md`）、语音说明、训练说明等 Markdown 文档。 |
| **`branding/`** | **品牌图标** | 软件安装包和桌面快捷方式用的 `.ico` 图标。 |
| **`scripts/`** | **打包与自动化工具脚本** | 构建 Windows 安装包、预处理 3D 模型、UI 自动化截图测试的脚本。 |
| **`tests/`** | **自动化测试** | 用来验证账号、开发流程、发布流程是否正常的测试脚本。 |
| **`docs/`** | **项目原有文档** | 架构说明、动作规范、资产清单等。 |

> 💡 **注意**：`node_modules/`、`dist/`、`build/`、`release/`、`.local-dev/` 这些文件夹是工具自动生成的依赖或打包产物，学习代码时可以忽略它们。

---

## 2. 四大核心链路：代码是怎么串起来的？

1. **官网 (`website/`) ↔ 云端后端 (`server/`)**
   - 用户在官网点击注册/登录，网页里的 `website/assets/app.mjs` 会向 `server/src/app.js` 发起 HTTPS 请求（比如 `/api/v1/auth/login`）。
2. **前端界面 (`src/`) ↔ 桌面壳 (`electron/`)**
   - 在浏览器里网页不能随便读写你的电脑硬盘，但在 Electron 里可以。
   - `electron/preload.cjs` 就像一座**桥梁**，它在网页的 `window.desktop` 上挂载了上百个方法（如 `window.desktop.send()`、`window.desktop.voiceSynthesize()`）。
   - 前端 React 代码调用 `window.desktop.xxx()`，就会通过 Electron 的 **IPC（进程间通信）** 发给 `electron/main.cjs` 执行。
3. **桌面壳 (`electron/`) ↔ 本地 AI (`inference/` & `model-service/` & `translation/`)**
   - 当你在软件里选择"本地大模型"或"本地语音"时，`electron/main.cjs` 会在后台启动一个 Python 子进程，通过 **标准输入/输出（stdin/stdout）的 JSONL（每行一个 JSON）** 来回传话。
4. **桌面壳 (`electron/`) ↔ 云端后端 (`server/`)**
   - 当需要登录账号、同步云端记忆或每日签到时，`electron/account-client.cjs` 会携带登录凭证（JWT）请求 `server/`。

---

## 3. 继续阅读本指南
- [01-前端与官网代码详解.md](./01-前端与官网代码详解.md) — 看懂 `src/`、`website/`、`public/`、`resources/`
- [02-后端与接口全解.md](./02-后端与接口全解.md) — 看懂 `server/`、数据库表、全部 API 接口清单与安全算法
- [03-桌面端与IPC桥梁详解.md](./03-桌面端与IPC桥梁详解.md) — 看懂 `electron/` 多窗口与 `preload.cjs` 接口
- [04-3D渲染与动作编辑器.md](./04-3D渲染与动作编辑器.md) — 看懂 Three.js 场景、VRM 人物与 `motion-studio/` IK 算法
- [05-语音推理原理(GPT-SoVITS).md](./05-语音推理原理(GPT-SoVITS).md) — 零基础看懂 `inference/` 声音克隆原理
- [06-大模型微调与RAG检索.md](./06-大模型微调与RAG检索.md) — 零基础看懂 `model-service/` LoRA 微调、蒸馏与防幻觉检索
