import Foundation
import React
import zlib

@objc(KazeModule)
public class KazeModule: NSObject {
    private let blacklistedPrefix = "ota_blacklisted_"
    private let stablePrefix = "ota_stable_"

    @objc public func getCurrentBundlePath(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let path = KazeBundleLoader.resolveBundle()?.url.path
        resolve(path)
    }

    // Synchronous so the write lands before the JS crash handler hands off to RN's fatal handler,
    // which kills the process.
    @objc public func setBundleBlacklisted(_ hash: String) -> NSNumber {
        UserDefaults.standard.set(true, forKey: "\(blacklistedPrefix)\(hash)")
        return NSNumber(value: UserDefaults.standard.synchronize())
    }

    @objc public func getRunningBundleInfo() -> NSDictionary {
        guard let running = KazeBundleLoader.runningBundle else {
            return ["hash": NSNull(), "slot": NSNull(), "stable": true]
        }
        let stable = UserDefaults.standard.bool(forKey: "\(stablePrefix)\(running.hash)")
        return ["hash": running.hash, "slot": running.slot, "stable": stable]
    }

    @objc public func isBundleBlacklisted(_ hash: String, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let isBlacklisted = UserDefaults.standard.bool(forKey: "\(blacklistedPrefix)\(hash)")
        resolve(isBlacklisted)
    }

    @objc public func setBundleStable(_ hash: String) {
        UserDefaults.standard.set(true, forKey: "\(stablePrefix)\(hash)")
        UserDefaults.standard.removeObject(forKey: "\(KazeBundleLoader.bootAttemptsPrefix)\(hash)")
        UserDefaults.standard.synchronize()
    }

