import Foundation

@objc public class OtaBundleLoader: NSObject {
    private static let otaDir = "ota"
    private static let currentDir = "current"
    private static let bundleFileName = "main.jsbundle"
    private static let blacklistedPrefix = "ota_blacklisted_"
    public static let activeSlotKey = "ota_active_slot"
    public static let rollbackSlotKey = "ota_rollback_slot"

    @objc public static func bundleURL() -> URL? {
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

            if FileManager.default.fileExists(atPath: hashURL.path) {
                do {
                    let hash = try String(contentsOf: hashURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
                    let isBlacklisted = defaults.bool(forKey: "\(blacklistedPrefix)\(hash)")
                    if isBlacklisted {
                        continue
                    }
                } catch {
                    continue
                }
            }

            return bundleURL
        }

        return nil
    }

    @objc public static func getJSBundleFile() -> URL? {
        return bundleURL()
    }
}
