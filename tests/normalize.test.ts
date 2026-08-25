import { describe, expect, it } from "vitest";
import { normalizeKey, numberAwareSimilarity, similarity } from "../src/utils/normalize";

describe("normalizeKey", () => {
  it("collapses common variations of the same locality to one key", () => {
    expect(normalizeKey("Sec 62")).toBe("sector62");
    expect(normalizeKey("Sector-62")).toBe("sector62");
    expect(normalizeKey("Sector 62")).toBe("sector62");
  });

  it("is case-insensitive and strips punctuation", () => {
    expect(normalizeKey("DLF Phase-1")).toBe(normalizeKey("dlf phase 1"));
    expect(normalizeKey("D.L.F. Phase 1")).toBe(normalizeKey("DLF Phase 1"));
  });

  it("returns an empty string for empty input", () => {
    expect(normalizeKey("")).toBe("");
  });
});

describe("numberAwareSimilarity", () => {
  it("treats identical keys as a perfect match", () => {
    expect(similarity("sector62", "sector62")).toBe(1);
  });

  it("never suggests a different numbered sector as a duplicate, even if textually close", () => {
    // "Sector 62" and "Sector 99" share a long common prefix but are different places.
    expect(numberAwareSimilarity(normalizeKey("Sector 62"), normalizeKey("Sector 99"))).toBe(0);
    expect(numberAwareSimilarity(normalizeKey("Sector 62"), normalizeKey("Sector 63"))).toBe(0);
  });

  it("still surfaces a genuine spelling typo as a near match when the number matches", () => {
    const score = numberAwareSimilarity(normalizeKey("Sector 62"), normalizeKey("Sctor 62"));
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThan(1);
  });
});
