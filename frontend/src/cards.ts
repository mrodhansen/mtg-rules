import type { Card } from "./types.js";

export type Segment =
  | { kind: "text"; value: string }
  | { kind: "card"; name: string; mark: "at" | "wiki" };

export function indexCards(cards: Card[]): Map<string, Card> {
  const map = new Map<string, Card>();
  for (const card of cards) {
    map.set(card.name.toLowerCase(), card);
  }
  return map;
}

export function segmentText(text: string, known: Map<string, Card>): Segment[] {
  const parts: Array<{ start: number; end: number; name: string; mark: "at" | "wiki" }> = [];

  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const raw = match[1]?.trim();
    if (!raw || match.index === undefined) continue;
    parts.push({ start: match.index, end: match.index + match[0].length, name: raw, mark: "wiki" });
  }

  for (const match of text.matchAll(/@\[([^\]]+)\]/g)) {
    const raw = match[1]?.trim();
    if (!raw || match.index === undefined) continue;
    parts.push({ start: match.index, end: match.index + match[0].length, name: raw, mark: "at" });
  }

  for (const match of text.matchAll(
    /@([A-Z][A-Za-z0-9'/-]*(?:[\s-](?:of|the|to|a|an|[A-Z][A-Za-z0-9'/-]*)){0,5})/g
  )) {
    const raw = match[1]?.trim();
    if (!raw || match.index === undefined) continue;
    const overlaps = parts.some(
      (p) => match.index! < p.end && match.index! + match[0].length > p.start
    );
    if (overlaps) continue;
    parts.push({ start: match.index, end: match.index + match[0].length, name: raw, mark: "at" });
  }

  const names = [...known.keys()].sort((a, b) => b.length - a.length);
  if (names.length > 0) {
    const re = new RegExp(
      names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
      "gi"
    );
    for (const match of text.matchAll(re)) {
      if (match.index === undefined) continue;
      const overlaps = parts.some(
        (p) => match.index! < p.end && match.index! + match[0].length > p.start
      );
      if (overlaps) continue;
      parts.push({
        start: match.index,
        end: match.index + match[0].length,
        name: match[0],
        mark: "wiki",
      });
    }
  }

  parts.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let cursor = 0;
  for (const part of parts) {
    if (part.start < cursor) continue;
    if (part.start > cursor) {
      out.push({ kind: "text", value: text.slice(cursor, part.start) });
    }
    out.push({ kind: "card", name: part.name, mark: part.mark });
    cursor = part.end;
  }
  if (cursor < text.length) {
    out.push({ kind: "text", value: text.slice(cursor) });
  }
  return out.length > 0 ? out : [{ kind: "text", value: text }];
}

export function toMarkdown(text: string): string {
  const held: string[] = [];
  const park = (markdown: string): string => {
    held.push(markdown);
    return `\u0000${held.length - 1}\u0000`;
  };
  let out = text
    .replace(/@\[([^\]]+)\]/g, (_m, name: string) =>
      park(`[${name}](#card/${encodeURIComponent(name)})`)
    )
    .replace(/\[\[([^\]]+)\]\]/g, (_m, name: string) =>
      park(`[${name}](#card/${encodeURIComponent(name)})`)
    );
  out = out.replace(/\b(?:CR\s+)?(\d{3}(?:\.\d+[a-z]?)?)\b/g, (full, id: string) =>
    park(`[${full}](#rule/${id})`)
  );
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => {
    const item = held[Number(i)];
    if (!item) throw new Error("markdown placeholder missing");
    return item;
  });
}
