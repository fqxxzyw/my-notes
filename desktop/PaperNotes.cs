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

    // Immutable assets live alongside the desktop data, not in the bundled
    // website or the WebView cache. Paths come from a strict managed namespace.
    internal static class AttachmentFiles
    {
        private const int MaximumBytes = 20 * 1024 * 1024;
        private static readonly Regex AllowedPath = new Regex(@"^docs/(?:notebooks/[A-Za-z0-9_-]+|pages)/assets/[a-f0-9]{32}\.(?:png|jpg|gif|webp)$", RegexOptions.CultureInvariant);

        private static string RepositoryScope(string repository)
        {
            string value = (repository ?? "").Trim().ToLowerInvariant();
            if (value.Length == 0) return "local";
            string normalized = Regex.Replace(value, @"^(?:github|gitee|gitlab|gitcode):", "");
            string[] parts = normalized.Split('/');
            if (parts.Length != 2 || !Regex.IsMatch(parts[0], @"^[a-z0-9](?:[a-z0-9._-]{0,37}[a-z0-9])?$") ||
                parts[0].Contains("--") || !Regex.IsMatch(parts[1], @"^[a-z0-9._-]{1,100}$") || parts[1] == "." || parts[1] == "..")
                throw new InvalidOperationException("仓库标识无效。");
            byte[] digest;
            using (SHA256 hash = SHA256.Create()) digest = hash.ComputeHash(Encoding.UTF8.GetBytes(value));
            return "repo-" + BitConverter.ToString(digest).Replace("-", "").ToLowerInvariant();
        }

        private static string Resolve(string baseDirectory, string repository, string path)
        {
            if (String.IsNullOrEmpty(path) || !AllowedPath.IsMatch(path)) throw new InvalidOperationException("图片附件路径无效。");
            string root = Path.GetFullPath(baseDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string file = Path.GetFullPath(Path.Combine(root, RepositoryScope(repository), path.Replace('/', Path.DirectorySeparatorChar)));
            if (!file.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("图片附件路径无效。");
            return file;
        }

        private static void CheckDirectory(string directory)
        {
            if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("图片附件目录不能是链接或重解析点。");
        }

        private static void CheckParents(string baseDirectory, string file, bool create)
        {
            string root = Path.GetFullPath(baseDirectory).TrimEnd(Path.DirectorySeparatorChar);
            if (!Directory.Exists(root)) { if (!create) return; Directory.CreateDirectory(root); }
            CheckDirectory(root);
            string relative = Path.GetDirectoryName(file).Substring(root.Length).TrimStart(Path.DirectorySeparatorChar);
            string current = root;
            foreach (string component in relative.Split(Path.DirectorySeparatorChar))
            {
                if (component.Length == 0) continue;
                current = Path.Combine(current, component);
                if (!Directory.Exists(current)) { if (!create) return; Directory.CreateDirectory(current); }
                CheckDirectory(current);
            }
        }

        internal static void ValidateImage(string path, byte[] bytes)
        {
            if (bytes == null || bytes.Length == 0 || bytes.Length > MaximumBytes) throw new InvalidOperationException("图片为空或超过 20 MiB。");
            bool png = bytes.Length >= 8 && bytes[0] == 137 && bytes[1] == 80 && bytes[2] == 78 && bytes[3] == 71 && bytes[4] == 13 && bytes[5] == 10 && bytes[6] == 26 && bytes[7] == 10;
            bool jpg = bytes.Length >= 3 && bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255;
            bool gif = bytes.Length >= 6 && Encoding.ASCII.GetString(bytes, 0, 6).StartsWith("GIF8", StringComparison.Ordinal) && (bytes[4] == 55 || bytes[4] == 57) && bytes[5] == 97;
            bool webp = bytes.Length >= 12 && Encoding.ASCII.GetString(bytes, 0, 4) == "RIFF" && Encoding.ASCII.GetString(bytes, 8, 4) == "WEBP";
            string ext = Path.GetExtension(path);
            if (!(ext == ".png" && png || (ext == ".jpg" || ext == ".jpeg") && jpg || ext == ".gif" && gif || ext == ".webp" && webp))
                throw new InvalidOperationException("图片内容与文件格式不匹配。");
        }

        internal static byte[] Read(string baseDirectory, string repository, string path)
        {
            string file = Resolve(baseDirectory, repository, path);
            CheckParents(baseDirectory, file, false);
            if (!File.Exists(file)) return null;
            if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("图片附件不能是链接。");
            if (new FileInfo(file).Length > MaximumBytes) throw new InvalidOperationException("图片附件超过 20 MiB。");
            byte[] bytes = File.ReadAllBytes(file);
            ValidateImage(path, bytes);
            return bytes;
        }

        internal static void Write(string baseDirectory, string repository, string path, byte[] bytes)
        {
            string file = Resolve(baseDirectory, repository, path);
            ValidateImage(path, bytes);
            CheckParents(baseDirectory, file, true);
            if (File.Exists(file)) { VerifySame(Read(baseDirectory, repository, path), bytes); return; }
            string temporary = Path.Combine(Path.GetDirectoryName(file), ".image-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                using (FileStream stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                { stream.Write(bytes, 0, bytes.Length); stream.Flush(true); }
                try { File.Move(temporary, file); }
                catch (IOException) { if (!File.Exists(file)) throw; VerifySame(Read(baseDirectory, repository, path), bytes); }
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        private static void VerifySame(byte[] existing, byte[] next)
        {
            if (existing == null || existing.Length != next.Length) throw new InvalidOperationException("图片路径已存在不同内容，已保留原文件。");
            for (int i = 0; i < existing.Length; i++) if (existing[i] != next[i]) throw new InvalidOperationException("图片路径已存在不同内容，已保留原文件。");
        }
    }

    // Immutable read-only imported documents (.pdf, .doc, .docx, .ppt, .pptx, etc.)
    // live under 纸间数据\文件\, scoped by repository and validated against traversal.
    internal static class DocumentFiles
    {
        private const int MaximumBytes = 50 * 1024 * 1024;
        private static readonly Regex AllowedPath = new Regex(@"^docs/(?:notebooks/[A-Za-z0-9_-]+|pages)/files/[a-f0-9]{32}\.(?:pdf|doc|docx|ppt|pptx|xls|xlsx|csv|rtf)$", RegexOptions.CultureInvariant);

        private static string RepositoryScope(string repository)
        {
            string value = (repository ?? "").Trim().ToLowerInvariant();
            if (value.Length == 0) return "local";
            string normalized = Regex.Replace(value, @"^(?:github|gitee|gitlab|gitcode):", "");
            string[] parts = normalized.Split('/');
            if (parts.Length != 2 || !Regex.IsMatch(parts[0], @"^[a-z0-9](?:[a-z0-9._-]{0,37}[a-z0-9])?$") ||
                parts[0].Contains("--") || !Regex.IsMatch(parts[1], @"^[a-z0-9._-]{1,100}$") || parts[1] == "." || parts[1] == "..")
                throw new InvalidOperationException("仓库标识无效。");
            byte[] digest;
            using (SHA256 hash = SHA256.Create()) digest = hash.ComputeHash(Encoding.UTF8.GetBytes(value));
            return "repo-" + BitConverter.ToString(digest).Replace("-", "").ToLowerInvariant();
        }

        private static string Resolve(string baseDirectory, string repository, string path)
        {
            if (String.IsNullOrEmpty(path) || !AllowedPath.IsMatch(path)) throw new InvalidOperationException("文档存储路径无效。");
            string root = Path.GetFullPath(baseDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string file = Path.GetFullPath(Path.Combine(root, RepositoryScope(repository), path.Replace('/', Path.DirectorySeparatorChar)));
            if (!file.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("文档存储路径无效。");
            return file;
        }

        private static void CheckDirectory(string directory)
        {
            if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("文档目录不能是链接或重解析点。");
        }

        private static void CheckParents(string baseDirectory, string file, bool create)
        {
            string root = Path.GetFullPath(baseDirectory).TrimEnd(Path.DirectorySeparatorChar);
            if (!Directory.Exists(root)) { if (!create) return; Directory.CreateDirectory(root); }
            CheckDirectory(root);
            string relative = Path.GetDirectoryName(file).Substring(root.Length).TrimStart(Path.DirectorySeparatorChar);
            string current = root;
            foreach (string component in relative.Split(Path.DirectorySeparatorChar))
            {
                if (component.Length == 0) continue;
                current = Path.Combine(current, component);
                if (!Directory.Exists(current)) { if (!create) return; Directory.CreateDirectory(current); }
                CheckDirectory(current);
            }
        }

        internal static byte[] Read(string baseDirectory, string repository, string path)
        {
            string file = Resolve(baseDirectory, repository, path);
            CheckParents(baseDirectory, file, false);
            if (!File.Exists(file)) return null;
            if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("文档文件不能是链接。");
            long length = new FileInfo(file).Length;
            if (length <= 0 || length > MaximumBytes) throw new InvalidOperationException("文档为空或超过 50 MiB。");
            return File.ReadAllBytes(file);
        }

        internal static void Write(string baseDirectory, string repository, string path, byte[] bytes)
        {
            string file = Resolve(baseDirectory, repository, path);
            if (bytes == null || bytes.Length == 0 || bytes.Length > MaximumBytes) throw new InvalidOperationException("文档为空或超过 50 MiB。");
            CheckParents(baseDirectory, file, true);
            if (File.Exists(file))
            {
                byte[] existing = Read(baseDirectory, repository, path);
                if (existing == null || existing.Length != bytes.Length) throw new InvalidOperationException("文档路径已存在不同内容，已保留原文件。");
                for (int i = 0; i < existing.Length; i++) if (existing[i] != bytes[i]) throw new InvalidOperationException("文档路径已存在不同内容，已保留原文件。");
                return;
            }
            string temporary = Path.Combine(Path.GetDirectoryName(file), ".doc-" + Guid.NewGuid().ToString("N") + ".tmp");
            try
            {
                using (FileStream stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                { stream.Write(bytes, 0, bytes.Length); stream.Flush(true); }
                try { File.Move(temporary, file); }
                catch (IOException) { if (!File.Exists(file)) throw; }
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        internal static void OpenExternal(string baseDirectory, string repository, string path, string displayName)
        {
            byte[] bytes = Read(baseDirectory, repository, path);
            if (bytes == null) throw new InvalidOperationException("本机未找到该文档，无法打开。");
            string ext = Path.GetExtension(path).ToLowerInvariant();
            string cleanName = Path.GetFileNameWithoutExtension((displayName ?? "").Trim());
            if (String.IsNullOrWhiteSpace(cleanName)) cleanName = "文档";
            foreach (char invalid in Path.GetInvalidFileNameChars()) cleanName = cleanName.Replace(invalid, '_');
            cleanName = cleanName.Trim().TrimEnd('.');
            if (cleanName.Length > 80) cleanName = cleanName.Substring(0, 80);
            if (String.IsNullOrEmpty(cleanName) || Regex.IsMatch(cleanName, @"^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
                cleanName = "文档";
            string openDir = Path.Combine(Path.GetFullPath(baseDirectory), "_open", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(openDir);
            string target = Path.Combine(openDir, cleanName + ext);
            File.WriteAllBytes(target, bytes);
            try { File.SetAttributes(target, FileAttributes.ReadOnly); } catch { }
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
    }

    // Import only exact local image paths referenced by the selected Markdown.
    // Never enumerate directories, follow reparse points, or access network/ADS paths.
    internal static class ReferencedImageFiles
    {
        private const long MaximumBytes = 20L * 1024 * 1024;

        // The selected source is cached from the same bytes sent to the UI.
        // Require the requested target to occur there; the Markdown parser in
        // the trusted UI further restricts requests to actual image syntax.
        internal static bool MentionsPath(string markdown, string target)
        {
            if (String.IsNullOrWhiteSpace(markdown) || String.IsNullOrWhiteSpace(target)) return false;
            try
            {
                return NormalizedMentionsPath(NormalizeSource(markdown), target);
            }
            catch { return false; }
        }

        internal static string NormalizeSource(string markdown)
        {
            var result = new StringBuilder();
            bool inComment = false, inFence = false;
            char fenceChar = '\0'; int fenceLength = 0;
            string rawTag = null;
            using (var reader = new StringReader(markdown))
            {
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    string containerText = StripMarkdownContainers(line);
                    var fence = Regex.Match(containerText, @"^ {0,3}(`{3,}|~{3,})");
                    if (inFence)
                    {
                        if (fence.Success && fence.Groups[1].Value[0] == fenceChar && fence.Groups[1].Length >= fenceLength && String.IsNullOrWhiteSpace(containerText.Substring(fence.Length))) inFence = false;
                        result.Append('\n'); continue;
                    }
                    var clean = new StringBuilder();
                    for (int i = 0; i < line.Length;)
                    {
                        if (inComment)
                        {
                            int end = line.IndexOf("-->", i, StringComparison.Ordinal);
                            if (end < 0) break;
                            inComment = false; i = end + 3; continue;
                        }
                        if (rawTag != null)
                        {
                            int end = line.IndexOf("</" + rawTag, i, StringComparison.OrdinalIgnoreCase);
                            if (end < 0) break;
                            int close = line.IndexOf('>', end);
                            if (close < 0) break;
                            rawTag = null; i = close + 1; continue;
                        }
                        if (i + 4 <= line.Length && String.CompareOrdinal(line, i, "<!--", 0, 4) == 0) { inComment = true; i += 4; continue; }
                        bool startedRaw = false;
                        foreach (string tag in new[] { "script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext", "pre", "code" })
                        {
                            string open = "<" + tag;
                            if (i + open.Length < line.Length && String.Compare(line, i, open, 0, open.Length, StringComparison.OrdinalIgnoreCase) == 0 && (Char.IsWhiteSpace(line[i + open.Length]) || line[i + open.Length] == '>'))
                            { rawTag = tag; startedRaw = true; break; }
                        }
                        if (startedRaw) continue;
                        clean.Append(line[i++]);
                    }
                    string text = clean.ToString();
                    containerText = StripMarkdownContainers(text);
                    fence = Regex.Match(containerText, @"^ {0,3}(`{3,}|~{3,})");
                    if (fence.Success) { inFence = true; fenceChar = fence.Groups[1].Value[0]; fenceLength = fence.Groups[1].Length; result.Append('\n'); continue; }
                    if (containerText.StartsWith("    ", StringComparison.Ordinal) || containerText.StartsWith("\t", StringComparison.Ordinal)) { result.Append('\n'); continue; }
                    result.Append(Regex.Replace(text, @"^(?: {0,3}>[ \t]?)+", "")).Append('\n');
                }
            }
            return StripInlineCode(StripUntrustedHtmlTags(result.ToString()));
        }

        private static string StripUntrustedHtmlTags(string text)
        {
            var result = new StringBuilder();
            for (int i = 0; i < text.Length;)
            {
                if (text[i] != '<') { result.Append(text[i++]); continue; }
                int name = i + 1;
                if (name < text.Length && text[name] == '/') name++;
                if (name >= text.Length || !(text[name] >= 'A' && text[name] <= 'Z' || text[name] >= 'a' && text[name] <= 'z')) { result.Append(text[i++]); continue; }
                int endName = name;
                while (endName < text.Length && Char.IsLetterOrDigit(text[endName])) endName++;
                if (endName == name || endName >= text.Length || !(Char.IsWhiteSpace(text[endName]) || text[endName] == '/' || text[endName] == '>')) { result.Append(text[i++]); continue; }
                int end = endName; char quote = '\0';
                for (; end < text.Length; end++)
                {
                    char c = text[end];
                    if (quote != '\0') { if (c == quote) quote = '\0'; continue; }
                    if (c == '\'' || c == '\"') quote = c;
                    else if (c == '>') break;
                }
                if (end >= text.Length) break; // incomplete tag: conservatively discard the rest
                int lineStart = text.LastIndexOf('\n', i);
                string prefix = text.Substring(lineStart + 1, i - lineStart - 1);
                if (Regex.IsMatch(prefix, @"!\[(?:\\.|[^\]\\\r\n])*\]\([ \t]*$") || Regex.IsMatch(prefix, @"^ {0,3}\[[^\]\r\n]+\]:[ \t]*$"))
                { result.Append(text, i, end - i + 1); i = end + 1; continue; }
                bool image = name == i + 1 && String.Equals(text.Substring(name, endName - name), "img", StringComparison.OrdinalIgnoreCase);
                if (image) result.Append(text, i, end - i + 1);
                i = end + 1;
            }
            return result.ToString();
        }

        private static string StripMarkdownContainers(string text)
        {
            string result = Regex.Replace(text, @"^(?: {0,3}>[ \t]?)+", "");
            return Regex.Replace(result, @"^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+(?=`{3,}|~{3,})", "");
        }

        private static string StripInlineCode(string text)
        {
            var clean = new StringBuilder();
            for (int i = 0; i < text.Length;)
            {
                if (text[i] != '`' || MarkdownEscaped(text, i)) { clean.Append(text[i++]); continue; }
                int start = i; while (i < text.Length && text[i] == '`') i++;
                string marker = text.Substring(start, i - start);
                int end = i;
                for (;;)
                {
                    end = text.IndexOf(marker, end, StringComparison.Ordinal);
                    if (end < 0) break;
                    int previousLine = i;
                    bool blankLine = false;
                    while ((previousLine = text.IndexOf('\n', previousLine)) >= 0 && previousLine < end)
                    {
                        int next = previousLine + 1;
                        while (next < end && (text[next] == ' ' || text[next] == '\t')) next++;
                        if (next < end && text[next] == '\n') { blankLine = true; break; }
                        previousLine++;
                    }
                    if (blankLine) { end = -1; break; }
                    if ((end == 0 || text[end - 1] != '`') && (end + marker.Length == text.Length || text[end + marker.Length] != '`')) break;
                    end += marker.Length;
                }
                if (end < 0) { clean.Append(marker); continue; }
                i = end + marker.Length;
            }
            return clean.ToString();
        }

        internal static bool NormalizedMentionsPath(string normalizedMarkdown, string target)
        {
            if (String.IsNullOrWhiteSpace(normalizedMarkdown) || String.IsNullOrWhiteSpace(target)) return false;
            try
            {
                string wanted = NormalizeValue(target.Trim());
                var options = RegexOptions.CultureInvariant;
                TimeSpan timeout = TimeSpan.FromSeconds(1);
                // Direct Markdown image destinations, including angle brackets.
                foreach (Match match in Regex.Matches(normalizedMarkdown, @"!\[(?:\\.|[^\]\\\r\n])*\]\(", options, timeout))
                {
                    if (MarkdownEscaped(normalizedMarkdown, match.Index)) continue;
                    string candidate = ReadDestination(normalizedMarkdown, match.Index + match.Length);
                    if (candidate != null && String.Equals(NormalizeValue(candidate), wanted, StringComparison.OrdinalIgnoreCase)) return true;
                }
                // Only images with a matching reference label authorize a definition.
                var labels = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (Match match in Regex.Matches(normalizedMarkdown, @"!\[(?<alt>[^\]\r\n]*)\](?:\[(?<ref>[^\]\r\n]*)\])?", options, timeout))
                {
                    if (MarkdownEscaped(normalizedMarkdown, match.Index)) continue;
                    if (!match.Groups["ref"].Success && match.Index + match.Length < normalizedMarkdown.Length && normalizedMarkdown[match.Index + match.Length] == '(') continue;
                    string label = match.Groups["ref"].Success && match.Groups["ref"].Length > 0 ? match.Groups["ref"].Value : match.Groups["alt"].Value;
                    labels.Add(Regex.Replace(label.Trim(), @"\s+", " "));
                }
                var seenLabels = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (Match match in Regex.Matches(normalizedMarkdown, @"(?m)^ {0,3}\[(?<label>[^\]\r\n]+)\]:[ \t]*(?:<(?<angle>[^>\r\n]+)>|(?<bare>\S+))", options, timeout))
                {
                    string label = Regex.Replace(match.Groups["label"].Value.Trim(), @"\s+", " ");
                    if (!seenLabels.Add(label)) continue;
                    string candidate = match.Groups["angle"].Success ? match.Groups["angle"].Value : match.Groups["bare"].Value;
                    if (labels.Contains(label) && String.Equals(NormalizeValue(candidate), wanted, StringComparison.OrdinalIgnoreCase)) return true;
                }
                // Typora image tags: duplicate src attributes are ambiguous.
                foreach (Match match in Regex.Matches(normalizedMarkdown, @"<img(?=[\s/>])(?:[^""'<>]|""[^""]*""|'[^']*')*/?>", RegexOptions.IgnoreCase | options, timeout))
                {
                    if (MarkdownEscaped(normalizedMarkdown, match.Index)) continue;
                    string candidate = HtmlImageSource(match.Value);
                    if (candidate == null) continue;
                    if (String.Equals(NormalizeValue(candidate), wanted, StringComparison.OrdinalIgnoreCase)) return true;
                }
            }
            catch (ArgumentException) { return false; }
            catch (RegexMatchTimeoutException) { return false; }
            return false;
        }

        private static string NormalizeValue(string value)
        {
            return Uri.UnescapeDataString(System.Net.WebUtility.HtmlDecode(value)).Replace("\\\\", "\\");
        }

        private static string HtmlImageSource(string tag)
        {
            int i = 4; string source = null;
            while (i < tag.Length)
            {
                while (i < tag.Length && Char.IsWhiteSpace(tag[i])) i++;
                if (i >= tag.Length || tag[i] == '>' || (tag[i] == '/' && i + 1 < tag.Length && tag[i + 1] == '>')) break;
                int nameStart = i;
                while (i < tag.Length && !Char.IsWhiteSpace(tag[i]) && "\"'<>/=".IndexOf(tag[i]) < 0) i++;
                if (i == nameStart) return null;
                string name = tag.Substring(nameStart, i - nameStart);
                while (i < tag.Length && Char.IsWhiteSpace(tag[i])) i++;
                if (i >= tag.Length || tag[i] != '=') { if (String.Equals(name, "src", StringComparison.OrdinalIgnoreCase)) return null; continue; }
                i++; while (i < tag.Length && Char.IsWhiteSpace(tag[i])) i++;
                if (i >= tag.Length) return null;
                string value;
                if (tag[i] == '\"' || tag[i] == '\'')
                {
                    char quote = tag[i++]; int start = i;
                    while (i < tag.Length && tag[i] != quote) i++;
                    if (i >= tag.Length) return null;
                    value = tag.Substring(start, i - start); i++;
                }
                else
                {
                    int start = i;
                    while (i < tag.Length && !Char.IsWhiteSpace(tag[i]) && "\"'=<>`".IndexOf(tag[i]) < 0) i++;
                    if (i == start) return null;
                    value = tag.Substring(start, i - start);
                }
                if (String.Equals(name, "src", StringComparison.OrdinalIgnoreCase)) { if (source != null) return null; source = value; }
            }
            return source;
        }

        private static bool MarkdownEscaped(string text, int position)
        {
            int count = 0;
            while (position > 0 && text[--position] == '\\') count++;
            return count % 2 != 0;
        }

        private static string ReadDestination(string text, int start)
        {
            int i = start;
            while (i < text.Length && (text[i] == ' ' || text[i] == '\t')) i++;
            if (i >= text.Length || text[i] == '\n') return null;
            if (text[i] == '<')
            {
                int end = text.IndexOf('>', i + 1);
                if (end < 0 || text.IndexOf('\n', i + 1, end - i - 1) >= 0) return null;
                return EndsImageDestination(text, end + 1) ? text.Substring(i + 1, end - i - 1) : null;
            }
            var value = new StringBuilder(); int depth = 0;
            while (i < text.Length)
            {
                char c = text[i++];
                if (c == '\n' || c == '\r' || Char.IsWhiteSpace(c)) break;
                if (c == '(') { depth++; if (depth > 32) return null; }
                if (c == ')') { if (depth == 0) return value.Length == 0 ? null : value.ToString(); depth--; }
                if (c == '\\' && i < text.Length && (text[i] == '(' || text[i] == ')' || text[i] == ' ')) { value.Append(text[i++]); continue; }
                value.Append(c);
            }
            return value.Length == 0 || depth != 0 || !EndsImageDestination(text, i - 1) ? null : value.ToString();
        }

        private static bool EndsImageDestination(string text, int position)
        {
            int i = position;
            while (i < text.Length && (text[i] == ' ' || text[i] == '\t')) i++;
            if (i >= text.Length || text[i] == '\n' || text[i] == '\r') return false;
            if (text[i] == ')') return true;
            // Markdown titles are optional but must be quoted and followed by
            // the actual closing parenthesis; arbitrary trailing words are not
            // part of a valid image destination.
            if (i == position || (text[i] != '"' && text[i] != '\'' && text[i] != '(')) return false;
            char end = text[i] == '(' ? ')' : text[i];
            i++;
            bool closed = false;
            while (i < text.Length && text[i] != '\n' && text[i] != '\r')
            {
                if (text[i] == '\\' && i + 1 < text.Length) { i += 2; continue; }
                if (text[i++] == end) { closed = true; break; }
            }
            if (!closed) return false;
            while (i < text.Length && (text[i] == ' ' || text[i] == '\t')) i++;
            return i < text.Length && text[i] == ')';
        }

        internal static byte[] Read(string target, long maximumBytes)
        {
            if (String.IsNullOrWhiteSpace(target) || target.Length > 32768) throw new InvalidOperationException("图片路径无效。");
            string path;
            try { path = Uri.UnescapeDataString(target.Trim()); }
            catch { throw new InvalidOperationException("图片路径无效。"); }
            if (path.StartsWith("file:///", StringComparison.OrdinalIgnoreCase)) path = path.Substring(8);
            return ReadPath(path, maximumBytes, 0);
        }

        internal static byte[] ReadRelative(string markdownPath, string target, long maximumBytes)
        {
            if (String.IsNullOrWhiteSpace(target) || target.Length > 32768) throw new InvalidOperationException("图片路径无效。");
            string relative;
            try { relative = Uri.UnescapeDataString(target.Trim().Split(new[] { '?', '#' }, 2)[0]); }
            catch { throw new InvalidOperationException("图片路径无效。"); }
            if (String.IsNullOrWhiteSpace(relative) || Path.IsPathRooted(relative) || relative.IndexOf(':') >= 0 || relative.StartsWith("\\", StringComparison.Ordinal) || relative.StartsWith("/", StringComparison.Ordinal))
                throw new InvalidOperationException("图片相对路径无效。");
            string path = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(markdownPath), relative.Replace('/', '\\')));
            return ReadPath(path, maximumBytes, 0);
        }

        internal static byte[] ReadMarkdown(string path, long maximumBytes)
        {
            return ReadPath(path, maximumBytes, 1);
        }

        internal static byte[] ReadLiteralImage(string path, long maximumBytes)
        {
            return ReadPath(path, maximumBytes, 0);
        }

        internal static byte[] ReadTextFile(string path, long maximumBytes)
        {
            return ReadPath(path, maximumBytes, 2);
        }

        internal static byte[] ReadDocumentFile(string path, long maximumBytes)
        {
            return ReadPath(path, maximumBytes, 3);
        }

        internal static bool IsSupportedDocumentExtension(string extension)
        {
            return extension == ".pdf" || extension == ".doc" || extension == ".docx" ||
                extension == ".ppt" || extension == ".pptx" || extension == ".xls" ||
                extension == ".xlsx" || extension == ".csv" || extension == ".rtf";
        }

        // kind: 0 = image, 1 = markdown (.md), 2 = plain text (.txt), 3 = binary read-only document
        private static byte[] ReadPath(string path, long maximumBytes, int kind)
        {
            long cap = kind == 3 ? 50L * 1024 * 1024 : (kind == 1 || kind == 2) ? 5L * 1024 * 1024 : MaximumBytes;
            if (maximumBytes <= 0 || maximumBytes > cap) throw new InvalidOperationException("导入文件容量限制无效。");
            if (!Regex.IsMatch(path, @"^[A-Za-z]:[\\/]") || Regex.IsMatch(path, @"[\x00-\x1f\x7f]") || path.IndexOfAny(new char[] { '?', '*', '"', '<', '>', '|' }) >= 0)
                throw new InvalidOperationException("只支持本机磁盘上的文件路径。");
            path = path.Replace('/', '\\');
            string[] parts = path.Substring(3).Split('\\');
            foreach (string part in parts)
                if (String.IsNullOrEmpty(part) || part == "." || part == ".." || part.IndexOf(':') >= 0 || part.EndsWith(" ", StringComparison.Ordinal) || part.EndsWith(".", StringComparison.Ordinal) || Regex.IsMatch(part, @"^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
                    throw new InvalidOperationException("文件路径无效。");
            string extension = Path.GetExtension(path).ToLowerInvariant();
            if (kind == 1 && extension != ".md") throw new InvalidOperationException("仅支持 Markdown (.md) 文件。");
            if (kind == 2 && extension != ".txt") throw new InvalidOperationException("仅支持纯文本 (.txt) 文件。");
            if (kind == 3 && !IsSupportedDocumentExtension(extension)) throw new InvalidOperationException("暂不支持导入此文件格式。");
            if (kind == 0 && extension != ".png" && extension != ".jpg" && extension != ".jpeg" && extension != ".gif" && extension != ".webp")
                throw new InvalidOperationException("仅支持 PNG、JPEG、GIF 或 WebP 图片。");
            string root = Path.GetPathRoot(path);
            DriveInfo drive = new DriveInfo(root);
            if (drive.DriveType != DriveType.Fixed && drive.DriveType != DriveType.Removable)
                throw new InvalidOperationException("不支持网络或设备文件路径。");
            string directory = root;
            for (int i = 0; i < parts.Length - 1; i++)
            {
                directory = Path.Combine(directory, parts[i]);
                if (!Directory.Exists(directory)) return null;
                if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("目录不能是链接。");
            }
            if (!File.Exists(path)) return null;
            FileAttributes attributes = File.GetAttributes(path);
            if ((attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0) throw new InvalidOperationException("文件不能是链接。");
            byte[] bytes;
            bool allowEmpty = kind == 1 || kind == 2;
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if ((!allowEmpty && stream.Length <= 0) || stream.Length > maximumBytes) throw new InvalidOperationException("文件为空或超过本次导入的大小限制。");
                bytes = new byte[(int)stream.Length];
                int offset = 0;
                while (offset < bytes.Length)
                {
                    int count = stream.Read(bytes, offset, bytes.Length - offset);
                    if (count == 0) throw new InvalidOperationException("读取文件时内容发生变化。");
                    offset += count;
                }
                if (stream.ReadByte() != -1) throw new InvalidOperationException("读取文件时内容发生变化。");
            }
            if (kind == 0) AttachmentFiles.ValidateImage(path.ToLowerInvariant(), bytes);
            return bytes;
        }
    }

    internal static class SelectedImportFolder
    {
        // Enumerate only the explicitly selected tree, never follow junctions.
        // Bytes are read later, on demand, only for Markdown and referenced images.
        internal static List<Dictionary<string, object>> Enumerate(string selected, HashSet<string> markdownPaths, HashSet<string> imagePaths)
        {
            return EnumerateAll(selected, markdownPaths, imagePaths, null, null);
        }

        internal static List<Dictionary<string, object>> EnumerateAll(string selected, HashSet<string> markdownPaths, HashSet<string> imagePaths, HashSet<string> textPaths, HashSet<string> documentPaths)
        {
            string root = Path.GetFullPath(selected).TrimEnd(Path.DirectorySeparatorChar);
            string driveRoot = Path.GetPathRoot(root);
            if (String.IsNullOrEmpty(driveRoot) || root.Length <= driveRoot.Length || (new DriveInfo(driveRoot).DriveType != DriveType.Fixed && new DriveInfo(driveRoot).DriveType != DriveType.Removable))
                throw new InvalidOperationException("请选择本机磁盘上的具体笔记文件夹。");
            string ancestor = driveRoot;
            foreach (string component in root.Substring(driveRoot.Length).Split(Path.DirectorySeparatorChar))
            {
                if (component.Length == 0) continue;
                ancestor = Path.Combine(ancestor, component);
                if ((File.GetAttributes(ancestor) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("请选择实际文件夹，不能选择文件夹链接。");
            }
            string prefix = root + Path.DirectorySeparatorChar;
            string rootName = Path.GetFileName(root);
            var files = new List<Dictionary<string, object>>();
            var pending = new Stack<KeyValuePair<string, int>>();
            pending.Push(new KeyValuePair<string, int>(root, 0));
            int count = 0, metadataLength = 0;
            while (pending.Count > 0)
            {
                var item = pending.Pop();
                var dirEntries = new List<string>(Directory.EnumerateFileSystemEntries(item.Key));
                dirEntries.Sort(StringComparer.CurrentCultureIgnoreCase);
                var subdirs = new List<string>();
                foreach (string entry in dirEntries)
                {
                    if (++count > 2000) throw new InvalidOperationException("文件夹项目超过 2000 个，请选择更具体的笔记文件夹。");
                    string path = Path.GetFullPath(entry);
                    if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("文件夹中存在无效路径。");
                    FileAttributes attributes = File.GetAttributes(path);
                    if ((attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("文件夹中包含链接或重解析点，请选择实际文件所在文件夹。");
                    if ((attributes & FileAttributes.Directory) != 0)
                    {
                        if (item.Value >= 31) throw new InvalidOperationException("文件夹嵌套超过 32 层。");
                        subdirs.Add(path); continue;
                    }
                    string extension = Path.GetExtension(path).ToLowerInvariant();
                    bool markdown = extension == ".md";
                    bool text = textPaths != null && extension == ".txt";
                    bool document = documentPaths != null && ReferencedImageFiles.IsSupportedDocumentExtension(extension);
                    bool image = extension == ".png" || extension == ".jpg" || extension == ".jpeg" || extension == ".gif" || extension == ".webp";
                    if (!markdown && !text && !document && !image) continue;
                    string relative = rootName + "/" + path.Substring(prefix.Length).Replace('\\', '/');
                    metadataLength += path.Length + relative.Length;
                    if (metadataLength > 2 * 1024 * 1024) throw new InvalidOperationException("文件夹路径信息过大，请选择更具体的笔记文件夹。");
                    string kind = markdown ? "markdown" : text ? "text" : document ? "document" : "image";
                    files.Add(new Dictionary<string, object> { { "path", path }, { "relative", relative }, { "size", new FileInfo(path).Length }, { "markdown", markdown }, { "kind", kind } });
                    if (markdown) markdownPaths.Add(path);
                    else if (text) textPaths.Add(path);
                    else if (document) documentPaths.Add(path);
                    else imagePaths.Add(path);
                }
                // Push subdirectories in reverse order so the stack pops them in natural forward pre-order.
                for (int i = subdirs.Count - 1; i >= 0; i--)
                {
                    pending.Push(new KeyValuePair<string, int>(subdirs[i], item.Value + 1));
                }
            }
            return files;
        }
    }

    internal sealed class MainWindow : Form
    {
        private const string AppHost = "paper.local";
        private const string StartUrl = "https://paper.local/my-notes/index.html";
        private readonly string root;
        private readonly string profile;
        private readonly string credentialDirectory;
        // A 50 MiB binary document is about 67 MiB after base64 encoding.
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 80 * 1024 * 1024 };
        private Microsoft.Web.WebView2.WinForms.WebView2 webView;
        private readonly StartupScreen startupScreen;
        private readonly List<ResizeGrip> resizeGrips = new List<ResizeGrip>();
        private readonly HashSet<string> selectedMarkdownPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> selectedImagePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> selectedTextPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> selectedDocumentPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, string> selectedMarkdownNormalized = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private readonly Stopwatch startupClock = Stopwatch.StartNew();
        private bool startupRevealed;

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
            BackColor = Color.White;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(1280, 820);
            MinimumSize = new Size(760, 520);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            startupScreen = new StartupScreen(Icon);
            startupScreen.Dock = DockStyle.Fill;
            Controls.Add(startupScreen);
            for (int hit = 10; hit <= 17; hit++)
            {
                var grip = new ResizeGrip(this, hit);
                resizeGrips.Add(grip);
                Controls.Add(grip);
            }
            LayoutResizeGrips();
            Shown += StartWebView;
        }

        private async void StartWebView(object sender, EventArgs args)
        {
            try
            {
                Directory.CreateDirectory(profile);
                webView = new Microsoft.Web.WebView2.WinForms.WebView2();
                webView.Location = new Point(-20000, -20000);
                webView.Size = ClientSize;
                Controls.Add(webView);
                startupScreen.BringToFront();
                foreach (ResizeGrip grip in resizeGrips) grip.BringToFront();

                var environment = await Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateAsync(null, profile);
                await webView.EnsureCoreWebView2Async(environment);
                var core = webView.CoreWebView2;
                core.Settings.AreDevToolsEnabled = false;
                // Keep the native Windows editor context menu so users can
                // cut, copy and paste, including clipboard images.
                core.Settings.AreDefaultContextMenusEnabled = true;
                core.Settings.IsWebMessageEnabled = true;
                core.Settings.AreBrowserAcceleratorKeysEnabled = false;
                core.SetVirtualHostNameToFolderMapping(
                    AppHost, Path.Combine(root, "site"),
                    Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind.DenyCors);
                core.NavigationStarting += NavigationStarting;
                core.NavigationCompleted += StartupNavigationCompleted;
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

        protected override void OnResize(EventArgs args)
        {
            base.OnResize(args);
            if (resizeGrips != null) LayoutResizeGrips();
        }

        private void LayoutResizeGrips()
        {
            if (resizeGrips.Count != 8) return;
            bool normal = WindowState == FormWindowState.Normal;
            int width = ClientSize.Width, height = ClientSize.Height;
            // Reserve the native resize strip outside WebView2. The scrollbar
            // then keeps its entire hit target instead of sharing it with a grip.
            const int edge = 7, corner = 7;
            Padding wantedPadding = normal ? new Padding(0, 0, edge, edge) : Padding.Empty;
            if (Padding != wantedPadding) Padding = wantedPadding;
            Rectangle[] bounds = {
                new Rectangle(0, corner, edge, Math.Max(0, height - 2 * corner)),
                new Rectangle(Math.Max(0, width - edge), corner, edge, Math.Max(0, height - 2 * corner)),
                new Rectangle(corner, 0, Math.Max(0, width - 2 * corner), edge),
                new Rectangle(0, 0, corner, corner),
                new Rectangle(Math.Max(0, width - corner), 0, corner, corner),
                new Rectangle(corner, Math.Max(0, height - edge), Math.Max(0, width - 2 * corner), edge),
                new Rectangle(0, Math.Max(0, height - corner), corner, corner),
                new Rectangle(Math.Max(0, width - corner), Math.Max(0, height - corner), corner, corner)
            };
            for (int i = 0; i < resizeGrips.Count; i++)
            {
                resizeGrips[i].Bounds = bounds[i];
                resizeGrips[i].Visible = normal;
            }
        }

        private void StartupNavigationCompleted(object sender, Microsoft.Web.WebView2.Core.CoreWebView2NavigationCompletedEventArgs args)
        {
            if (!startupRevealed && !args.IsSuccess)
            {
                startupScreen.ShowFailure("无法加载笔记界面，请重新启动应用。");
            }
        }

        private async void RevealStartup()
        {
            if (startupRevealed)
            {
                if (webView != null && webView.CoreWebView2 != null)
                    webView.CoreWebView2.PostWebMessageAsJson("{\"channel\":\"paper-notes\",\"action\":\"ui.reveal\"}");
                return;
            }
            startupRevealed = true;
            // Let the two pieces of the mark finish assembling before the page appears.
            int remaining = (startupScreen.AnimationsEnabled ? 1400 : 150) - (int)startupClock.ElapsedMilliseconds;
            if (remaining > 0) await Task.Delay(remaining);
            if (IsDisposed || webView == null || webView.CoreWebView2 == null) return;
            webView.Dock = DockStyle.Fill;
            startupScreen.StopAnimation();
            startupScreen.Visible = false;
            webView.CoreWebView2.PostWebMessageAsJson("{\"channel\":\"paper-notes\",\"action\":\"ui.reveal\"}");
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
            if (action == "ui.ready") { RevealStartup(); return; }
            if (action == "ui.theme")
            {
                string theme = GetString(request, "theme");
                BackColor = theme == "night" ? Color.FromArgb(23, 25, 28)
                    : theme == "green" ? Color.FromArgb(233, 243, 231)
                    : theme == "yellow" ? Color.FromArgb(251, 245, 224) : Color.White;
                return;
            }
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
                if (action == "import.pickFiles")
                {
                    selectedMarkdownPaths.Clear();
                    selectedImagePaths.Clear();
                    selectedTextPaths.Clear();
                    selectedDocumentPaths.Clear();
                    selectedMarkdownNormalized.Clear();
                    var picked = new List<string>();
                    using (var picker = new OpenFileDialog())
                    {
                        picker.Title = "选择笔记或外部文档";
                        picker.Filter = "所有支持的文件 (*.md;*.txt;*.pdf;*.doc;*.docx;*.ppt;*.pptx;*.xls;*.xlsx;*.csv;*.rtf)|*.md;*.txt;*.pdf;*.doc;*.docx;*.ppt;*.pptx;*.xls;*.xlsx;*.csv;*.rtf|Markdown (*.md)|*.md|纯文本 (*.txt)|*.txt|PDF 文档 (*.pdf)|*.pdf|Word / PPT / Excel (*.doc;*.docx;*.ppt;*.pptx;*.xls;*.xlsx)|*.doc;*.docx;*.ppt;*.pptx;*.xls;*.xlsx";
                        picker.Multiselect = true;
                        picker.CheckFileExists = true;
                        if (picker.ShowDialog(this) == DialogResult.OK)
                        {
                            if (picker.FileNames.Length > 300) throw new InvalidOperationException("一次最多导入 300 个文件。");
                            foreach (string rawPath in picker.FileNames)
                            {
                                string full = Path.GetFullPath(rawPath);
                                string ext = Path.GetExtension(full).ToLowerInvariant();
                                if (ext == ".md") { selectedMarkdownPaths.Add(full); picked.Add(full); }
                                else if (ext == ".txt") { selectedTextPaths.Add(full); picked.Add(full); }
                                else if (ReferencedImageFiles.IsSupportedDocumentExtension(ext)) { selectedDocumentPaths.Add(full); picked.Add(full); }
                            }
                        }
                    }
                    response["paths"] = picked.ToArray();
                    response["ok"] = true;
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(response));
                    return;
                }
                if (action == "import.pickFolder")
                {
                    selectedMarkdownPaths.Clear();
                    selectedImagePaths.Clear();
                    selectedTextPaths.Clear();
                    selectedDocumentPaths.Clear();
                    selectedMarkdownNormalized.Clear();
                    var files = new List<Dictionary<string, object>>();
                    using (var picker = new FolderBrowserDialog())
                    {
                        picker.Description = "选择包含笔记、图片或文档的文件夹";
                        picker.ShowNewFolderButton = false;
                        if (picker.ShowDialog(this) == DialogResult.OK)
                        {
                            var markdown = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                            var images = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                            var texts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                            var docs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                            files = SelectedImportFolder.EnumerateAll(picker.SelectedPath, markdown, images, texts, docs);
                            selectedMarkdownPaths.UnionWith(markdown);
                            selectedImagePaths.UnionWith(images);
                            selectedTextPaths.UnionWith(texts);
                            selectedDocumentPaths.UnionWith(docs);
                        }
                    }
                    response["files"] = files;
                    response["ok"] = true;
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(response));
                    return;
                }
                if (action == "import.readTextFile")
                {
                    string path = GetString(request, "path");
                    long maximumBytes;
                    if (!selectedTextPaths.Contains(path) || !Int64.TryParse(GetString(request, "maxBytes"), out maximumBytes)) throw new InvalidOperationException("只能读取刚才选择的纯文本文件。");
                    byte[] bytes = ReferencedImageFiles.ReadTextFile(path, maximumBytes);
                    if (bytes == null) throw new InvalidOperationException("选择的纯文本文件不存在。");
                    response["data"] = Convert.ToBase64String(bytes);
                    response["ok"] = true;
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(response));
                    return;
                }
                if (action == "import.readDocumentFile")
                {
                    string path = GetString(request, "path");
                    long maximumBytes;
                    if (!selectedDocumentPaths.Contains(path) || !Int64.TryParse(GetString(request, "maxBytes"), out maximumBytes)) throw new InvalidOperationException("只能读取刚才选择的文档文件。");
                    byte[] bytes = ReferencedImageFiles.ReadDocumentFile(path, maximumBytes);
                    if (bytes == null) throw new InvalidOperationException("选择的文档文件不存在。");
                    response["data"] = Convert.ToBase64String(bytes);
                    response["ok"] = true;
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(response));
                    return;
                }
                if (action == "document.get" || action == "document.put" || action == "document.openExternal")
                {
                    string baseDirectory = Path.Combine(Path.GetDirectoryName(profile), "文件");
                    string repository = GetString(request, "repository");
                    string path = GetString(request, "path");
                    if (action == "document.get")
                    {
                        byte[] bytes = DocumentFiles.Read(baseDirectory, repository, path);
                        response["data"] = bytes == null ? null : Convert.ToBase64String(bytes);
                    }
                    else if (action == "document.put")
                    {
                        string encoded = GetString(request, "data");
                        if (String.IsNullOrEmpty(encoded) || encoded.Length > 70 * 1024 * 1024)
                            throw new InvalidOperationException("文档为空或超过 50 MiB。");
                        byte[] bytes;
                        try { bytes = Convert.FromBase64String(encoded); }
                        catch (FormatException) { throw new InvalidOperationException("文档数据无效。"); }
                        DocumentFiles.Write(baseDirectory, repository, path, bytes);
                    }
                    else
                    {
                        string displayName = GetString(request, "displayName");
                        DocumentFiles.OpenExternal(baseDirectory, repository, path, displayName);
                    }
                    response["ok"] = true;
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(response));
                    return;
                }
                if (action == "import.pickMarkdownFiles")
                {
                    selectedMarkdownPaths.Clear();
                    selectedImagePaths.Clear();
                    selectedMarkdownNormalized.Clear();
                    using (var picker = new OpenFileDialog())
                    {
                        picker.Title = "选择 Markdown 文件";
                        picker.Filter = "Markdown 文件 (*.md)|*.md";
                        picker.Multiselect = true;
                        picker.CheckFileExists = true;
                        if (picker.ShowDialog(this) == DialogResult.OK)
                        {
                            if (picker.FileNames.Length > 300) throw new InvalidOperationException("一次最多导入 300 个 Markdown 文件。");
                            foreach (string path in picker.FileNames) selectedMarkdownPaths.Add(Path.GetFullPath(path));
                        }
                    }
                    response["paths"] = new List<string>(selectedMarkdownPaths).ToArray();
                    response["ok"] = true;
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(response));
                    return;
                }
                if (action == "import.pickMarkdownFolder")
                {
                    selectedMarkdownPaths.Clear();
                    selectedImagePaths.Clear();
                    selectedMarkdownNormalized.Clear();
                    var files = new List<Dictionary<string, object>>();
                    using (var picker = new FolderBrowserDialog())
                    {
                        picker.Description = "选择包含 Markdown 和图片的文件夹";
                        picker.ShowNewFolderButton = false;
                        if (picker.ShowDialog(this) == DialogResult.OK)
                        {
                            var markdown = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                            var images = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                            files = SelectedImportFolder.Enumerate(picker.SelectedPath, markdown, images);
                            selectedMarkdownPaths.UnionWith(markdown);
                            selectedImagePaths.UnionWith(images);
                        }
                    }
                    response["files"] = files;
                    response["ok"] = true;
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(response));
                    return;
                }
                if (action == "import.readMarkdown")
                {
                    string path = GetString(request, "path");
                    long maximumBytes;
                    if (!selectedMarkdownPaths.Contains(path) || !Int64.TryParse(GetString(request, "maxBytes"), out maximumBytes)) throw new InvalidOperationException("只能读取刚才选择的 Markdown 文件。");
                    byte[] bytes = ReferencedImageFiles.ReadMarkdown(path, maximumBytes);
                    if (bytes == null) throw new InvalidOperationException("选择的 Markdown 文件不存在。");
                    try
                    {
                        string content = new UTF8Encoding(false, true).GetString(bytes);
                        selectedMarkdownNormalized[path] = ReferencedImageFiles.NormalizeSource(content);
                    }
                    catch (DecoderFallbackException) { throw new InvalidOperationException("Markdown 不是有效的 UTF-8 文件。"); }
                    response["data"] = bytes == null ? null : Convert.ToBase64String(bytes);
                    response["ok"] = true;
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(response));
                    return;
                }
                if (action == "import.readSelectedImage")
                {
                    string path = GetString(request, "path");
                    long maximumBytes;
                    if (!selectedImagePaths.Contains(path) || !Int64.TryParse(GetString(request, "maxBytes"), out maximumBytes)) throw new InvalidOperationException("只能读取所选文件夹中的图片。");
                    byte[] bytes = ReferencedImageFiles.ReadLiteralImage(path, maximumBytes);
                    response["data"] = bytes == null ? null : Convert.ToBase64String(bytes);
                    response["ok"] = true;
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(response));
                    return;
                }
                if (action == "import.readImage")
                {
                    long maximumBytes;
                    if (!Int64.TryParse(GetString(request, "maxBytes"), out maximumBytes)) throw new InvalidOperationException("图片导入容量限制无效。");
                    string path = GetString(request, "path");
                    string markdownPath = GetString(request, "markdownPath");
                    string markdown;
                    if (!selectedMarkdownPaths.Contains(markdownPath) || !selectedMarkdownNormalized.TryGetValue(markdownPath, out markdown) || !ReferencedImageFiles.NormalizedMentionsPath(markdown, path))
                        throw new InvalidOperationException("只能读取刚才选择的 Markdown 文件中引用的图片。");
                    string decoded = Uri.UnescapeDataString(path);
                    bool absolute = decoded.StartsWith("file:///", StringComparison.OrdinalIgnoreCase) || Regex.IsMatch(decoded, @"^[A-Za-z]:[\\/]");
                    byte[] bytes = absolute ? ReferencedImageFiles.Read(path, maximumBytes) : ReferencedImageFiles.ReadRelative(markdownPath, path, maximumBytes);
                    response["data"] = bytes == null ? null : Convert.ToBase64String(bytes);
                    response["ok"] = true;
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(response));
                    return;
                }
                if (action == "attachment.get" || action == "attachment.put")
                {
                    string baseDirectory = Path.Combine(Path.GetDirectoryName(profile), "附件");
                    string repository = GetString(request, "repository");
                    string path = GetString(request, "path");
                    if (action == "attachment.get")
                    {
                        byte[] bytes = AttachmentFiles.Read(baseDirectory, repository, path);
                        response["data"] = bytes == null ? null : Convert.ToBase64String(bytes);
                    }
                    else
                    {
                        string encoded = GetString(request, "data");
                        if (String.IsNullOrEmpty(encoded) || encoded.Length > 28 * 1024 * 1024)
                            throw new InvalidOperationException("图片为空或超过 20 MiB。");
                        byte[] bytes;
                        try { bytes = Convert.FromBase64String(encoded); }
                        catch (FormatException) { throw new InvalidOperationException("图片数据无效。"); }
                        AttachmentFiles.Write(baseDirectory, repository, path, bytes);
                    }
                    response["ok"] = true;
                    webView.CoreWebView2.PostWebMessageAsJson(json.Serialize(response));
                    return;
                }
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
                response["error"] = action.StartsWith("import.", StringComparison.Ordinal) ? "无法读取选择的文件，请检查文件是否存在及权限。" : action.StartsWith("document.", StringComparison.Ordinal) ? "无法访问本机文档文件，请检查磁盘空间或权限。" : action.StartsWith("attachment.", StringComparison.Ordinal) ? "无法访问本机图片附件，请检查磁盘空间或权限。" : "无法访问 Windows 加密存储。";
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
            string normalized = Regex.Replace(value, @"^(?:github|gitee|gitlab|gitcode):", "");
            string[] parts = normalized.Split('/');
            if (parts.Length != 2 || !Regex.IsMatch(parts[0], @"^[a-z0-9](?:[a-z0-9._-]{0,37}[a-z0-9])?$") ||
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

    // WebView2 has its own child HWNDs, which otherwise consume edge mouse
    // events before the captionless form can enter Windows' native sizing loop.
    internal sealed class ResizeGrip : Control
    {
        [DllImport("user32.dll")]
        private static extern bool SetLayeredWindowAttributes(IntPtr window, uint color, byte alpha, uint flags);
        private readonly Form owner;
        private readonly int hit;
        private bool dragging;
        private Point dragOrigin;
        private Rectangle initialBounds;

        public ResizeGrip(Form owner, int hit)
        {
            this.owner = owner; this.hit = hit;
            BackColor = Color.Black;
            Cursor = hit == 10 || hit == 11 ? Cursors.SizeWE : hit == 12 || hit == 15 ? Cursors.SizeNS :
                hit == 13 || hit == 17 ? Cursors.SizeNWSE : Cursors.SizeNESW;
        }

        protected override CreateParams CreateParams
        {
            get { var parameters = base.CreateParams; parameters.ExStyle |= 0x00080000; return parameters; }
        }

        protected override void OnHandleCreated(EventArgs args)
        {
            base.OnHandleCreated(args);
            // One alpha level is visually imperceptible but remains hit-testable.
            SetLayeredWindowAttributes(Handle, 0, 1, 2);
        }

        protected override void OnMouseDown(MouseEventArgs args)
        {
            base.OnMouseDown(args);
            if (args.Button != MouseButtons.Left || owner.WindowState != FormWindowState.Normal) return;
            dragging = true;
            dragOrigin = Cursor.Position;
            initialBounds = owner.Bounds;
            Capture = true;
        }

        protected override void OnMouseMove(MouseEventArgs args)
        {
            base.OnMouseMove(args);
            if (!dragging || !Capture) return;
            Point position = Cursor.Position;
            int dx = position.X - dragOrigin.X, dy = position.Y - dragOrigin.Y;
            int left = initialBounds.Left, right = initialBounds.Right, top = initialBounds.Top, bottom = initialBounds.Bottom;
            if (hit == 10 || hit == 13 || hit == 16) left = Math.Min(right - owner.MinimumSize.Width, left + dx);
            if (hit == 11 || hit == 14 || hit == 17) right = Math.Max(left + owner.MinimumSize.Width, right + dx);
            if (hit == 12 || hit == 13 || hit == 14) top = Math.Min(bottom - owner.MinimumSize.Height, top + dy);
            if (hit == 15 || hit == 16 || hit == 17) bottom = Math.Max(top + owner.MinimumSize.Height, bottom + dy);
            owner.Bounds = Rectangle.FromLTRB(left, top, right, bottom);
        }

        protected override void OnMouseUp(MouseEventArgs args)
        {
            base.OnMouseUp(args);
            dragging = false;
            Capture = false;
        }

        protected override void OnMouseCaptureChanged(EventArgs args)
        {
            base.OnMouseCaptureChanged(args);
            if (!Capture) dragging = false;
        }
    }

    // A native placeholder is painted before WebView2 starts, so its runtime
    // initialization cannot leave the application looking like an empty window.
    internal sealed class StartupScreen : Control
    {
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SystemParametersInfo(uint action, uint parameter, out bool value, uint flags);

        private readonly Timer timer = new Timer();
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private readonly Image logo;
        private readonly bool animate;
        private string failure;
        public bool AnimationsEnabled { get { return animate; } }

        public StartupScreen(Icon icon)
        {
            DoubleBuffered = true;
            BackColor = Color.White;
            // The icon's frames are PNG-encoded. Icon.ToBitmap in .NET Framework
            // cannot reliably decode these, so load the selected frame as an image.
            try
            {
                using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("PaperNotes.Logo"))
                using (var reader = resource == null ? null : new BinaryReader(resource))
                {
                    if (reader != null)
                    {
                        reader.ReadUInt16(); reader.ReadUInt16();
                        int count = reader.ReadUInt16();
                        int bestDifference = Int32.MaxValue, bestLength = 0, bestOffset = 0;
                        for (int i = 0; i < count; i++)
                        {
                            int width = reader.ReadByte();
                            reader.ReadByte(); reader.ReadByte(); reader.ReadByte();
                            reader.ReadUInt16(); reader.ReadUInt16();
                            int length = reader.ReadInt32(), offset = reader.ReadInt32();
                            int difference = Math.Abs((width == 0 ? 256 : width) - 128);
                            if (difference < bestDifference) { bestDifference = difference; bestLength = length; bestOffset = offset; }
                        }
                        if (bestLength > 0 && bestOffset >= 0 && (long)bestOffset + bestLength <= resource.Length)
                        {
                            resource.Position = bestOffset;
                            using (var frame = new MemoryStream(reader.ReadBytes(bestLength)))
                            using (var image = Image.FromStream(frame)) logo = new Bitmap(image);
                        }
                    }
                }
            }
            catch (Exception) { /* Keep a usable loading screen if the icon is unavailable. */ }
            bool enabled;
            animate = !SystemParametersInfo(0x1042, 0, out enabled, 0) || enabled;
            timer.Interval = animate ? 60 : 1000;
            timer.Tick += delegate { Invalidate(); };
            timer.Start();
        }

        public void StopAnimation() { timer.Stop(); }

        public void ShowFailure(string message)
        {
            failure = message + "（按 Alt+F4 关闭）";
            timer.Stop();
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            var g = e.Graphics;
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            float centerX = ClientSize.Width / 2f;
            float centerY = ClientSize.Height / 2f - 24f;
            double phase = clock.Elapsed.TotalSeconds * 2.7;
            if (logo != null)
            {
                // Keep the entire outer mark fixed. Only the little book spine
                // gently looks around, then settles into its original position.
                double time = clock.Elapsed.TotalSeconds % 2.4;
                double motion = animate && failure == null && time < 1.8
                    ? Math.Sin(Math.PI * time / 1.8) : 0;
                float frameX = centerX - 38;
                float frameY = centerY - 68;
                var spineSource = new Rectangle(45, 28, 27, 61);
                var spineOriginal = new RectangleF(frameX + 76f * spineSource.X / 128f, frameY + 76f * spineSource.Y / 128f,
                    76f * spineSource.Width / 128f, 76f * spineSource.Height / 128f);
                if (motion <= 0.001) g.DrawImage(logo, frameX, frameY, 76, 76);
                else
                {
                    var saved = g.Save();
                    g.SetClip(spineOriginal, System.Drawing.Drawing2D.CombineMode.Exclude);
                    g.DrawImage(logo, frameX, frameY, 76, 76);
                    g.Restore(saved);

                    var sprite = g.Save();
                    float centerSpineX = spineOriginal.X + spineOriginal.Width / 2f + (float)(Math.Sin(time * 5) * motion * 2.8);
                    float centerSpineY = spineOriginal.Y + spineOriginal.Height / 2f - (float)(motion * 2.5);
                    g.TranslateTransform(centerSpineX, centerSpineY);
                    g.RotateTransform((float)(Math.Sin(time * 6) * motion * 12));
                    g.DrawImage(logo, new RectangleF(-spineOriginal.Width / 2f, -spineOriginal.Height / 2f, spineOriginal.Width, spineOriginal.Height),
                        spineSource, GraphicsUnit.Pixel);
                    g.Restore(sprite);
                }
            }
            using (var titleFont = new Font("Microsoft YaHei UI", 15f, FontStyle.Regular))
            using (var hintFont = new Font("Microsoft YaHei UI", 9f, FontStyle.Regular))
            using (var ink = new SolidBrush(Color.FromArgb(22, 22, 22)))
            using (var muted = new SolidBrush(Color.FromArgb(105, 105, 105)))
            using (var centered = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            {
                g.DrawString("纸间", titleFont, ink, new RectangleF(0, centerY + 24, Width, 30), centered);
                string status = failure ?? (clock.Elapsed.TotalSeconds >= 15 ? "启动时间较长，请检查 WebView2 运行环境" : "正在打开你的笔记");
                g.DrawString(status, hintFont, muted, new RectangleF(0, centerY + 63, Width, 24), centered);
                if (failure == null && clock.Elapsed.TotalSeconds < 15)
                {
                    for (int i = 0; i < 3; i++)
                    {
                        float size = animate ? 3f + (float)((Math.Sin(phase - i * 0.8) + 1) * 1.3) : 4f;
                        g.FillEllipse(ink, centerX - 14 + i * 14 - size / 2, centerY + 105 - size / 2, size, size);
                    }
                }
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { timer.Dispose(); if (logo != null) logo.Dispose(); }
            base.Dispose(disposing);
        }
    }
}
