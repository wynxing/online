import { describe, expect, it } from "vitest";
import { formatDate, formatMs } from "../../utils/format";

describe("format utilities", () => {
  it("formats dates for both supported locales", () => {
    const value = "2026-06-21T08:30:00Z";
    expect(formatDate(value, "en")).toMatch(/06|21/);
    expect(formatDate(value, "zh")).toMatch(/06|21/);
  });

  it("formats missing, millisecond, and second durations", () => {
    expect(formatMs()).toBe("-");
    expect(formatMs(320.4)).toBe("320ms");
    expect(formatMs(1250)).toBe("1.3s");
  });
});
