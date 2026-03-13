export function extractCommandPayload(
  rawText = "",
  commandName: string
): string {
  const pattern = new RegExp(`^\\/${commandName}(?:@\\w+)?\\s*`, "i");
  return String(rawText).replace(pattern, "").trim();
}

function levenshteinDistance(a: string, b: string): number {
  const left = String(a);
  const right = String(b);
  const dp = Array.from({ length: left.length + 1 }, () =>
    new Array(right.length + 1).fill(0)
  );

  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[left.length][right.length];
}

export function suggestClosestWord(
  input: string,
  candidates: Iterable<string | null | undefined>,
  maxDistance = 2
): string {
  const normalizedInput = String(input || "")
    .trim()
    .toLowerCase();
  if (!normalizedInput) return "";

  let best = "";
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const normalizedCandidate = String(candidate || "")
      .trim()
      .toLowerCase();
    if (!normalizedCandidate) continue;

    const distance = levenshteinDistance(normalizedInput, normalizedCandidate);
    if (distance < bestDistance) {
      best = normalizedCandidate;
      bestDistance = distance;
    }
  }

  return bestDistance <= maxDistance ? best : "";
}

export function buildPlanPrompt(task: string): string {
  return [
    "Planning mode only.",
    "Analyze the request and respond with a concise execution plan.",
    "Do not modify files.",
    "Do not run write commands.",
    "Do not claim you already made changes.",
    "",
    "Task:",
    task
  ].join("\n");
}
