# 纸间 Windows 桌面版

`release/纸间.exe` 是 x64 Windows 的单文件程序，使用无标题栏窗口；最小化、最大化和关闭按钮位于页面导航栏，窗口边缘可拖动调整大小。运行需要 Microsoft Edge WebView2 Runtime 和 Windows 自带的 .NET Framework 4.6.2 或更高版本。

首次启动时，程序将内嵌的页面和运行组件解压到 `%LOCALAPPDATA%\PaperNotes\Versions`。WebView2 的用户资料（包括本机草稿）保存在 `%LOCALAPPDATA%\PaperNotes\WebView2`，不同版本的 EXE 共用同一目录。不要清除该目录中仍需保留的草稿。

## 便携版

将便携版 ZIP **完整解压**到有写入权限的文件夹，保留 EXE 旁边的 `portable.mode` 文件，然后双击 EXE。请勿直接在压缩包内运行。程序会在 EXE 旁边创建 `纸间数据` 文件夹，运行文件、WebView2 资料、本机草稿、离线笔记和加密令牌都保存在里面。需要携带笔记时，请连同 EXE、`portable.mode` 和 `纸间数据` 一起复制。

普通 EXE 旁没有 `portable.mode`，继续使用原有的 `%LOCALAPPDATA%\PaperNotes`，不会自动搬迁或覆盖已有草稿。便携版与普通版数据各自独立；需要共享笔记时，可分别连接同一 GitHub 仓库并使用同步和恢复。Windows 加密的令牌可能不能在另一台电脑或另一个 Windows 用户下解密，届时需要重新连接。

桌面应用和浏览器的草稿分别保存。桌面版联网启动后和切换回来时会检查 GitHub 的最新版本，网页中尚未同步的草稿需先在网页中同步。本地草稿不会被远端更新覆盖；桌面版通过 GitHub 同步设置连接，并用批量同步提交勾选的笔记。两端同时修改时需先处理同步冲突。

顶部「恢复」会下载 GitHub 的书柜、笔记本与章节，保存为本机离线副本，已有未同步草稿仍保留；「同步」用于提交勾选的本机项目。书柜和章节目录中可批量删除内容：删除已同步内容需要连接 GitHub，确认后才会从仓库及本机删除，发生版本冲突时不会执行删除。

在同步设置中填写自己的 GitHub 仓库（`owner/repository` 或仓库 HTTPS 地址）和精细访问令牌。每个仓库使用独立的本机数据和令牌；切换时不会自动把其他仓库的笔记或凭据带过去。桌面版通过 Windows 数据保护 API 按当前 Windows 用户加密保存在 `%LOCALAPPDATA%\PaperNotes\Credentials`，文件名由仓库标识的哈希生成，可在同步设置中断开并清除。旧版的单个令牌文件保留但不会自动用于新选仓库。若换 Windows 用户或重装系统，加密的令牌可能无法恢复，需要重新连接。

## 重新构建

在 Windows x64 的项目目录先执行 `npm ci`，然后运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\build.ps1
```

构建脚本会校验并缓存微软发布的 WebView2 SDK，构建 VitePress 后生成 `release/纸间.exe`。图标可用 `desktop/make-icon.ps1` 重新生成。
