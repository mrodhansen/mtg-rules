export interface Alias {
  terms: string[];
  ruleIds: string[];
  extraQueries: string[];
}

export const ALIASES: readonly Alias[] = [
  {
    terms: ["summoning sickness", "summoning-sick", "sick"],
    ruleIds: ["302.6", "702.10"],
    extraQueries: [
      "has been under its controller's control continuously since their most recent turn began",
    ],
  },
  {
    terms: ["etb", "enters the battlefield", "enters"],
    ruleIds: ["603.6a", "400.7"],
    extraQueries: ["enters the battlefield"],
  },
  {
    terms: ["ltb", "leaves the battlefield"],
    ruleIds: ["603.6c", "400.7"],
    extraQueries: ["leaves the battlefield"],
  },
  {
    terms: ["sba", "state-based action", "state based actions"],
    ruleIds: ["704"],
    extraQueries: ["state-based actions"],
  },
  {
    terms: ["stack"],
    ruleIds: ["405"],
    extraQueries: ["the stack"],
  },
  {
    terms: ["priority"],
    ruleIds: ["117"],
    extraQueries: ["priority"],
  },
  {
    terms: ["legend rule", "legend"],
    ruleIds: ["704.5j"],
    extraQueries: ["legendary permanents"],
  },
  {
    terms: ["commander damage"],
    ruleIds: ["903.10"],
    extraQueries: ["commander damage", "21 or more combat damage"],
  },
  {
    terms: ["crew", "crewing"],
    ruleIds: ["702.122"],
    extraQueries: ["crew", "vehicle"],
  },
  {
    terms: ["equip", "equipping"],
    ruleIds: ["702.6"],
    extraQueries: ["equip"],
  },
  {
    terms: ["hexproof"],
    ruleIds: ["702.11"],
    extraQueries: ["hexproof"],
  },
  {
    terms: ["ward"],
    ruleIds: ["702.21"],
    extraQueries: ["ward"],
  },
  {
    terms: ["indestructible"],
    ruleIds: ["702.12"],
    extraQueries: ["indestructible"],
  },
  {
    terms: ["protection"],
    ruleIds: ["702.16"],
    extraQueries: ["protection from"],
  },
  {
    terms: ["layer", "layers"],
    ruleIds: ["613"],
    extraQueries: ["interaction of continuous effects"],
  },
  {
    terms: ["replacement effect", "replacement effects"],
    ruleIds: ["614"],
    extraQueries: ["replacement effect"],
  },
  {
    terms: ["copy", "copying"],
    ruleIds: ["707"],
    extraQueries: ["copying objects"],
  },
  {
    terms: ["morph", "manifest"],
    ruleIds: ["702.37", "701.34"],
    extraQueries: ["face-down", "morph"],
  },
  {
    terms: ["cascade"],
    ruleIds: ["702.85"],
    extraQueries: ["cascade"],
  },
  {
    terms: ["storm"],
    ruleIds: ["702.40"],
    extraQueries: ["storm"],
  },
];

export function aliasesFor(query: string): Alias[] {
  const q = query.toLowerCase();
  return ALIASES.filter((a) => a.terms.some((t) => q.includes(t)));
}
