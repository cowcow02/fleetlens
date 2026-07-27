import Foundation
import SwiftUI
import Combine

let daemonSnapshotStaleAfter: TimeInterval = 5 * 60

func shouldRecoverDaemon(
  snapshots: [AgentKind: UsageSnapshot],
  now: Date,
  staleAfter: TimeInterval = daemonSnapshotStaleAfter
) -> Bool {
  guard let newest = snapshots.values.compactMap(\.capturedDate).max() else { return true }
  return now.timeIntervalSince(newest) > staleAfter
}

struct CliLaunch: Codable {
  let node: String
  let script: String

  static func load() -> CliLaunch? {
    let url = SnapshotIO.cclensDir().appendingPathComponent("cli-launch.json")
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(CliLaunch.self, from: data)
  }

  func run(_ arguments: [String]) -> Bool {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: node)
    proc.arguments = [script] + arguments
    proc.standardOutput = FileHandle(forWritingAtPath: "/dev/null")
    proc.standardError = FileHandle(forWritingAtPath: "/dev/null")
    do {
      try proc.run()
      proc.waitUntilExit()
      return proc.terminationStatus == 0
    } catch {
      return false
    }
  }
}

@MainActor
final class UsageStore: ObservableObject {
  @Published var snapshots: [AgentKind: UsageSnapshot] = [:]
  @Published var paces: [AgentKind: Double] = [:]
  /// Agents allowed to appear as pins in the menu-bar strip. Toggle from the
  /// popover; persisted in UserDefaults under MenubarPreferences.
  @Published var visibleAgents: Set<AgentKind>
  @Published var lastRefreshed: Date?
  @Published var lastError: String?
  @Published var refreshing = false

  private var watcher: UsageLogWatcher?
  private var watchdog: AnyCancellable?
  private var daemonStartInFlight = false
  private let defaults: UserDefaults

  init(watchdogInterval: TimeInterval = 60, defaults: UserDefaults = .standard) {
    self.defaults = defaults
    self.visibleAgents = MenubarPreferences.loadVisible(from: defaults)
    reload()
    watcher = UsageLogWatcher(url: SnapshotIO.usageLogURL()) { [weak self] in
      Task { @MainActor in self?.reload() }
    }
    watcher?.start()
    watchdog = Timer.publish(every: watchdogInterval, on: .main, in: .common)
      .autoconnect()
      .sink { [weak self] now in
        Task { @MainActor in self?.recoverDaemonIfStale(now: now) }
      }
  }

  /// Toggle strip visibility for one agent and persist.
  func setAgentVisible(_ kind: AgentKind, visible: Bool) {
    if visible {
      visibleAgents.insert(kind)
    } else {
      visibleAgents.remove(kind)
    }
    MenubarPreferences.saveVisible(visibleAgents, to: defaults)
  }

  /// Headline value for the menu bar — Claude 5h, falling back to Codex 7d.
  var headlinePercent: String { Self.percentLabel(headlineUtil) }
  var hasData: Bool { !snapshots.isEmpty }

  var headlineUtil: Double? {
    snapshots[.claudeCode]?.fiveHour.utilization
      ?? snapshots[.codex]?.fiveHour.utilization
      ?? snapshots[.codex]?.sevenDay.utilization
  }

  /// Color for the menu bar % — reflects the same threshold scale as the bars.
  var headlineColor: Color { thresholdColor(headlineUtil) }

  /// Secondary metric for the menu bar when Codex is also present.
  var secondaryPercent: String? {
    guard let codex = snapshots[.codex]?.fiveHour.utilization
      ?? snapshots[.codex]?.sevenDay.utilization,
          snapshots[.claudeCode] != nil else { return nil }
    return Self.percentLabel(codex)
  }

  static func percentLabel(_ value: Double?) -> String {
    guard let value else { return "—" }
    return String(format: "%.0f%%", value)
  }

  func reload() {
    snapshots = SnapshotIO.latestPerAgent()
    paces = snapshots.keys.reduce(into: [:]) { acc, kind in
      if let p = pace(for: kind) { acc[kind] = p }
    }
    lastRefreshed = Date()
    lastError = snapshots.isEmpty ? "Waiting for the daemon's first usage snapshot…" : nil
  }

  /// App launch, popover open, and the stale-snapshot watchdog all converge on
  /// this idempotent recovery path.
  func ensureDaemonRunning() {
    guard !daemonStartInFlight else { return }
    daemonStartInFlight = true
    Task { [weak self] in
      let ok = await Task.detached(priority: .utility) {
        CliLaunch.load()?.run(["daemon", "start"]) == true
      }.value
      guard let self else { return }
      self.daemonStartInFlight = false
      guard !ok, self.snapshots.isEmpty else { return }
      self.lastError = "Daemon couldn't start — re-run `fleetlens menubar install` to reconnect the widget to the CLI."
    }
  }

