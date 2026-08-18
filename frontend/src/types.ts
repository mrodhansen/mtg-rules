export interface Card {
  id: string;
  name: string;
  manaCost: string;
  cmc: number;
  typeLine: string;
  oracleText: string;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  keywords: string[];
  layout: string;
  scryfallUri: string;
  imageUri: string | null;
  imageUriBack: string | null;
}

export interface AskResponse {
  answer: string;
  citations: string[];
  cards: string[];
  resolved: Card[];
  rules: Record<string, string>;
  steps: number;
}

export interface RuleEntry {
  id: string;
  text: string;
}

export interface Health {
  ok: true;
  effectiveDate: string;
  rules: number;
  glossary: number;
}

export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  text: string;
}
