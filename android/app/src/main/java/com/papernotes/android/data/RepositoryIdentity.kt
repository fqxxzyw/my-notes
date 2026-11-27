package com.papernotes.android.data

import java.net.URI
import java.security.MessageDigest

/**
 * Repository identity rules matching docs/.vitepress/theme/repository.ts.
 * Never hardcoded to any developer account; isolates local data and tokens per repo.
 */
object RepositoryIdentity {
    private val OWNER_REGEX = Regex("^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,37}[a-zA-Z0-9])?$")
    private val REPO_REGEX = Regex("^[a-zA-Z0-9._-]{1,100}$")
    private val SUPPORTED_HOSTS = mapOf(
        "github.com" to "github",
        "gitee.com" to "gitee",
        "gitlab.com" to "gitlab",
        "gitcode.com" to "gitcode"
    )
    private val PROVIDER_PREFIX_REGEX = Regex("^(github|gitee|gitlab|gitcode):(.+)$", RegexOption.IGNORE_CASE)

    data class ParsedRepo(val provider: String, val owner: String, val repo: String) {
        val canonical: String get() = if (provider == "github") "$owner/$repo" else "$provider:$owner/$repo"
    }

    fun parseRepository(input: String): ParsedRepo {
        var value = input.trim()
        var provider = "github"
        val prefixMatch = PROVIDER_PREFIX_REGEX.matchEntire(value)
        if (prefixMatch != null) {
            provider = prefixMatch.groupValues[1].lowercase()
            value = prefixMatch.groupValues[2].trim()
        } else if (value.startsWith("http://", ignoreCase = true) || value.startsWith("https://", ignoreCase = true)) {
            val uri = try {
                URI(value)
            } catch (_: Exception) {
                throw IllegalArgumentException("请输入 GitHub / Gitee / GitLab / GitCode 仓库地址或 owner/repository。")
            }
            val hostProvider = SUPPORTED_HOSTS[uri.host?.lowercase().orEmpty()]
            if (!"https".equals(uri.scheme, ignoreCase = true) ||
                hostProvider == null ||
                uri.port != -1 ||
                uri.userInfo != null ||
                uri.query != null ||
                uri.fragment != null
            ) {
                throw IllegalArgumentException("仅支持 github.com、gitee.com、gitlab.com 或 gitcode.com 的 HTTPS 仓库地址。")
            }
            provider = hostProvider
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
        return ParsedRepo(provider, owner.lowercase(), repo.lowercase())
    }

    fun normalizeRepository(input: String): String = parseRepository(input).canonical

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
