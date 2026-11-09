// Step counts from the motion coprocessor (CMPedometer). iOS keeps about a
// week of history even when Noor isn't running. Rust calls this class by name
// from a background thread, so blocking briefly here is fine.
import CoreMotion
import Foundation

@objc(NoorMotion)
final class NoorMotion: NSObject {
    private static let pedometer = CMPedometer()

    @objc static func available() -> Bool {
        guard CMPedometer.isStepCountingAvailable() else { return false }
        let status = CMPedometer.authorizationStatus()
        return status != .denied && status != .restricted
    }

    /// JSON `[["2026-11-03", 5234], …]` for the last `days` days (today first), or "[]".
    @objc static func stepsJSON(_ days: Int) -> String {
        guard CMPedometer.isStepCountingAvailable() else { return "[]" }
        let cal = Calendar.current
        let fmt = DateFormatter()
        fmt.calendar = Calendar(identifier: .gregorian)
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.dateFormat = "yyyy-MM-dd"

        var out: [[Any]] = []
        let today = cal.startOfDay(for: Date())
        for i in 0..<max(1, min(days, 7)) {
            guard let start = cal.date(byAdding: .day, value: -i, to: today),
                  let end = cal.date(byAdding: .day, value: 1, to: start) else { continue }
            let sem = DispatchSemaphore(value: 0)
            var steps: Int?
            // The first call shows the "Motion & Fitness" permission prompt.
            pedometer.queryPedometerData(from: start, to: min(end, Date())) { data, _ in
                steps = data?.numberOfSteps.intValue
                sem.signal()
            }
            if sem.wait(timeout: .now() + 4) == .timedOut { break }
            if let s = steps {
                out.append([fmt.string(from: start), s])
            } else if i == 0 {
                break // not allowed: stop asking
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: out),
              let text = String(data: data, encoding: .utf8) else { return "[]" }
        return text
    }

    // MARK: Live walk (Fitness › Start live)

    private static let livePedometer = CMPedometer()
    private static let lock = NSLock()
    private static var live: [String: Any] = [:]
    private static var liveOn = false
    private static var lastUpdate = Date.distantPast
    /// (time, metres since start) — the last ~20 s, to work out speed ourselves:
    /// iOS often leaves `currentPace` empty.
    private static var samples: [(Date, Double)] = []

    /// Count from `fromEpoch` (seconds since 1970; the moment the walk started). Calling it again
    /// with the same start after the app was in the background picks up the full total again.
    @objc static func startLive(_ fromEpoch: Double) {
        guard CMPedometer.isStepCountingAvailable() else { return }
        lock.lock()
        if liveOn { livePedometer.stopUpdates() }
        liveOn = true
        live = [:]
        samples = []
        lock.unlock()
        let start = fromEpoch > 0 ? Date(timeIntervalSince1970: fromEpoch) : Date()
        livePedometer.startUpdates(from: start) { data, _ in
            guard let d = data else { return }
            let now = Date()
            let metres = d.distance?.doubleValue ?? 0
            var v: [String: Any] = ["steps": d.numberOfSteps.intValue, "distanceM": metres]
            lock.lock()
            samples.append((now, metres))
            samples.removeAll { now.timeIntervalSince($0.0) > 20 }
            var speed = 0.0
            if let pace = d.currentPace?.doubleValue, pace > 0 {
                speed = 1.0 / pace
            } else if let first = samples.first, now.timeIntervalSince(first.0) >= 3 {
                speed = max(0, (metres - first.1) / now.timeIntervalSince(first.0))
            }
            v["speedMps"] = speed
            if let c = d.currentCadence?.doubleValue { v["cadence"] = c * 60 }
            live = v
            lastUpdate = now
            lock.unlock()
        }
    }

    @objc static func stopLive() {
        lock.lock(); let was = liveOn; liveOn = false; live = [:]; samples = []; lock.unlock()
        if was { livePedometer.stopUpdates() }
    }

    /// `{"steps", "distanceM", "speedMps", "cadence", "age"}` since the walk started, or `{}`.
    @objc static func liveJSON() -> String {
        lock.lock()
        var v = live
        let age = Date().timeIntervalSince(lastUpdate)
        lock.unlock()
        if v.isEmpty { return "{}" }
        v["age"] = age
        // No new steps for a while = standing still.
        if age > 6 { v["speedMps"] = 0; v["cadence"] = 0 }
        guard let data = try? JSONSerialization.data(withJSONObject: v),
              let text = String(data: data, encoding: .utf8) else { return "{}" }
        return text
    }
}
