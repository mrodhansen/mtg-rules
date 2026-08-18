import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Chunk, ChunkKind, Corpus } from "./types.js";
import { extractRuleRefs, fixMojibake, slug } from "./text.js";

const RULE_NUMBERED = /^(\d{3}\.\d+)\.\s+(.*)$/;
const RULE_LETTER = /^(\d{3}\.\d+[a-z])\s+(.*)$/;
const SECTION = /^(\d{3})\.\s+(.+)$/;
const EFFECTIVE = /These rules are effective as of ([^.]+)\./;

const REQUIRED_IDS = ["100.1", "100.1a", "302.6", "701.5a"] as const;

export function parseRulesFile(path: string): Corpus {
  const raw = readFileSync(path, "utf8");
  return parseRulesText(fixMojibake(raw), path);
}

export function defaultRulesPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "mtg-rules.txt");
}

export function parseRulesText(text: string, source = "mtg-rules.txt"): Corpus {
  const glossaryAt = text.lastIndexOf("\nGlossary\n");
  if (glossaryAt < 0) {
    throw new Error(`${source}: missing Glossary section`);
  }
  const rulesBlock = text.slice(0, glossaryAt);
  const glossaryBlock = text.slice(glossaryAt + "\nGlossary\n".length);
  const start = rulesBlock.lastIndexOf("\n100. General");
  if (start < 0) {
    throw new Error(`${source}: missing start of rules (100. General)`);
  }

  const effective = text.match(EFFECTIVE)?.[1]?.trim();
  if (!effective) {
    throw new Error(`${source}: missing effective date`);
  }

  const chunks: Chunk[] = [];
  const seen = new Set<string>();
  let section = "";

  const push = (
    id: string,
    kind: ChunkKind,
    title: string,
    body: string,
    sec: string
  ): void => {
    if (seen.has(id)) {
      throw new Error(`${source}: duplicate chunk id ${id}`);
    }
    seen.add(id);
    const textBody = body.replace(/\s+/g, " ").trim();
    if (!textBody) {
      throw new Error(`${source}: empty chunk ${id}`);
    }
    chunks.push({
      id,
      kind,
      title,
      text: textBody,
      seeAlso: extractRuleRefs(textBody),
      section: sec,
    });
  };

  let current: { id: string; kind: ChunkKind; title: string; lines: string[] } | null =
    null;

  const flush = (): void => {
    if (!current) return;
    push(current.id, current.kind, current.title, current.lines.join("\n"), section);
    current = null;
  };

  for (const line of rulesBlock.slice(start + 1).split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^[1-9]\. [A-Z]/.test(trimmed) && !RULE_NUMBERED.test(trimmed)) {
      flush();
      continue;
    }

    const sectionMatch = trimmed.match(SECTION);
    if (sectionMatch && !trimmed.match(RULE_NUMBERED)) {
      flush();
      const id = sectionMatch[1];
      const title = sectionMatch[2];
      if (!id || !title) {
        throw new Error(`${source}: malformed section line: ${trimmed}`);
      }
      section = id;
      push(id, "section", `${id}. ${title}`, `${id}. ${title}`, id);
      continue;
    }

    const numbered = trimmed.match(RULE_NUMBERED);
    if (numbered) {
      flush();
      const id = numbered[1];
      const rest = numbered[2];
      if (!id || rest === undefined) {
        throw new Error(`${source}: malformed rule: ${trimmed}`);
      }
      section = id.split(".")[0] ?? section;
      current = { id, kind: "rule", title: id, lines: [`${id}. ${rest}`] };
      continue;
    }

    const letter = trimmed.match(RULE_LETTER);
    if (letter) {
      flush();
      const id = letter[1];
      const rest = letter[2];
      if (!id || rest === undefined) {
        throw new Error(`${source}: malformed subrule: ${trimmed}`);
      }
      section = id.split(".")[0] ?? section;
      current = { id, kind: "rule", title: id, lines: [`${id} ${rest}`] };
      continue;
    }

    if (current) {
      current.lines.push(trimmed);
      continue;
    }
    throw new Error(`${source}: orphan line before any rule: ${trimmed}`);
  }
  flush();

  parseGlossary(glossaryBlock, chunks, seen, source);

  const byId = new Map<string, Chunk>();
  for (const chunk of chunks) {
    byId.set(chunk.id, chunk);
  }

  for (const id of REQUIRED_IDS) {
    if (!byId.has(id)) {
      throw new Error(`${source}: missing required rule ${id}`);
    }
  }
  const ruleCount = chunks.filter((c) => c.kind === "rule").length;
  if (ruleCount < 2500) {
    throw new Error(`${source}: expected >= 2500 rules, parsed ${ruleCount}`);
  }
  const glossaryCount = chunks.filter((c) => c.kind === "glossary").length;
  if (glossaryCount < 400) {
    throw new Error(`${source}: expected >= 400 glossary terms, parsed ${glossaryCount}`);
  }

  return { effectiveDate: effective, chunks, byId };
}

function parseGlossary(
  block: string,
  chunks: Chunk[],
  seen: Set<string>,
  source: string
): void {
  const credits = block.search(/\nCredits\n/);
  const body = credits >= 0 ? block.slice(0, credits) : block;
  const lines = body.split(/\n/);
  let term: string | null = null;
  let def: string[] = [];

  const flush = (): void => {
    if (!term) return;
    const text = def.join("\n").replace(/\s+/g, " ").trim();
    if (!text) {
      throw new Error(`${source}: empty glossary entry ${term}`);
    }
    const id = `g:${slug(term)}`;
    if (seen.has(id)) {
      throw new Error(`${source}: duplicate glossary id ${id}`);
    }
    seen.add(id);
    chunks.push({
      id,
      kind: "glossary",
      title: term,
      text: `${term}: ${text}`,
      seeAlso: extractRuleRefs(text),
      section: "glossary",
    });
    term = null;
    def = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (term === null) {
      term = trimmed;
      continue;
    }
    def.push(trimmed);
  }
  flush();
}
