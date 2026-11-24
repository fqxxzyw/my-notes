package com.papernotes.android.data

import java.io.File

/**
 * Immutable per-repository attachment file store on internal app storage.
 * Enforces byte-level immutability: existing paths with differing bytes are never overwritten.
 */
class AttachmentFileStore(private val rootDir: File) {

    private fun workspaceAttachmentsDir(repository: String?): File {
        val scope = RepositoryIdentity.workspaceScope(repository)
        return File(File(File(rootDir, "workspaces"), scope), "attachments")
    }

    fun resolveFile(repository: String?, managedPath: String): File {
        AttachmentPolicy.validateAttachmentPath(managedPath)
        val base = workspaceAttachmentsDir(repository)
        val file = File(base, managedPath)
        val canonicalBase = base.canonicalFile
        val canonicalTarget = file.canonicalFile
        if (!canonicalTarget.path.startsWith(canonicalBase.path + File.separator)) {
            throw SecurityException("图片路径越界。")
        }
        return file
    }

    fun putAttachment(repository: String?, attachment: NoteAttachment) {
        AttachmentPolicy.validateAttachment(attachment)
        val target = resolveFile(repository, attachment.path)
        if (target.isFile) {
            val existing = target.readBytes()
            if (!existing.contentEquals(attachment.bytes)) {
                throw IllegalStateException("图片路径已存在不同内容，已保留原文件。")
            }
            return
        }
        target.parentFile?.mkdirs()
        val tmp = File(target.parentFile, "${target.name}.tmp")
        tmp.writeBytes(attachment.bytes)
        if (!tmp.renameTo(target)) {
            target.writeBytes(attachment.bytes)
            tmp.delete()
        }
    }

    fun getAttachment(repository: String?, managedPath: String): NoteAttachment? {
        AttachmentPolicy.validateAttachmentPath(managedPath)
        val target = resolveFile(repository, managedPath)
        if (!target.isFile) return null
        val bytes = target.readBytes()
        return AttachmentPolicy.validateAttachment(NoteAttachment(path = managedPath, bytes = bytes))
    }

    fun exists(repository: String?, managedPath: String): Boolean {
        return try {
            resolveFile(repository, managedPath).isFile
        } catch (_: Exception) {
            false
        }
    }
}
