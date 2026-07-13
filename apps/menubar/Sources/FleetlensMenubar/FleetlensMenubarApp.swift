import AppKit
import Combine
import SwiftUI

@main
struct FleetlensMenubarApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

  var body: some Scene {
    // The UI is AppKit-driven (NSStatusItem + NSPopover). An empty Settings
    // scene satisfies SwiftUI's requirement for at least one Scene.
    Settings { EmptyView() }
  }
}

/// Owns the menu bar item and the popover. SwiftUI's MenuBarExtra flattens
/// multi-line labels and fights template-image coloring; an NSStatusItem with
/// an image rendered from SwiftUI (via ImageRenderer) reproduces OpenUsage's
/// strip layout reliably.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private var statusItem: NSStatusItem!
  private var popover: NSPopover!
  private let store = UsageStore()
  private var cancellable: AnyCancellable?

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory) // no Dock icon (LSUIElement also set in Info.plist)

    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    popover = NSPopover()
    popover.behavior = .transient
    popover.contentViewController = NSHostingController(
      rootView: ContentView().environmentObject(store)
    )

    redraw()
    cancellable = store.$snapshots
      .receive(on: DispatchQueue.main)
      .sink { [weak self] _ in self?.redraw() }

    if let button = statusItem.button {
      button.action = #selector(togglePopover(_:))
      button.target = self
    }
  }

  /// Re-render the strip to an NSImage and push it onto the status item. Runs
  /// once at launch and on every usage update (Combine sink on store).
  private func redraw() {
    guard let button = statusItem?.button else { return }
    let view = StripLabel(snapshots: store.snapshots, hasData: store.hasData)
      .fixedSize()
    let renderer = ImageRenderer(content: view)
    renderer.scale = NSScreen.main?.backingScaleFactor ?? 2
    if let image = renderer.nsImage {
      image.isTemplate = false // we baked brand colors in — don't let the bar template-ize it
      button.image = image
    }
  }

  @objc private func togglePopover(_ sender: AnyObject?) {
    guard let button = statusItem?.button else { return }
    if popover.isShown {
      popover.performClose(sender)
    } else {
      popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
      NSApp.activate(ignoringOtherApps: true)
    }
  }
}

/// The menu-bar strip. Every present provider renders as a "detailed" pin;
/// providers without a 5h window (current Codex and Grok) show only 7d%.
/// Text and icons are white — the strip is a baked-color image on the dark
/// menu bar (isTemplate=false), so white reads cleanly there.
private struct StripLabel: View {
  let snapshots: [AgentKind: UsageSnapshot]
  let hasData: Bool

  private var ordered: [AgentKind] {
    let priority: [AgentKind] = [.claudeCode, .codex]
    let present = priority.filter { snapshots[$0] != nil }
    let extras = snapshots.keys.filter { !present.contains($0) }.sorted(by: { $0.rawValue < $1.rawValue })
    return present + extras
  }

  var body: some View {
    if !hasData || ordered.isEmpty {
      Image(systemName: "gauge.medium").font(.system(size: 13)).foregroundStyle(.white)
    } else {
      HStack(spacing: 8) {
        ForEach(ordered, id: \.self) { kind in
          DetailedPin(kind: kind, snap: snapshots[kind]!)
        }
      }
      .padding(.horizontal, 2)
    }
  }
}

private struct DetailedPin: View {
  let kind: AgentKind
  let snap: UsageSnapshot

  var body: some View {
    HStack(spacing: 3) {
      ProviderIcon(kind: kind, size: 20, tint: .white)
      VStack(alignment: .trailing, spacing: 0) {
        if snap.fiveHour.utilization != nil {
          Text(UsageStore.percentLabel(snap.fiveHour.utilization))
            .font(.system(size: 9))
            .monospacedDigit()
            .foregroundStyle(.white)
        }
        Text(UsageStore.percentLabel(snap.sevenDay.utilization))
          .font(.system(size: 9))
          .monospacedDigit()
          .foregroundStyle(.white)
      }
    }
  }
}
