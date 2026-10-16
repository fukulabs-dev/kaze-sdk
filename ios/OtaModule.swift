import Foundation
import React

@objc(OtaModule)
public class OtaModule: NSObject {
    @objc public func getCurrentBundlePath(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let path = OtaBundleLoader.bundleURL()?.path
        resolve(path)
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
