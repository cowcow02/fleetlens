import SwiftUI

struct ContentView: View {
  @EnvironmentObject var store: UsageStore

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if store.snapshots.isEmpty {
        emptyState.padding(16)
      } else {
        VStack(spacing: 20) {
          ForEach(orderedKinds, id: \.self) { kind in
            if let snap = store.snapshots[kind] {
              AgentSection(kind: kind, snapshot: snap)
            }
          }
        }
        .padding(16)
      }
      Divider()
      footer
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
    .frame(width: 340)
  }

  private var orderedKinds: [AgentKind] {
    store.snapshots.keys.sorted(by: { $0.rawValue < $1.rawValue })
  }

  private var emptyState: some View {
    HStack(spacing: 10) {
      Image(systemName: "questionmark.circle")
        .foregroundStyle(.secondary)
        .font(.title3)
      Text(store.lastError ?? "No data.")
        .font(.callout)
        .foregroundStyle(.secondary)
      Spacer()
    }
  }

  /// Footer doubles as the title row: Fleetlens on the left, the actions on
  /// the right. Keeps the popover to two blocks (agents + this bar) instead of
  /// three.
  private var footer: some View {
    HStack(spacing: 8) {
      Image(systemName: "gauge.high.fill")
        .foregroundStyle(.tint)
        .font(.subheadline)
      Text("Fleetlens")
        .font(.subheadline.weight(.semibold))
      if let v = appVersion, !v.isEmpty {
        Text("v\(v)")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
      Spacer()
      Button {
        // Overview lists every agent (incl. Grok sessions). Usage is for
        // Claude/Codex/Z.ai plan windows only.
        NSWorkspace.shared.open(URL(string: "http://localhost:3321/")!)
      } label: {
        Label("Dashboard", systemImage: "chart.bar.xaxis")
      }
      .buttonStyle(.bordered)
      .controlSize(.small)
      .focusEffectDisabled()

      Button {
        store.forceRefresh()
      } label: {
        if store.refreshing {
          ProgressView().controlSize(.small)
        } else {
          // Live data age next to the icon so freshness is visible at a glance;
          // the daemon polls every 5 min, so this is usually "0m"–"5m".
          TimelineView(.periodic(from: .now, by: 30)) { ctx in
            HStack(spacing: 3) {
              Image(systemName: "arrow.clockwise")
              if let refreshed = store.lastRefreshed {
                Text(ageLabel(now: ctx.date, since: refreshed))
                  .monospacedDigit()
                  .font(.caption2)
              }
            }
          }
        }
      }
      .buttonStyle(.bordered)
      .controlSize(.small)
      .focusEffectDisabled()
      .disabled(store.refreshing)
      .help(store.refreshing ? "Polling…" : "Force a fresh poll now")

      Button {
        NSApplication.shared.terminate(nil)
      } label: {
        Image(systemName: "power")
      }
      .buttonStyle(.borderless)
      .foregroundStyle(.secondary)
      .focusEffectDisabled()
      .help("Quit Fleetlens menu bar")
    }
  }

  private var appVersion: String? {
    Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
  }
}

// MARK: - Per-agent section

