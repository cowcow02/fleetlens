import XCTest
@testable import FleetlensMenubar

/// Headless proof that a Command Code usage.jsonl line decodes as its own
/// agent (not Claude) and exposes both rolling windows the popover draws.
final class CommandCodeRenderTests: XCTestCase {
  private var tmp: URL!

  private let fixture = """
    {"captured_at":"2026-08-17T04:00:00.000Z","agent":"command-code","five_hour":{"utilization":0.3,"resets_at":"2026-08-17T10:00:00.000Z"},"seven_day":{"utilization":99.5,"resets_at":"2026-08-18T21:12:50.702Z"},"monthly":{"utilization":59.6,"resets_at":"2026-09-05T15:55:49.000Z"},"monthly_quota":{"used":5.96,"limit":10,"remaining":4.04,"unit":"credits","unlimited":false},"seven_day_opus":null,"seven_day_sonnet":null,"seven_day_oauth_apps":null,"seven_day_cowork":null,"extra_usage":null,"plan_type":"Go"}
    {"captured_at":"2026-08-17T04:00:01.000Z","agent":"claude-code","five_hour":{"utilization":12,"resets_at":null},"seven_day":{"utilization":20,"resets_at":null},"seven_day_opus":null,"seven_day_sonnet":null,"seven_day_oauth_apps":null,"seven_day_cowork":null,"extra_usage":null}
    """

  override func setUpWithError() throws {
    tmp = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("fleetlens-menubar-cmd-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
    try fixture.write(to: tmp.appendingPathComponent("usage.jsonl"), atomically: true, encoding: .utf8)
    setenv("CCLENS_HOME", tmp.path, 1)
  }

  override func tearDownWithError() throws {
    unsetenv("CCLENS_HOME")
    try? FileManager.default.removeItem(at: tmp)
  }

  func testCommandCodeDecodesAsItsOwnAgent() throws {
    let found = SnapshotIO.latestPerAgent()
    XCTAssertEqual(found[.commandCode]?.agentKind, .commandCode)
    XCTAssertEqual(found[.commandCode]?.fiveHour.utilization, 0.3)
    XCTAssertEqual(found[.commandCode]?.sevenDay.utilization, 99.5)
    XCTAssertEqual(found[.commandCode]?.monthly?.utilization, 59.6)
    XCTAssertEqual(found[.commandCode]?.monthlyQuota?.limit, 10)
    XCTAssertEqual(found[.commandCode]?.monthlyQuota?.remaining, 4.04)
    XCTAssertEqual(found[.commandCode]?.planType, "Go")
    XCTAssertEqual(found[.claudeCode]?.fiveHour.utilization, 12)
    XCTAssertNotEqual(found[.commandCode]?.agentKind, .claudeCode)
  }
}
