// Settings › Optimize (iPhone only).
//
// iOS sandboxes every app: no app can read other apps' battery use or delete their files.
// What Noor can do, and does here:
//   • device health — battery level/charging, Low Power Mode, heat, free storage
//   • Photos cleanup — find screenshots, large videos and duplicate/similar photos.
//     Nothing is deleted until the user picks items; iOS then asks again and moves
//     them to Photos › Recently Deleted (kept 30 days).
// Rust calls this class by name from a background thread (see src/ios_optimize.rs),
// so blocking here is fine.
import Foundation
import Photos
import UIKit

@objc(NoorOptimize)
final class NoorOptimize: NSObject {

    // MARK: Device

    /// `{"battery":0.82,"charging":"unplugged","lowPower":false,"thermal":"nominal","free":…,"total":…}`
    @objc static func deviceJSON() -> String {
        var out: [String: Any] = [:]
        let read = {
            let d = UIDevice.current
            d.isBatteryMonitoringEnabled = true
            out["battery"] = d.batteryLevel >= 0 ? Double(d.batteryLevel) : NSNull()
            switch d.batteryState {
            case .charging: out["charging"] = "charging"
            case .full: out["charging"] = "full"
            case .unplugged: out["charging"] = "unplugged"
            default: out["charging"] = "unknown"
            }
        }
        if Thread.isMainThread { read() } else { DispatchQueue.main.sync(execute: read) }

        let info = ProcessInfo.processInfo
        out["lowPower"] = info.isLowPowerModeEnabled
        switch info.thermalState {
        case .nominal: out["thermal"] = "nominal"
        case .fair: out["thermal"] = "fair"
        case .serious: out["thermal"] = "serious"
        case .critical: out["thermal"] = "critical"
        @unknown default: out["thermal"] = "nominal"
        }

        let home = URL(fileURLWithPath: NSHomeDirectory())
        if let v = try? home.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey, .volumeTotalCapacityKey]) {
            if let free = v.volumeAvailableCapacityForImportantUsage { out["free"] = free }
            if let total = v.volumeTotalCapacity { out["total"] = total }
        }
        return json(out, fallback: "{}")
    }

    // MARK: Photos permission

    /// "authorized" | "limited" | "denied" | "restricted". Asks the first time.
    @objc static func photosAccess() -> String {
        var status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if status == .notDetermined {
            let sem = DispatchSemaphore(value: 0)
            PHPhotoLibrary.requestAuthorization(for: .readWrite) { s in
                status = s
                sem.signal()
            }
            _ = sem.wait(timeout: .now() + 120)
        }
        switch status {
        case .authorized: return "authorized"
        case .limited: return "limited"
        case .restricted: return "restricted"
        default: return "denied"
        }
    }

    // MARK: Photos scan

    private static let thumbSize = CGSize(width: 180, height: 180)

    /// Scan one part of the library, so the app can show real progress.
    /// `part` = "screenshots" | "videos" | "duplicates". JSON:
    /// `{"screenshots":[item…]}` / `{"videos":[item…]}` / `{"duplicates":[[item…]…]}`, plus "scanned" and "limited".
    /// item = `{"id","size","date","w","h","duration","thumb"}` (thumb = base64 JPEG).
    @objc static func photosScanJSON(_ part: String) -> String {
        let access = photosAccess()
        guard access == "authorized" || access == "limited" else {
            return json(["error": access], fallback: "{}")
        }
        let manager = PHCachingImageManager()
        var out: [String: Any] = ["limited": access == "limited"]

        switch part {
        case "screenshots":
            // Screenshots, newest first.
            let o = PHFetchOptions()
            o.predicate = NSPredicate(format: "(mediaSubtypes & %d) != 0", PHAssetMediaSubtype.photoScreenshot.rawValue)
            o.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
            o.fetchLimit = 400
            var items: [[String: Any]] = []
            PHAsset.fetchAssets(with: .image, options: o).enumerateObjects { a, _, _ in
                items.append(item(a, manager: manager))
            }
            out["screenshots"] = items
            out["scanned"] = items.count

        case "videos":
            // Videos bigger than 50 MB, largest first.
            let o = PHFetchOptions()
            o.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
            o.fetchLimit = 1500
            var big: [(PHAsset, Int64)] = []
            var count = 0
            PHAsset.fetchAssets(with: .video, options: o).enumerateObjects { a, _, _ in
                count += 1
                let s = size(of: a)
                if s >= 50 * 1024 * 1024 { big.append((a, s)) }
            }
            big.sort { $0.1 > $1.1 }
            out["videos"] = big.prefix(80).map { item($0.0, manager: manager, knownSize: $0.1) }
            out["scanned"] = count

        default:
            // Duplicates & near-duplicates among recent photos (screenshots excluded).
            let o = PHFetchOptions()
            o.predicate = NSPredicate(format: "(mediaSubtypes & %d) == 0", PHAssetMediaSubtype.photoScreenshot.rawValue)
            o.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
            o.fetchLimit = 1200
            var photos: [PHAsset] = []
            PHAsset.fetchAssets(with: .image, options: o).enumerateObjects { a, _, _ in photos.append(a) }

            let hashes: [UInt64?] = photos.map { dHash($0, manager: manager) }
            // Union-find: identical hash anywhere, or very close hash within 2 minutes (bursts).
            var parent = Array(0..<photos.count)
            func find(_ i: Int) -> Int {
                var i = i
                while parent[i] != i { parent[i] = parent[parent[i]]; i = parent[i] }
                return i
            }
            func union(_ a: Int, _ b: Int) { let ra = find(a), rb = find(b); if ra != rb { parent[rb] = ra } }

            var byHash: [UInt64: Int] = [:]
            for (i, h) in hashes.enumerated() {
                guard let h else { continue }
                if let j = byHash[h] { union(j, i) } else { byHash[h] = i }
            }
            for i in 0..<photos.count {
                guard let hi = hashes[i], let di = photos[i].creationDate else { continue }
                var j = i + 1
                while j < photos.count, let dj = photos[j].creationDate, di.timeIntervalSince(dj) <= 120 {
                    if let hj = hashes[j], (hi ^ hj).nonzeroBitCount <= 5 { union(i, j) }
                    j += 1
                }
            }
            var groups: [Int: [Int]] = [:]
            for i in 0..<photos.count where hashes[i] != nil { groups[find(i), default: []].append(i) }
            let dup = groups.values
                .filter { $0.count > 1 }
                .sorted { $0.min()! < $1.min()! }
                .prefix(80)
                .map { g in g.map { item(photos[$0], manager: manager) } }
            out["duplicates"] = Array(dup)
            out["scanned"] = photos.count
        }
        return json(out, fallback: "{}")
    }

    // MARK: Delete

    /// Deletes the given local identifiers. iOS shows its own confirmation;
    /// deleted items go to Recently Deleted. Returns "ok", "cancelled" or an error message.
    @objc static func photosDelete(_ idsJSON: String) -> String {
        guard let data = idsJSON.data(using: .utf8),
              let ids = (try? JSONSerialization.jsonObject(with: data)) as? [String], !ids.isEmpty else { return "nothing selected" }
        let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        guard assets.count > 0 else { return "not found" }
        do {
            try PHPhotoLibrary.shared().performChangesAndWait {
                PHAssetChangeRequest.deleteAssets(assets)
            }
            return "ok"
        } catch {
            let ns = error as NSError
            // PHPhotosError.userCancelled = 3072
            if ns.code == 3072 { return "cancelled" }
            return ns.localizedDescription
        }
    }

    // MARK: Helpers

    private static func size(of a: PHAsset) -> Int64 {
        let res = PHAssetResource.assetResources(for: a)
        let main = res.first { $0.type == .video || $0.type == .photo || $0.type == .fullSizeVideo } ?? res.first
        return (main?.value(forKey: "fileSize") as? Int64) ?? 0
    }

    private static func item(_ a: PHAsset, manager: PHImageManager, knownSize: Int64? = nil) -> [String: Any] {
        var out: [String: Any] = [
            "id": a.localIdentifier,
            "size": knownSize ?? size(of: a),
            "w": a.pixelWidth,
            "h": a.pixelHeight,
            "duration": a.duration,
        ]
        if let d = a.creationDate { out["date"] = ISO8601DateFormatter().string(from: d) }
        if let t = thumb(a, manager: manager) { out["thumb"] = t }
        return out
    }

    private static func requestImage(_ a: PHAsset, manager: PHImageManager, size: CGSize) -> UIImage? {
        let o = PHImageRequestOptions()
        o.isSynchronous = true
        o.deliveryMode = .fastFormat
        o.resizeMode = .fast
        o.isNetworkAccessAllowed = false // never download from iCloud while scanning
        var img: UIImage?
        manager.requestImage(for: a, targetSize: size, contentMode: .aspectFill, options: o) { i, _ in img = i }
        return img
    }

    private static func thumb(_ a: PHAsset, manager: PHImageManager) -> String? {
        guard let img = requestImage(a, manager: manager, size: thumbSize),
              let jpg = img.jpegData(compressionQuality: 0.55) else { return nil }
        return jpg.base64EncodedString()
    }

    /// 64-bit difference hash from a 9×8 grayscale copy: similar pictures give similar bits.
    private static func dHash(_ a: PHAsset, manager: PHImageManager) -> UInt64? {
        guard let img = requestImage(a, manager: manager, size: CGSize(width: 64, height: 64)),
              let cg = img.cgImage else { return nil }
        let w = 9, h = 8
        var px = [UInt8](repeating: 0, count: w * h)
        let ok: Bool = px.withUnsafeMutableBytes { buf -> Bool in
            guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8,
                                      bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(),
                                      bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
            ctx.interpolationQuality = .medium
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard ok else { return nil }
        var hash: UInt64 = 0
        var bit: UInt64 = 1
        for y in 0..<h {
            for x in 0..<(w - 1) {
                if px[y * w + x] > px[y * w + x + 1] { hash |= bit }
                bit <<= 1
            }
        }
        return hash
    }

    private static func json(_ obj: Any, fallback: String) -> String {
        guard JSONSerialization.isValidJSONObject(obj),
              let data = try? JSONSerialization.data(withJSONObject: obj),
              let text = String(data: data, encoding: .utf8) else { return fallback }
        return text
    }
}
