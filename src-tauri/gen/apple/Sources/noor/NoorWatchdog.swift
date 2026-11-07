// Black-screen guard (iPhone).
//
// While Noor sits in the background, iOS may kill the web process that draws its screen to free
// memory. Coming back, the app then shows a black page that never recovers. Each time Noor returns
// to the foreground this pings the page; if it doesn't answer within 3 s, it reloads it.
import UIKit
import WebKit

@objc(NoorWatchdog)
final class NoorWatchdog: NSObject {
    private static var installed = false
    private static var checking = false
    private static var lastURL: URL?

    /// Safe to call more than once and from any thread.
    @objc static func install() {
        DispatchQueue.main.async {
            guard !installed else { return }
            installed = true
            let nc = NotificationCenter.default
            nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { _ in check(after: 0.5) }
            nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in check(after: 1.2) }
            nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
                if let u = webView()?.url { lastURL = u }
            }
        }
    }

    private static func webView() -> WKWebView? {
        for scene in UIApplication.shared.connectedScenes {
            guard let ws = scene as? UIWindowScene else { continue }
            for w in ws.windows {
                if let v = find(in: w) { return v }
            }
        }
        return nil
    }

    private static func find(in v: UIView) -> WKWebView? {
        if let wk = v as? WKWebView { return wk }
        for s in v.subviews {
            if let wk = find(in: s) { return wk }
        }
        return nil
    }

    private static func check(after delay: Double) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            guard !checking, let wv = webView() else { return }
            if let u = wv.url { lastURL = u }
            checking = true
            var answered = false
            wv.evaluateJavaScript("document.readyState") { result, error in
                answered = true
                checking = false
                if error != nil || result == nil { reload(wv) }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                if !answered {
                    checking = false
                    reload(wv)
                }
            }
        }
    }

    private static func reload(_ wv: WKWebView) {
        NSLog("Noor: page did not answer after returning — reloading")
        if wv.url != nil {
            wv.reload()
        } else if let u = lastURL {
            wv.load(URLRequest(url: u))
        }
    }
}
