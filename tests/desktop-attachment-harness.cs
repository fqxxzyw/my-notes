using System;
using System.IO;
using System.Linq;
using PaperNotesDesktop;

internal static class DesktopAttachmentHarness
{
    private static void Fails(Action action)
    {
        bool failed = false;
        try { action(); } catch { failed = true; }
        if (!failed) throw new Exception("Expected operation to fail");
    }

    private static void Main(string[] args)
    {
        try { Run(args); }
        catch (Exception e) { Console.Error.WriteLine(e.Message); Environment.Exit(1); }
    }

    private static void Run(string[] args)
    {
        string root = Path.Combine(args[0], "附件");
        string path = "docs/notebooks/book/assets/" + new string('1', 32) + ".png";
        byte[] png = { 137,80,78,71,13,10,26,10,1,2 };
        AttachmentFiles.Write(root, "Alice/Notes", path, png);
        if (!AttachmentFiles.Read(root, "alice/notes", path).SequenceEqual(png)) throw new Exception("Image bytes changed");
        if (AttachmentFiles.Read(root, "other/notes", path) != null || AttachmentFiles.Read(root, "", path) != null) throw new Exception("Workspace isolation failed");
        AttachmentFiles.Write(root, "alice/notes", path, png);
        Fails(() => AttachmentFiles.Write(root, "alice/notes", path, new byte[] { 137,80,78,71,13,10,26,10,9,2 }));
        Fails(() => AttachmentFiles.Write(root, "alice/notes", "docs/notebooks/book/assets/../../secret.png", png));
        Fails(() => AttachmentFiles.Write(root, "../notes", path, png));
        Fails(() => AttachmentFiles.Write(root, "alice/notes", path, new byte[] { 1,2,3 }));
        if (!AttachmentFiles.Read(root, "alice/notes", path).SequenceEqual(png)) throw new Exception("Existing image overwritten");
        if (Directory.GetFiles(root, "*", SearchOption.AllDirectories).Length != 1) throw new Exception("Unexpected files");

        string sourceDirectory = Path.Combine(args[0], "图片 来源");
        Directory.CreateDirectory(sourceDirectory);
        string source = Path.Combine(sourceDirectory, "测试 图片.png");
        File.WriteAllBytes(source, png);
        string sourceMarkdown = Path.Combine(sourceDirectory, "测试笔记.md");
        byte[] markdown = System.Text.Encoding.UTF8.GetBytes("![图](测试%20图片.png)");
        File.WriteAllBytes(sourceMarkdown, markdown);
        if (!ReferencedImageFiles.Read(source, 20 * 1024 * 1024).SequenceEqual(png)) throw new Exception("Local image bytes changed");
        if (!ReferencedImageFiles.Read(new Uri(source).AbsoluteUri, 20 * 1024 * 1024).SequenceEqual(png)) throw new Exception("file URI failed");
        if (!ReferencedImageFiles.ReadRelative(sourceMarkdown, "./测试%20图片.png", 20 * 1024 * 1024).SequenceEqual(png)) throw new Exception("Relative image failed");
        string nestedDirectory = Path.Combine(sourceDirectory, "笔记");
        Directory.CreateDirectory(nestedDirectory);
        string nestedMarkdown = Path.Combine(nestedDirectory, "嵌套.md");
        File.WriteAllBytes(nestedMarkdown, markdown);
        if (!ReferencedImageFiles.ReadRelative(nestedMarkdown, "../测试%20图片.png", 20 * 1024 * 1024).SequenceEqual(png)) throw new Exception("Parent-relative image failed");
        if (!ReferencedImageFiles.ReadMarkdown(sourceMarkdown, 5 * 1024 * 1024).SequenceEqual(markdown)) throw new Exception("Markdown bytes changed");
        if (!ReferencedImageFiles.MentionsPath("![图](<" + source + ">)", source.Replace("\\", "%5C"))) throw new Exception("Referenced path not recognized");
        string typoraPath = @"C:\Users\Lenovo\AppData\Roaming\Typora\typora-user-images\image-20260920210933494.png";
        if (!ReferencedImageFiles.MentionsPath("![](" + typoraPath + ")", typoraPath.Replace("\\", "%5C"))) throw new Exception("Typora absolute image not recognized");
        if (!ReferencedImageFiles.MentionsPath("![图](file:///C:/Users/Lenovo/image.png)", "file:///C:/Users/Lenovo/image.png")) throw new Exception("file URI image not recognized");
        if (!ReferencedImageFiles.MentionsPath("![图](<测试 图片.png>)", "测试%20图片.png")) throw new Exception("Encoded path not recognized");
        if (!ReferencedImageFiles.MentionsPath(new string('a', 100000) + "![图](测试%2Epng)", "测试.png")) throw new Exception("Long encoded Markdown path not recognized");
        if (ReferencedImageFiles.MentionsPath("![图](测试 图片.png)", "another.png")) throw new Exception("Unreferenced path was authorized");
        if (!ReferencedImageFiles.MentionsPath("![图][pic]\n\n[pic]: <C:/图片/a%20b.png> \"title\"", "C:/图片/a%20b.png")) throw new Exception("Image reference not recognized");
        if (!ReferencedImageFiles.MentionsPath("![][a]\n\n[a]: C:/private/a.png", "C:/private/a.png")) throw new Exception("Empty-alt image reference not recognized");
        if (!ReferencedImageFiles.MentionsPath("> ![x][r]\n>\n> [r]: C:/valid/a.png", "C:/valid/a.png")) throw new Exception("Quoted image reference not recognized");
        if (ReferencedImageFiles.MentionsPath("![a][a]\n\n[a]: https://example.com/image.png\n[a]: C:/private/secret.png", "C:/private/secret.png")) throw new Exception("Shadowed reference definition was authorized");
        if (!ReferencedImageFiles.MentionsPath("<img src=\"C:/图片/a%20b.png\" style=\"zoom:50%\" />", "C:/图片/a%20b.png")) throw new Exception("HTML image not recognized");
        if (ReferencedImageFiles.MentionsPath("<!-- ![x](C:/private/secret.png) -->", "C:/private/secret.png")) throw new Exception("Comment was authorized");
        if (ReferencedImageFiles.MentionsPath("```md\n![x](C:/private/secret.png)\n```", "C:/private/secret.png")) throw new Exception("Code fence was authorized");
        if (ReferencedImageFiles.MentionsPath("> ```md\n> ![x](C:/private/secret.png)\n> ```", "C:/private/secret.png")) throw new Exception("Quoted code fence was authorized");
        if (ReferencedImageFiles.MentionsPath(">     ![x](C:/private/secret.png)", "C:/private/secret.png")) throw new Exception("Quoted indented code was authorized");
        if (ReferencedImageFiles.MentionsPath("prefix `code\n![x](C:/private/secret.png)\nclosing`", "C:/private/secret.png")) throw new Exception("Multiline inline code was authorized");
        if (ReferencedImageFiles.MentionsPath("- ```md\n  ![x](C:/private/secret.png)\n  ```", "C:/private/secret.png")) throw new Exception("List code fence was authorized");
        if (ReferencedImageFiles.MentionsPath("`![x](C:/private/secret.png)`", "C:/private/secret.png")) throw new Exception("Inline code was authorized");
        if (ReferencedImageFiles.MentionsPath("[link](C:/private/secret.png)", "C:/private/secret.png")) throw new Exception("Ordinary link was authorized");
        if (ReferencedImageFiles.MentionsPath("\\![x](C:/private/secret.png)", "C:/private/secret.png")) throw new Exception("Escaped image was authorized");
        if (ReferencedImageFiles.MentionsPath("\\<img src='C:/private/secret.png'>", "C:/private/secret.png")) throw new Exception("Escaped HTML image was authorized");
        if (ReferencedImageFiles.MentionsPath("![x](C:/private/secret.png.bak)", "C:/private/secret.png")) throw new Exception("Path prefix was authorized");
        if (ReferencedImageFiles.MentionsPath("![x](C:/private/secret.png", "C:/private/secret.png")) throw new Exception("Unclosed image was authorized");
        if (ReferencedImageFiles.MentionsPath("![x](<C:/private/secret.png>", "C:/private/secret.png")) throw new Exception("Unclosed angle image was authorized");
        if (ReferencedImageFiles.MentionsPath("![x](C:/private/secret.png plain)", "C:/private/secret.png")) throw new Exception("Invalid image title was authorized");
        if (!ReferencedImageFiles.MentionsPath("![x](C:/valid/a.png \"title\")", "C:/valid/a.png")) throw new Exception("Valid image title was rejected");
        if (ReferencedImageFiles.MentionsPath("![x](C:/private/a%20b.png)", "C:/private/a+b.png")) throw new Exception("Plus and space paths collided");
        if (!ReferencedImageFiles.MentionsPath("![x](C:/private/a+b.png)", "C:/private/a%2Bb.png")) throw new Exception("Encoded plus was not recognized");
        if (ReferencedImageFiles.MentionsPath("<script> <img src='C:/private/secret.png'> </script>", "C:/private/secret.png")) throw new Exception("Script image was authorized");
        if (ReferencedImageFiles.MentionsPath("<img alt=\" text src='C:/private/secret.png' \">", "C:/private/secret.png")) throw new Exception("Attribute text was authorized as src");
        if (ReferencedImageFiles.MentionsPath("<div title='<img src=\"C:/private/secret.png\">'>text</div>", "C:/private/secret.png")) throw new Exception("Nested image in HTML attribute was authorized");
        if (ReferencedImageFiles.MentionsPath("<div title=\"![x](C:/private/secret.png)\">text</div>", "C:/private/secret.png")) throw new Exception("Markdown in HTML attribute was authorized");
        if (ReferencedImageFiles.MentionsPath("<pre>![x](C:/private/secret.png)</pre>", "C:/private/secret.png")) throw new Exception("Preformatted code was authorized");
        if (!ReferencedImageFiles.MentionsPath("`unmatched\n\n![x](C:/valid/a.png)\n\nanother `", "C:/valid/a.png")) throw new Exception("Unmatched code delimiters hid image");
        if (ReferencedImageFiles.Read(Path.Combine(sourceDirectory, "missing.png"), 20 * 1024 * 1024) != null) throw new Exception("Missing image should remain unresolved");
        Fails(() => ReferencedImageFiles.Read(source, 1));
        Fails(() => ReferencedImageFiles.Read(source, 0));
        Fails(() => ReferencedImageFiles.Read(@"\\server\share\test.png", 20 * 1024 * 1024));
        Fails(() => ReferencedImageFiles.Read(@"\\?\C:\temp\test.png", 20 * 1024 * 1024));
        Fails(() => ReferencedImageFiles.Read(@"C:\temp\..\test.png", 20 * 1024 * 1024));
        Fails(() => ReferencedImageFiles.Read(@"C:\temp\secret.txt:visible.png", 20 * 1024 * 1024));
        Fails(() => ReferencedImageFiles.Read(@"C:\temp\CON.png", 20 * 1024 * 1024));
        Fails(() => ReferencedImageFiles.Read("https://example.com/a.png", 20 * 1024 * 1024));
        Fails(() => ReferencedImageFiles.ReadRelative(sourceMarkdown, "//server/share/test.png", 20 * 1024 * 1024));
        Fails(() => ReferencedImageFiles.ReadRelative(sourceMarkdown, "C:/temp/test.png", 20 * 1024 * 1024));
        Fails(() => ReferencedImageFiles.ReadMarkdown(source, 5 * 1024 * 1024));
        string bad = Path.Combine(sourceDirectory, "invalid.png");
        File.WriteAllBytes(bad, new byte[] { 1, 2, 3 });
        Fails(() => ReferencedImageFiles.Read(bad, 20 * 1024 * 1024));
        var selectedMarkdown = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var selectedImages = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var selectedFiles = SelectedImportFolder.Enumerate(sourceDirectory, selectedMarkdown, selectedImages);
        if (!selectedMarkdown.Contains(sourceMarkdown) || !selectedMarkdown.Contains(nestedMarkdown) || !selectedImages.Contains(source)) throw new Exception("Selected folder contents missing");
        if (!selectedFiles.Any(item => ((string)item["relative"]).EndsWith("/笔记/嵌套.md"))) throw new Exception("Relative folder paths lost");
        if (!ReferencedImageFiles.ReadLiteralImage(source, 20 * 1024 * 1024).SequenceEqual(png)) throw new Exception("Selected image changed");
        if (!File.ReadAllBytes(source).SequenceEqual(png)) throw new Exception("Source image modified");

        // Verify DocumentFiles storage isolation, read-only document reading, and multi-format folder enumeration.
        string docRoot = Path.Combine(args[0], "文件");
        string docPath = "docs/pages/files/" + new string('2', 32) + ".pdf";
        byte[] pdf = System.Text.Encoding.ASCII.GetBytes("%PDF-1.4\n%test\n");
        DocumentFiles.Write(docRoot, "Alice/Notes", docPath, pdf);
        if (!DocumentFiles.Read(docRoot, "alice/notes", docPath).SequenceEqual(pdf)) throw new Exception("Document bytes changed");
        if (DocumentFiles.Read(docRoot, "other/notes", docPath) != null) throw new Exception("Document workspace isolation failed");
        Fails(() => DocumentFiles.Write(docRoot, "alice/notes", "docs/pages/files/" + new string('2', 32) + ".exe", pdf));
        Fails(() => DocumentFiles.Write(docRoot, "alice/notes", "docs/pages/files/../../secret.pdf", pdf));
        string txtFile = Path.Combine(sourceDirectory, "纯文本.txt");
        byte[] txtBytes = System.Text.Encoding.UTF8.GetBytes("hello plain text");
        File.WriteAllBytes(txtFile, txtBytes);
        string pdfFile = Path.Combine(sourceDirectory, "资料.pdf");
        File.WriteAllBytes(pdfFile, pdf);
        if (!ReferencedImageFiles.ReadTextFile(txtFile, 5 * 1024 * 1024).SequenceEqual(txtBytes)) throw new Exception("Text file bytes changed");
        if (!ReferencedImageFiles.ReadDocumentFile(pdfFile, 50 * 1024 * 1024).SequenceEqual(pdf)) throw new Exception("PDF file bytes changed");
        Fails(() => ReferencedImageFiles.ReadDocumentFile(txtFile, 50 * 1024 * 1024));
        var allMd = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var allImg = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var allTxt = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var allDoc = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var enumerated = SelectedImportFolder.EnumerateAll(sourceDirectory, allMd, allImg, allTxt, allDoc);
        if (!allTxt.Contains(txtFile) || !allDoc.Contains(pdfFile) || !enumerated.Any(item => (string)item["kind"] == "document")) throw new Exception("Multi-format folder enumeration failed");
        Console.WriteLine("Desktop attachment storage passed.");
    }
}
