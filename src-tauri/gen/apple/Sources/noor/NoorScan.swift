// Studio › ID / Passport: Apple's document scanner (VisionKit).
// It finds the card's edges, straightens it and crops it — like the Notes app scanner.
// Rust calls `scan` by name from a background thread (src/ios_scan.rs) and waits for the result.
import Foundation
import UIKit
import VisionKit
import Vision

@objc(NoorScan)
final class NoorScan: NSObject, VNDocumentCameraViewControllerDelegate {

    private static var current: NoorScan?
    private var finish: ((String) -> Void)?

    /// `{"paths":["…/scan-1.jpg", …]}`, `{"cancelled":true}` or `{"error":"…"}`.
    @objc static func scan() -> String {
        guard VNDocumentCameraViewController.isSupported else { return #"{"error":"This iPhone can't scan documents."}"# }
        var result = #"{"cancelled":true}"#
        let done = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            guard let top = topController() else {
                result = #"{"error":"No screen to show the scanner on."}"#
                done.signal()
                return
            }
            let me = NoorScan()
            current = me
            me.finish = { out in
                result = out
                current = nil
                done.signal()
            }
            let vc = VNDocumentCameraViewController()
            vc.delegate = me
            top.present(vc, animated: true)
        }
        done.wait()
        return result
    }

    /// Find the card in a photo with Apple's Vision. JSON `[[x,y]×4]` (TL, TR, BR, BL; 0..1,
    /// top-left origin, as the photo is shown upright) or `[]`.
    @objc static func detect(_ path: String) -> String {
        guard let ui = UIImage(contentsOfFile: path), let cg = ui.cgImage else { return "[]" }
        let request = VNDetectRectanglesRequest()
        request.maximumObservations = 1
        request.minimumConfidence = 0.5
        request.minimumAspectRatio = 0.3
        request.maximumAspectRatio = 1.0
        request.quadratureTolerance = 25
        request.minimumSize = 0.2
        let handler = VNImageRequestHandler(cgImage: cg, orientation: cgOrientation(ui.imageOrientation), options: [:])
        do { try handler.perform([request]) } catch { return "[]" }
        guard let r = request.results?.first else { return "[]" }
        // Vision: origin bottom-left → flip y.
        let pts = [r.topLeft, r.topRight, r.bottomRight, r.bottomLeft].map { [Double($0.x), 1 - Double($0.y)] }
        guard let data = try? JSONSerialization.data(withJSONObject: pts),
              let text = String(data: data, encoding: .utf8) else { return "[]" }
        return text
    }

    private static func cgOrientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch o {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }

    // MARK: VNDocumentCameraViewControllerDelegate

    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("noor-scans", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        var paths: [String] = []
        for i in 0..<scan.pageCount {
            let url = dir.appendingPathComponent("scan-\(stamp)-\(i + 1).jpg")
            if let data = scan.imageOfPage(at: i).jpegData(compressionQuality: 0.92), (try? data.write(to: url)) != nil {
                paths.append(url.path)
            }
        }
        let body = (try? JSONSerialization.data(withJSONObject: ["paths": paths])).flatMap { String(data: $0, encoding: .utf8) }
        controller.dismiss(animated: true) { self.finish?(body ?? #"{"error":"Could not save the scan."}"#) }
    }

    func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
        controller.dismiss(animated: true) { self.finish?(#"{"cancelled":true}"#) }
    }

    func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) {
        let msg = error.localizedDescription.replacingOccurrences(of: "\"", with: "'")
        controller.dismiss(animated: true) { self.finish?("{\"error\":\"\(msg)\"}") }
    }

    private static func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? scenes.first?.windows.first
        var top = window?.rootViewController
        while let next = top?.presentedViewController { top = next }
        return top
    }
}
