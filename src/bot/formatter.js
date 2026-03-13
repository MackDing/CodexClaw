const THINK_BLOCK_REGEX = /<think>([\s\S]*?)<\/think>/gi;
const TELEGRAM_SPECIAL_REGEX = /[_*[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMarkdownV2(input = "") {
  return String(input).replace(TELEGRAM_SPECIAL_REGEX, "\\$&");
}

export function extractReasoning(raw = "") {
  const source = String(raw);
  const blocks = [];

  const cleanText = source.replace(THINK_BLOCK_REGEX, (_, content) => {
    const trimmed = String(content || "").trim();
    if (trimmed) blocks.push(trimmed);
    return "";
  });

  return {
    cleanText: cleanText.trim(),
    reasoningBlocks: blocks
  };
}

function renderReasoningBlock(content, mode = "spoiler") {
  const escaped = escapeMarkdownV2(content);
  if (mode === "quote") {
    const lines = escaped.split("\n").map((line) => `> ${line || " "}`);
    return lines.join("\n");
  }

  const segments = [];
  let remaining = escaped;
  const segmentLength = 1200;

  while (remaining.length > segmentLength) {
    segments.push(remaining.slice(0, segmentLength));
    remaining = remaining.slice(segmentLength);
  }
  if (remaining) segments.push(remaining);

  return segments.map((segment) => `||${segment}||`).join("\n");
}

export function formatPtyOutput(raw, options = {}) {
  const { mode = "spoiler" } = options;
  const { cleanText, reasoningBlocks } = extractReasoning(raw);
  const sections = [];

  if (cleanText) {
    sections.push(escapeMarkdownV2(cleanText));
  }

  if (reasoningBlocks.length) {
    const title = escapeMarkdownV2("Reasoning Stream (tap to expand):");
    const rendered = reasoningBlocks.map((block) => renderReasoningBlock(block, mode));
    sections.push([title, ...rendered].join("\n"));
  }

  if (!sections.length) {
    return escapeMarkdownV2("(waiting for output...)");
  }

  return sections.join("\n\n");
}

export function splitTelegramMessage(markdownText, maxLength = 3900) {
  const text = String(markdownText ?? "");
  if (!text) return [escapeMarkdownV2("(empty output)")];
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let current = "";

  for (const line of text.split("\n")) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (line.length <= maxLength) {
      current = line;
      continue;
    }

    let remaining = line;
    while (remaining.length > maxLength) {
      let cut = maxLength;
      while (cut > 0 && remaining[cut - 1] === "\\") {
        cut -= 1;
      }
      if (cut === 0) cut = maxLength;

      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut);
    }
    current = remaining;
  }

  if (current) chunks.push(current);
  return chunks;
}
