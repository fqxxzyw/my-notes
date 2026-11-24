package com.papernotes.android.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface TokenStore {
    fun getToken(repository: String): String?
    fun saveToken(repository: String, token: String)
    fun clearToken(repository: String)
}

/**
 * Android Keystore backed AES-256-GCM token vault isolated per canonical GitHub repository.
 * Tokens are never written to logs, source code, or note repositories.
 */
class AndroidKeystoreTokenStore(private val baseDir: File) : TokenStore {
    companion object {
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val KEY_ALIAS = "paper_notes_github_token_aes256_v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_IV_BYTES = 12
        private const val GCM_TAG_BITS = 128
    }

    private fun vaultDir(): File = File(baseDir, "secure_tokens").apply { mkdirs() }

    private fun tokenFile(repository: String): File {
        val canonical = RepositoryIdentity.normalizeRepository(repository)
        val digest = MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8))
        val hex = digest.joinToString("") { "%02x".format(it) }
        return File(vaultDir(), "$hex.enc")
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        generator.init(spec)
        return generator.generateKey()
    }

    override fun getToken(repository: String): String? {
        if (repository.isBlank()) return null
        val file = tokenFile(repository)
        if (!file.isFile) return null
        return try {
            val payload = file.readBytes()
            if (payload.size <= GCM_IV_BYTES) return null
            val iv = payload.copyOfRange(0, GCM_IV_BYTES)
            val ciphertext = payload.copyOfRange(GCM_IV_BYTES, payload.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8).trim().ifEmpty { null }
        } catch (_: Exception) {
            null
        }
    }

    override fun saveToken(repository: String, token: String) {
        val trimmed = token.trim()
        require(trimmed.isNotEmpty()) { "令牌不能为空。" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = cipher.iv
        val encrypted = cipher.doFinal(trimmed.toByteArray(Charsets.UTF_8))
        val target = tokenFile(repository)
        val tmp = File(target.parentFile, "${target.name}.tmp")
        tmp.writeBytes(iv + encrypted)
        if (!tmp.renameTo(target)) {
            target.writeBytes(iv + encrypted)
            tmp.delete()
        }
    }

    override fun clearToken(repository: String) {
        if (repository.isBlank()) return
        tokenFile(repository).delete()
    }
}
