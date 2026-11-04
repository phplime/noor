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
}
