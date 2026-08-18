import { z } from "zod";
import type { Card, CardFace, CardRuling } from "./types.js";

const SCRYFALL = "https://api.scryfall.com";
const USER_AGENT = "mtg-rules-rag/1.0 (local CLI; Scryfall polite client)";

const ImageUrisSchema = z.object({
  normal: z.string(),
  large: z.string().optional(),
});

const FaceSchema = z.object({
  name: z.string(),
  mana_cost: z.string().optional(),
  type_line: z.string().optional(),
  oracle_text: z.string().optional(),
  power: z.string().nullable().optional(),
  toughness: z.string().nullable().optional(),
  loyalty: z.string().nullable().optional(),
  defense: z.string().nullable().optional(),
  image_uris: ImageUrisSchema.optional(),
});

const CardSchema = z.object({
  object: z.literal("card"),
  id: z.string(),
  name: z.string(),
  mana_cost: z.string().optional(),
  cmc: z.number(),
  type_line: z.string(),
  oracle_text: z.string().optional(),
  power: z.string().nullable().optional(),
  toughness: z.string().nullable().optional(),
  loyalty: z.string().nullable().optional(),
  defense: z.string().nullable().optional(),
  keywords: z.array(z.string()),
  layout: z.string(),
  scryfall_uri: z.string(),
  rulings_uri: z.string(),
  image_uris: ImageUrisSchema.optional(),
  card_faces: z.array(FaceSchema).optional(),
});

const ErrorSchema = z.object({
  object: z.literal("error"),
  status: z.number(),
  code: z.string(),
  details: z.string(),
});

const RulingsSchema = z.object({
  object: z.literal("list"),
  data: z.array(
    z.object({
      source: z.string(),
      published_at: z.string(),
      comment: z.string(),
    })
  ),
});

function faceFrom(raw: z.infer<typeof FaceSchema>, fallbackName: string): CardFace {
  return {
    name: raw.name || fallbackName,
    manaCost: raw.mana_cost ?? "",
    typeLine: raw.type_line ?? "",
    oracleText: raw.oracle_text ?? "",
    power: raw.power ?? null,
    toughness: raw.toughness ?? null,
    loyalty: raw.loyalty ?? null,
    defense: raw.defense ?? null,
    imageUri: raw.image_uris?.normal ?? null,
  };
}

function cardFrom(raw: z.infer<typeof CardSchema>): Card {
  const faces = (raw.card_faces ?? []).map((f) => faceFrom(f, raw.name));
  const front =
    raw.image_uris?.normal ?? faces[0]?.imageUri ?? null;
  const back = faces[1]?.imageUri ?? null;
  return {
    id: raw.id,
    name: raw.name,
    manaCost: raw.mana_cost ?? "",
    cmc: raw.cmc,
    typeLine: raw.type_line,
    oracleText: raw.oracle_text ?? faces.map((f) => `${f.name}: ${f.oracleText}`).join("\n"),
    power: raw.power ?? null,
    toughness: raw.toughness ?? null,
    loyalty: raw.loyalty ?? null,
    defense: raw.defense ?? null,
    keywords: raw.keywords,
    layout: raw.layout,
    faces,
    scryfallUri: raw.scryfall_uri,
    imageUri: front,
    imageUriBack: back,
  };
}

async function scryfallGet(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
  });
  const json: unknown = await res.json();
  if (!res.ok) {
    const err = ErrorSchema.safeParse(json);
    if (err.success) {
      throw new Error(`Scryfall ${err.data.status} ${err.data.code}: ${err.data.details}`);
    }
    throw new Error(`Scryfall HTTP ${res.status} for ${url}`);
  }
  return json;
}

const cache = new Map<string, Card>();

export async function lookupCard(name: string, mode: "fuzzy" | "exact" = "fuzzy"): Promise<Card> {
  const q = name.trim();
  if (!q) {
    throw new Error("Card name is required");
  }
  const key = `${mode}:${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const param = mode === "exact" ? "exact" : "fuzzy";
  const url = `${SCRYFALL}/cards/named?${param}=${encodeURIComponent(q)}`;
  const json = await scryfallGet(url);
  const parsed = CardSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Scryfall card payload failed validation: ${parsed.error.message}`);
  }
  const card = cardFrom(parsed.data);
  cache.set(key, card);
  cache.set(`exact:${card.name.toLowerCase()}`, card);
  return card;
}

