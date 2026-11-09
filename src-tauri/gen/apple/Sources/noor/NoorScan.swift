// Studio › ID / Passport: Apple's document scanner (VisionKit).
// It finds the card's edges, straightens it and crops it — like the Notes app scanner.
// Rust calls `scan` by name from a background thread (src/ios_scan.rs) and waits for the result.
import Foundation
import UIKit
import VisionKit
import Vision
import AVFoundation

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

    // MARK: Single photo with an ID-card guide (Studio › ID / Passport Copy)

    /// Open Noor's card camera: live edge detection, AUTO-captures when the card is held
    /// steady, or tap the shutter. One photo only.
    /// Returns `{"paths":[photo]}`, `{"cancelled":true}` or `{"error":"…"}`. Blocks the calling
    /// (background) thread until done.
    @objc static func capture(_ passport: Bool) -> String {
        guard AVCaptureDevice.default(for: .video) != nil else { return #"{"error":"No camera on this device."}"# }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .notDetermined:
            let asked = DispatchSemaphore(value: 0)
            var ok = false
            AVCaptureDevice.requestAccess(for: .video) { granted in ok = granted; asked.signal() }
            asked.wait()
            if !ok { return #"{"error":"Noor needs the camera to scan your card. Allow it in Settings › Noor › Camera."}"# }
        case .denied, .restricted:
            return #"{"error":"Camera access is off. Turn it on in Settings › Noor › Camera."}"#
        default:
            break
        }
        var result = #"{"cancelled":true}"#
        let done = DispatchSemaphore(value: 0)
        DispatchQueue.main.async {
            guard let top = topController() else {
                result = #"{"error":"No screen to show the camera on."}"#
                done.signal()
                return
            }
            let vc = CardCameraController(aspect: passport ? 125.0 / 88.0 : 85.6 / 54.0) { out in
                result = out
                done.signal()
            }
            vc.modalPresentationStyle = .fullScreen
            top.present(vc, animated: true)
        }
        done.wait()
        return result
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

/// Full-screen camera for one ID card / passport photo.
/// - live rectangle detection (Vision) drawn over the preview,
/// - auto-capture once the card has been steady for ~0.8 s,
/// - manual shutter, torch and cancel.
private final class CardCameraController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate, AVCapturePhotoCaptureDelegate {
    private let aspect: CGFloat
    private let finish: (String) -> Void
    private var finished = false

    private let session = AVCaptureSession()
    private let photoOutput = AVCapturePhotoOutput()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let videoQueue = DispatchQueue(label: "noor.cardcam")
    private var preview: AVCaptureVideoPreviewLayer!
    private var device: AVCaptureDevice?

    private let guide = CAShapeLayer()
    private let shade = CAShapeLayer()
    private let found = CAShapeLayer()
    private let hint = UILabel()
    private let shutter = UIButton(type: .custom)
    private let cancelButton = UIButton(type: .system)
    private let torchButton = UIButton(type: .system)
    private let autoSwitch = UIButton(type: .system)
    private var torchOn = false
    private var autoOn = true

    // detection state (video queue)
    private var lastDetect = Date.distantPast
    private var history: [[CGPoint]] = []
    private var capturing = false
    private var bufferSize = CGSize(width: 1080, height: 1920) // upright (portrait) size

    init(aspect: CGFloat, finish: @escaping (String) -> Void) {
        self.aspect = aspect
        self.finish = finish
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var prefersStatusBarHidden: Bool { true }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: dev) else {
            done(#"{"error":"Could not open the camera."}"#)
            return
        }
        device = dev
        session.beginConfiguration()
        session.sessionPreset = .photo
        if session.canAddInput(input) { session.addInput(input) }
        if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.setSampleBufferDelegate(self, queue: videoQueue)
        if session.canAddOutput(videoOutput) { session.addOutput(videoOutput) }
        session.commitConfiguration()
        if dev.isFocusModeSupported(.continuousAutoFocus) {
            try? dev.lockForConfiguration()
            dev.focusMode = .continuousAutoFocus
            dev.unlockForConfiguration()
        }

        preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        view.layer.addSublayer(preview)

        shade.fillRule = .evenOdd
        shade.fillColor = UIColor.black.withAlphaComponent(0.45).cgColor
        view.layer.addSublayer(shade)
        guide.strokeColor = UIColor.white.withAlphaComponent(0.85).cgColor
        guide.fillColor = UIColor.clear.cgColor
        guide.lineWidth = 2
        guide.lineDashPattern = [10, 8]
        view.layer.addSublayer(guide)
        found.strokeColor = UIColor(red: 0.18, green: 0.70, blue: 0.50, alpha: 1).cgColor
        found.fillColor = UIColor(red: 0.18, green: 0.70, blue: 0.50, alpha: 0.18).cgColor
        found.lineWidth = 3
        found.lineJoin = .round
        view.layer.addSublayer(found)

        hint.text = "Hold the card inside the frame"
        hint.textColor = .white
        hint.font = .systemFont(ofSize: 16, weight: .semibold)
        hint.textAlignment = .center
        hint.numberOfLines = 2
        view.addSubview(hint)

        shutter.backgroundColor = .white
        shutter.layer.cornerRadius = 36
        shutter.layer.borderWidth = 5
        shutter.layer.borderColor = UIColor.white.withAlphaComponent(0.45).cgColor
        shutter.addAction(UIAction { [weak self] _ in self?.takePhoto() }, for: .touchUpInside)
        view.addSubview(shutter)

        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.tintColor = .white
        cancelButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        cancelButton.addAction(UIAction { [weak self] _ in self?.done(#"{"cancelled":true}"#) }, for: .touchUpInside)
        view.addSubview(cancelButton)

        torchButton.setImage(UIImage(systemName: "bolt.slash.fill"), for: .normal)
        torchButton.tintColor = .white
        torchButton.addAction(UIAction { [weak self] _ in self?.toggleTorch() }, for: .touchUpInside)
        view.addSubview(torchButton)

        autoSwitch.tintColor = .white
        autoSwitch.titleLabel?.font = .systemFont(ofSize: 14, weight: .bold)
        autoSwitch.layer.cornerRadius = 15
        autoSwitch.backgroundColor = UIColor.white.withAlphaComponent(0.18)
        autoSwitch.contentEdgeInsets = UIEdgeInsets(top: 6, left: 12, bottom: 6, right: 12)
        autoSwitch.addAction(UIAction { [weak self] _ in self?.toggleAuto() }, for: .touchUpInside)
        view.addSubview(autoSwitch)
        updateAutoTitle()

        videoQueue.async { [weak self] in self?.session.startRunning() }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
        let safe = view.safeAreaInsets
        let w = view.bounds.width - 40
        let h = w / aspect
        let card = CGRect(x: 20, y: (view.bounds.height - h) / 2 - 40, width: w, height: h)
        let hole = UIBezierPath(roundedRect: card, cornerRadius: 14)
        let all = UIBezierPath(rect: view.bounds)
        all.append(hole)
        shade.path = all.cgPath
        guide.path = hole.cgPath
        hint.frame = CGRect(x: 20, y: card.minY - 64, width: view.bounds.width - 40, height: 48)
        autoSwitch.sizeToFit()
        autoSwitch.frame.size.width += 24
        autoSwitch.center = CGPoint(x: view.bounds.midX, y: max(safe.top, 20) + 28)
        let bottom = view.bounds.height - safe.bottom - 30
        shutter.frame = CGRect(x: view.bounds.midX - 36, y: bottom - 72, width: 72, height: 72)
        cancelButton.frame = CGRect(x: 20, y: bottom - 58, width: 90, height: 44)
        torchButton.frame = CGRect(x: view.bounds.width - 70, y: bottom - 58, width: 50, height: 44)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        setTorch(false)
        videoQueue.async { [weak self] in self?.session.stopRunning() }
    }

    // MARK: buttons

    private func toggleTorch() {
        torchOn.toggle()
        setTorch(torchOn)
        torchButton.setImage(UIImage(systemName: torchOn ? "bolt.fill" : "bolt.slash.fill"), for: .normal)
    }

    private func setTorch(_ on: Bool) {
        guard let dev = device, dev.hasTorch else { return }
        try? dev.lockForConfiguration()
        dev.torchMode = on ? .on : .off
        dev.unlockForConfiguration()
    }

    private func toggleAuto() {
        autoOn.toggle()
        updateAutoTitle()
    }

    private func updateAutoTitle() {
        autoSwitch.setTitle(autoOn ? "AUTO  ●" : "AUTO  ○", for: .normal)
        autoSwitch.alpha = autoOn ? 1 : 0.6
    }

    private func done(_ out: String) {
        guard !finished else { return }
        finished = true
        if presentingViewController != nil {
            dismiss(animated: true) { self.finish(out) }
        } else {
            finish(out)
        }
    }

    // MARK: live detection

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard !capturing, Date().timeIntervalSince(lastDetect) > 0.12,
              let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastDetect = Date()
        // The sensor is landscape; .right turns it upright (portrait).
        bufferSize = CGSize(width: CVPixelBufferGetHeight(pixels), height: CVPixelBufferGetWidth(pixels))
        let request = VNDetectRectanglesRequest()
        request.maximumObservations = 1
        request.minimumConfidence = 0.6
        request.minimumAspectRatio = 0.3
        request.quadratureTolerance = 20
        request.minimumSize = 0.3
        try? VNImageRequestHandler(cvPixelBuffer: pixels, orientation: .right, options: [:]).perform([request])
        let quad = request.results?.first.map { r in
            [r.topLeft, r.topRight, r.bottomRight, r.bottomLeft].map { CGPoint(x: $0.x, y: 1 - $0.y) }
        }
        handle(quad)
    }

    private func handle(_ quad: [CGPoint]?) {
        guard let q = quad else {
            history.removeAll()
            DispatchQueue.main.async { [weak self] in
                self?.found.path = nil
                self?.hint.text = "Hold the card inside the frame"
            }
            return
        }
        history.append(q)
        if history.count > 7 { history.removeFirst() }
        // Steady = every corner moved less than 1.5% over the last ~0.8 s.
        let steady = history.count >= 7 && (0..<4).allSatisfy { i in
            let xs = history.map { $0[i].x }, ys = history.map { $0[i].y }
            return (xs.max()! - xs.min()!) < 0.015 && (ys.max()! - ys.min()!) < 0.015
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let pts = q.map(self.toView)
            let path = UIBezierPath()
            path.move(to: pts[0])
            pts.dropFirst().forEach { path.addLine(to: $0) }
            path.close()
            self.found.path = path.cgPath
            self.hint.text = self.autoOn ? (steady ? "Hold still…" : "Card found — hold steady") : "Card found — tap the shutter"
            if steady && self.autoOn { self.takePhoto() }
        }
    }

    /// Normalised upright-image point → point on screen (preview uses aspect-fill).
    private func toView(_ p: CGPoint) -> CGPoint {
        let b = view.bounds
        let s = max(b.width / bufferSize.width, b.height / bufferSize.height)
        let w = bufferSize.width * s, h = bufferSize.height * s
        return CGPoint(x: p.x * w + (b.width - w) / 2, y: p.y * h + (b.height - h) / 2)
    }

    // MARK: photo

    private func takePhoto() {
        guard !capturing else { return }
        capturing = true
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        hint.text = "Capturing…"
        if let conn = photoOutput.connection(with: .video) {
            if #available(iOS 17.0, *) {
                if conn.isVideoRotationAngleSupported(90) { conn.videoRotationAngle = 90 }
            } else if conn.isVideoOrientationSupported {
                conn.videoOrientation = .portrait
            }
        }
        let settings = AVCapturePhotoSettings()
        if let dev = device, dev.hasFlash, torchOn == false { settings.flashMode = .off }
        photoOutput.capturePhoto(with: settings, delegate: self)
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        var out = #"{"error":"Could not take the photo."}"#
        if error == nil, let data = photo.fileDataRepresentation(), let img = UIImage(data: data),
           let jpeg = upright(img).jpegData(compressionQuality: 0.92) {
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("noor-scans", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent("photo-\(Int(Date().timeIntervalSince1970 * 1000)).jpg")
            if (try? jpeg.write(to: url)) != nil,
               let json = try? JSONSerialization.data(withJSONObject: ["paths": [url.path]]),
               let text = String(data: json, encoding: .utf8) {
                out = text
            }
        }
        DispatchQueue.main.async { self.done(out) }
    }

    /// Bake the photo's orientation into the pixels so every reader sees it upright.
    private func upright(_ img: UIImage) -> UIImage {
        if img.imageOrientation == .up { return img }
        let f = UIGraphicsImageRendererFormat()
        f.scale = img.scale
        return UIGraphicsImageRenderer(size: img.size, format: f).image { _ in img.draw(in: CGRect(origin: .zero, size: img.size)) }
    }
}
