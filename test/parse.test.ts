import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultRulesPath, parseRulesFile, parseRulesText } from "../src/parse.js";
import { Retriever } from "../src/retrieve.js";
import { fixMojibake } from "../src/text.js";

describe("fixMojibake", () => {
  it("repairs CR curly quotes and registered mark", () => {
    assert.equal(fixMojibake("canâ€™t"), "can't");
    assert.equal(fixMojibake("GatheringÂ®"), "Gathering®");
    assert.equal(fixMojibake("â€œsummoning sicknessâ€"), '"summoning sickness"');
  });
});

describe("parseRulesFile", () => {
  const corpus = parseRulesFile(defaultRulesPath());

  it("parses a full CR with required rules", () => {
    assert.ok(corpus.chunks.filter((c) => c.kind === "rule").length >= 2500);
    assert.ok(corpus.chunks.filter((c) => c.kind === "glossary").length >= 400);
    assert.ok(corpus.byId.has("100.1"));
    assert.ok(corpus.byId.has("100.1a"));
    assert.ok(corpus.byId.has("302.6"));
  });

  it("does not leave mojibake in 302.6", () => {
    const rule = corpus.byId.get("302.6");
    if (!rule) throw new Error("missing 302.6");
    assert.equal(rule.text.includes("â€™"), false);
    assert.match(rule.text, /summoning sickness/);
  });

  it("fails on a document with no glossary", () => {
    assert.throws(() => parseRulesText("100. General\n\n100.1. Hi.\n", "x"), /missing Glossary/);
  });
});

describe("Retriever", () => {
  const retriever = new Retriever(parseRulesFile(defaultRulesPath()));

  it("fetches 302.6 exactly", () => {
    const rules = retriever.getRule("302.6");
    assert.equal(rules[0]?.id, "302.6");
  });

  it("maps summoning sickness slang to 302.6", () => {
    const ids = retriever.search("summoning sickness").map((h) => h.chunk.id);
    assert.ok(ids.includes("302.6"));
  });

  it("rejects unknown glossary terms", () => {
    assert.throws(() => retriever.getGlossary("not-a-real-term-xyz"), /not found/);
  });

  it("rejects empty search", () => {
    assert.throws(() => retriever.search("  "), /required/);
  });

  it("returns a single exact rule object", () => {
    const rule = retriever.getExact("100.1");
    assert.equal(rule.id, "100.1");
    assert.match(rule.text, /two or more players/);
  });
});
