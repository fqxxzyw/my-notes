package com.papernotes.android.data

import java.net.URI
import java.security.MessageDigest

/**
 * Repository identity rules matching docs/.vitepress/theme/repository.ts.
 * Never hardcoded to any developer account; isolates local data and tokens per repo.
 */
object RepositoryIdentity {
    private val OWNER_REGEX = Regex("^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$")
    private val REPO_REGEX = Regex("^[a-zA-Z0-9._-]{1,100}$")

    fun normalizeRepository(input: String): String {
        var value = input.trim()
        if (value.startsWith("http://", ignoreCase = true) || value.startsWith("https://", ignoreCase = true)) {
            val uri = try {
                URI(value)
            } catch (_: Exception) {
                throw IllegalArgumentException("请输入 GitHub 仓库地址或 owner/repository。")
            }
            if (!"https".equals(uri.scheme, ignoreCase = true) ||
                !"github.com".equals(uri.host, ignoreCase = true) ||
                uri.port != -1 ||
                uri.userInfo != null ||
                uri.query != null ||
                uri.fragment != null
            ) {
                throw IllegalArgumentException("请输入 github.com 上的 HTTPS 仓库地址。")
            }
            value = (uri.path ?: "").trim('/')
        }
        if (value.endsWith(".git", ignoreCase = true)) {
            value = value.dropLast(4)
        }
        val parts = value.split('/')
        val owner = parts.getOrNull(0).orEmpty()
        val repo = parts.getOrNull(1).orEmpty()
        if (parts.size != 2 ||
            !OWNER_REGEX.matches(owner) ||
            owner.contains("--") ||
            !REPO_REGEX.matches(repo) ||
            repo == "." ||
            repo == ".."
        ) {
            throw IllegalArgumentException("仓库格式应为 owner/repository，例如 octocat/my-notes。")
        }
        return "$owner/$repo".lowercase()
    }

    /** Stable filesystem-safe directory identifier per repository (or 'local' when unbound). */
    fun workspaceScope(repository: String?): String {
        if (repository.isNullOrBlank()) return "local"
        val canonical = normalizeRepository(repository)
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8))
        val hex = digest.joinToString("") { "%02x".format(it) }.take(24)
        val safeLabel = canonical.replace('/', '_').replace(Regex("[^a-z0-9_-]"), "_")
        return "repo_${safeLabel}_$hex"
    }
}
