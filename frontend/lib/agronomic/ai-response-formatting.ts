export type FormattedAiTextBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

const URL_LIKE_KEYS = new Set([
  "url",
  "image_url",
  "file_url",
  "report_url",
  "soil_analysis_url",
  "imageUrl",
  "fileUrl",
  "reportUrl",
  "soilAnalysisUrl",
]);

function normalizeInlineSpacing(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?]){2,}/g, "$1")
    .replace(/\s+\)/g, ")")
    .replace(/\(\s+/g, "(")
    .trim();
}

export function normalizeAiResponseText(value?: string | null) {
  if (!value) return "";

  return value
    .replace(/\r\n?/g, "\n")
    .replace(/(^|\n)[ \t]*[—–][ \t]+/g, "$1- ")
    .replace(/[ \t]*[—–][ \t]*/g, ": ")
    .replace(/[ \t]*-{2,}[ \t]*/g, ". ")
    .split("\n")
    .map((line) => normalizeInlineSpacing(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/:[ \t]*:/g, ":")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function normalizeAiTextFields<T>(value: T, key?: string): T {
  if (typeof value === "string") {
    return (URL_LIKE_KEYS.has(key ?? "") ? value : normalizeAiResponseText(value)) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeAiTextFields(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        normalizeAiTextFields(entryValue, entryKey),
      ]),
    ) as T;
  }

  return value;
}

function isHeadingLine(line: string) {
  if (line.length > 96) return false;
  if (/^#{1,6}\s+/.test(line)) return true;
  return line.endsWith(":") && !/^https?:\/\//i.test(line);
}

function cleanMarkdownDecorations(line: string) {
  return normalizeAiResponseText(line)
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^__(.+)__$/, "$1")
    .trim();
}

export function splitAiResponseIntoBlocks(value?: string | null): FormattedAiTextBlock[] {
  const normalized = normalizeAiResponseText(value);
  if (!normalized) return [];

  const blocks: FormattedAiTextBlock[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const text = paragraphLines.map(cleanMarkdownDecorations).filter(Boolean).join(" ");
    if (text) blocks.push({ type: "paragraph", text });
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push({ type: "list", items: listItems });
    listItems = [];
  };

  for (const rawLine of normalized.split("\n")) {
    const line = cleanMarkdownDecorations(rawLine);

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const bulletMatch = line.match(/^(?:[-*•]\s+|\d+[.)]\s+)(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      listItems.push(cleanMarkdownDecorations(bulletMatch[1]));
      continue;
    }

    if (isHeadingLine(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", text: line.replace(/:$/, "") });
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}
