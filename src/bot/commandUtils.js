export function extractCommandPayload(rawText = "", commandName) {
  const pattern = new RegExp(`^\\/${commandName}(?:@\\w+)?\\s*`, "i");
  return String(rawText).replace(pattern, "").trim();
}

export function buildPlanPrompt(task) {
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
