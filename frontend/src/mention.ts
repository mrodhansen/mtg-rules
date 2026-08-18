export interface Mention {
  start: number;
  end: number;
  query: string;
}

export function activeMention(text: string, caret: number): Mention | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1] ?? "")) return null;
  const afterAt = before.slice(at + 1);
  if (afterAt.startsWith("[")) {
    if (afterAt.includes("]")) return null;
    return { start: at, end: caret, query: afterAt.slice(1) };
  }
  if (/[\[\n]/.test(afterAt)) return null;
  return { start: at, end: caret, query: afterAt };
}

export function insertMention(text: string, mention: Mention, name: string): string {
  const token = `@[${name}]`;
  return `${text.slice(0, mention.start)}${token} ${text.slice(mention.end)}`;
}

export function mentionedNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/@\[([^\]]+)\]/g)) {
    const n = match[1]?.trim();
    if (n) names.push(n);
  }
  return names;
}