struct AgentSection: View {
  let kind: AgentKind
  let snapshot: UsageSnapshot

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        ProviderIcon(kind: kind, size: 14, template: true)
        Text(kind.displayName).font(.subheadline.weight(.semibold))
      }

      if kind == .grok {
        // Grok reports context-window fill on fiveHour; no 7d plan window.
        WindowRow(label: "Context window", window: snapshot.fiveHour,
                  color: thresholdColor(snapshot.fiveHour.utilization),
                  totalDuration: 0)
      } else {
        WindowRow(label: "5-hour window", window: snapshot.fiveHour,
                  color: thresholdColor(snapshot.fiveHour.utilization),
                  totalDuration: 5 * 3_600)
        WindowRow(label: "7-day window", window: snapshot.sevenDay,
                  color: thresholdColor(snapshot.sevenDay.utilization),
                  totalDuration: 7 * 86_400)
      }

      if let opus = snapshot.sevenDayOpus?.utilization,
         let sonnet = snapshot.sevenDaySonnet?.utilization,
         opus != 0 || sonnet != 0 {
        HStack(spacing: 6) {
          ModelChip(label: "Opus", value: opus, color: .purple)
          ModelChip(label: "Sonnet", value: sonnet, color: .pink)
          Spacer()
        }
      }

      if let extra = snapshot.extraUsage, extra.isEnabled == true, let u = extra.utilization {
        WindowRow(label: "Extra usage", window: UsageWindow(utilization: u, resetsAt: nil),
                  color: .purple, totalDuration: 0)
      }

      if kind == .zai, let ws = snapshot.webSearchQuota {
        // web_search_quota is a percentage meter (used = 0–100, limit = 100),
        // matching Z.ai's portal display. Render as "N%" like the token rows.
        let pct = ws.used ?? 0
        WebSearchRow(pct: pct)
      }
    }
  }
}

struct WebSearchRow: View {
  let pct: Double
  private var barHeight: CGFloat { 7 }

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(alignment: .firstTextBaseline) {
        Text("Monthly web search").font(.caption).foregroundStyle(.secondary)
        Spacer()
        Text("\(Int(pct))%")
          .font(.system(size: 12, weight: .medium))
          .monospacedDigit()
          .foregroundStyle(.primary)
      }
      GeometryReader { geo in
        ZStack(alignment: .leading) {
          Capsule().fill(.quaternary).frame(height: barHeight)
          Capsule()
            .fill(Color.blue)
            .frame(width: max(3, geo.size.width * CGFloat(min(1, pct / 100))), height: barHeight)
        }
      }
      .frame(height: barHeight)
    }
  }
}

// MARK: - One window: label + bar + ideal-pace tick + live countdown

struct WindowRow: View {
  let label: String
  let window: UsageWindow
  let color: Color
  let totalDuration: TimeInterval

  private var barHeight: CGFloat { 7 }

  var body: some View {
    TimelineView(.periodic(from: .now, by: 60)) { ctx in
      VStack(alignment: .leading, spacing: 3) {
        HStack(alignment: .firstTextBaseline) {
          Text(label).font(.caption).foregroundStyle(.secondary)
          Spacer()
          Text(UsageStore.percentLabel(window.utilization))
            .font(.system(size: 12, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(.primary)
        }
        bar(now: ctx.date)
        if let resets = window.resetsAtDate {
          HStack(spacing: 3) {
            Image(systemName: "clock").font(.system(size: 9))
            Text("resets in \(countdown(from: ctx.date, to: resets))")
          }
          .font(.caption2)
          .foregroundStyle(.secondary)
        }
      }
    }
  }

  @ViewBuilder
  private func bar(now: Date) -> some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(.quaternary).frame(height: barHeight)
        if let v = window.utilization {
          Capsule()
            .fill(color)
            .frame(width: max(3, geo.size.width * CGFloat(min(1, v / 100))),
                   height: barHeight)
        }
        if let resets = window.resetsAtDate,
           let f = idealFraction(now: now, resetsAt: resets, duration: totalDuration) {
          Capsule()
            .fill(Color.primary)
            .frame(width: 1.5, height: barHeight + 3)
            .offset(x: max(0, geo.size.width * CGFloat(f) - 0.75))
        }
      }
    }
    .frame(height: barHeight)
  }
}

// MARK: - Small bits

struct ModelChip: View {
  let label: String
  let value: Double
  let color: Color

  var body: some View {
    HStack(spacing: 3) {
      Circle().fill(color).frame(width: 6, height: 6)
      Text(label).font(.caption2.weight(.medium))
      Text(UsageStore.percentLabel(value))
        .font(.caption2.monospacedDigit())
        .foregroundStyle(.secondary)
    }
    .padding(.horizontal, 7)
    .padding(.vertical, 3)
    .background(.quaternary, in: Capsule())
  }
}