  func recoverDaemonIfStale(now: Date = Date()) {
    guard shouldRecoverDaemon(snapshots: snapshots, now: now) else { return }
    ensureDaemonRunning()
  }

  /// Force a fresh usage poll instead of just re-reading the file. Spawns the
  /// CLI (`node <script> usage --save`) which does the OAuth fetch + appends a
  /// new line to usage.jsonl — the file watcher then fires reload() on its own.
  /// The node + script paths are read from ~/.cclens/cli-launch.json because a
  /// GUI app launched via `open` doesn't inherit the user's shell PATH.
  func forceRefresh() {
    guard !refreshing else { return }
    refreshing = true
    Task { [weak self] in
      let ok = await Task.detached(priority: .utility) { Self.runUsageSave() }.value
      guard let self else { return }
      self.refreshing = false
      if ok {
        self.reload()
      } else {
        self.lastError = "Refresh couldn't reach the CLI — ~/.cclens/cli-launch.json missing. Re-run `fleetlens menubar install`."
      }
    }
  }

  private static nonisolated func runUsageSave() -> Bool {
    CliLaunch.load()?.run(["usage", "--save"]) == true
  }

  /// Burn rate: 7-day utilization change vs ~1h ago. Positive = climbing.
  /// Falls back to the 5h window if 7d is null (e.g. Codex sometimes reports
  /// only 5h). Returns nil when there isn't enough history to compare.
  private func pace(for kind: AgentKind) -> Double? {
    let hist = SnapshotIO.history(for: kind)
    guard hist.count >= 2,
          let nowSnap = hist.last,
          let nowDate = nowSnap.capturedDate else { return nil }

    let nowVal = nowSnap.sevenDay.utilization ?? nowSnap.fiveHour.utilization
    guard let nowVal else { return nil }

    let target = nowDate.addingTimeInterval(-3_600)
    let oldSnap = hist
      .filter { $0.capturedDate.map { abs($0.timeIntervalSince(target)) < 3_600 } ?? false }
      .min(by: { a, b in
        guard let da = a.capturedDate, let db = b.capturedDate else { return false }
        return abs(da.timeIntervalSince(target)) < abs(db.timeIntervalSince(target))
      })
    guard let oldSnap else { return nil }
    let oldVal = oldSnap.sevenDay.utilization ?? oldSnap.fiveHour.utilization
    guard let oldVal else { return nil }
    return nowVal - oldVal
  }
}

/// Watches the usage log via a kernel DispatchSource and fires on every write.
/// Cheaper and more responsive than polling; we watch the inode via an open fd
/// (O_EVTONLY), not the path, so the daemon's appends are seen live.
final class UsageLogWatcher {
  private let url: URL
  private let handler: () -> Void
  private var source: DispatchSourceFileSystemObject?
  private var fd: CInt = -1
  private var dirSource: DispatchSourceFileSystemObject?
  private var dirFd: CInt = -1

  init(url: URL, handler: @escaping () -> Void) {
    self.url = url
    self.handler = handler
  }

  func start() {
    openSource()
    openDirSource()
  }

  private func openSource() {
    fd = open(url.path, O_EVTONLY)
    guard fd >= 0 else { return }
    let src = DispatchSource.makeFileSystemObjectSource(
      fileDescriptor: fd,
      eventMask: [.write, .delete, .rename],
      queue: .global(qos: .utility)
    )
    let capturedFd = fd
    src.setEventHandler { [weak self] in self?.handler() }
    src.setCancelHandler { close(capturedFd) }
    src.resume()
    source = src
  }

  /// If the file doesn't exist yet (fresh install), watch the parent dir so
  /// we attach the moment the daemon creates it.
  private func openDirSource() {
    let dir = url.deletingLastPathComponent()
    dirFd = open(dir.path, O_EVTONLY)
    guard dirFd >= 0 else { return }
    let src = DispatchSource.makeFileSystemObjectSource(
      fileDescriptor: dirFd,
      eventMask: [.write, .delete, .rename],
      queue: .global(qos: .utility)
    )
    let capturedFd = dirFd
    src.setEventHandler { [weak self] in
      self?.handler()
      if self?.source == nil { self?.openSource() }
    }
    src.setCancelHandler { close(capturedFd) }
    src.resume()
    dirSource = src
  }
}
