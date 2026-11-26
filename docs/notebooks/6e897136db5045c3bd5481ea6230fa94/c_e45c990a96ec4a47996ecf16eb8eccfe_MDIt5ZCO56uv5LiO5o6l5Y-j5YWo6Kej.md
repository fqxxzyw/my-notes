# 02 · 后端代码、全部接口与安全算法全解 (`server/`)

后端代码全部在 **`server/`** 目录下，它是一个运行在 **Cloudflare Workers**（边缘无服务器节点）上的 API 服务，数据库使用的是 **Cloudflare D1**（本质是分布式 SQLite）。

> 💡 **本地怎么跑后端？** 本地开发时不需要真的上传到 Cloudflare，项目里的 `server/dev/node-d1.mjs` 用 Node.js 模拟了 D1 数据库（数据存在 `server/.data/dev.db`），运行 `npm run api:dev` 即可在本地启动完整后端。

---

## 1. 后端目录结构 (`server/`)

- `server/src/worker.js`：Cloudflare Worker 入口。
- `server/src/app.js`：**核心路由表**，所有 `/api/v1/...` 接口都在这里分发，同时负责 CORS 跨域检查、请求体大小限制（最大 64KB）与安全响应头。
- `server/src/auth.js`：注册、登录、修改密码、找回密码、刷新 Token、注销设备。
- `server/src/password.js`：密码加密与防破解算法（PBKDF2）。
- `server/src/session.js`：JWT 签发与 Refresh Token 轮换。
- `server/src/entitlement.js`：离线权益数字签名（ECDSA P-256）。
- `server/src/memory.js`：云端聊天记录与长期记忆读写。
- `server/src/progress.js`：每日签到、好感度成长事件、皮肤列表。
- `server/src/character-profiles.js`：自定义角色档案同步。
- `server/src/mail.js`：发送注册/重置验证码邮件（本地开发时直接写进 `server/.local-mailbox/messages.jsonl`，不用真发邮件）。
- `server/migrations/`：SQLite 建表脚本（`0001_init.sql` 到 `0005_character_profiles.sql`）。

---

## 2. 完整 API 接口清单 (`server/src/app.js`)

| 模块 | 方法与路径 | 作用 |
| :--- | :--- | :--- |
| **公共/健康** | `GET /api/v1/health` | 检查后端服务是否存活 |
| | `GET /api/v1/public/downloads` | 获取客户端各平台安装包下载信息 |
| | `GET /api/v1/public/entitlement-key` | 获取用于离线验签的 ES256 公钥 |
| **账号认证** | `POST /api/v1/auth/register/request-code` | 请求发送注册邮箱验证码 |
| | `POST /api/v1/auth/register` | 提交验证码与密码完成注册 |
| | `POST /api/v1/auth/login` | 邮箱密码登录，返回 Access Token + Refresh Token |
| | `POST /api/v1/auth/refresh` | 用 Refresh Token 换取新的 Access Token |
| | `POST /api/v1/auth/logout` / `logout-all` | 退出当前设备 / 踢出所有设备 |
| | `POST /api/v1/auth/password/change` | 已登录状态修改密码 |
| | `POST /api/v1/auth/password/forgot` / `verify-reset` / `reset` | 忘记密码三步流程 |
| **个人与会话** | `GET /api/v1/me` / `PATCH /api/v1/me` | 获取当前用户信息 / 修改昵称 |
| | `GET /api/v1/sessions` / `DELETE /api/v1/sessions/:id` | 查看已登录设备列表 / 踢掉某个设备 |
| **云端记忆** | `GET /api/v1/memory` | 列出所有角色的云端记忆 |
| | `GET/PUT /api/v1/memory/settings` | 读取/保存云端记忆开关设置 |
| | `GET/PUT/DELETE /api/v1/memory/:character` | 读写/删除某个角色的长期记忆 |
| | `GET/POST/DELETE /api/v1/memory/:character/chat` | 拉取/上传/清空云端聊天记录 |
| **角色与成长** | `GET /api/v1/characters` / `PUT /api/v1/characters/:id` | 读取/保存自定义角色档案 |
| | `GET /api/v1/progress` | 获取当前好感度、登录天数与**签名的权益快照** |
| | `POST /api/v1/progress/check-in` | 每日签到 |
| | `POST /api/v1/progress/events` | 上报互动事件增加好感度 |
| | `GET /api/v1/skins` | 获取皮肤解锁状态 |

---

## 3. 后端核心密码学与安全算法（必学亮点）

### 3.1 为什么不用 MD5 存密码？(`server/src/password.js`)
早年的老系统用 MD5 存密码，因为 MD5 计算太快（普通显卡每秒算几百亿次），一旦数据库泄露，黑客用彩虹表或暴力枚举几秒钟就能破解。
本项目使用的是 **PBKDF2-HMAC-SHA256**：
- **加盐（Salt）**：每次注册随机生成 16 字节盐值，哪怕两个用户密码都是 `123456`，存进数据库的哈希也完全不同。
- **慢哈希迭代**：故意循环计算 **10,000 次** SHA-256（这是为了适配 Cloudflare 免费版 10ms CPU 限制做的权衡；代码里还预留了 `needsRehash` 机制，以后升级服务器提高迭代次数后，老用户登录会自动无感升级）。
- **防时序攻击 (`timingSafeEqual`)**：比对哈希时不用普通的 `===`（因为 `===` 遇到第一个不匹配的字符就返回，黑客可通过纳秒级耗时差猜出前缀），而是逐字节全部比对完再返回。
- **防邮箱枚举 (`burnPasswordCheck`)**：如果黑客输入一个**根本没注册过的邮箱**尝试登录，服务端不会直接秒回"用户不存在"，而是照样对一个假密码跑一遍完整的 10,000 轮 PBKDF2 计算，让"邮箱不存在"和"密码错误"耗时一模一样，黑客无法探测哪些邮箱注册过。

### 3.2 双 Token 认证与防并发竞争 (`server/src/session.js`)
- **Access Token (JWT, HS256)**：有效期仅 **15 分钟**。每次请求接口放在 HTTP Header 的 `Authorization: Bearer <token>` 里。里面带有 `sv`（安全版本号），一旦用户改密，`sv` 加 1，所有旧 JWT 瞬间作废。
- **Refresh Token**：48 字节超长随机串，有效期 30~180 天。数据库里**不存明文**，只存它的 `SHA-256` 哈希，防止拖库后被直接冒充。

### 3.3 离线权益签名：ECDSA P-256 (`server/src/entitlement.js`)
桌面软件允许用户在**断网**时使用已解锁的服装，但如果直接把 `{skins: ["01", "02"]}` 明文存在本地 JSON 里，用户用记事本改一下就能白嫖所有皮肤。
解决办法是**非对称数字签名（ES256）**：
1. **服务端**用只有自己知道的 **私钥** 对 `{用户ID, 好感度, 已解锁皮肤, 签发时间}` 进行数学签名，生成一串 `signature` 发给客户端。
2. **客户端**只内置 **公钥**（`shared/entitlement-public-key.json`）。断网时用公钥验证签名是否匹配：只要改了一个字符，验签就会失败；而因为没有私钥，客户端绝对无法伪造签名。
