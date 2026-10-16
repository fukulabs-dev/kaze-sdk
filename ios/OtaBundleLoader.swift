import Foundation

@objc public class OtaBundleLoader: NSObject {
    private static let otaDir = "ota"
    private static let currentDir = "current"
    private static let bundleFileName = "main.jsbundle"
    private static let blacklistedPrefix = "ota_blacklisted_"

    @objc public static func bundleURL() -> URL? {
        guard let documentsDirectory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            return nil
        }

        let bundleURL = documentsDirectory
            .appendingPathComponent(otaDir)
            .appendingPathComponent(currentDir)
            .appendingPathComponent(bundleFileName)

        let hashURL = documentsDirectory
            .appendingPathComponent(otaDir)
            .appendingPathComponent(currentDir)
            .appendingPathComponent("bundle.hash")

        if !FileManager.default.fileExists(atPath: bundleURL.path) {
            return nil
        }

        if FileManager.default.fileExists(atPath: hashURL.path) {
            do {
                let hash = try String(contentsOf: hashURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
                let isBlacklisted = UserDefaults.standard.bool(forKey: "\(blacklistedPrefix)\(hash)")
                if isBlacklisted {
                    return nil
                }
            } catch {
                // If hash cannot be read, default to nil for safety
                return nil
            }
        }

        return bundleURL
    }

    @objc public static func getJSBundleFile() -> URL? {
        return bundleURL()
    }
}
