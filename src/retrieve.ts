import MiniSearch from "minisearch";
import type { Chunk, Corpus, Hit } from "./types.js";
import { aliasesFor } from "./aliases.js";
import { isRuleChild, normalizeRuleId } from "./text.js";

const RULE_ID_IN_QUERY = /\b(\d{3}(?:\.\d+[a-z]?)?)\b/g;

export class Retriever {
  private readonly corpus: Corpus;
  private readonly index: MiniSearch<Chunk>;

  constructor(corpus: Corpus) {
    this.corpus = corpus;
    this.index = new MiniSearch<Chunk>({
      fields: ["id", "title", "text"],
      storeFields: ["id"],
      idField: "id",
      searchOptions: {
        boost: { id: 8, title: 4, text: 1 },
        fuzzy: 0.15,
        prefix: true,
      },
    });
    this.index.addAll(corpus.chunks);
  }

  private collect(id: string): Chunk[] {
    return this.corpus.chunks.filter(
      (c) => c.kind !== "glossary" && isRuleChild(id, c.id)
    );
  }

  getExact(idRaw: string): Chunk {
    const id = normalizeRuleId(idRaw);
    const chunk = this.corpus.byId.get(id);
    if (!chunk || chunk.kind === "glossary") {
      throw new Error(`No rule ${id}`);
    }
    return chunk;
  }

  getRule(idRaw: string): Chunk[] {
    const id = normalizeRuleId(idRaw);
    const matches = this.collect(id);
    if (matches.length === 0) {
      throw new Error(`No rule ${id}`);
    }
    if (matches.length > 50) {
      const sample = matches
        .slice(0, 20)
        .map((c) => c.id)
        .join(", ");
      throw new Error(
        `Rule ${id} has ${matches.length} children; request a more specific id (e.g. ${sample})`
      );
    }
    return matches;
  }

  getGlossary(term: string): Chunk {
    const q = term.trim().toLowerCase();
    if (!q) {
      throw new Error("Glossary term is required");
    }
    const exact = this.corpus.chunks.find(
      (c) => c.kind === "glossary" && c.title.toLowerCase() === q
    );
    if (exact) return exact;
    const partial = this.corpus.chunks.filter(
      (c) => c.kind === "glossary" && c.title.toLowerCase().includes(q)
    );
    if (partial.length === 1) {
      const hit = partial[0];
      if (!hit) {
        throw new Error(`Glossary term not found: ${term}`);
      }
      return hit;
    }
    if (partial.length > 1) {
      const titles = partial.map((c) => c.title).join(", ");
      throw new Error(`Ambiguous glossary term ${JSON.stringify(term)}: ${titles}`);
    }
    throw new Error(`Glossary term not found: ${term}`);
  }

  search(query: string, k = 8): Hit[] {
    const q = query.trim();
    if (!q) {
      throw new Error("Search query is required");
    }
    const merged = new Map<string, Hit>();

    const add = (chunk: Chunk, score: number, source: Hit["source"]): void => {
      const prev = merged.get(chunk.id);
      if (!prev || score > prev.score) {
        merged.set(chunk.id, { chunk, score, source });
      }
    };

    for (const match of q.matchAll(RULE_ID_IN_QUERY)) {
      const raw = match[1];
      if (!raw || !/^\d{3}(?:\.\d+[a-z]?)?$/.test(raw)) continue;
      const found = this.collect(raw).slice(0, 20);
      for (const chunk of found) add(chunk, 100, "exact");
    }

    for (const chunk of this.corpus.chunks) {
      if (chunk.kind === "glossary" && q.toLowerCase().includes(chunk.title.toLowerCase())) {
        add(chunk, 80, "glossary");
      }
    }

    for (const alias of aliasesFor(q)) {
      for (const ruleId of alias.ruleIds) {
        for (const chunk of this.collect(ruleId).slice(0, 20)) {
          add(chunk, 90, "alias");
        }
      }
      for (const extra of alias.extraQueries) {
        for (const result of this.index.search(extra, { prefix: true })) {
          const chunk = this.corpus.byId.get(String(result.id));
          if (chunk) add(chunk, result.score, "alias");
        }
      }
    }

    for (const result of this.index.search(q)) {
      const chunk = this.corpus.byId.get(String(result.id));
      if (chunk) add(chunk, result.score, "bm25");
    }

    const primary = [...merged.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    for (const hit of [...primary]) {
      for (const ref of hit.chunk.seeAlso) {
        const chunk = this.corpus.byId.get(ref);
        if (chunk && !merged.has(chunk.id)) {
          merged.set(chunk.id, { chunk, score: hit.score * 0.5, source: "see-also" });
        }
      }
    }

    return [...merged.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(k, 12));
  }
}
