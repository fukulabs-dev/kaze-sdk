package com.otarn

import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

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
    fun restartApp() {
        val packageManager = reactContext.packageManager
        val intent = packageManager.getLaunchIntentForPackage(reactContext.packageName)
        val componentName = intent?.component
        val restartIntent = android.content.Intent.makeRestartActivityTask(componentName)
        reactContext.startActivity(restartIntent)
        Runtime.getRuntime().exit(0)
    }
}
