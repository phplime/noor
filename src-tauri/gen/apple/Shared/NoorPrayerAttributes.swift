// Shared by the Noor app and the NoorWidget extension: the data a prayer
// Live Activity carries. Both targets compile this file, so keep it identical.
import Foundation
#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
struct NoorPrayerAttributes: ActivityAttributes {
    struct Slot: Codable, Hashable {
        var name: String
        var at: Date
    }

    struct ContentState: Codable, Hashable {
        /// The prayer period we're in now, e.g. "Asr" / "আসর".
        var current: String
        var currentBn: String
        var periodStart: Date
        var periodEnd: Date
        /// The next prayer and when it starts.
        var next: String
        var nextAt: Date
        /// End of a makruh (no-salah) time, if we're in one.
        var makruhUntil: Date?
        /// The day's five prayers, for the strip at the bottom.
        var slots: [Slot]
        /// Today's steps (counted by the iPhone), when shown on the lock screen.
        var steps: Int?
        var stepGoal: Int?
        /// When `steps` was read.
        var stepsAt: Date?
    }

    var location: String
}
#endif
