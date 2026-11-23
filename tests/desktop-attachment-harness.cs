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
        Console.WriteLine("Desktop attachment storage passed.");
    }
}
