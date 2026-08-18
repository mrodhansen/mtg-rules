import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractCardCandidates } from "../src/scryfall.js";

describe("extractCardCandidates", () => {
  it("pulls wiki names and title-case phrases", () => {
    const names = extractCardCandidates(
      'Can [[Lightning Bolt]] kill a creature? Also Sol Ring and "Teferi\'s Protection".'
    );
    assert.ok(names.includes("Lightning Bolt"));
    assert.ok(names.includes("Sol Ring"));
    assert.ok(names.includes("Teferi's Protection"));
  });

  it("pulls @mentions", () => {
    const names = extractCardCandidates("Does @[Lightning Bolt] kill @Sol Ring?");
    assert.ok(names.includes("Lightning Bolt"));
    assert.ok(names.includes("Sol Ring"));
  });

  it("skips stop words", () => {
    const names = extractCardCandidates("See Rule 302.6 when The stack resolves.");
    assert.equal(names.includes("See"), false);
    assert.equal(names.includes("The"), false);
  });
});
