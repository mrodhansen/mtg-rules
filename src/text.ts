const REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["â€™", "'"],
  ["â€˜", "'"],
  ["â€œ", '"'],
  ["â€\u009d", '"'],
  ["â€", '"'],
  ["â€“", "–"],
  ["â€”", "—"],
  ["â€¦", "…"],
  ["â„¢", "™"],
  ["âˆ’", "−"],
  ["âˆž", "∞"],
  ["Â®", "®"],
  ["Â©", "©"],
  ["Â ", " "],
];

export function fixMojibake(text: string): string {
  let out = text;
  for (const [from, to] of REPLACEMENTS) {
    out = out.replaceAll(from, to);
  }
  return out;
}

export function slug(value: string): string {
  const s = value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) {
    throw new Error(`Cannot slugify empty value: ${JSON.stringify(value)}`);
  }
  return s;
}

const RULE_REF =
  /\b(?:see\s+)?(?:rule|rules)\s+(\d{3}(?:\.\d+[a-z]?)?(?:\s*[–-]\s*\d+[a-z]?)?)/gi;

const RULE_CITE = /\b(?:CR\s+)?(\d{3}(?:\.\d+[a-z]?)?)\b/g;

export function extractCitedRuleIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(RULE_CITE)) {
    const id = match[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

export function extractRuleRefs(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(RULE_REF)) {
    const raw = match[1];
    if (!raw) continue;
    const range = raw.replace(/\s+/g, "");
    const dash = range.search(/[–-]/);
    if (dash === -1) {
      ids.add(range);
      continue;
    }
    ids.add(range.slice(0, dash));
  }
  return [...ids];
}

export function normalizeRuleId(raw: string): string {
  const id = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!/^\d{3}(?:\.\d+[a-z]?)?$/.test(id)) {
    throw new Error(`Invalid rule id: ${JSON.stringify(raw)}`);
  }
  return id;
}

export function isRuleChild(parent: string, child: string): boolean {
  if (child === parent) return true;
  if (child.startsWith(`${parent}.`)) return true;
  if (
    /^\d{3}\.\d+$/.test(parent) &&
    child.startsWith(parent) &&
    /^[a-z]+$/.test(child.slice(parent.length))
  ) {
    return true;
  }
  return false;
}
