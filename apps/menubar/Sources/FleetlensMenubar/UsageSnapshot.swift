import Foundation
import SwiftUI

struct UsageWindow: Codable, Equatable {
  let utilization: Double?
  let resetsAt: String?
}

extension UsageWindow {
  var resetsAtDate: Date? {
    guard let resetsAt else { return nil }
    return ISO8601DateFormatter.shared.date(from: resetsAt)
  }
}

struct ExtraUsage: Codable, Equatable {
  let isEnabled: Bool?
  let monthlyLimit: Double?
  let usedCredits: Double?
  let utilization: Double?
}

struct WebSearchQuota: Codable, Equatable {
  let used: Double?
  let limit: Double?
}

struct MonthlyQuota: Codable, Equatable {
  let used: Double?
  let limit: Double?
  let remaining: Double?
  let unit: String
  let unlimited: Bool
}

struct UsageSnapshot: Codable, Equatable {
  let capturedAt: String
  let agent: String?
  let fiveHour: UsageWindow
  let sevenDay: UsageWindow
  let monthly: UsageWindow?
  let monthlyQuota: MonthlyQuota?
  let sevenDayOpus: UsageWindow?
  let sevenDaySonnet: UsageWindow?
  let sevenDayOauthApps: UsageWindow?
  let sevenDayCowork: UsageWindow?
  let extraUsage: ExtraUsage?
  let planType: String?
  let webSearchQuota: WebSearchQuota?
}

extension UsageSnapshot {
  var agentKind: AgentKind {
    switch (agent ?? "claude-code").lowercased() {
    case "codex": return .codex
    case "copilot": return .copilot
    case "zai": return .zai
    case "grok": return .grok
    case "command-code", "cmd": return .commandCode
    default: return .claudeCode
    }
  }

  var capturedDate: Date? {
    ISO8601DateFormatter.shared.date(from: capturedAt)
  }
}

enum AgentKind: String, Codable, CaseIterable {
  case claudeCode = "claude-code"
  case codex
  case copilot
  case zai
  case grok
  case commandCode = "command-code"

  var displayName: String {
    switch self {
    case .claudeCode: return "Claude Code"
    case .codex: return "Codex"
    case .copilot: return "GitHub Copilot"
    case .zai: return "Z.ai"
    case .grok: return "Grok Build"
    case .commandCode: return "Command Code"
    }
  }

  var symbol: String {
    switch self {
    case .claudeCode: return "c.circle.fill"
    case .codex: return "x.circle.fill"
    case .copilot: return "infinity.circle.fill"
    case .zai: return "z.circle.fill"
    case .grok: return "g.circle.fill"
    case .commandCode: return "chevron.right.circle.fill"
    }
  }

  var color: Color {
    switch self {
    case .claudeCode: return .orange
    case .codex: return .blue
    case .copilot: return .purple
    case .zai: return .blue
    case .grok: return .primary
    case .commandCode: return Color(red: 132 / 255, green: 204 / 255, blue: 22 / 255)
    }
  }
}

enum SnapshotIO {
  /// Mirrors the CLI's cclensHome(): CCLENS_HOME overrides ~/.cclens. getenv,
  /// not ProcessInfo.environment — the latter snapshots at first access, which
  /// would defeat setenv-based test fixtures.
  static func cclensDir() -> URL {
    if let raw = getenv("CCLENS_HOME"), raw.pointee != 0 {
      return URL(fileURLWithPath: String(cString: raw))
    }
    return FileManager.default
      .homeDirectoryForCurrentUser
      .appendingPathComponent(".cclens")
  }

  static func usageLogURL() -> URL {
    cclensDir().appendingPathComponent("usage.jsonl")
  }

  static func decode(_ line: String) -> UsageSnapshot? {
    guard let data = line.data(using: .utf8) else { return nil }
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try? decoder.decode(UsageSnapshot.self, from: data)
  }

