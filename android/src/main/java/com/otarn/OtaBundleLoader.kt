package com.otarn

import android.content.Context
import java.io.File

object OtaBundleLoader {
    private const val OTA_DIR = "ota"
    private const val CURRENT_DIR = "current"
    private const val BUNDLE_FILE_NAME = "index.android.bundle"
    private const val PREFS_NAME = "ota_prefs"
    private const val KEY_BLACKLISTED_PREFIX = "ota_blacklisted_"
    const val KEY_ACTIVE_SLOT = "ota_active_slot"
    const val KEY_ROLLBACK_SLOT = "ota_rollback_slot"
    const val DEFAULT_SLOT_A = "slot_a"
    const val DEFAULT_SLOT_B = "slot_b"

    @JvmStatic
    fun getJSBundleFile(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

        val activeSlot = prefs.getString(KEY_ACTIVE_SLOT, null)
        val rollbackSlot = prefs.getString(KEY_ROLLBACK_SLOT, null)

        val candidateSlots = mutableListOf<String>()
        if (activeSlot != null) {
            candidateSlots.add(activeSlot)
        }
        if (rollbackSlot != null && rollbackSlot != activeSlot) {
            candidateSlots.add(rollbackSlot)
        }
        candidateSlots.add(CURRENT_DIR)

        for (slot in candidateSlots) {
            val bundleFile = File(context.filesDir, "$OTA_DIR/$slot/$BUNDLE_FILE_NAME")
            if (!bundleFile.exists()) {
                continue
            }

            val hashFile = File(context.filesDir, "$OTA_DIR/$slot/bundle.hash")
            if (hashFile.exists()) {
                val hash = hashFile.readText().trim()
                val isBlacklisted = prefs.getBoolean("$KEY_BLACKLISTED_PREFIX$hash", false)
                if (isBlacklisted) {
                    continue
                }
            }

            return bundleFile.absolutePath
        }

        return null
    }
}
