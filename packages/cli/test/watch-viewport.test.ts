import { describe, expect, it } from "vitest";
import {
  renderWatchViewport,
  watchOffsetForKey,
} from "../src/usage/watch-viewport.js";

describe("watch viewport", () => {
  it("clips long output and reports the visible range", () => {
    const viewport = renderWatchViewport("a\nb\nc\nd\ne\nf\n", 4, 2);
    expect(viewport.offset).toBe(2);
    expect(viewport.maxOffset).toBe(3);
    expect(viewport.text).toContain("c\nd\ne");
    expect(viewport.text).toContain("3–5 / 6");
    expect(viewport.text).not.toContain("\nf\n");
  });

  it("clamps offsets when content or terminal height changes", () => {
    const viewport = renderWatchViewport("a\nb\nc\n", 2, 99);
    expect(viewport.offset).toBe(2);
    expect(viewport.maxOffset).toBe(2);
  });

  it("maps navigation keys to bounded offsets", () => {
    expect(watchOffsetForKey(5, "up", 10, 4)).toBe(4);
    expect(watchOffsetForKey(5, "down", 10, 4)).toBe(6);
    expect(watchOffsetForKey(5, "pageup", 10, 4)).toBe(1);
    expect(watchOffsetForKey(5, "pagedown", 10, 4)).toBe(9);
    expect(watchOffsetForKey(5, "home", 10, 4)).toBe(0);
    expect(watchOffsetForKey(5, "end", 10, 4)).toBe(10);
  });
});
