import type { AskResponse, Card, ChatMessage, RuleEntry } from "./types.js";

function apiUrl(path: string): string {
  const root = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "");
  if (root) return `${root}${path}`;
  return `/api${path}`;
}

async function readJson(res: Response): Promise<unknown> {
  const json: unknown = await res.json();
  if (!res.ok) {
    const err = json as { error?: unknown };
    const msg = typeof err.error === "string" ? err.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

export async function ask(
  question: string,
  cards: string[] = [],
  history: ChatMessage[] = []
): Promise<AskResponse> {
  const res = await fetch(apiUrl("/ask"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      cards,
      history: history.map((m) => ({ role: m.role, text: m.text })),
    }),
  });
  return readJson(res) as Promise<AskResponse>;
}

export async function autocomplete(query: string): Promise<string[]> {
  const res = await fetch(apiUrl(`/cards/autocomplete?q=${encodeURIComponent(query)}`));
  const json = (await readJson(res)) as { names: string[] };
  return json.names;
}

export async function scan(text: string): Promise<Card[]> {
  const res = await fetch(apiUrl(`/cards/scan?text=${encodeURIComponent(text)}`));
  const json = (await readJson(res)) as { cards: Card[] };
  return json.cards;
}

export async function fetchCard(name: string): Promise<Card> {
  const res = await fetch(apiUrl(`/card?name=${encodeURIComponent(name)}`));
  const json = (await readJson(res)) as { card: Card };
  return json.card;
}

export async function fetchRule(id: string): Promise<RuleEntry> {
  const res = await fetch(apiUrl(`/rules/${encodeURIComponent(id)}`));
  return readJson(res) as Promise<RuleEntry>;
}
