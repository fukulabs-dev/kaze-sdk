import Foundation

@objc public class OtaBundleLoader: NSObject {
    static let otaDir = "ota"
    private static let currentDir = "current"
    private static let bundleFileName = "main.jsbundle"
    static let blacklistedPrefix = "ota_blacklisted_"
    static let stablePrefix = "ota_stable_"
    public static let activeSlotKey = "ota_active_slot"
    public static let rollbackSlotKey = "ota_rollback_slot"
    private static let binaryVersionKey = "ota_binary_version"

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
        let resolved = resolveBundle()
        runningBundle = resolved.map { (hash: $0.hash, slot: $0.slot) }
        return resolved?.url
        #endif
    }

    /// Picks the bundle that would load now, without recording it as running.
    static func resolveBundle() -> (url: URL, hash: String, slot: String)? {
        guard let documentsDirectory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
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
            let bundleURL = documentsDirectory
                .appendingPathComponent(otaDir)
                .appendingPathComponent(slot)
                .appendingPathComponent(bundleFileName)

            let hashURL = documentsDirectory
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

        if let documentsDirectory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
            try? FileManager.default.removeItem(at: documentsDirectory.appendingPathComponent(otaDir))
        }
        defaults.removeObject(forKey: activeSlotKey)
        defaults.removeObject(forKey: rollbackSlotKey)
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix(stablePrefix) {
            defaults.removeObject(forKey: key)
        }
        defaults.set(current, forKey: binaryVersionKey)
        defaults.synchronize()
    }
}
