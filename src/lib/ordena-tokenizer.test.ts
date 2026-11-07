import { describe, it, expect } from "vitest";
import { tokenizeOrdena, normalizeOrdenaApos, isOrdenaEligible } from "./ordena-tokenizer";

describe("normalizeOrdenaApos", () => {
  it("replaces curly apostrophes", () => {
    expect(normalizeOrdenaApos("a\u2019b")).toBe("a'b");
    expect(normalizeOrdenaApos("a\u00B4b")).toBe("a'b");
  });
});

describe("tokenizeOrdena", () => {
  it("vocal + apostrophe = one token", () => {
    expect(tokenizeOrdena("a'")).toEqual(["a'"]);
    expect(tokenizeOrdena("e'")).toEqual(["e'"]);
  });

  it("clusters are indivisible", () => {
    expect(tokenizeOrdena("txh")).toEqual(["txh"]);
    expect(tokenizeOrdena("th")).toEqual(["th"]);
    expect(tokenizeOrdena("çx")).toEqual(["çx"]);
  });

  it("preserves case", () => {
    expect(tokenizeOrdena("Txh")).toEqual(["Txh"]);
  });

  it("single letters", () => {
    expect(tokenizeOrdena("abc")).toEqual(["a", "b", "c"]);
  });

  it("mixed", () => {
    const tokens = tokenizeOrdena("a'txh");
    expect(tokens).toEqual(["a'", "txh"]);
  });
});

describe("isOrdenaEligible", () => {
  it("eligible word", () => {
    expect(isOrdenaEligible({ spanish: "hola", nasaYuwe: "txhab" })).toBe(true);
  });

  it("rejects empty spanish", () => {
    expect(isOrdenaEligible({ spanish: "", nasaYuwe: "abc" })).toBe(false);
  });

  it("rejects spaces in nasaYuwe", () => {
    expect(isOrdenaEligible({ spanish: "hola", nasaYuwe: "a b" })).toBe(false);
  });

  it("rejects (Esp marker", () => {
    expect(isOrdenaEligible({ spanish: "hola", nasaYuwe: "abc(Esp" })).toBe(false);
  });

  it("rejects same spanish/nasaYuwe", () => {
    expect(isOrdenaEligible({ spanish: "abc", nasaYuwe: "abc" })).toBe(false);
  });

  it("rejects too few tokens", () => {
    expect(isOrdenaEligible({ spanish: "hola", nasaYuwe: "ab" })).toBe(false);
  });
});