const STOP = new Set([
  "The",
  "A",
  "An",
  "If",
  "When",
  "See",
  "Rule",
  "Rules",
  "Then",
  "This",
  "That",
  "You",
  "Your",
  "Each",
  "All",
  "And",
  "Or",
  "For",
  "With",
  "From",
  "Into",
  "Onto",
  "Can",
  "Does",
  "Yes",
  "No",
  "Not",
  "But",
]);

function addCandidate(names: Set<string>, raw: string): void {
  const n = raw.trim();
  if (!n || STOP.has(n) || n.length < 3) return;
  names.add(n);
  const words = n.split(/\s+/);
  for (let i = 1; i < words.length; i += 1) {
    const word = words[i];
    if (!word || !/^[A-Z]/.test(word)) continue;
    addCandidate(names, words.slice(i).join(" "));
  }
}

export function extractCardCandidates(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/@\[([^\]]+)\]/g)) {
    if (match[1]) addCandidate(names, match[1]);
  }
  for (const match of text.matchAll(
    /@([A-Z][A-Za-z0-9'/-]*(?:[\s-](?:of|the|to|a|an|[A-Z][A-Za-z0-9'/-]*)){0,5})/g
  )) {
    if (match[1]) addCandidate(names, match[1]);
  }
  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    if (match[1]) addCandidate(names, match[1]);
  }
  for (const match of text.matchAll(/"([^"]{3,80})"/g)) {
    if (match[1]) addCandidate(names, match[1]);
  }
  for (const match of text.matchAll(
    /\b([A-Z][A-Za-z0-9'/-]*(?:[\s-](?:of|the|to|a|an|[A-Z][A-Za-z0-9'/-]*)){0,5})\b/g
  )) {
    const n = match[1]?.trim();
    if (!n || !/[A-Z][a-z]/.test(n)) continue;
    addCandidate(names, n);
  }
  return [...names];
}

export async function scanCards(text: string): Promise<Card[]> {
  const found = new Map<string, Card>();
  for (const name of extractCardCandidates(text)) {
    try {
      const card = await lookupCard(name, "exact");
      found.set(card.id, card);
    } catch {
      continue;
    }
  }
  return [...found.values()];
}

const AutocompleteSchema = z.object({
  object: z.literal("catalog"),
  data: z.array(z.string()),
});

export async function autocompleteCards(query: string): Promise<string[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `${SCRYFALL}/cards/autocomplete?q=${encodeURIComponent(q)}`;
  const json = await scryfallGet(url);
  const parsed = AutocompleteSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Scryfall autocomplete payload failed validation: ${parsed.error.message}`);
  }
  return parsed.data.data;
}

export async function lookupRulings(name: string): Promise<{ card: Card; rulings: CardRuling[] }> {
  const card = await lookupCard(name);
  const url = `${SCRYFALL}/cards/${card.id}/rulings`;
  const json = await scryfallGet(url);
  const parsed = RulingsSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Scryfall rulings payload failed validation: ${parsed.error.message}`);
  }
  return {
    card,
    rulings: parsed.data.data.map((r) => ({
      source: r.source,
      publishedAt: r.published_at,
      comment: r.comment,
    })),
  };
}

export function formatCard(card: Card): string {
  const lines = [
    card.name,
    card.manaCost ? `${card.manaCost}  CMC ${card.cmc}` : `CMC ${card.cmc}`,
    card.typeLine,
  ];
  if (card.oracleText) lines.push(card.oracleText);
  if (card.power !== null && card.toughness !== null) {
    lines.push(`${card.power}/${card.toughness}`);
  }
  if (card.loyalty) lines.push(`Loyalty ${card.loyalty}`);
  if (card.defense) lines.push(`Defense ${card.defense}`);
  if (card.keywords.length) lines.push(`Keywords: ${card.keywords.join(", ")}`);
  lines.push(card.scryfallUri);
  return lines.join("\n");
}
