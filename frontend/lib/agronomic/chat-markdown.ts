/**
 * Markdown simples das respostas do chat (sem HTML bruto, sem
 * dangerouslySetInnerHTML): parágrafos, títulos, listas com marcador e listas
 * numeradas (a numeração é preservada: "a segunda hipótese" precisa continuar
 * sendo a de número 2 na tela), **negrito** e *itálico*.
 */

export type InlineSegment = { text: string; bold?: boolean; italic?: boolean };

export type ChatMarkdownBlock =
  | { type: "heading"; segments: InlineSegment[] }
  | { type: "paragraph"; segments: InlineSegment[] }
  | { type: "bullets"; items: InlineSegment[][] }
  | { type: "numbered"; start: number; items: InlineSegment[][] };

export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  // Sem lookbehind: Safari antigo (iOS < 16.4) não suporta e quebraria a tela.
  const pattern = /\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\s](?:[^*]*?[^*\s])?)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index) });
    if (match[1] !== undefined || match[2] !== undefined) segments.push({ text: match[1] ?? match[2], bold: true });
    else segments.push({ text: match[3] ?? "", italic: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments.filter((segment) => segment.text.length > 0);
}

export function parseChatMarkdown(value: string | null | undefined): ChatMarkdownBlock[] {
  const text = (value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const blocks: ChatMarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", segments: parseInline(paragraph.join(" ")) });
      paragraph = [];
    }
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", segments: parseInline(heading[1].replace(/\*\*/g, "")) });
      continue;
    }
    const numbered = line.match(/^(\d{1,3})[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      const previous = blocks[blocks.length - 1];
      if (previous?.type === "numbered") previous.items.push(parseInline(numbered[2]));
      else blocks.push({ type: "numbered", start: Number(numbered[1]) || 1, items: [parseInline(numbered[2])] });
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      const previous = blocks[blocks.length - 1];
      if (previous?.type === "bullets") previous.items.push(parseInline(bullet[1]));
      else blocks.push({ type: "bullets", items: [parseInline(bullet[1])] });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}
