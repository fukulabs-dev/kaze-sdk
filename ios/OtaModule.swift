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

    @objc public func restartApp() {
        DispatchQueue.main.async {
            exit(0)
        }
    }

    @objc public static func requiresMainQueueSetup() -> Bool {
        return false
    }
}
