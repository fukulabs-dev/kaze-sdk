package com.otarn

import android.content.Context
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.BufferedInputStream
import java.util.zip.ZipInputStream
class OtaModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "OtaModule"

    private val prefs by lazy {
        reactContext.getSharedPreferences("ota_prefs", Context.MODE_PRIVATE)
    }

    @ReactMethod
    fun getCurrentBundlePath(promise: Promise) {
        val path = OtaBundleLoader.resolveBundle(reactContext)?.path
        promise.resolve(path)
    }

    // Synchronous so the write lands before the JS crash handler hands off to RN's fatal handler,
    // which kills the process.
    @ReactMethod(isBlockingSynchronousMethod = true)
    fun setBundleBlacklisted(hash: String): Boolean {
        return prefs.edit().putBoolean("${OtaBundleLoader.KEY_BLACKLISTED_PREFIX}$hash", true).commit()
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    fun getRunningBundleInfo(): WritableMap {
        val running = OtaBundleLoader.runningBundle
        val info = Arguments.createMap()
        if (running != null) {
            info.putString("hash", running.hash)
            info.putString("slot", running.slot)
            info.putBoolean("stable", prefs.getBoolean("${OtaBundleLoader.KEY_STABLE_PREFIX}${running.hash}", false))
        } else {
            info.putNull("hash")
            info.putNull("slot")
            info.putBoolean("stable", true)
        }
        return info
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
    fun deleteBundlePath(relativePath: String, promise: Promise) {
        try {
            if (relativePath.contains("..") || relativePath.isBlank()) {
                promise.reject("SECURITY_ERROR", "Invalid path: $relativePath")
                return
            }
            val target = File(reactContext.filesDir, relativePath)
            promise.resolve(!target.exists() || target.deleteRecursively())
        } catch (e: Exception) {
            promise.reject("FILE_DELETE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun unzipBundleFile(zipRelativePath: String, targetSlotDir: String, promise: Promise) {
        try {
            if (zipRelativePath.contains("..") || targetSlotDir.contains("..")) {
                promise.reject("SECURITY_ERROR", "Path traversal detected in arguments")
                return
            }
            val zipFile = File(reactContext.filesDir, zipRelativePath)
            if (!zipFile.exists() || !zipFile.isFile) {
                promise.reject("FILE_NOT_FOUND", "Source zip archive does not exist: $zipRelativePath")
                return
            }
            val targetDir = File(reactContext.filesDir, targetSlotDir)
            if (!targetDir.exists()) {
                targetDir.mkdirs()
            }
            val canonicalTarget = targetDir.canonicalPath

            ZipInputStream(BufferedInputStream(FileInputStream(zipFile))).use { zis ->
                var entry = zis.nextEntry
                while (entry != null) {
                    val destFile = File(targetDir, entry.name)
                    val canonicalDest = destFile.canonicalPath
                    if (!canonicalDest.startsWith(canonicalTarget + File.separator) && canonicalDest != canonicalTarget) {
                        promise.reject("SECURITY_ERROR", "Zip slip detected for entry: ${entry.name}")
                        return
                    }
                    if (entry.isDirectory) {
                        destFile.mkdirs()
                    } else {
                        destFile.parentFile?.mkdirs()
                        FileOutputStream(destFile).use { fos ->
                            zis.copyTo(fos)
                        }
                    }
                    zis.closeEntry()
                    entry = zis.nextEntry
                }
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("UNZIP_ERROR", e.message, e)
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
