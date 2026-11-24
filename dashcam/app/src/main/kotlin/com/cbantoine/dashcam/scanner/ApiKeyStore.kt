package com.cbantoine.dashcam.scanner

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import androidx.core.content.edit
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.UnrecoverableKeyException
import javax.crypto.AEADBadTagException
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
        try {
            val key = existingKey()
            if (key == null) {
                // The Keystore key is gone (a reset, or data restored to another phone): ask again.
                clear()
                return null
            }
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, decode(iv)))
            return String(cipher.doFinal(decode(ciphertext)), Charsets.UTF_8)
        } catch (e: GeneralSecurityException) {
            // The saved key can never be decrypted again (tag mismatch, invalidated key): ask again.
            if (e is AEADBadTagException || e is KeyPermanentlyInvalidatedException || e is UnrecoverableKeyException) {
                Log.w(TAG, "Saved API key is unrecoverable", e)
                clear()
            } else {
                Log.w(TAG, "Couldn't decrypt the API key this time", e)
            }
            return null
        } catch (e: RuntimeException) {
            // For example a busy Keystore: keep the key and try again next time.
            Log.w(TAG, "Couldn't decrypt the API key this time", e)
            return null
        }
    }

    /** Encrypts and saves [apiKey]. Returns false if the Keystore refused. */
    @Synchronized
    fun set(apiKey: String): Boolean = try {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, existingKey() ?: newKey())
        val ciphertext = cipher.doFinal(apiKey.trim().toByteArray(Charsets.UTF_8))
        prefs.edit {
            putString(KEY_IV, encode(cipher.iv))
            putString(KEY_CIPHERTEXT, encode(ciphertext))
        }
        _hasKey.value = true
        true
    } catch (e: GeneralSecurityException) {
        Log.e(TAG, "Couldn't save the API key", e)
        false
    } catch (e: RuntimeException) {
        Log.e(TAG, "Couldn't save the API key", e)
        false
    }

    @Synchronized
    fun clear() {
        prefs.edit {
            remove(KEY_IV)
            remove(KEY_CIPHERTEXT)
        }
        _hasKey.value = false
    }

    private fun existingKey(): SecretKey? {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        return keyStore.getKey(KEY_ALIAS, null) as? SecretKey
    }

    private fun newKey(): SecretKey {
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