    @objc public func setBootVerificationEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: KazeBundleLoader.bootVerificationKey)
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
        guard let baseDirectory = KazeBundleLoader.baseDirectory else {
            return nil
        }
        return baseDirectory.appendingPathComponent(relativePath)
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

    @objc public func deleteBundlePath(_ relativePath: String, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard !relativePath.trimmingCharacters(in: .whitespaces).isEmpty, let targetURL = resolveSafeURL(for: relativePath) else {
            reject("SECURITY_ERROR", "Invalid path: \(relativePath)", nil)
            return
        }
        do {
            if FileManager.default.fileExists(atPath: targetURL.path) {
                try FileManager.default.removeItem(at: targetURL)
            }
            resolve(true)
        } catch {
            reject("FILE_DELETE_ERROR", error.localizedDescription, error)
        }
    }

    private func decompressRawDeflate(compressed: Data, expectedSize: Int) -> Data? {
        var stream = z_stream()
        let initStatus = inflateInit2_(&stream, -15, zlibVersion(), Int32(MemoryLayout<z_stream>.size))
        guard initStatus == Z_OK else { return nil }
        defer { inflateEnd(&stream) }

        // Inflate into a fixed chunk and append it afterwards; touching `output` while its bytes are
        // borrowed mutably violates Swift's exclusive access rules.
        let chunkSize = 64 * 1024
        var chunk = [UInt8](repeating: 0, count: chunkSize)
        var output = Data(capacity: max(expectedSize, chunkSize))
        var status: Int32 = Z_OK

        let finished = compressed.withUnsafeBytes { (rawIn: UnsafeRawBufferPointer) -> Bool in
            guard let inBase = rawIn.bindMemory(to: Bytef.self).baseAddress else { return false }
            stream.next_in = UnsafeMutablePointer(mutating: inBase)
            stream.avail_in = uInt(compressed.count)

            while status == Z_OK {
                let produced = chunk.withUnsafeMutableBufferPointer { (buffer: inout UnsafeMutableBufferPointer<UInt8>) -> Int in
                    stream.next_out = buffer.baseAddress
                    stream.avail_out = uInt(chunkSize)
                    status = inflate(&stream, Z_NO_FLUSH)
                    return chunkSize - Int(stream.avail_out)
                }
                if status != Z_OK && status != Z_STREAM_END {
                    return false
                }
                output.append(contentsOf: chunk[0..<produced])
            }
            return true
        }
        return finished ? output : nil
    }

    @objc public func unzipBundleFile(_ zipRelativePath: String, targetSlotDir: String, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard let zipURL = resolveSafeURL(for: zipRelativePath),
              let targetURL = resolveSafeURL(for: targetSlotDir) else {
            reject("SECURITY_ERROR", "Invalid path traversal in parameters", nil)
            return
        }

        guard FileManager.default.fileExists(atPath: zipURL.path) else {
            reject("FILE_NOT_FOUND", "Source zip archive does not exist at \(zipRelativePath)", nil)
            return
        }

        do {
            try FileManager.default.createDirectory(at: targetURL, withIntermediateDirectories: true, attributes: nil)
            let zipData = try Data(contentsOf: zipURL)
            let count = zipData.count
            guard count >= 22 else {
                reject("INVALID_ZIP", "File is too small to be a valid zip archive", nil)
                return
            }

            var eocdOffset = -1
            let searchLimit = max(0, count - 65557)
            zipData.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
                guard let base = bytes.baseAddress else { return }
                var i = count - 22
                while i >= searchLimit {
                    let sig = base.loadUnaligned(fromByteOffset: i, as: UInt32.self)
                    if sig == 0x06054b50 {
                        eocdOffset = i
                        break
                    }
                    i -= 1
                }
            }

            guard eocdOffset != -1 else {
                reject("INVALID_ZIP", "End of Central Directory not found", nil)
                return
            }

            let eocd = zipData.subdata(in: eocdOffset..<count)
            let totalEntries = Int(eocd.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 10, as: UInt16.self) })
            let cdOffset = Int(eocd.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 16, as: UInt32.self) })

            var curr = cdOffset
            let targetCanonical = targetURL.standardizedFileURL.path

            for _ in 0..<totalEntries {
                guard curr + 46 <= eocdOffset else { break }
                let cdSig = zipData.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: curr, as: UInt32.self) }
                guard cdSig == 0x02014b50 else { break }

                let method = Int(zipData.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: curr + 10, as: UInt16.self) })
                let compressedSize = Int(zipData.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: curr + 20, as: UInt32.self) })
                let uncompressedSize = Int(zipData.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: curr + 24, as: UInt32.self) })
                let fileNameLen = Int(zipData.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: curr + 28, as: UInt16.self) })
                let extraLen = Int(zipData.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: curr + 30, as: UInt16.self) })
                let commentLen = Int(zipData.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: curr + 32, as: UInt16.self) })
                let localOffset = Int(zipData.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: curr + 42, as: UInt32.self) })

                let fileNameData = zipData.subdata(in: (curr + 46)..<(curr + 46 + fileNameLen))
                guard let fileName = String(data: fileNameData, encoding: .utf8) else {
                    reject("INVALID_ZIP", "Cannot decode entry filename as UTF-8", nil)
                    return
                }

                if fileName.contains("..") || fileName.hasPrefix("/") || fileName.hasPrefix("\\") {
                    reject("SECURITY_ERROR", "Zip slip detected in entry: \(fileName)", nil)
                    return
                }

                curr += 46 + fileNameLen + extraLen + commentLen

                let destURL = targetURL.appendingPathComponent(fileName)
                let destCanonical = destURL.standardizedFileURL.path
                guard destCanonical.hasPrefix(targetCanonical + "/") || destCanonical == targetCanonical else {
                    reject("SECURITY_ERROR", "Zip slip detected for entry: \(fileName)", nil)
                    return
                }

                if fileName.hasSuffix("/") {
                    try FileManager.default.createDirectory(at: destURL, withIntermediateDirectories: true, attributes: nil)
                    continue
                }

                guard localOffset + 30 <= count else {
                    reject("INVALID_ZIP", "Corrupt local header offset for \(fileName)", nil)
                    return
                }
                let localNameLen = Int(zipData.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: localOffset + 26, as: UInt16.self) })
                let localExtraLen = Int(zipData.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: localOffset + 28, as: UInt16.self) })
                let dataStart = localOffset + 30 + localNameLen + localExtraLen
                let dataEnd = dataStart + compressedSize

                guard dataEnd <= count else {
                    reject("INVALID_ZIP", "Truncated data for \(fileName)", nil)
                    return
                }

                let compData = zipData.subdata(in: dataStart..<dataEnd)
                var fileData: Data?

                if method == 0 {
                    fileData = compData
                } else if method == 8 {
                    fileData = decompressRawDeflate(compressed: compData, expectedSize: uncompressedSize)
                    if fileData == nil {
                        reject("DECOMPRESS_ERROR", "Failed to decompress deflate entry: \(fileName)", nil)
                        return
                    }
                } else {
                    reject("UNSUPPORTED_METHOD", "Unsupported compression method \(method) for \(fileName)", nil)
                    return
                }

                if let validData = fileData {
                    let parentDir = destURL.deletingLastPathComponent()
                    try FileManager.default.createDirectory(at: parentDir, withIntermediateDirectories: true, attributes: nil)
                    try validData.write(to: destURL, options: .atomic)
                }
            }

            resolve(true)
        } catch {
            reject("UNZIP_ERROR", error.localizedDescription, error)
        }
    }

    @objc public func getActiveSlot(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let active = UserDefaults.standard.string(forKey: KazeBundleLoader.activeSlotKey)
        resolve(active)
    }

    @objc public func switchActiveSlot(_ newSlot: String, resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let defaults = UserDefaults.standard
        let currentActive = defaults.string(forKey: KazeBundleLoader.activeSlotKey)
        if let current = currentActive, current != newSlot {
            defaults.set(current, forKey: KazeBundleLoader.rollbackSlotKey)
        }
        defaults.set(newSlot, forKey: KazeBundleLoader.activeSlotKey)
        defaults.synchronize()
        resolve(true)
    }

    @objc public func getRollbackSlot(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        let rollback = UserDefaults.standard.string(forKey: KazeBundleLoader.rollbackSlotKey)
        resolve(rollback)
    }

    // Reloads JS in place instead of killing the process (exit() quits the app and is flagged in
    // App Review). Both the bridge and RCTHost re-ask the AppDelegate for the bundle URL on reload,
    // so KazeBundleLoader picks up the newly staged slot.
    @objc public func restartApp() {
        DispatchQueue.main.async {
            RCTTriggerReloadCommandListeners("kaze: apply staged update")
        }
    }

    @objc public static func requiresMainQueueSetup() -> Bool {
        return false
    }
}
