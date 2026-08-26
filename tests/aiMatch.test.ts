import { afterEach, describe, expect, it, vi } from "vitest";
import { findAiDuplicateCandidates } from "../src/services/aiMatch.service";

describe("findAiDuplicateCandidates", () => {
  const originalKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it("returns no candidates when no API key is configured (the default for this app)", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await findAiDuplicateCandidates("Rajiv Chowk Metro Area", "AREA", [
      { id: "cp-1", name: "Connaught Place" },
    ]);
    expect(result).toEqual([]);
  });

  it("returns no candidates when there are no siblings to compare against", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    const result = await findAiDuplicateCandidates("Rajiv Chowk Metro Area", "AREA", []);
    expect(result).toEqual([]);
  });

  it("fails open (empty array) if the API call throws", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down")))
    );
    const result = await findAiDuplicateCandidates("Rajiv Chowk Metro Area", "AREA", [
      { id: "cp-1", name: "Connaught Place" },
    ]);
    expect(result).toEqual([]);
  });
});
