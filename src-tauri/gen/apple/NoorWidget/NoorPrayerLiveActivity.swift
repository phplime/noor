// The prayer Live Activity: lock screen banner and Dynamic Island.
import ActivityKit
import SwiftUI
import WidgetKit

private let gold = Color(red: 1.0, green: 0.86, blue: 0.55)
private let night = Color(red: 0.05, green: 0.08, blue: 0.18)

private extension NoorPrayerAttributes.ContentState {
    var range: ClosedRange<Date> { periodStart...max(periodEnd, periodStart.addingTimeInterval(60)) }
}

struct NoorPrayerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: NoorPrayerAttributes.self) { context in
            LockScreenView(state: context.state, location: context.attributes.location, stale: context.isStale)
                .activityBackgroundTint(night.opacity(0.88))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Label(s.current, systemImage: "moon.stars.fill")
                            .font(.headline)
                            .foregroundStyle(gold)
                        Text(s.currentBn).font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("ends in").font(.caption2).foregroundStyle(.secondary)
                        Text(timerInterval: s.range, countsDown: true)
                            .font(.title3.monospacedDigit().weight(.semibold))
                            .multilineTextAlignment(.trailing)
                            .frame(maxWidth: 90, alignment: .trailing)
                    }
                    .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 6) {
                        ProgressView(timerInterval: s.range, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                            .tint(gold)
                        HStack {
                            Text("Next · \(s.next)").font(.caption)
                            Spacer()
                            Text(s.nextAt, style: .time).font(.caption.weight(.semibold))
                        }
                        .foregroundStyle(.secondary)
                        if let steps = s.steps {
                            StepsRow(steps: steps, goal: s.stepGoal ?? 8000, at: s.stepsAt, compact: true)
                        }
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Image(systemName: "moon.stars.fill").foregroundStyle(gold)
            } compactTrailing: {
                Text(timerInterval: s.range, countsDown: true)
                    .monospacedDigit()
                    .font(.caption.weight(.semibold))
                    .frame(maxWidth: 56)
                    .foregroundStyle(gold)
            } minimal: {
                Image(systemName: "moon.stars.fill").foregroundStyle(gold)
            }
            .keylineTint(gold)
        }
    }
}

private struct LockScreenView: View {
    let state: NoorPrayerAttributes.ContentState
    let location: String
    let stale: Bool

    private var isNight: Bool { ["Isha", "Fajr"].contains(state.current) }

    var body: some View {
        VStack(spacing: 8) {
            HStack(alignment: .center, spacing: 14) {
                PrayerCurve(state: state, stale: stale)
                    .frame(width: 128, height: 70)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        Image(systemName: isNight ? "moon.stars.fill" : "sun.max.fill")
                            .font(.caption2)
                            .foregroundStyle(gold)
                        Text(location)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.6))
                            .lineLimit(1)
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(state.current).font(.title3.weight(.bold))
                        Text(state.currentBn).font(.caption).foregroundStyle(.white.opacity(0.7))
                    }
                    if let until = state.makruhUntil, !stale {
                        HStack(spacing: 3) {
                            Text("No salah until").font(.caption2.weight(.semibold))
                            Text(until, style: .time).font(.caption2.weight(.bold))
                        }
                        .foregroundStyle(Color(red: 1, green: 0.6, blue: 0.6))
                    } else if stale {
                        Text("\(state.next) started — open Noor")
                            .font(.caption2)
                            .foregroundStyle(gold)
                    } else {
                        HStack(spacing: 3) {
                            Text("Next · \(state.next)").font(.caption2)
                            Text(state.nextAt, style: .time).font(.caption2.weight(.bold))
                        }
                        .foregroundStyle(.white.opacity(0.75))
                    }
                }
                Spacer(minLength: 0)
            }

            HStack(spacing: 0) {
                ForEach(state.slots, id: \.self) { slot in
                    let now = slot.name == state.current
                    VStack(spacing: 0) {
                        Text(slot.name)
                            .font(.system(size: 10, weight: now ? .bold : .regular))
                            .foregroundStyle(now ? gold : .white.opacity(0.6))
                        Text(slot.at, style: .time)
                            .font(.system(size: 11, weight: .semibold))
                            .minimumScaleFactor(0.8)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity)
                }
            }

            if let steps = state.steps {
                StepsRow(steps: steps, goal: state.stepGoal ?? 8000, at: state.stepsAt, compact: true)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .foregroundStyle(.white)
    }
}

/// Half-circle gauge like the Home card: fills left to right as the prayer period passes,
/// with the live countdown inside. iOS animates it on its own, no app updates needed.
private struct PrayerCurve: View {
    let state: NoorPrayerAttributes.ContentState
    let stale: Bool

    /// A full circle drawn over twice the period: the visible top half fills exactly once.
    private var doubled: ClosedRange<Date> {
        let r = state.range
        return r.lowerBound...r.lowerBound.addingTimeInterval(r.upperBound.timeIntervalSince(r.lowerBound) * 2)
    }

    var body: some View {
        GeometryReader { g in
            let d = g.size.width
            ZStack(alignment: .bottom) {
                // Track
                Path { p in
                    p.addArc(center: CGPoint(x: d / 2, y: d / 2), radius: d / 2 - 4,
                             startAngle: .degrees(180), endAngle: .degrees(360), clockwise: false)
                }
                .stroke(.white.opacity(0.14), style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .frame(width: d, height: d)
                .frame(width: d, height: g.size.height, alignment: .top)
                .clipped()

                // Live fill
                ProgressView(timerInterval: doubled, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
                    .progressViewStyle(.circular)
                    .tint(gold)
                    .frame(width: d - 2, height: d - 2)
                    .rotationEffect(.degrees(-90))
                    .frame(width: d, height: d)
                    .frame(width: d, height: g.size.height - 2, alignment: .top)
                    .clipped()
                    .frame(maxHeight: .infinity, alignment: .top)

                VStack(spacing: 0) {
                    Text(timerInterval: state.range, countsDown: true)
                        .font(.system(size: 19, weight: .bold).monospacedDigit())
                        .multilineTextAlignment(.center)
                        .frame(width: d - 24)
                    Text(stale ? "ended" : "শেষ হতে বাকি")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
        }
    }
}

/// Today's steps with a small progress bar.
private struct StepsRow: View {
    let steps: Int
    let goal: Int
    let at: Date?
    let compact: Bool

    private var progress: Double { min(1, Double(steps) / Double(max(goal, 1))) }

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "figure.walk")
                .foregroundStyle(Color(red: 0.56, green: 0.94, blue: 0.77))
            Text("\(steps.formatted()) steps")
                .font((compact ? Font.caption : Font.subheadline).weight(.bold))
                .monospacedDigit()
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.15))
                GeometryReader { g in
                    Capsule()
                        .fill(Color(red: 0.56, green: 0.94, blue: 0.77))
                        .frame(width: g.size.width * progress)
                }
            }
            .frame(height: 5)
            Text(progress >= 1 ? "Goal ✓" : "\(Int(progress * 100))%")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white.opacity(0.75))
            if let at, !compact {
                Text(at, style: .time)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
    }
}
