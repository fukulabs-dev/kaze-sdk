import Foundation

@objc(OtaModule)
public class OtaModule: NSObject {
    @objc public func getCurrentBundlePath() -> String? {
        return OtaBundleLoader.bundleURL()?.path
    }

    @objc public func restartApp() {
        DispatchQueue.main.async {
            exit(0)
        }
    }
}
