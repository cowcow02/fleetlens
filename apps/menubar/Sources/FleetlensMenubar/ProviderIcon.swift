import AppKit
import SwiftUI

// Brand glyphs sourced from OpenUsage (MIT) ProviderIcons:
//   https://github.com/robinebers/openusage
//   Sources/OpenUsage/Resources/ProviderIcons/{claude,codex,zai,grok}.svg
// Loaded from the app bundle's Contents/Resources so they ship inside the
// .app. Each is a single-shape template that we tint to the provider's brand
// color so it reads cleanly on the dark menu bar and inside the popover.

enum BrandIcon {
  static func baseImage(for kind: AgentKind) -> NSImage? {
    let name: String
    switch kind {
    case .claudeCode: name = "claude"
    case .codex: name = "codex"
    case .copilot: name = "copilot"
    case .zai: name = "zai"
    case .grok: name = "grok"
    }
    // Load the SVG directly — NSImage rasterizes it on draw with true
    // transparency. (PNG-converted via qlmanage came out as a fully-opaque
    // square, which broke source-atop tinting.)
    guard let url = Bundle.main.url(forResource: name, withExtension: "svg"),
          let img = NSImage(contentsOf: url) else { return nil }
    return img
  }

  /// Same glyph flagged as a template image, so SwiftUI's foregroundStyle can
  /// color it (used in the popover to match the surrounding text color).
  static func templateImage(for kind: AgentKind) -> NSImage? {
    guard let img = baseImage(for: kind) else { return nil }
    img.isTemplate = true
    return img
  }

  /// The brand glyph rasterized at `renderSize` and filled with a solid color
  /// (isTemplate=false), so SwiftUI and ImageRenderer render it in color
  /// without relying on foregroundStyle (which ImageRenderer doesn't always
  /// honor for templates). Pass `color` to override the brand color.
  static func tintedImage(for kind: AgentKind, color: NSColor? = nil) -> NSImage? {
    guard let base = baseImage(for: kind) else { return nil }
    return base.tinted(color ?? brandColor(for: kind), renderSize: 64)
  }

  static func brandColor(for kind: AgentKind) -> NSColor {
    switch kind {
    case .claudeCode:
      // Anthropic terracotta — reads well on the dark menu bar.
      return NSColor(calibratedRed: 0.85, green: 0.47, blue: 0.34, alpha: 1)
    case .codex:
      return NSColor(calibratedRed: 0.30, green: 0.62, blue: 0.95, alpha: 1)
    case .copilot:
      return NSColor(calibratedRed: 137 / 255, green: 87 / 255, blue: 229 / 255, alpha: 1)
    case .zai:
      return NSColor(calibratedRed: 0.23, green: 0.51, blue: 0.96, alpha: 1)
    case .grok:
      // Slate-400 — matches web GROK_METADATA accent (visible on dark chrome).
      return NSColor(calibratedRed: 100 / 255, green: 116 / 255, blue: 139 / 255, alpha: 1)
    }
  }
}

extension NSImage {
  /// Rasterize (for SVG, crisply at `renderSize`) then replace every opaque
  /// pixel with `color`, preserving alpha. Classic source-atop composite.
  func tinted(_ color: NSColor, renderSize: CGFloat) -> NSImage {
    let sz = NSSize(width: renderSize, height: renderSize)
    let output = NSImage(size: sz)
    output.lockFocus()
    let rect = NSRect(origin: .zero, size: sz)
    self.draw(in: rect) // SVG → crisp raster at renderSize; PNG → scaled
    color.set()
    NSGraphicsContext.current?.compositingOperation = .sourceAtop
    NSBezierPath(rect: rect).fill()
    output.unlockFocus()
    return output
  }
}

/// SwiftUI brand icon. Uses the tinted PNG/SVG when bundled; falls back to an SF
/// Symbol letter-circle in dev (where Bundle.main has no Resources).
/// - `tint`: bake a specific NSColor into the glyph (used for the menu-bar
///   image, where ImageRenderer needs a baked color).
/// - `template`: render as a template image colored by SwiftUI's
///   foregroundStyle (used in the popover, so the icon matches the text color).
struct ProviderIcon: View {
  let kind: AgentKind
  var size: CGFloat = 14
  var tint: NSColor? = nil
  var template: Bool = false

  var body: some View {
    Group {
      if template, let base = BrandIcon.templateImage(for: kind) {
        Image(nsImage: base)
          .resizable()
          .aspectRatio(contentMode: .fit)
          .frame(width: size, height: size)
          .foregroundStyle(.primary)
      } else if let ns = BrandIcon.tintedImage(for: kind, color: tint) {
        Image(nsImage: ns)
          .resizable()
          .aspectRatio(contentMode: .fit)
          .frame(width: size, height: size)
      } else {
        Image(systemName: kind.symbol)
          .foregroundStyle(template ? .primary : (tint.map { Color(nsColor: $0) } ?? kind.color))
          .font(.system(size: size, weight: .semibold))
      }
    }
  }
}
