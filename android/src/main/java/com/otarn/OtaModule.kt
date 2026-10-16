package com.otarn

import android.content.Context
import android.util.Base64
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import java.io.File
class OtaModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "OtaModule"

    private val prefs by lazy {
        reactContext.getSharedPreferences("ota_prefs", Context.MODE_PRIVATE)
    }

    @ReactMethod
    fun getCurrentBundlePath(promise: Promise) {
        val path = OtaBundleLoader.getJSBundleFile(reactContext)
        promise.resolve(path)
    }

    @ReactMethod
    fun setBundleBlacklisted(hash: String) {
        prefs.edit().putBoolean("ota_blacklisted_$hash", true).commit()
    }

    @ReactMethod
    fun isBundleBlacklisted(hash: String, promise: Promise) {
        val isBlacklisted = prefs.getBoolean("ota_blacklisted_$hash", false)
        promise.resolve(isBlacklisted)
    }

    @ReactMethod
    fun setBundleStable(hash: String) {
        prefs.edit().putBoolean("ota_stable_$hash", true).commit()
    }

    @ReactMethod
    fun clearBlacklist() {
        val editor = prefs.edit()
        for (key in prefs.all.keys) {
            if (key.startsWith("ota_blacklisted_")) {
                editor.remove(key)
            }
        }
        editor.commit()
    }

    @ReactMethod
    fun writeBundleFile(relativePath: String, content: String, isBase64: Boolean, promise: Promise) {
        try {
            if (relativePath.contains("..")) {
                promise.reject("SECURITY_ERROR", "Path traversal detected in $relativePath")
                return
            }
            val targetFile = File(reactContext.filesDir, relativePath)
            targetFile.parentFile?.mkdirs()
            if (isBase64) {
                val bytes = Base64.decode(content, Base64.DEFAULT)
                targetFile.writeBytes(bytes)
            } else {
                targetFile.writeText(content, Charsets.UTF_8)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("FILE_WRITE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun readBundleFile(relativePath: String, promise: Promise) {
        try {
            if (relativePath.contains("..")) {
                promise.reject("SECURITY_ERROR", "Path traversal detected in $relativePath")
                return
            }
            val targetFile = File(reactContext.filesDir, relativePath)
            if (!targetFile.exists()) {
                promise.resolve(null)
                return
            }
            promise.resolve(targetFile.readText(Charsets.UTF_8))
        } catch (e: Exception) {
            promise.reject("FILE_READ_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun bundleFileExists(relativePath: String, promise: Promise) {
        try {
            if (relativePath.contains("..")) {
                promise.reject("SECURITY_ERROR", "Path traversal detected in $relativePath")
                return
            }
            val targetFile = File(reactContext.filesDir, relativePath)
            promise.resolve(targetFile.exists())
        } catch (e: Exception) {
            promise.reject("FILE_EXISTS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getActiveSlot(promise: Promise) {
        val active = prefs.getString(OtaBundleLoader.KEY_ACTIVE_SLOT, null)
        promise.resolve(active)
    }

    @ReactMethod
    fun switchActiveSlot(newSlot: String, promise: Promise) {
        val currentActive = prefs.getString(OtaBundleLoader.KEY_ACTIVE_SLOT, null)
        val editor = prefs.edit()
        if (currentActive != null && currentActive != newSlot) {
            editor.putString(OtaBundleLoader.KEY_ROLLBACK_SLOT, currentActive)
        }
        editor.putString(OtaBundleLoader.KEY_ACTIVE_SLOT, newSlot)
        val ok = editor.commit()
        promise.resolve(ok)
    }

    @ReactMethod
    fun getRollbackSlot(promise: Promise) {
        val rollback = prefs.getString(OtaBundleLoader.KEY_ROLLBACK_SLOT, null)
        promise.resolve(rollback)
    }

    @ReactMethod
    fun restartApp() {
        val packageManager = reactContext.packageManager
        val intent = packageManager.getLaunchIntentForPackage(reactContext.packageName)
        val componentName = intent?.component
        val restartIntent = android.content.Intent.makeRestartActivityTask(componentName)
        reactContext.startActivity(restartIntent)
        Runtime.getRuntime().exit(0)
    }
}
