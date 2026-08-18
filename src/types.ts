export type ChunkKind = "rule" | "section" | "glossary";

export interface Chunk {
  id: string;
  kind: ChunkKind;
  title: string;
  text: string;
  seeAlso: string[];
  section: string;
}

export interface Corpus {
  effectiveDate: string;
  chunks: Chunk[];
  byId: Map<string, Chunk>;
}

export interface Hit {
  chunk: Chunk;
  score: number;
  source: "exact" | "glossary" | "alias" | "bm25" | "see-also";
}

export interface CardFace {
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  imageUri: string | null;
}

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
  faces: CardFace[];
  scryfallUri: string;
  imageUri: string | null;
  imageUriBack: string | null;
}

export interface CardRuling {
  source: string;
  publishedAt: string;
  comment: string;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AskRequest {
  question: string;
  cards: string[];
  history: ChatTurn[];
}

export interface AskResponse {
  answer: string;
  citations: string[];
  cards: string[];
  resolved: Card[];
  rules: Record<string, string>;
  steps: number;
}

export interface SearchResponse {
  hits: Array<{
    id: string;
    kind: ChunkKind;
    title: string;
    text: string;
    score: number;
    source: Hit["source"];
  }>;
}
