// Starts, updates and ends Noor's prayer Live Activity (lock screen and
// Dynamic Island). Rust calls this class by name through the Objective-C runtime.
import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

@objc(NoorLive)
final class NoorLive: NSObject {
    private struct SlotJS: Decodable {
        let name: String
        let at: Double
    }

    /// What the web view sends; times are epoch milliseconds.
    private struct Payload: Decodable {
        let location: String
        let current: String
        let currentBn: String
        let periodStart: Double
        let periodEnd: Double
        let next: String
        let nextAt: Double
        let makruhUntil: Double?
        let slots: [SlotJS]
        let steps: Int?
        let stepGoal: Int?
        let stepsAt: Double?
    }

    private static func date(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }

    @objc static func supported() -> Bool {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) { return ActivityAuthorizationInfo().areActivitiesEnabled }
        #endif
        return false
    }

    /// Start or update the activity. Returns "" when it worked, otherwise a message.
    @objc static func sync(_ json: String) -> String {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { return "Lock-screen prayer times need iOS 16.2 or later." }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            return "Live Activities are off for Noor. Turn them on in Settings › Noor."
        }
        guard let data = json.data(using: .utf8), let p = try? JSONDecoder().decode(Payload.self, from: data) else {
            return "Couldn't read the prayer data."
        }
        let start = date(p.periodStart)
        let end = max(date(p.periodEnd), start.addingTimeInterval(60))
        let state = NoorPrayerAttributes.ContentState(
            current: p.current,
            currentBn: p.currentBn,
            periodStart: start,
            periodEnd: end,
            next: p.next,
            nextAt: date(p.nextAt),
            makruhUntil: p.makruhUntil.map(date),
            slots: p.slots.map { .init(name: $0.name, at: date($0.at)) },
            steps: p.steps,
            stepGoal: p.stepGoal,
            stepsAt: p.stepsAt.map(date)
        )
        let content = ActivityContent(state: state, staleDate: end, relevanceScore: 60)

        let running = Activity<NoorPrayerAttributes>.activities
        for extra in running.dropFirst() {
            Task { await extra.end(nil, dismissalPolicy: .immediate) }
        }
        if let current = running.first {
            if current.attributes.location == p.location && current.activityState == .active {
                Task { await current.update(content) }
                return ""
            }
            Task { await current.end(nil, dismissalPolicy: .immediate) }
        }
        do {
            _ = try Activity.request(attributes: NoorPrayerAttributes(location: p.location), content: content, pushType: nil)
            return ""
        } catch {
            return error.localizedDescription
        }
        #else
        return "Live Activities aren't available."
        #endif
    }

    /// Remove the activity from the lock screen.
    @objc static func end() {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else { return }
        for a in Activity<NoorPrayerAttributes>.activities {
            Task { await a.end(nil, dismissalPolicy: .immediate) }
        }
        #endif
    }
}
