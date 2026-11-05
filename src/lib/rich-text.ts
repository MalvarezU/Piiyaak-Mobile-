/**
 * Parser puro (sin imports de React Native) para el HTML sanitizado de los
 * bloques de texto de lecciones.
 *
 * Tags permitidos (allowlist del servidor, ver lesson-html.ts):
 *   p, h1, h2, h3, ul, li, strong, em, br, span, b, i
 * Sin atributos. Cualquier tag desconocido se trata como texto plano.
 *
 * El parser es tolerante: input malformado (tags sin cerrar, anidamiento
 * raro) se degrada a texto plano en vez de crashear. Límite 40 000 chars
 * (maxHtml del contrato).
 */

export const RICH_TEXT_MAX = 40_000;

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] };

export type BlockNode =
  | { type: "p"; children: InlineNode[] }
  | { type: "h1"; children: InlineNode[] }
  | { type: "h2"; children: InlineNode[] }
  | { type: "h3"; children: InlineNode[] }
  | { type: "ul"; items: InlineNode[][] }
  | { type: "br" };

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "ul", "br"]);

/**
 * Parsea el HTML y devuelve la lista de bloques.
 */
export function parseRichText(html: string): BlockNode[] {
  if (!html) return [];
  const input = html.length > RICH_TEXT_MAX ? html.slice(0, RICH_TEXT_MAX) : html;

  const blocks: BlockNode[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    // skip whitespace between blocks
    while (i < len && /\s/.test(input[i]!)) i++;
    if (i >= len) break;

    if (input[i] !== "<") {
      // bare text → paragraph
      const end = indexOfTag(input, i);
      const text = input.slice(i, end).trim();
      if (text) blocks.push({ type: "p", children: parseInline(text) });
      i = end;
      continue;
    }

    // parse tag
    const tagMatch = input.slice(i).match(/^<\/?([a-z0-9]+)\b[^>]*>/i);
    if (!tagMatch) {
      // not a valid tag, treat as text
      const end = indexOfTag(input, i);
      const text = input.slice(i, end).trim();
      if (text) blocks.push({ type: "p", children: parseInline(text) });
      i = end;
      continue;
    }

    const fullTag = tagMatch[0]!;
    const tagName = tagMatch[1]!.toLowerCase();
    const isClosing = fullTag.startsWith("</");
    const selfClosing = fullTag.endsWith("/>") || tagName === "br";

    if (isClosing) {
      // stray closing tag, skip
      i += fullTag.length;
      continue;
    }

    if (tagName === "br") {
      blocks.push({ type: "br" });
      i += fullTag.length;
      continue;
    }

    if (!BLOCK_TAGS.has(tagName)) {
      // unknown tag → skip the tag, keep inner as text
      i += fullTag.length;
      continue;
    }

    // find matching closing tag (depth 1 for simplicity)
    const closeTag = `</${tagName}>`;
    const closeIdx = input.toLowerCase().indexOf(closeTag, i + fullTag.length);
    const inner =
      closeIdx === -1
        ? input.slice(i + fullTag.length)
        : input.slice(i + fullTag.length, closeIdx);
    const consumed = closeIdx === -1 ? len - i : closeIdx + closeTag.length;

    if (tagName === "ul") {
      // parse <li> items
      const items = parseListItems(inner);
      blocks.push({ type: "ul", items });
    } else if (tagName === "h1") {
      blocks.push({ type: "h1", children: parseInline(inner) });
    } else if (tagName === "h2") {
      blocks.push({ type: "h2", children: parseInline(inner) });
    } else if (tagName === "h3") {
      blocks.push({ type: "h3", children: parseInline(inner) });
    } else {
      blocks.push({ type: "p", children: parseInline(inner) });
    }

    i += consumed;
  }

  return blocks;
}

function indexOfTag(input: string, from: number): number {
  const idx = input.indexOf("<", from);
  return idx === -1 ? input.length : idx;
}

