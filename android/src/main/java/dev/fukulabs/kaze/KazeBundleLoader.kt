package dev.fukulabs.kaze

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import java.io.File

object KazeBundleLoader {
    const val OTA_DIR = "ota"
    private const val CURRENT_DIR = "current"
    private const val BUNDLE_FILE_NAME = "index.android.bundle"
    const val PREFS_NAME = "ota_prefs"
    const val KEY_BLACKLISTED_PREFIX = "ota_blacklisted_"
    const val KEY_STABLE_PREFIX = "ota_stable_"
    const val KEY_ACTIVE_SLOT = "ota_active_slot"
    const val KEY_ROLLBACK_SLOT = "ota_rollback_slot"
    private const val KEY_BINARY_VERSION = "ota_binary_version"
    const val DEFAULT_SLOT_A = "slot_a"
    const val DEFAULT_SLOT_B = "slot_b"

    data class ResolvedBundle(val path: String, val hash: String, val slot: String)

    /** The OTA bundle handed to React Native by the last getJSBundleFile call in this process. */
    @Volatile
    var runningBundle: ResolvedBundle? = null
        private set

    @JvmStatic
    fun getJSBundleFile(context: Context): String? {
        // Debuggable builds load from Metro / the embedded bundle; OTA is for release builds.
        if ((context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            runningBundle = null
            return null
        }
        invalidateIfBinaryChanged(context)
        val resolved = resolveBundle(context)
        runningBundle = resolved
        return resolved?.path
    }

    /** Picks the bundle that would load now, without recording it as running. */
    fun resolveBundle(context: Context): ResolvedBundle? {
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

            // bundle.hash is written last when staging, so a slot without it is incomplete.
            val hashFile = File(context.filesDir, "$OTA_DIR/$slot/bundle.hash")
            if (!hashFile.exists()) {
                continue
            }
            val hash = hashFile.readText().trim()
            if (hash.isEmpty() || prefs.getBoolean("$KEY_BLACKLISTED_PREFIX$hash", false)) {
                continue
            }

            return ResolvedBundle(bundleFile.absolutePath, hash, slot)
        }

        return null
    }

    /**
     * OTA bundles are built against one native binary. When the app is installed or updated
     * (new versionCode, versionName, or install time), drop every staged bundle so the new
     * binary boots its own embedded bundle instead of stale JS.
     */
    private fun invalidateIfBinaryChanged(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val current = binaryVersion(context) ?: return
        if (prefs.getString(KEY_BINARY_VERSION, null) == current) {
            return
        }

        File(context.filesDir, OTA_DIR).deleteRecursively()
        val editor = prefs.edit()
        editor.remove(KEY_ACTIVE_SLOT)
        editor.remove(KEY_ROLLBACK_SLOT)
        for (key in prefs.all.keys) {
            if (key.startsWith(KEY_STABLE_PREFIX)) {
                editor.remove(key)
            }
        }
        editor.putString(KEY_BINARY_VERSION, current)
        editor.commit()
    }

    private fun binaryVersion(context: Context): String? {
        return try {
            val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                context.packageManager.getPackageInfo(context.packageName, 0)
            }
            val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                info.versionCode.toLong()
            }
            "${info.versionName}|$versionCode|${info.lastUpdateTime}"
        } catch (e: PackageManager.NameNotFoundException) {
            null
        }
    }
}
