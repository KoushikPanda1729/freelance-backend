// Common abbreviations seen in Indian address entry that should collapse to one canonical token.
const ABBREVIATIONS: Record<string, string> = {
  sec: "sector",
  st: "street",
  rd: "road",
  ngr: "nagar",
  nr: "nagar",
  soc: "society",
  apt: "apartment",
  appt: "apartment",
  twp: "township",
  ph: "phase",
  blk: "block",
  ext: "extension",
  clny: "colony",
  cly: "colony",
};

/**
 * Normalizes free-text location names for matching:
 * "Sec 62", "Sector-62", "Sector 62" all collapse to "sector62".
 */
export function normalizeKey(raw: string): string {
  if (!raw) return "";
  const lower = raw
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/[-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const expanded = lower
    .split(" ")
    .map((token) => ABBREVIATIONS[token] ?? token)
    .join(" ");

  return expanded.replace(/[^a-z0-9]/g, "");
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/** Similarity in [0, 1], 1 = identical normalized keys. */
export function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Text similarity alone treats "Sector 62" and "Sector 99" as near-identical
 * (same prefix, both 2-digit numbers) even though they are different places.
 * When both normalized keys carry digit groups, only compare them as
 * possible duplicates if those digit groups actually match - otherwise a
 * different sector/phase/block number should never surface as a "duplicate"
 * suggestion, it's simply a new value.
 */
export function numberAwareSimilarity(a: string, b: string): number {
  const numsA = a.match(/\d+/g);
  const numsB = b.match(/\d+/g);
  if (numsA && numsB && numsA.join(",") !== numsB.join(",")) {
    return 0;
  }
  return similarity(a, b);
}
