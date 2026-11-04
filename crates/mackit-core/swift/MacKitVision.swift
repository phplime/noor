// MacKit ⇄ Apple Vision bridge.
//
// Compiled by crates/mackit-core/build.rs into a static library on macOS / iOS and
// called from Rust (src/segment.rs) through a plain C ABI. Everything runs on
// the device (Neural Engine / GPU); no image ever leaves it.
//
// Status codes (keep in sync with segment.rs):
//    0  ok
//   -1  Vision failed (message in the system log)
//   -2  subject detection needs macOS 14 / iOS 17 or later
//   -3  people detection needs macOS 12 / iOS 15 or later
//   -4  unexpected mask format
//   -5  invalid arguments / could not create the image

import CoreGraphics
import CoreVideo
import Foundation
import Vision

/// Copy (and resample bilinearly if needed) a one-component pixel buffer into `out` (w×h floats, 0…1).
private func copyMask(_ pb: CVPixelBuffer, _ out: UnsafeMutablePointer<Float>, _ w: Int, _ h: Int) -> Int32 {
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(pb) else { return -4 }
    let mw = CVPixelBufferGetWidth(pb)
    let mh = CVPixelBufferGetHeight(pb)
    let bpr = CVPixelBufferGetBytesPerRow(pb)
    let format = CVPixelBufferGetPixelFormatType(pb)

    let sample: (Int, Int) -> Float
    switch format {
    case kCVPixelFormatType_OneComponent32Float:
        sample = { x, y in base.advanced(by: y * bpr).assumingMemoryBound(to: Float.self)[x] }
    case kCVPixelFormatType_OneComponent8:
        sample = { x, y in Float(base.advanced(by: y * bpr).assumingMemoryBound(to: UInt8.self)[x]) / 255 }
    default:
        return -4
    }
    if mw <= 0 || mh <= 0 { return -4 }

    if mw == w && mh == h {
        for y in 0..<h {
            for x in 0..<w { out[y * w + x] = min(1, max(0, sample(x, y))) }
        }
        return 0
    }
    let sx = Float(mw) / Float(w)
    let sy = Float(mh) / Float(h)
    for y in 0..<h {
        let fy = max(0, min(Float(mh - 1), (Float(y) + 0.5) * sy - 0.5))
        let y0 = Int(fy)
        let y1 = min(mh - 1, y0 + 1)
        let ty = fy - Float(y0)
        for x in 0..<w {
            let fx = max(0, min(Float(mw - 1), (Float(x) + 0.5) * sx - 0.5))
            let x0 = Int(fx)
            let x1 = min(mw - 1, x0 + 1)
            let tx = fx - Float(x0)
            let top = sample(x0, y0) * (1 - tx) + sample(x1, y0) * tx
            let bottom = sample(x0, y1) * (1 - tx) + sample(x1, y1) * tx
            out[y * w + x] = min(1, max(0, top * (1 - ty) + bottom * ty))
        }
    }
    return 0
}

/// Instance label under a normalised point, searching nearby when the point is on an edge.
private func labelAt(_ mask: CVPixelBuffer, _ nx: Float, _ ny: Float) -> Int {
    CVPixelBufferLockBaseAddress(mask, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(mask) else { return 0 }
    let mw = CVPixelBufferGetWidth(mask)
    let mh = CVPixelBufferGetHeight(mask)
    let bpr = CVPixelBufferGetBytesPerRow(mask)
    let px = max(0, min(mw - 1, Int(nx * Float(mw))))
    let py = max(0, min(mh - 1, Int(ny * Float(mh))))
    let at: (Int, Int) -> Int = { x, y in Int(base.advanced(by: y * bpr).assumingMemoryBound(to: UInt8.self)[x]) }
    let direct = at(px, py)
    if direct != 0 { return direct }
    // Nearest labelled pixel within ~3% of the mask size (forgiving clicks near an edge).
    let radius = max(2, max(mw, mh) * 3 / 100)
    var best = 0
    var bestD = Int.max
    for y in max(0, py - radius)...min(mh - 1, py + radius) {
        for x in max(0, px - radius)...min(mw - 1, px + radius) {
            let l = at(x, y)
            if l != 0 {
                let d = (x - px) * (x - px) + (y - py) * (y - py)
                if d < bestD { bestD = d; best = l }
            }
        }
    }
    return best
}

/// Segment the image.
///
/// - mode 0: every salient subject (people, pets, objects…); `picks` (x,y pairs in 0…1)
///   choose which subjects to keep — none means all of them. macOS 14+.
/// - mode 1: people only (hair-accurate). macOS 12+.
///
/// `out` receives w×h alpha values (1 = subject). `outCount` receives the number of
/// subjects found.
@_cdecl("mk_vision_segment")
public func mk_vision_segment(
    _ rgba: UnsafePointer<UInt8>?, _ width: Int32, _ height: Int32,
    _ mode: Int32,
    _ picks: UnsafePointer<Float>?, _ npicks: Int32,
    _ out: UnsafeMutablePointer<Float>?, _ outCount: UnsafeMutablePointer<Int32>?
) -> Int32 {
    return autoreleasepool { () -> Int32 in
        guard let rgba = rgba, let out = out, width > 0, height > 0 else { return -5 }
        let w = Int(width)
        let h = Int(height)
        outCount?.pointee = 0
        out.initialize(repeating: 0, count: w * h)

        guard let data = CFDataCreate(nil, rgba, w * h * 4),
              let provider = CGDataProvider(data: data),
              let space = CGColorSpace(name: CGColorSpace.sRGB),
              let image = CGImage(
                  width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4,
                  space: space, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
                  provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
        else { return -5 }

        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        do {
            if mode == 1 {
                guard #available(macOS 12.0, iOS 15.0, *) else { return -3 }
                let request = VNGeneratePersonSegmentationRequest()
                request.qualityLevel = .accurate
                request.outputPixelFormat = kCVPixelFormatType_OneComponent32Float
                try handler.perform([request])
                guard let obs = request.results?.first else { return 0 }
                outCount?.pointee = 1
                return copyMask(obs.pixelBuffer, out, w, h)
            }

            guard #available(macOS 14.0, iOS 17.0, *) else { return -2 }
            let request = VNGenerateForegroundInstanceMaskRequest()
            try handler.perform([request])
            guard let obs = request.results?.first else { return 0 }
            let all = obs.allInstances
            outCount?.pointee = Int32(all.count)
            if all.isEmpty { return 0 }

            var chosen = IndexSet()
            if let picks = picks, npicks > 0 {
                for i in 0..<Int(npicks) {
                    let label = labelAt(obs.instanceMask, picks[2 * i], picks[2 * i + 1])
                    if label != 0 { chosen.insert(label) }
                }
                if chosen.isEmpty { return 0 }  // clicked only on background
            } else {
                chosen = all
            }
            let mask = try obs.generateScaledMaskForImage(forInstances: chosen, from: handler)
            return copyMask(mask, out, w, h)
        } catch {
            NSLog("MacKit Vision error: %@", error as NSError)
            return -1
        }
    }
}
