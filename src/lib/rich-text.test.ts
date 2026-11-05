import { describe, it, expect } from "vitest";
import { parseRichText, parseInline, inlineToText } from "./rich-text";

describe("parseRichText", () => {
  it("empty input → empty array", () => {
    expect(parseRichText("")).toEqual([]);
    expect(parseRichText("   ")).toEqual([]);
  });

  it("plain text → paragraph", () => {
    const blocks = parseRichText("Hola mundo");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe("p");
    expect(inlineToText((blocks[0] as { children: any[] }).children)).toBe("Hola mundo");
  });

  it("h1/h2/h3", () => {
    expect(parseRichText("<h1>T</h1>")[0]!.type).toBe("h1");
    expect(parseRichText("<h2>T</h2>")[0]!.type).toBe("h2");
    expect(parseRichText("<h3>T</h3>")[0]!.type).toBe("h3");
  });

  it("bold and italic inline", () => {
    const blocks = parseRichText("<p>un <strong>negrita</strong> y <em>cursiva</em></p>");
    const inlines = (blocks[0] as { children: any[] }).children;
    expect(inlines.some((n) => n.type === "bold")).toBe(true);
    expect(inlines.some((n) => n.type === "italic")).toBe(true);
  });

  it("b/i aliases", () => {
    const blocks = parseRichText("<p><b>b</b> <i>i</i></p>");
    const inlines = (blocks[0] as { children: any[] }).children;
    expect(inlines.some((n) => n.type === "bold")).toBe(true);
    expect(inlines.some((n) => n.type === "italic")).toBe(true);
  });

  it("ul with li", () => {
    const blocks = parseRichText("<ul><li>uno</li><li>dos</li></ul>");
    expect(blocks[0]!.type).toBe("ul");
    expect((blocks[0] as { items: any[] }).items).toHaveLength(2);
  });

  it("br → linebreak", () => {
    const blocks = parseRichText("<p>a<br>b</p>");
    const inlines = (blocks[0] as { children: any[] }).children;
    expect(inlines.some((n) => n.type === "text" && n.text === "\n")).toBe(true);
  });

  it("span → inline (no wrapper)", () => {
    const blocks = parseRichText("<p><span>x</span></p>");
    expect(inlineToText((blocks[0] as { children: any[] }).children)).toBe("x");
  });

  it("unknown tag treated as text (not crash)", () => {
    const blocks = parseRichText("<foo>bar</foo>");
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(inlineToText((blocks[0] as { children: any[] }).children)).toContain("bar");
  });

  it("unclosed tag degrades gracefully", () => {
    const blocks = parseRichText("<p>sin cerrar");
    expect(blocks.length).toBeGreaterThanOrEqual(1);
  });

  it("truncates at max", () => {
    const big = "a".repeat(50_000);
    const blocks = parseRichText(big);
    // Should not crash; produces a paragraph
    expect(blocks.length).toBeGreaterThanOrEqual(1);
  });

  it("nested bold inside italic", () => {
    const blocks = parseRichText("<p><em><strong>x</strong></em></p>");
    const inlines = (blocks[0] as { children: any[] }).children;
    const italic = inlines.find((n) => n.type === "italic");
    expect(italic).toBeDefined();
    expect((italic as { children: any[] }).children.some((n: any) => n.type === "bold")).toBe(true);
  });
});

describe("parseInline", () => {
  it("plain text", () => {
    expect(inlineToText(parseInline("hola"))).toBe("hola");
  });
  it("bold text extraction", () => {
    expect(inlineToText(parseInline("<strong>x</strong>"))).toBe("x");
  });
});