# 纸间 Windows 桌面版

`release/纸间.exe` 是 x64 Windows 的单文件程序，使用无标题栏窗口；最小化、最大化和关闭按钮位于页面导航栏，窗口边缘可拖动调整大小。运行需要 Microsoft Edge WebView2 Runtime 和 Windows 自带的 .NET Framework 4.6.2 或更高版本。

首次启动时，程序将内嵌的页面和运行组件解压到 `%LOCALAPPDATA%\PaperNotes\Versions`。WebView2 的用户资料（包括本机草稿）保存在 `%LOCALAPPDATA%\PaperNotes\WebView2`，不同版本的 EXE 共用同一目录。不要清除该目录中仍需保留的草稿。

桌面应用和浏览器的草稿分别保存。桌面版联网启动后和切换回来时会检查 GitHub 的最新版本，网页中尚未同步的草稿需先在网页中同步。本地草稿不会被远端更新覆盖；桌面版通过 GitHub 同步设置连接，并用批量同步提交勾选的笔记。两端同时修改时需先处理同步冲突。

桌面版的 GitHub 令牌使用 Windows 数据保护 API 按当前 Windows 用户加密保存在 `%LOCALAPPDATA%\PaperNotes\github-token.dat`，可在同步设置中断开并清除。若换 Windows 用户或重装系统，加密的令牌可能无法恢复，需要重新连接。

## 重新构建

在 Windows x64 的项目目录先执行 `npm ci`，然后运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\build.ps1
```

构建脚本会校验并缓存微软发布的 WebView2 SDK，构建 VitePress 后生成 `release/纸间.exe`。图标可用 `desktop/make-icon.ps1` 重新生成。
