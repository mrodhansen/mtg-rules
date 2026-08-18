import { readJson, waitForHealth } from "./health.js";
import type { AskResponse, Card, ChatMessage, Health, RuleEntry } from "./types.js";

function apiUrl(path: string): string {
  const root = import.meta.env.VITE_API_URL?.replace(/\/$/, "");
  if (root) return `${root}${path}`;
  return `/api${path}`;
}

let apiReady: Promise<Health> | undefined;

export function waitForApi(): Promise<Health> {
  if (!apiReady) {
    apiReady = waitForHealth(apiUrl("/health"));
  }
  return apiReady;
}

export async function ask(
  question: string,
  cards: string[] = [],
  history: ChatMessage[] = []
): Promise<AskResponse> {
  await waitForApi();
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
  await waitForApi();
  const res = await fetch(apiUrl(`/cards/autocomplete?q=${encodeURIComponent(query)}`));
  const json = (await readJson(res)) as { names: string[] };
  return json.names;
}

export async function scan(text: string): Promise<Card[]> {
  await waitForApi();
  const res = await fetch(apiUrl(`/cards/scan?text=${encodeURIComponent(text)}`));
  const json = (await readJson(res)) as { cards: Card[] };
  return json.cards;
}

export async function fetchCard(name: string): Promise<Card> {
  await waitForApi();
  const res = await fetch(apiUrl(`/card?name=${encodeURIComponent(name)}`));
  const json = (await readJson(res)) as { card: Card };
  return json.card;
}

export async function fetchRule(id: string): Promise<RuleEntry> {
  await waitForApi();
  const res = await fetch(apiUrl(`/rules/${encodeURIComponent(id)}`));
  return readJson(res) as Promise<RuleEntry>;
}
