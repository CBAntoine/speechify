package com.cbantoine.dashcam.scanner

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import androidx.core.content.edit
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Keeps the user's Anthropic API key, encrypted with an AES key that lives in the Android
 * Keystore and never leaves it. The ciphertext sits in private app storage, which is excluded
 * from backups, so the key stays on this phone.
 */
class ApiKeyStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val _hasKey = MutableStateFlow(prefs.contains(KEY_CIPHERTEXT))
    val hasKey: StateFlow<Boolean> = _hasKey.asStateFlow()

    /** The saved key, or null. Decrypts with the Keystore, so call it off the main thread. */
    @Synchronized
    fun get(): String? {
        val iv = prefs.getString(KEY_IV, null) ?: return null
        val ciphertext = prefs.getString(KEY_CIPHERTEXT, null) ?: return null
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, decode(iv)))
            String(cipher.doFinal(decode(ciphertext)), Charsets.UTF_8)
        } catch (e: Exception) {
            // The Keystore key is gone (for example after a restore to a new phone): ask again.
            Log.w(TAG, "Saved API key can't be decrypted", e)
            clear()
            null
        }
    }

    @Synchronized
    fun set(apiKey: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val ciphertext = cipher.doFinal(apiKey.trim().toByteArray(Charsets.UTF_8))
        prefs.edit {
            putString(KEY_IV, encode(cipher.iv))
            putString(KEY_CIPHERTEXT, encode(ciphertext))
        }
        _hasKey.value = true
    }

    @Synchronized
    fun clear() {
        prefs.edit {
            remove(KEY_IV)
            remove(KEY_CIPHERTEXT)
        }
        _hasKey.value = false
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private fun decode(text: String) = Base64.decode(text, Base64.NO_WRAP)

    private companion object {
        const val TAG = "ApiKeyStore"
        const val PREFS = "scanner_secrets"
        const val KEY_IV = "anthropic_iv"
        const val KEY_CIPHERTEXT = "anthropic_key"
        const val KEY_ALIAS = "dashcam_anthropic_key"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
    }
}
