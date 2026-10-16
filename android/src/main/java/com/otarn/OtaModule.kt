package com.otarn

import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class OtaModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "OtaModule"

    @ReactMethod
    fun getCurrentBundlePath(promise: Promise) {
        val path = OtaBundleLoader.getJSBundleFile(reactContext)
        promise.resolve(path)
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
