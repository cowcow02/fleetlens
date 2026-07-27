import Foundation

/// UserDefaults-backed preferences for the menu-bar strip.
///
/// Stores which agents appear as icon pins in the status item. Default is
/// every known agent (so a fresh install matches pre-config behavior: any
/// agent with a usage sample shows up). Empty set is valid — strip falls
/// back to the generic gauge glyph.
enum MenubarPreferences {
  static let visibleAgentsKey = "fleetlens.menubar.visibleAgents"

  /// Priority order for the strip (Claude / Codex / Copilot first, then the
  /// rest alphabetically by rawValue). Shared with the strip renderer so the
  /// layout never drifts from the preference UI.
  static let stripPriority: [AgentKind] = [.claudeCode, .codex, .copilot]

  static let defaultVisible: Set<AgentKind> = Set(AgentKind.allCases)

  static func loadVisible(from defaults: UserDefaults = .standard) -> Set<AgentKind> {
    guard let raw = defaults.stringArray(forKey: visibleAgentsKey) else {
      return defaultVisible
    }
    // Drop unknown ids; an all-unknown array would otherwise blank the strip.
    let parsed = Set(raw.compactMap(AgentKind.init(rawValue:)))
    return raw.isEmpty ? [] : (parsed.isEmpty ? defaultVisible : parsed)
  }

  static func saveVisible(_ agents: Set<AgentKind>, to defaults: UserDefaults = .standard) {
    defaults.set(agents.map(\.rawValue).sorted(), forKey: visibleAgentsKey)
  }
}

/// Agents that should render as status-item pins, given the latest snapshots
/// and the user's visibility set. Priority agents keep a stable left-to-right
/// order; everything else is alphabetical by rawValue.
func stripAgents(
  snapshots: [AgentKind: UsageSnapshot],
  visible: Set<AgentKind>,
  priority: [AgentKind] = MenubarPreferences.stripPriority
) -> [AgentKind] {
  let present = priority.filter { snapshots[$0] != nil && visible.contains($0) }
  let extras = snapshots.keys
    .filter { kind in
      !priority.contains(kind) && visible.contains(kind)
    }
    .sorted(by: { $0.rawValue < $1.rawValue })
  return present + extras
}
