const THINK_BLOCK_REGEX = /<think>([\s\S]*?)<\/think>/gi;
const TELEGRAM_SPECIAL_REGEX = /[_*[\]()~`>#+\-=|{}.!\\]/g;
const CODEX_DIVIDER = "\n--------\n";
const CODEX_TRANSCRIPT_HEADER_REGEX = /^OpenAI Codex v[^\n]*\n/;

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

function removeCodexBanner(raw = "") {
  const source = String(raw || "").replace(/\r/g, "");
  if (!CODEX_TRANSCRIPT_HEADER_REGEX.test(source)) return source;

  const firstDividerIndex = source.indexOf(CODEX_DIVIDER);
  if (firstDividerIndex === -1) return source;

  const secondDividerIndex = source.indexOf(
    CODEX_DIVIDER,
    firstDividerIndex + CODEX_DIVIDER.length
  );
  if (secondDividerIndex === -1) return source;

  return source.slice(secondDividerIndex + CODEX_DIVIDER.length);
}

export function extractCodexExecResponse(raw = "") {
  const source = removeCodexBanner(raw);
  if (!source) return "";

  const blocks = [];
  let section = null;
  let currentCodexLines = [];
  let skipNextNonEmptyLine = false;

  const flushCodexBlock = () => {
    if (!currentCodexLines.length) return;

    const content = currentCodexLines.join("\n").trim();
    if (content) blocks.push(content);
    currentCodexLines = [];
  };

  for (const line of source.split("\n")) {
    const trimmed = line.trim();

    if (skipNextNonEmptyLine) {
      if (trimmed) {
        skipNextNonEmptyLine = false;
      }
      continue;
    }

    if (trimmed === "tokens used") {
      flushCodexBlock();
      break;
    }

    if (/^mcp startup:/i.test(trimmed)) {
      continue;
    }

    if (trimmed === "user") {
      flushCodexBlock();
      section = "user";
      continue;
    }

    if (trimmed === "codex") {
      flushCodexBlock();
      section = "codex";
      continue;
    }

    if (trimmed === "exec") {
      flushCodexBlock();
      section = "exec";
      continue;
    }

    if (trimmed === "tokens" || trimmed === "token usage") {
      flushCodexBlock();
      break;
    }

    if (/^[\d,]+$/.test(trimmed) && section !== "codex") {
      continue;
    }

    if (section === "codex") {
      currentCodexLines.push(line);
      continue;
    }

    if (/^tokens used\b/i.test(trimmed)) {
      flushCodexBlock();
      skipNextNonEmptyLine = true;
      continue;
    }
  }

  flushCodexBlock();
  return blocks.at(-1) || "";
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
  const { mode = "spoiler", sessionMode = "pty" } = options;
  const normalizedRaw =
    sessionMode === "exec" ? extractCodexExecResponse(raw) : String(raw || "");
  const { cleanText, reasoningBlocks } = extractReasoning(normalizedRaw);
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
