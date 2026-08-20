import XCTest
@testable import FleetlensMenubar

final class StripVisibilityTests: XCTestCase {
  private var suiteName: String!
  private var defaults: UserDefaults!

  override func setUpWithError() throws {
    suiteName = "fleetlens.menubar.tests.\(UUID().uuidString)"
    defaults = UserDefaults(suiteName: suiteName)
    defaults.removePersistentDomain(forName: suiteName)
  }

  override func tearDownWithError() throws {
    if let suiteName {
      defaults?.removePersistentDomain(forName: suiteName)
    }
    defaults = nil
  }

  func testDefaultVisibleIsEveryAgent() {
    let visible = MenubarPreferences.loadVisible(from: defaults)
    XCTAssertEqual(visible, Set(AgentKind.allCases))
  }

  func testSaveAndLoadVisibleRoundTrip() {
    let chosen: Set<AgentKind> = [.claudeCode, .codex]
    MenubarPreferences.saveVisible(chosen, to: defaults)
    XCTAssertEqual(MenubarPreferences.loadVisible(from: defaults), chosen)
  }

  func testEmptyVisibleIsHonored() {
    MenubarPreferences.saveVisible([], to: defaults)
    XCTAssertEqual(MenubarPreferences.loadVisible(from: defaults), [])
  }

  func testUnknownIdsFallBackToDefault() {
    defaults.set(["not-an-agent", "also-fake"], forKey: MenubarPreferences.visibleAgentsKey)
    XCTAssertEqual(MenubarPreferences.loadVisible(from: defaults), MenubarPreferences.defaultVisible)
  }

  func testStripAgentsFiltersAndOrders() {
    // Fabricate the map keys only — stripAgents never reads snapshot bodies.
    let snaps: [AgentKind: UsageSnapshot] = [
      .grok: Self.dummySnap(agent: "grok"),
      .claudeCode: Self.dummySnap(agent: "claude-code"),
      .zai: Self.dummySnap(agent: "zai"),
      .codex: Self.dummySnap(agent: "codex"),
      .copilot: Self.dummySnap(agent: "copilot"),
      .commandCode: Self.dummySnap(agent: "command-code"),
    ]

    // All visible → priority first, then alphabetical extras.
    XCTAssertEqual(
      stripAgents(snapshots: snaps, visible: Set(AgentKind.allCases)),
      [.claudeCode, .codex, .copilot, .commandCode, .grok, .zai]
    )

    // Hide Codex + Grok.
    let filtered = stripAgents(
      snapshots: snaps,
      visible: [.claudeCode, .copilot, .zai]
    )
    XCTAssertEqual(filtered, [.claudeCode, .copilot, .zai])

    // Hide everyone → empty strip (caller shows the gauge glyph).
    XCTAssertEqual(stripAgents(snapshots: snaps, visible: []), [])

    // Visible but no snapshot for that agent → omitted.
    XCTAssertEqual(
      stripAgents(snapshots: [.claudeCode: snaps[.claudeCode]!], visible: [.claudeCode, .codex]),
      [.claudeCode]
    )
  }

  @MainActor
  func testStoreTogglePersists() {
    let store = UsageStore(watchdogInterval: 3600, defaults: defaults)
    XCTAssertTrue(store.visibleAgents.contains(.copilot))
    store.setAgentVisible(.copilot, visible: false)
    XCTAssertFalse(store.visibleAgents.contains(.copilot))
    XCTAssertFalse(MenubarPreferences.loadVisible(from: defaults).contains(.copilot))

    // Fresh store reloads the preference.
    let again = UsageStore(watchdogInterval: 3600, defaults: defaults)
    XCTAssertFalse(again.visibleAgents.contains(.copilot))
    withExtendedLifetime(store) {}
    withExtendedLifetime(again) {}
  }

  private static func dummySnap(agent: String) -> UsageSnapshot {
    let line =
      #"{"captured_at":"2026-07-10T02:00:00.000Z","agent":"\#(agent)","five_hour":{"utilization":1,"resets_at":null},"seven_day":{"utilization":2,"resets_at":null},"seven_day_opus":null,"seven_day_sonnet":null,"seven_day_oauth_apps":null,"seven_day_cowork":null,"extra_usage":null}"#
    return SnapshotIO.decode(line)!
  }
}
