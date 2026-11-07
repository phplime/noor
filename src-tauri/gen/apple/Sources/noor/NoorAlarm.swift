// Reminders that ring like an alarm until stopped (iPhone, iOS 26+, AlarmKit).
//
// Rust hands over the full list of upcoming alarm times on every re-plan; this schedules the new
// ones and cancels any Noor alarm that is no longer wanted. AlarmKit alarms ring through Silent
// mode and Focus with a full-screen Stop button, like the Clock app.
// Called from a background thread (src/ios_alarm.rs), so blocking here is fine.
import Foundation
import SwiftUI
#if canImport(AlarmKit)
import AlarmKit
#endif

#if canImport(AlarmKit)
@available(iOS 26.0, *)
struct NoorAlarmData: AlarmMetadata {}
#endif

@objc(NoorAlarm)
final class NoorAlarm: NSObject {

    /// True on iOS 26+ when this build includes AlarmKit.
    @objc static func supported() -> Bool {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) { return true }
        #endif
        return false
    }

    /// `json` = `[{"id":"<uuid>","at":<unix seconds>,"title":"…"}]`.
    /// Returns "ok", "unsupported", "denied" or an error message.
    @objc static func sync(_ json: String) -> String {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *) {
            guard let data = json.data(using: .utf8),
                  let list = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return "bad input" }
            var result = "ok"
            let done = DispatchSemaphore(value: 0)
            Task {
                result = await run(list)
                done.signal()
            }
            _ = done.wait(timeout: .now() + 30)
            return result
        }
        #endif
        return "unsupported"
    }

    #if canImport(AlarmKit)
    @available(iOS 26.0, *)
    private static func run(_ list: [[String: Any]]) async -> String {
        let manager = AlarmManager.shared
        var wanted: [UUID: (Date, String)] = [:]
        for item in list {
            guard let s = item["id"] as? String, let id = UUID(uuidString: s),
                  let at = (item["at"] as? NSNumber)?.doubleValue else { continue }
            let date = Date(timeIntervalSince1970: at)
            if date > Date() { wanted[id] = (date, (item["title"] as? String) ?? "Reminder") }
        }

        // Ask once (the first time shows the system prompt).
        if manager.authorizationState == .notDetermined {
            _ = try? await manager.requestAuthorization()
        }
        if manager.authorizationState != .authorized {
            return wanted.isEmpty ? "ok" : "denied"
        }

        // Cancel Noor alarms that are no longer wanted.
        let existing = (try? manager.alarms) ?? []
        let have = Set(existing.map(\.id))
        for a in existing where wanted[a.id] == nil {
            try? manager.cancel(id: a.id)
        }

        // Schedule the new ones.
        for (id, (date, title)) in wanted where !have.contains(id) {
            let alert = AlarmPresentation.Alert(
                title: LocalizedStringResource(stringLiteral: title),
                stopButton: AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.circle")
            )
            let attributes = AlarmAttributes<NoorAlarmData>(
                presentation: AlarmPresentation(alert: alert),
                metadata: NoorAlarmData(),
                tintColor: Color(red: 0.13, green: 0.6, blue: 0.45)
            )
            let config = AlarmManager.AlarmConfiguration<NoorAlarmData>(
                countdownDuration: nil,
                schedule: .fixed(date),
                attributes: attributes
            )
            do {
                _ = try await manager.schedule(id: id, configuration: config)
            } catch {
                return "could not schedule: \(error.localizedDescription)"
            }
        }
        return "ok"
    }
    #endif
}
