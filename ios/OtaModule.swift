import Foundation
import React

@objc(OtaModule)
public class OtaModule: NSObject {
    private let blacklistedPrefix = "ota_blacklisted_"
    private let stablePrefix = "ota_stable_"

    @objc public func getCurrentBundlePath(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let path = OtaBundleLoader.bundleURL()?.path
        resolve(path)
    }

    @objc public func setBundleBlacklisted(_ hash: String) {
        UserDefaults.standard.set(true, forKey: "\(blacklistedPrefix)\(hash)")
        UserDefaults.standard.synchronize()
    }

    @objc public func isBundleBlacklisted(_ hash: String, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let isBlacklisted = UserDefaults.standard.bool(forKey: "\(blacklistedPrefix)\(hash)")
        resolve(isBlacklisted)
    }

    @objc public func setBundleStable(_ hash: String) {
        UserDefaults.standard.set(true, forKey: "\(stablePrefix)\(hash)")
        UserDefaults.standard.synchronize()
    }

    @objc public func clearBlacklist() {
        let defaults = UserDefaults.standard
        let dictionary = defaults.dictionaryRepresentation()
        for key in dictionary.keys {
            if key.hasPrefix(blacklistedPrefix) {
                defaults.removeObject(forKey: key)
            }
        }
        defaults.synchronize()
    }

    private func resolveSafeURL(for relativePath: String) -> URL? {
        guard !relativePath.contains("..") else {
            return nil
        }
        guard let documentsDirectory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            return nil
        }
        return documentsDirectory.appendingPathComponent(relativePath)
    }

    @objc public func writeBundleFile(_ relativePath: String, content: String, isBase64: Bool, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let fileURL = resolveSafeURL(for: relativePath) else {
            reject("SECURITY_ERROR", "Invalid path traversal: \(relativePath)", nil)
            return
        }

        do {
            let directoryURL = fileURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true, attributes: nil)

            if isBase64 {
                guard let data = Data(base64Encoded: content) else {
                    reject("INVALID_DATA", "Failed to decode base64 content", nil)
                    return
                }
                try data.write(to: fileURL, options: .atomic)
            } else {
                try content.write(to: fileURL, atomically: true, encoding: .utf8)
            }
            resolve(true)
        } catch {
            reject("FILE_WRITE_ERROR", error.localizedDescription, error)
        }
    }

    @objc public func readBundleFile(_ relativePath: String, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let fileURL = resolveSafeURL(for: relativePath) else {
            reject("SECURITY_ERROR", "Invalid path traversal: \(relativePath)", nil)
            return
        }

        if !FileManager.default.fileExists(atPath: fileURL.path) {
            resolve(nil)
            return
        }

        do {
            let content = try String(contentsOf: fileURL, encoding: .utf8)
            resolve(content)
        } catch {
            reject("FILE_READ_ERROR", error.localizedDescription, error)
        }
    }

    @objc public func bundleFileExists(_ relativePath: String, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let fileURL = resolveSafeURL(for: relativePath) else {
            reject("SECURITY_ERROR", "Invalid path traversal: \(relativePath)", nil)
            return
        }

        let exists = FileManager.default.fileExists(atPath: fileURL.path)
        resolve(exists)
    }

    @objc public func restartApp() {
        DispatchQueue.main.async {
            exit(0)
        }
    }

    @objc public static func requiresMainQueueSetup() -> Bool {
        return false
    }
}