function parseListItems(inner: string): InlineNode[][] {
  const items: InlineNode[][] = [];
  let i = 0;
  const len = inner.length;
  while (i < len) {
    while (i < len && /\s/.test(inner[i]!)) i++;
    if (i >= len) break;
    if (!inner.slice(i).toLowerCase().startsWith("<li")) {
      // stray text, skip until next <li or end
      const next = inner.toLowerCase().indexOf("<li", i);
      if (next === -1) break;
      i = next;
      continue;
    }
    const tagMatch = inner.slice(i).match(/^<li\b[^>]*>/i);
    if (!tagMatch) {
      i++;
      continue;
    }
    const fullTag = tagMatch[0]!;
    const closeIdx = inner.toLowerCase().indexOf("</li>", i + fullTag.length);
    const itemInner =
      closeIdx === -1
        ? inner.slice(i + fullTag.length)
        : inner.slice(i + fullTag.length, closeIdx);
    items.push(parseInline(itemInner));
    i = closeIdx === -1 ? len : closeIdx + "</li>".length;
  }
  return items;
}

/**
 * Parse inline content: text with bold/italic/span/br.
 * Handles one level of nesting (bold inside italic, etc.).
 */
export function parseInline(input: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    if (input[i] !== "<") {
      // text until next tag
      const end = input.indexOf("<", i);
      const slice = end === -1 ? input.slice(i) : input.slice(i, end);
      if (slice.trim() || slice.includes(" ")) {
        // preserve internal spaces, trim trailing
        nodes.push({ type: "text", text: slice });
      }
      i = end === -1 ? len : end;
      continue;
    }

    const tagMatch = input.slice(i).match(/^<\/?([a-z0-9]+)\b[^>]*>/i);
    if (!tagMatch) {
      // not a tag, treat as text
      nodes.push({ type: "text", text: input[i]! });
      i++;
      continue;
    }

    const fullTag = tagMatch[0]!;
    const tagName = tagMatch[1]!.toLowerCase();
    const isClosing = fullTag.startsWith("</");

    if (isClosing) {
      // stray closing, skip
      i += fullTag.length;
      continue;
    }

    if (tagName === "br") {
      nodes.push({ type: "text", text: "\n" });
      i += fullTag.length;
      continue;
    }

    if (tagName === "strong" || tagName === "b") {
      const closeTag = `</${tagName === "b" ? "b" : "strong"}>`;
      // also accept </strong> for <b> and vice versa
      const altClose = tagName === "b" ? "</strong>" : "</b>";
      let closeIdx = input.toLowerCase().indexOf(closeTag, i + fullTag.length);
      let closeLen = closeTag.length;
      if (closeIdx === -1) {
        closeIdx = input.toLowerCase().indexOf(altClose, i + fullTag.length);
        closeLen = altClose.length;
      }
      const inner =
        closeIdx === -1
          ? input.slice(i + fullTag.length)
          : input.slice(i + fullTag.length, closeIdx);
      nodes.push({ type: "bold", children: parseInline(inner) });
      i = closeIdx === -1 ? len : closeIdx + closeLen;
      continue;
    }

    if (tagName === "em" || tagName === "i") {
      const closeTag = `</${tagName === "i" ? "i" : "em"}>`;
      const altClose = tagName === "i" ? "</em>" : "</i>";
      let closeIdx = input.toLowerCase().indexOf(closeTag, i + fullTag.length);
      let closeLen = closeTag.length;
      if (closeIdx === -1) {
        closeIdx = input.toLowerCase().indexOf(altClose, i + fullTag.length);
        closeLen = altClose.length;
      }
      const inner =
        closeIdx === -1
          ? input.slice(i + fullTag.length)
          : input.slice(i + fullTag.length, closeIdx);
      nodes.push({ type: "italic", children: parseInline(inner) });
      i = closeIdx === -1 ? len : closeIdx + closeLen;
      continue;
    }

    if (tagName === "span") {
      // span without attributes → treat inner as inline (recurse)
      const closeIdx = input.toLowerCase().indexOf("</span>", i + fullTag.length);
      const inner =
        closeIdx === -1
          ? input.slice(i + fullTag.length)
          : input.slice(i + fullTag.length, closeIdx);
      nodes.push(...parseInline(inner));
      i = closeIdx === -1 ? len : closeIdx + "</span>".length;
      continue;
    }

    // unknown inline tag → skip the tag
    i += fullTag.length;
  }

  return nodes;
}

/**
 * Helper: convierte InlineNode[] a string plano (para tests / fallback).
 */
export function inlineToText(nodes: InlineNode[]): string {
  return nodes
    .map((n) => (n.type === "text" ? n.text : inlineToText(n.children)))
    .join("");
}