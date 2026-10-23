import Foundation

@objc public class KazeBundleLoader: NSObject {
    static let otaDir = "ota"
    private static let currentDir = "current"
    private static let bundleFileName = "main.jsbundle"
    static let blacklistedPrefix = "ota_blacklisted_"
    static let stablePrefix = "ota_stable_"
    public static let activeSlotKey = "ota_active_slot"
    public static let rollbackSlotKey = "ota_rollback_slot"
    static let bootAttemptsPrefix = "ota_boot_attempts_"
    static let bootVerificationKey = "ota_boot_verification"
    private static let binaryVersionKey = "ota_binary_version"

    /// How many launches an OTA bundle may get without the JS boot guard marking it stable. One miss
    /// can be the user closing the app inside the guard window; a second one in a row means the
    /// bundle keeps dying before it can confirm, so the next launch rolls it back.
    private static let maxUnconfirmedBoots = 2

    // bundleURL() can be called more than once per launch; count each bundle's boot only once.
    private static var countedBootHash: String?

    /// Folder that holds ota/: Library/Application Support/kaze, excluded from iCloud backup. Apple's
    /// storage guidelines keep downloaded data out of Documents, which is backed up and can be shown
    /// to the user. Releases up to 0.1.0-beta.2 used Documents/ota; it is moved here on first use.
    static let baseDirectory: URL? = {
        let fileManager = FileManager.default
        guard let support = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }
        var base = support.appendingPathComponent("kaze", isDirectory: true)
        do {
            try fileManager.createDirectory(at: base, withIntermediateDirectories: true, attributes: nil)
            // Set on base, which is never deleted, so it also covers ota/ after it is recreated.
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try base.setResourceValues(values)
        } catch {
            NSLog("[Kaze] Could not prepare %@: %@", base.path, error.localizedDescription)
        }

        if let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first {
            let legacy = documents.appendingPathComponent(otaDir, isDirectory: true)
            let target = base.appendingPathComponent(otaDir, isDirectory: true)
            if fileManager.fileExists(atPath: legacy.path) {
                if !fileManager.fileExists(atPath: target.path) {
                    do {
                        try fileManager.moveItem(at: legacy, to: target)
                    } catch {
                        NSLog("[Kaze] Could not move staged bundles: %@", error.localizedDescription)
                    }
                }
                try? fileManager.removeItem(at: legacy)
            }
        }
        return base
    }()

    /// The OTA bundle handed to React Native by the last getJSBundleFile call in this process.
    public private(set) static var runningBundle: (hash: String, slot: String)?

    /// Alias of getJSBundleFile for host apps that call it at boot.
    @objc public static func bundleURL() -> URL? {
        return getJSBundleFile()
    }

    @objc public static func getJSBundleFile() -> URL? {
        #if DEBUG
        // Debug builds load from Metro / the embedded bundle; OTA is for release builds.
        runningBundle = nil
        return nil
        #else
        invalidateIfBinaryChanged()
        let resolved = resolveVerifiedBundle()
        runningBundle = resolved.map { (hash: $0.hash, slot: $0.slot) }
        return resolved?.url
        #endif
    }

    /// Catches bundles that never reach the JS boot guard: native crashes, out-of-memory kills, or a
    /// bundle that throws before initBootGuard runs. Only active once initBootGuard has enabled it,
    /// since without the guard nothing ever marks a bundle stable.
    private static func resolveVerifiedBundle() -> (url: URL, hash: String, slot: String)? {
        let defaults = UserDefaults.standard
        while true {
            guard let resolved = resolveBundle() else { return nil }
            let hash = resolved.hash
            if !defaults.bool(forKey: bootVerificationKey)
                || defaults.bool(forKey: "\(stablePrefix)\(hash)")
                || countedBootHash == hash {
                return resolved
            }

            let attemptsKey = "\(bootAttemptsPrefix)\(hash)"
            let attempts = defaults.integer(forKey: attemptsKey)
            if attempts >= maxUnconfirmedBoots {
                // resolveBundle skips it from now on and picks the fallback on the next pass.
                defaults.set(true, forKey: "\(blacklistedPrefix)\(hash)")
                defaults.removeObject(forKey: attemptsKey)
                defaults.synchronize()
                continue
            }

            defaults.set(attempts + 1, forKey: attemptsKey)
            defaults.synchronize()
            countedBootHash = hash
            return resolved
        }
    }

    /// Picks the bundle that would load now, without recording it as running.
    static func resolveBundle() -> (url: URL, hash: String, slot: String)? {
        guard let baseDirectory = baseDirectory else {
            return nil
        }

        let defaults = UserDefaults.standard
        let activeSlot = defaults.string(forKey: activeSlotKey)
        let rollbackSlot = defaults.string(forKey: rollbackSlotKey)

        var candidateSlots: [String] = []
        if let active = activeSlot {
            candidateSlots.append(active)
        }
        if let rollback = rollbackSlot, rollback != activeSlot {
            candidateSlots.append(rollback)
        }
        candidateSlots.append(currentDir)

        for slot in candidateSlots {
            let bundleURL = baseDirectory
                .appendingPathComponent(otaDir)
                .appendingPathComponent(slot)
                .appendingPathComponent(bundleFileName)

            let hashURL = baseDirectory
                .appendingPathComponent(otaDir)
                .appendingPathComponent(slot)
                .appendingPathComponent("bundle.hash")

            if !FileManager.default.fileExists(atPath: bundleURL.path) {
                continue
            }

            // bundle.hash is written last when staging, so a slot without it is incomplete.
            guard let rawHash = try? String(contentsOf: hashURL, encoding: .utf8) else {
                continue
            }
            let hash = rawHash.trimmingCharacters(in: .whitespacesAndNewlines)
            if hash.isEmpty || defaults.bool(forKey: "\(blacklistedPrefix)\(hash)") {
                continue
            }

            return (bundleURL, hash, slot)
        }

        return nil
    }

    /// OTA bundles are built against one native binary. When the app version or build number
    /// changes, drop every staged bundle so the new binary boots its own embedded bundle
    /// instead of stale JS.
    private static func invalidateIfBinaryChanged() {
        let info = Bundle.main.infoDictionary
        let shortVersion = info?["CFBundleShortVersionString"] as? String ?? ""
        let buildNumber = info?["CFBundleVersion"] as? String ?? ""
        let current = "\(shortVersion)|\(buildNumber)"

        let defaults = UserDefaults.standard
        if defaults.string(forKey: binaryVersionKey) == current {
            return
        }

        if let baseDirectory = baseDirectory {
            try? FileManager.default.removeItem(at: baseDirectory.appendingPathComponent(otaDir))
        }
        defaults.removeObject(forKey: activeSlotKey)
        defaults.removeObject(forKey: rollbackSlotKey)
        for key in defaults.dictionaryRepresentation().keys
        where key.hasPrefix(stablePrefix) || key.hasPrefix(bootAttemptsPrefix) {
            defaults.removeObject(forKey: key)
        }
        defaults.set(current, forKey: binaryVersionKey)
        defaults.synchronize()
    }
}
