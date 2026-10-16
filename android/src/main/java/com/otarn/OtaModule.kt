package com.otarn

import android.content.Context
import java.io.File

class OtaModule(private val context: Context) {
    fun getCurrentBundlePath(): String? {
        return OtaBundleLoader.getJSBundleFile(context)
    }

    fun restartApp() {
        val packageManager = context.packageManager
        val intent = packageManager.getLaunchIntentForPackage(context.packageName)
        val componentName = intent?.component
        val restartIntent = android.content.Intent.makeRestartActivityTask(componentName)
        context.startActivity(restartIntent)
        Runtime.getRuntime().exit(0)
    }
}
