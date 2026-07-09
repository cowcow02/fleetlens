import XCTest
@testable import FleetlensMenubar

/// Headless proof that the real menu-bar rendering pipeline ingests a Z.ai
/// snapshot from ~/.cclens/usage.jsonl and produces the values the popover
/// draws. AppKit views can't render without a display, so we exercise the
/// same pure helpers ContentView uses (decode + per-agent selection +
/// threshold/countdown/ideal-pace math) against the actual on-disk log.
final class ZaiRenderTests: XCTestCase {
  func testZaiSectionRendersFromRealLog() throws {
    let perAgent = SnapshotIO.latestPerAgent()
    guard let zai = perAgent[.zai] else {
      throw XCTSkip("No zai snapshot in usage.jsonl — run the daemon with ZAI_API_KEY set")
    }

    // Same fields ContentView's AgentSection reads for Z.ai.
    XCTAssertEqual(zai.agentKind, .zai)
    XCTAssertEqual(zai.planType, "GLM Coding Lite")

    // 5-hour window (shows 100%).
    let five = zai.fiveHour
    XCTAssertEqual(five.utilization, 100.0)
    XCTAssertNotNil(five.resetsAtDate)

    // 7-day window (shows 24%).
    let seven = zai.sevenDay
    XCTAssertEqual(seven.utilization, 24.0)
    XCTAssertNotNil(seven.resetsAtDate)

    // Web-search row (the new Z.ai-only card).
    let ws = try XCTUnwrap(zai.webSearchQuota)
    XCTAssertEqual(ws.used, 100)
    XCTAssertEqual(ws.limit, 200)

    // Threshold colors ContentView applies to the bars.
    XCTAssertEqual(thresholdColor(five.utilization), .red)       // 100% → red
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

  func testZaiAppearsInOrderedSectionList() {
    let perAgent = SnapshotIO.latestPerAgent()
    XCTAssertTrue(perAgent.keys.contains(.zai))
    // AgentKind is exhaustive over claude-code/codex/zai — compiles & switches.
    for kind in AgentKind.allCases {
      XCTAssertFalse(kind.displayName.isEmpty)
      XCTAssertFalse(kind.symbol.isEmpty)
    }
  }
}
