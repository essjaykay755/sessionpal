export type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; start?: number; items: string[] }
  | { type: "quote"; text: string }
  | { type: "rule" }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "code"; lang: string; text: string };

const BULLET = /^\s*[-*+]\s+/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

// A small, dependency-free Markdown subset: enough for agent transcripts, and
// everything renders as React text, so nothing in a transcript is ever HTML.
export function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split("\n");
  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; start?: number; items: string[] } | null = null;

  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    if (quote.length) blocks.push({ type: "quote", text: quote.join("\n") });
    if (list) blocks.push({ type: "list", ...list });
    paragraph = [];
    quote = [];
    list = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.trimStart().match(/^(```+|~~~+)\s*([\w+#.-]*)/);
    if (fence) {
      flush();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith(fence[1])) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ type: "code", lang: fence[2] ?? "", text: code.join("\n") });
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ type: "rule" });
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1])) {
      flush();
      const header = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const quoted = line.match(/^\s{0,3}>\s?(.*)$/);
    if (quoted) {
      if (!quote.length) flush();
      quote.push(quoted[1]);
      continue;
    }
    const bullet = BULLET.test(line);
    const numbered = line.match(NUMBERED);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, start: numbered ? Number(numbered[1]) : undefined, items: [] };
      }
      list.items.push(line.replace(ordered ? NUMBERED : BULLET, ""));
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // Continuation of the previous list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (list || quote.length) flush();
    paragraph.push(line);
  }
  flush();
  return blocks;
}
