import XCTest
@testable import FleetlensMenubar

/// Headless proof that the real menu-bar rendering pipeline ingests a Z.ai
/// snapshot from usage.jsonl and produces the values the popover draws.
/// AppKit views can't render without a display, so we exercise the same pure
/// helpers ContentView uses (decode + per-agent selection + threshold/
/// countdown/ideal-pace math).
///
/// Hermetic: a fixture log in a temp CCLENS_HOME, never the user's real
/// ~/.cclens — an earlier version read the live log and asserted whatever the
/// daemon had recorded that day, so it only passed on the machine (and day)
/// it was written.
final class ZaiRenderTests: XCTestCase {
  private var tmp: URL!

  // Line shapes copied from a real daemon log; values chosen for assertions.
  // Two zai lines prove latestPerAgent picks the newest, codex proves the
  // per-agent split.
  private let fixture = """
    {"captured_at":"2026-07-10T02:00:00.000Z","agent":"zai","five_hour":{"utilization":10,"resets_at":"2026-07-10T05:00:00.000Z"},"seven_day":{"utilization":9,"resets_at":"2026-07-12T01:40:10.997Z"},"seven_day_opus":null,"seven_day_sonnet":null,"seven_day_oauth_apps":null,"seven_day_cowork":null,"extra_usage":null,"plan_type":"GLM Coding Lite","web_search_quota":{"used":90,"limit":200}}
    {"captured_at":"2026-07-10T02:52:11.745Z","agent":"codex","five_hour":{"utilization":null,"resets_at":null},"seven_day":{"utilization":40,"resets_at":"2026-07-15T00:31:06.000Z"},"seven_day_opus":null,"seven_day_sonnet":null,"seven_day_oauth_apps":null,"seven_day_cowork":null,"extra_usage":null,"plan_type":"plus"}
    {"captured_at":"2026-07-10T02:52:12.489Z","agent":"zai","five_hour":{"utilization":100,"resets_at":"2026-07-10T05:00:00.000Z"},"seven_day":{"utilization":24,"resets_at":"2026-07-12T01:40:10.997Z"},"seven_day_opus":null,"seven_day_sonnet":null,"seven_day_oauth_apps":null,"seven_day_cowork":null,"extra_usage":null,"plan_type":"GLM Coding Lite","web_search_quota":{"used":100,"limit":200}}
    {"captured_at":"2026-07-10T02:52:13.489Z","agent":"copilot","five_hour":{"utilization":null,"resets_at":null},"seven_day":{"utilization":null,"resets_at":null},"monthly":{"utilization":12.5,"resets_at":"2026-08-01T00:00:00.000Z"},"monthly_quota":{"used":25,"limit":200,"remaining":175,"unit":"ai-credits","unlimited":false},"seven_day_opus":null,"seven_day_sonnet":null,"seven_day_oauth_apps":null,"seven_day_cowork":null,"extra_usage":null,"plan_type":"AI credits"}
    """

  override func setUpWithError() throws {
    tmp = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("fleetlens-menubar-tests-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
    try fixture.write(to: tmp.appendingPathComponent("usage.jsonl"), atomically: true, encoding: .utf8)
    setenv("CCLENS_HOME", tmp.path, 1)
  }

  override func tearDownWithError() throws {
    unsetenv("CCLENS_HOME")
    try? FileManager.default.removeItem(at: tmp)
  }

  func testZaiSectionRendersFromLog() throws {
    let perAgent = SnapshotIO.latestPerAgent()
    let zai = try XCTUnwrap(perAgent[.zai])

    // Same fields ContentView's AgentSection reads for Z.ai — and the newest
    // line won, not the older 10%/9% snapshot.
    XCTAssertEqual(zai.agentKind, .zai)
    XCTAssertEqual(zai.planType, "GLM Coding Lite")

    let five = zai.fiveHour
    XCTAssertEqual(five.utilization, 100.0)
    XCTAssertNotNil(five.resetsAtDate)

    let seven = zai.sevenDay
    XCTAssertEqual(seven.utilization, 24.0)
    XCTAssertNotNil(seven.resetsAtDate)

    // Web-search row (the Z.ai-only card).
    let ws = try XCTUnwrap(zai.webSearchQuota)
    XCTAssertEqual(ws.used, 100)
    XCTAssertEqual(ws.limit, 200)

    // Threshold colors ContentView applies to the bars.
    XCTAssertEqual(thresholdColor(five.utilization), .red)        // 100% → red
    XCTAssertEqual(thresholdColor(seven.utilization), .secondary) // 24% → muted

    // Countdown + ideal-pace tick math the WindowRow renders.
    let now = Date()
    if let reset = five.resetsAtDate {
      let cd = countdown(from: now, to: reset)
      XCTAssertFalse(cd.isEmpty)
      let frac = idealFraction(now: now, resetsAt: reset, duration: 5 * 3_600)
      XCTAssertNotNil(frac)
    }
  }

  func testPerAgentSplitAndKindMetadata() {
    let perAgent = SnapshotIO.latestPerAgent()
    XCTAssertTrue(perAgent.keys.contains(.zai))
    XCTAssertTrue(perAgent.keys.contains(.codex))
    XCTAssertTrue(perAgent.keys.contains(.copilot))
    XCTAssertFalse(perAgent.keys.contains(.claudeCode)) // not in the fixture
    let codex = perAgent[.codex]
    XCTAssertNil(codex?.fiveHour.utilization)
    XCTAssertEqual(codex?.sevenDay.utilization, 40)
    XCTAssertEqual(codex?.planType, "plus")
    let copilot = perAgent[.copilot]
    XCTAssertEqual(copilot?.monthly?.utilization, 12.5)
    XCTAssertEqual(copilot?.monthlyQuota?.used, 25)
    XCTAssertEqual(copilot?.monthlyQuota?.limit, 200)
    XCTAssertEqual(monthlyDuration(resetsAt: copilot?.monthly?.resetsAtDate), 31 * 86_400)
    // AgentKind is exhaustive over every menu-bar provider — compiles & switches.
    for kind in AgentKind.allCases {
      XCTAssertFalse(kind.displayName.isEmpty)
      XCTAssertFalse(kind.symbol.isEmpty)
    }
    XCTAssertEqual(AgentKind.grok.displayName, "Grok Build")
    XCTAssertEqual(AgentKind.grok.rawValue, "grok")
    XCTAssertEqual(AgentKind.copilot.displayName, "GitHub Copilot")
  }

  func testGrokAgentKindDecodesFromSnapshotLine() {
    let line =
      #"{"captured_at":"2026-07-10T02:52:12.489Z","agent":"grok","five_hour":{"utilization":null,"resets_at":null},"seven_day":{"utilization":null,"resets_at":null},"seven_day_opus":null,"seven_day_sonnet":null,"seven_day_oauth_apps":null,"seven_day_cowork":null,"extra_usage":null}"#
    let snap = SnapshotIO.decode(line)
    XCTAssertNotNil(snap)
    XCTAssertEqual(snap?.agentKind, .grok)
  }
}