  /// Freshest snapshot per agent from the tail of the log. Lines interleave
  /// across agents (Claude + Codex polled in the same tick), so we walk
  /// backwards from EOF and keep the first hit per agent.
  static func latestPerAgent(maxLines: Int = 64) -> [AgentKind: UsageSnapshot] {
    let raw = readTail(chunk: 16_384)
    var lines = raw.split(separator: "\n", omittingEmptySubsequences: true)
    if lines.count > maxLines { lines = Array(lines.suffix(maxLines)) }

    var found: [AgentKind: UsageSnapshot] = [:]
    for line in lines.reversed() {
      guard let snap = decode(String(line)) else { continue }
      let kind = snap.agentKind
      if found[kind] == nil { found[kind] = snap }
      if found.count == AgentKind.allCases.count { break }
    }
    return found
  }

  /// Chronological history for one agent, read from a generous tail of the
  /// log. Used for pace (burn-rate) computation. 256KB ≈ 1–2 days at the
  /// daemon's 5-min cadence — plenty for a 1h-ago comparison.
  static func history(for kind: AgentKind, tailBytes: Int = 262_144) -> [UsageSnapshot] {
    let raw = readTail(chunk: tailBytes)
    var snaps: [UsageSnapshot] = []
    for line in raw.split(separator: "\n", omittingEmptySubsequences: true) {
      if let s = decode(String(line)), s.agentKind == kind { snaps.append(s) }
    }
    return snaps
  }

  private static func readTail(chunk: Int) -> String {
    let url = usageLogURL()
    guard let handle = try? FileHandle(forReadingFrom: url) else { return "" }
    defer { try? handle.close() }
    let fileSize = (try? handle.seekToEnd()) ?? 0
    let start = max(0, Int64(fileSize) - Int64(chunk))
    try? handle.seek(toOffset: UInt64(max(0, start)))
    guard let data = try? handle.readToEnd(),
          let text = String(data: data, encoding: .utf8) else { return "" }
    return text
  }
}

// MARK: - Presentation helpers

/// Threshold color so the bar/menu-bar text signals how close you are to the
/// limit at a glance. Low usage stays muted; near-limit goes red.
func thresholdColor(_ util: Double?) -> Color {
  guard let util else { return .secondary }
  switch util {
  case ..<50: return .secondary
  case ..<80: return .accentColor
  case ..<95: return .orange
  default: return .red
  }
}

/// "2h 14m" / "3d 4h" style countdown to a future date. Updates live when
/// driven by a TimelineView.
func countdown(from now: Date, to future: Date) -> String {
  let s = max(0, Int(future.timeIntervalSince(now)))
  if s < 60 { return "<1m" }
  let m = s / 60
  if m < 60 { return "\(m)m" }
  let h = m / 60
  let remM = m % 60
  if h < 24 { return "\(h)h \(remM)m" }
  let d = h / 24
  let remH = h % 24
  return "\(d)d \(remH)h"
}

/// Ideal-pace fraction: where utilization *should* be right now for a perfectly
/// even burn across the window. Computed from the reset time and the window's
/// nominal duration (5h / 7d). Drives the tick mark on each progress bar —
/// ahead of the tick = burning fast, behind = burning slow.
func idealFraction(now: Date, resetsAt: Date, duration: TimeInterval) -> Double? {
  guard duration > 0 else { return nil }
  let start = resetsAt.addingTimeInterval(-duration)
  let f = now.timeIntervalSince(start) / duration
  return min(1, max(0, f))
}

/// Exact duration of the calendar month ending at a Copilot reset boundary.
/// Falls back to 30 days only when an older snapshot has no reset timestamp.
func monthlyDuration(resetsAt: Date?) -> TimeInterval {
  guard let resetsAt else { return 30 * 86_400 }
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(secondsFromGMT: 0)!
  guard let start = calendar.date(byAdding: .month, value: -1, to: resetsAt) else {
    return 30 * 86_400
  }
  return resetsAt.timeIntervalSince(start)
}

/// Compact data age for the refresh button: "now" / "2m" / "3h" / "1d".
func ageLabel(now: Date, since: Date) -> String {
  let s = max(0, Int(now.timeIntervalSince(since)))
  if s < 60 { return "now" }
  let m = s / 60
  if m < 60 { return "\(m)m" }
  let h = m / 60
  if h < 24 { return "\(h)h" }
  return "\(h / 24)d"
}

extension ISO8601DateFormatter {
  /// The daemon emits timestamps with sub-second precision and (sometimes) a
  /// fractional-offset suffix (`+00:00.409347`) that the strict ISO8601
  /// parser rejects. `.withFractionalSeconds` accepts it.
  static let shared: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()
}
