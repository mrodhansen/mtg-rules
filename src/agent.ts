import type { AskResponse, Card, ChatTurn } from "./types.js";
import type { Retriever } from "./retrieve.js";
import { extractCitedRuleIds } from "./text.js";
import { chat, type ChatMessage, type ToolDef } from "./xai.js";
import { formatCard, lookupCard, lookupRulings, scanCards } from "./scryfall.js";

const MAX_STEPS = 8;

const TOOLS: ToolDef[] = [
  {
    name: "search_rules",
    description: "Search the Comprehensive Rules by natural language or slang.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        k: { type: "integer", minimum: 1, maximum: 16 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_rule",
    description: "Fetch a rule by id (e.g. 302.6 or 702.122) plus its children.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "get_glossary",
    description: "Fetch a Comprehensive Rules glossary entry by term.",
    parameters: {
      type: "object",
      properties: { term: { type: "string" } },
      required: ["term"],
    },
  },
  {
    name: "lookup_card",
    description: "Look up a Magic card on Scryfall by name (fuzzy).",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "lookup_rulings",
    description: "Look up official Scryfall/Wizards rulings for a card by name.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
];

const SYSTEM = `You are a Magic: The Gathering judge for kitchen-table and tournament players.
Interpret what the player is asking, not the most literal parse of their wording.
Players almost always mean "is there a chance to respond on the stack?" — not "can I act during resolution?"
Treat phrasing like "before the counters go on", "before it dies", "before combat damage", or "can someone respond" as questions about priority and the stack unless they clearly ask about the resolution step itself.
Answer that intended question first, with a clear yes/no when possible. Then give the short technical reason and CR cites.
Do not lead with a pedantic "no" that ignores the play they are trying to make. Mention the finer distinction only if it would change the line of play.
Answer ONLY from retrieved CR text, glossary entries, Scryfall oracle text, and official rulings you fetched with tools.
Wrap every Magic card name in double brackets, like [[Lightning Bolt]].
If evidence is missing, call a tool. If tools still do not cover it, say you do not know — never invent a rule.
Card text can override generic rules (CR 101.1); say so when that happens.
Be concise. This is a multi-turn conversation — use earlier turns as context.`;

function formatHits(retriever: Retriever, query: string, k: number): string {
  const hits = retriever.search(query, k);
  if (hits.length === 0) {
    throw new Error(`No rules matched ${JSON.stringify(query)}`);
  }
  return hits
    .map((h) => `[${h.source} ${h.chunk.id}] ${h.chunk.title}\n${h.chunk.text}`)
    .join("\n\n");
}

async function runTool(
  retriever: Retriever,
  name: string,
  argsJson: string
): Promise<string> {
  let args: unknown;
  try {
    args = JSON.parse(argsJson);
  } catch {
    throw new Error(`Invalid tool args JSON for ${name}: ${argsJson}`);
  }
  if (!args || typeof args !== "object") {
    throw new Error(`Tool ${name} args must be an object`);
  }
  const rec = args as Record<string, unknown>;

  switch (name) {
    case "search_rules": {
      if (typeof rec.query !== "string") throw new Error("search_rules.query required");
      const k = typeof rec.k === "number" ? rec.k : 8;
      return formatHits(retriever, rec.query, k);
    }
    case "get_rule": {
      if (typeof rec.id !== "string") throw new Error("get_rule.id required");
      return retriever
        .getRule(rec.id)
        .map((c) => `${c.id}: ${c.text}`)
        .join("\n\n");
    }
    case "get_glossary": {
      if (typeof rec.term !== "string") throw new Error("get_glossary.term required");
      const g = retriever.getGlossary(rec.term);
      return g.text;
    }
    case "lookup_card": {
      if (typeof rec.name !== "string") throw new Error("lookup_card.name required");
      return formatCard(await lookupCard(rec.name));
    }
    case "lookup_rulings": {
      if (typeof rec.name !== "string") throw new Error("lookup_rulings.name required");
      const { card, rulings } = await lookupRulings(rec.name);
      const body =
        rulings.length === 0
          ? "No official rulings."
          : rulings.map((r) => `- (${r.source} ${r.publishedAt}) ${r.comment}`).join("\n");
      return `${formatCard(card)}\n\nRulings:\n${body}`;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function ask(
  retriever: Retriever,
  question: string,
  preloadCards: Card[] = [],
  history: ChatTurn[] = []
): Promise<AskResponse> {
  const q = question.trim();
  if (!q) {
    throw new Error("Question is required");
  }

  const citations = new Set<string>();
  const cards = new Set<string>(preloadCards.map((c) => c.name));
  const resolved = new Map<string, Card>(preloadCards.map((c) => [c.id, c]));

  const prior: ChatMessage[] = history.map((turn) => {
    if (!turn.text.trim()) {
      throw new Error("History turn text is required");
    }
    return { role: turn.role, content: turn.text };
  });

  const latest =
    preloadCards.length > 0
      ? `${q}\n\nPreloaded cards:\n${preloadCards.map(formatCard).join("\n\n")}`
      : q;

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    ...prior,
    { role: "user", content: latest },
  ];

  let steps = 0;
  while (steps < MAX_STEPS) {
    steps += 1;
    const result = await chat(messages, TOOLS);
    if (result.toolCalls.length === 0) {
      const answer = result.content?.trim();
      if (!answer) {
        throw new Error("Model returned an empty answer");
      }
      const scanned = await scanCards(`${q}\n${answer}`);
      for (const card of scanned) {
        resolved.set(card.id, card);
        cards.add(card.name);
      }
      const rules: Record<string, string> = {};
      for (const id of [...citations, ...extractCitedRuleIds(answer)]) {
        try {
          rules[id] = retriever.getExact(id).text;
        } catch {
          continue;
        }
      }
      return {
        answer,
        citations: [...citations],
        cards: [...cards],
        resolved: [...resolved.values()],
        rules,
        steps,
      };
    }

    messages.push({
      role: "assistant",
      content: result.content ?? "",
      tool_calls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      try {
        const out = await runTool(retriever, call.function.name, call.function.arguments);
        if (call.function.name === "lookup_card" || call.function.name === "lookup_rulings") {
          const first = out.split("\n")[0];
          if (first) {
            cards.add(first);
            const looked = await lookupCard(first, "fuzzy");
            resolved.set(looked.id, looked);
          }
        }
        if (call.function.name === "get_rule" || call.function.name === "search_rules") {
          for (const m of out.matchAll(/\[(?:exact|glossary|alias|bm25|see-also) ([^\]]+)\]|^(\d{3}(?:\.\d+[a-z]?)?):/gm)) {
            const id = m[1] ?? m[2];
            if (id) citations.add(id);
          }
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: out });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `ERROR: ${message}`,
        });
      }
    }
  }

  throw new Error(`Agent exceeded ${MAX_STEPS} tool steps without an answer`);
}
