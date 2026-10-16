package com.otarn

import android.content.Context
import java.io.File

object OtaBundleLoader {
    private const val OTA_DIR = "ota"
    private const val CURRENT_DIR = "current"
    private const val BUNDLE_FILE_NAME = "index.android.bundle"
    private const val PREFS_NAME = "ota_prefs"
    private const val KEY_BLACKLISTED_PREFIX = "ota_blacklisted_"

    @JvmStatic
    fun getJSBundleFile(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val bundleFile = File(context.filesDir, "$OTA_DIR/$CURRENT_DIR/$BUNDLE_FILE_NAME")

        if (!bundleFile.exists()) {
            return null
        }

        val hashFile = File(context.filesDir, "$OTA_DIR/$CURRENT_DIR/bundle.hash")
        if (hashFile.exists()) {
            val hash = hashFile.readText().trim()
            val isBlacklisted = prefs.getBoolean("$KEY_BLACKLISTED_PREFIX$hash", false)
            if (isBlacklisted) {
                return null
            }
        }

        return bundleFile.absolutePath
    }
}
