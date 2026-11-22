using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace PaperNotesDesktop
{
    internal static class Program
    {
        private const string PayloadName = "PaperNotes.Payload";
        private static string runtimeDirectory;

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool SetDllDirectory(string path);

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try
            {
                bool portable;
                string appData = ResolveDataDirectory(Application.ExecutablePath,
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), out portable);
                if (portable) EnsurePortableDataDirectory(appData);
                runtimeDirectory = ExtractPayload(Path.Combine(appData, "Versions"));
                AppDomain.CurrentDomain.AssemblyResolve += ResolveBundledAssembly;
                if (!SetDllDirectory(runtimeDirectory))
                    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());

                StartWindow(runtimeDirectory, Path.Combine(appData, "WebView2"));
            }
            catch (Exception exception)
            {
                MessageBox.Show("无法启动纸间。请检查程序所在目录的写入权限，并确认已安装 Microsoft Edge WebView2 Runtime。\n\n" +
                    exception.Message, "纸间", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        // The executable location, never the shell's working directory, controls
        // portable mode. A standalone executable preserves the original profile.
        private static string ResolveDataDirectory(string executablePath, string localAppData, out bool portable)
        {
            string executableDirectory = Path.GetDirectoryName(Path.GetFullPath(executablePath));
            if (String.IsNullOrEmpty(executableDirectory)) throw new InvalidOperationException("无法确定程序所在目录。");
            portable = File.Exists(Path.Combine(executableDirectory, "portable.mode"));
            return portable ? Path.Combine(executableDirectory, "纸间数据") : Path.Combine(localAppData, "PaperNotes");
        }

        private static void EnsurePortableDataDirectory(string directory)
        {
            try
            {
                Directory.CreateDirectory(directory);
                string probe = Path.Combine(directory, ".write-test-" + Guid.NewGuid().ToString("N"));
                try
                {
                    using (FileStream stream = new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        stream.WriteByte(0);
                }
                finally { if (File.Exists(probe)) File.Delete(probe); }
            }
            catch (Exception exception)
            {
                if (!(exception is UnauthorizedAccessException) && !(exception is IOException) && !(exception is System.Security.SecurityException)) throw;
                throw new InvalidOperationException("便携版无法写入“纸间数据”。请先完整解压压缩包，并将文件夹放到有写入权限的位置后重试。", exception);
            }
        }

        // The WebView2 types are referenced only after our assembly resolver is installed.
        private static void StartWindow(string root, string profile)
        {
            Application.Run(new MainWindow(root, profile));
        }

        private static Assembly ResolveBundledAssembly(object sender, ResolveEventArgs args)
        {
            string name = new AssemblyName(args.Name).Name;
            if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms")
                return null;
            return Assembly.LoadFrom(Path.Combine(runtimeDirectory, name + ".dll"));
        }

        private static string ExtractPayload(string versionsDirectory)
        {
            byte[] bytes;
            using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadName))
            {
                if (resource == null) throw new InvalidOperationException("程序资源缺失。");
                using (var buffer = new MemoryStream())
                {
                    resource.CopyTo(buffer);
                    bytes = buffer.ToArray();
                }
            }

            string digest;
            using (SHA256 hash = SHA256.Create())
                digest = BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
            Directory.CreateDirectory(versionsDirectory);
            string destination = Path.Combine(versionsDirectory, digest);
            string ready = Path.Combine(destination, ".ready");
            if (File.Exists(ready)) return destination;

            string temporary = Path.Combine(versionsDirectory, ".extract-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temporary);
            try
            {
                using (var input = new MemoryStream(bytes))
                using (var archive = new ZipArchive(input, ZipArchiveMode.Read))
                {
                    string safeRoot = Path.GetFullPath(temporary) + Path.DirectorySeparatorChar;
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        string path = Path.GetFullPath(Path.Combine(temporary, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
                        if (!path.StartsWith(safeRoot, StringComparison.OrdinalIgnoreCase))
                            throw new InvalidDataException("资源路径无效。");
                        if (String.IsNullOrEmpty(entry.Name))
                        {
                            Directory.CreateDirectory(path);
                            continue;
                        }
                        Directory.CreateDirectory(Path.GetDirectoryName(path));
                        using (Stream source = entry.Open())
                        using (FileStream target = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                            source.CopyTo(target);
                    }
                }
                File.WriteAllText(Path.Combine(temporary, ".ready"), digest, Encoding.UTF8);
                try { Directory.Move(temporary, destination); }
                catch (IOException)
                {
                    if (!File.Exists(ready)) throw;
                }
            }
            finally
            {
                if (Directory.Exists(temporary)) Directory.Delete(temporary, true);
            }
            return destination;
        }
    }

    internal sealed class MainWindow : Form
    {
        private const string AppHost = "paper.local";
        private const string StartUrl = "https://paper.local/my-notes/index.html";
        private readonly string root;
        private readonly string profile;
        private readonly string credentialDirectory;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private Microsoft.Web.WebView2.WinForms.WebView2 webView;

        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();
        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hWnd, int message, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
        [DllImport("dwmapi.dll")]
        private static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref Margins margins);

        [StructLayout(LayoutKind.Sequential)]
        private struct Margins { public int Left, Right, Top, Bottom; }
        [StructLayout(LayoutKind.Sequential)]
        private struct NativePoint { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)]
        private struct NativeRect { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)]
        private struct MonitorInfo { public int Size; public NativeRect Monitor, Work; public uint Flags; }
        [StructLayout(LayoutKind.Sequential)]
        private struct MinMaxInfo { public NativePoint Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize; }

        public MainWindow(string root, string profile)
        {
            this.root = root;
            this.profile = profile;
            credentialDirectory = Path.Combine(Path.GetDirectoryName(profile), "Credentials");
            Text = "纸间";
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1280, 820);
            MinimumSize = new Size(760, 520);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            Shown += StartWebView;
        }

        private async void StartWebView(object sender, EventArgs args)
        {
            try
            {
                Directory.CreateDirectory(profile);
                webView = new Microsoft.Web.WebView2.WinForms.WebView2();
                webView.Dock = DockStyle.Fill;
                Controls.Add(webView);

                var environment = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, profile);
                await webView.EnsureCoreWebView2Async(environment);
                var core = webView.CoreWebView2;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.IsWebMessageEnabled = true;
                core.Settings.AreBrowserAcceleratorKeysEnabled = false;
                core.SetVirtualHostNameToFolderMapping(
                    AppHost, Path.Combine(root, "site"),
                    Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind.DenyCors);
                core.NavigationStarting += NavigationStarting;
                core.NewWindowRequested += NewWindowRequested;
                core.PermissionRequested += PermissionRequested;
                core.WebMessageReceived += WebMessageReceived;
                core.Navigate(StartUrl);
            }
            catch (Exception exception)
            {
                MessageBox.Show("无法加载笔记页面，请确认 Microsoft Edge WebView2 Runtime 可用。\n\n" +
                    exception.Message, "纸间", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        // Retain native window sizing and snapping while suppressing the entire caption.
        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams parameters = base.CreateParams;
                parameters.Style |= 0x00040000 | 0x00020000 | 0x00010000;
                return parameters;
            }
        }

        protected override void OnHandleCreated(EventArgs args)
        {
            base.OnHandleCreated(args);
            try
            {
                // DWM paints the normal system border/shadow, and Windows 11
                // clips the window to its native rounded-corner geometry.
                int renderingEnabled = 2; // DWMNCRP_ENABLED
                DwmSetWindowAttribute(Handle, 2, ref renderingEnabled, sizeof(int));
                int rounded = 2; // DWMWCP_ROUND; ignored on older Windows
                DwmSetWindowAttribute(Handle, 33, ref rounded, sizeof(int));
                var margins = new Margins { Left = 1, Right = 1, Top = 1, Bottom = 1 };
                DwmExtendFrameIntoClientArea(Handle, ref margins);
            }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
        }

        protected override void WndProc(ref Message message)
        {
            const int WmGetMinMaxInfo = 0x0024, WmNcCalcSize = 0x0083, WmNcHitTest = 0x0084;
            if (message.Msg == WmGetMinMaxInfo)
            {
                base.WndProc(ref message);
                // A captionless window has no nonclient inset, so use the
                // actual monitor work area and never cover the taskbar.
                IntPtr monitor = MonitorFromWindow(message.HWnd, 2);
                var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
                if (monitor != IntPtr.Zero && GetMonitorInfo(monitor, ref info))
                {
                    var limits = (MinMaxInfo)Marshal.PtrToStructure(message.LParam, typeof(MinMaxInfo));
                    limits.MaxPosition.X = info.Work.Left - info.Monitor.Left;
                    limits.MaxPosition.Y = info.Work.Top - info.Monitor.Top;
                    limits.MaxSize.X = info.Work.Right - info.Work.Left;
                    limits.MaxSize.Y = info.Work.Bottom - info.Work.Top;
                    Marshal.StructureToPtr(limits, message.LParam, false);
                }
                return;
            }
            if (message.Msg == WmNcCalcSize && message.WParam != IntPtr.Zero)
            {
                message.Result = IntPtr.Zero;
                return;
            }
            if (message.Msg == WmNcHitTest && WindowState == FormWindowState.Normal)
            {
                int packed = unchecked((int)(long)message.LParam);
                Point pt = PointToClient(new Point((short)(packed & 0xffff), (short)((packed >> 16) & 0xffff)));
                const int edge = 7;
                bool left = pt.X >= 0 && pt.X < edge, right = pt.X >= ClientSize.Width - edge && pt.X < ClientSize.Width;
                bool top = pt.Y >= 0 && pt.Y < edge, bottom = pt.Y >= ClientSize.Height - edge && pt.Y < ClientSize.Height;
                int result = top && left ? 13 : top && right ? 14 : bottom && left ? 16 : bottom && right ? 17 :
                    left ? 10 : right ? 11 : top ? 12 : bottom ? 15 : 0;
                if (result != 0) { message.Result = new IntPtr(result); return; }
            }
            base.WndProc(ref message);
        }

        private void WebMessageReceived(object sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs args)
        {
            Uri source;
            if (!Uri.TryCreate(args.Source, UriKind.Absolute, out source) ||
                !IsAppUrl(source) || source.Port != 443 || source.AbsolutePath != "/my-notes/index.html") return;
            Dictionary<string, object> request;
            try { request = json.Deserialize<Dictionary<string, object>>(args.WebMessageAsJson); }
            catch { return; }
            if (request == null || GetString(request, "channel") != "paper-notes") return;
            string action = GetString(request, "action");
            if (action == "window.minimize") { WindowState = FormWindowState.Minimized; return; }
            if (action == "window.maximize")
            {
                if (WindowState == FormWindowState.Maximized) WindowState = FormWindowState.Normal;
                else { MaximizedBounds = Screen.FromControl(this).WorkingArea; WindowState = FormWindowState.Maximized; }
                return;
            }
            if (action == "window.close") { Close(); return; }
            if (action == "window.drag")
            {
                ReleaseCapture(); SendMessage(Handle, 0x00A1, new IntPtr(2), IntPtr.Zero);
                return;
            }
            string id = GetString(request, "id");
            if (String.IsNullOrEmpty(id) || id.Length > 128) return;
            var response = new Dictionary<string, object> { { "channel", "paper-notes" }, { "id", id } };
            try
            {
                if (action != "token.get" && action != "token.set" && action != "token.clear" && action != "token.importLegacy") return;
                string credentialPath = GetCredentialPath(GetString(request, "repository"));
                if (action == "token.get")
                {
                    string token = null;
                    if (File.Exists(credentialPath))
                        token = Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(credentialPath), null, DataProtectionScope.CurrentUser));
                    response["token"] = token;
                }
                else if (action == "token.set")
                {
                    string token = GetString(request, "token");
                    if (String.IsNullOrWhiteSpace(token) || token.Length > 8192) throw new ArgumentException("令牌无效。");
                    byte[] encrypted = ProtectedData.Protect(Encoding.UTF8.GetBytes(token), null, DataProtectionScope.CurrentUser);
                    Directory.CreateDirectory(Path.GetDirectoryName(credentialPath));
                    string temporary = credentialPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
                    try
                    {
                        File.WriteAllBytes(temporary, encrypted);
                        if (File.Exists(credentialPath)) File.Replace(temporary, credentialPath, null);
                        else File.Move(temporary, credentialPath);
                    }
                    finally { if (File.Exists(temporary)) File.Delete(temporary); }
                }
                else if (action == "token.clear") { if (File.Exists(credentialPath)) File.Delete(credentialPath); }
                else if (action == "token.importLegacy")
                {
                    ImportLegacyCredential(credentialPath);
                    response["imported"] = true;
                }
                else return;
                response["ok"] = true;
            }
            catch (InvalidOperationException exception)
            {
                response["ok"] = false;
                response["error"] = exception.Message;
            }
            catch
            {
                response["ok"] = false;
                response["error"] = "无法访问 Windows 加密存储。";
            }
            webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(response));
        }

        private void ImportLegacyCredential(string target)
        {
            string legacy = Path.Combine(Path.GetDirectoryName(profile), "github-token.dat");
            if (!File.Exists(legacy)) throw new InvalidOperationException("没有找到旧版已保存的令牌。请手动输入令牌。");
            if (File.Exists(target)) throw new InvalidOperationException("此仓库已经保存令牌，旧令牌不会覆盖它。");
            byte[] decoded = ProtectedData.Unprotect(File.ReadAllBytes(legacy), null, DataProtectionScope.CurrentUser);
            try
            {
                if (decoded.Length == 0 || decoded.Length > 8192) throw new InvalidOperationException("旧版令牌无效，请手动输入令牌。");
                byte[] encrypted = ProtectedData.Protect(decoded, null, DataProtectionScope.CurrentUser);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                string temporary = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
                try
                {
                    File.WriteAllBytes(temporary, encrypted);
                    // Move is atomic and will not overwrite a token that appeared meanwhile.
                    File.Move(temporary, target);
                }
                finally { if (File.Exists(temporary)) File.Delete(temporary); }
            }
            finally { Array.Clear(decoded, 0, decoded.Length); }
        }

        private string GetCredentialPath(string repository)
        {
            // The page supplies an owner/repo identity, never a filesystem path.
            // GitHub repository names are case-insensitive.
            string value = (repository ?? "").Trim().ToLowerInvariant();
            string[] parts = value.Split('/');
            if (parts.Length != 2 || !Regex.IsMatch(parts[0], @"^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$") ||
                parts[0].Contains("--") || !Regex.IsMatch(parts[1], @"^[a-z0-9._-]{1,100}$") || parts[1] == "." || parts[1] == "..")
                throw new ArgumentException("仓库标识无效。");
            byte[] digest;
            using (SHA256 hash = SHA256.Create()) digest = hash.ComputeHash(Encoding.UTF8.GetBytes(value));
            string name = BitConverter.ToString(digest).Replace("-", "").ToLowerInvariant();
            return Path.Combine(credentialDirectory, name + ".dat");
        }

        private static string GetString(Dictionary<string, object> data, string key)
        {
            object value;
            return data.TryGetValue(key, out value) ? value as string : null;
        }

        private static bool IsAppUrl(Uri uri)
        {
            return uri != null && uri.Scheme == Uri.UriSchemeHttps &&
                String.Equals(uri.Host, AppHost, StringComparison.OrdinalIgnoreCase) &&
                (uri.AbsolutePath == "/my-notes" || uri.AbsolutePath.StartsWith("/my-notes/", StringComparison.Ordinal));
        }

        private static string NormalizeAppUrl(Uri uri)
        {
            if (uri.AbsolutePath != "/my-notes" && uri.AbsolutePath != "/my-notes/")
                return uri.AbsoluteUri;
            var builder = new UriBuilder(uri);
            builder.Path = "/my-notes/index.html";
            return builder.Uri.AbsoluteUri;
        }

        private void NavigationStarting(object sender, Microsoft.Web.WebView2.Core.CoreWebView2NavigationStartingEventArgs args)
        {
            Uri uri;
            if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out uri))
            {
                args.Cancel = true;
                return;
            }
            if (IsAppUrl(uri))
            {
                string normalized = NormalizeAppUrl(uri);
                if (normalized != uri.AbsoluteUri)
                {
                    args.Cancel = true;
                    webView.CoreWebView2.Navigate(normalized);
                }
                return;
            }
            args.Cancel = true;
            OpenExternal(uri);
        }

        private void NewWindowRequested(object sender, Microsoft.Web.WebView2.Core.CoreWebView2NewWindowRequestedEventArgs args)
        {
            args.Handled = true;
            Uri uri;
            if (Uri.TryCreate(args.Uri, UriKind.Absolute, out uri))
            {
                if (IsAppUrl(uri)) webView.CoreWebView2.Navigate(NormalizeAppUrl(uri));
                else OpenExternal(uri);
            }
        }

        private static void OpenExternal(Uri uri)
        {
            if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) return;
            if (String.Equals(uri.Host, AppHost, StringComparison.OrdinalIgnoreCase)) return;
            try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); }
            catch (Exception exception)
            {
                MessageBox.Show("无法打开链接。\n\n" + exception.Message, "纸间", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private static void PermissionRequested(object sender, Microsoft.Web.WebView2.Core.CoreWebView2PermissionRequestedEventArgs args)
        {
            args.State = Microsoft.Web.WebView2.Core.CoreWebView2PermissionState.Deny;
        }
    }
}
