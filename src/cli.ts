#!/usr/bin/env npx tsx
import { backendUrl, loadEnv } from "./env.js";

loadEnv();

const COMMANDS = ["ask", "search", "rule", "glossary", "card", "rulings", "health"] as const;
type Command = (typeof COMMANDS)[number];

function help(): string {
  return `mtg — Comprehensive Rules RAG + Scryfall

Start the backend first:
  npm run server

Usage:
  npm run cli -- "can I crew with a summoning-sick creature?"
  npm run cli -- ask "does Lightning Bolt kill a 4/4?" --card "Lightning Bolt"
  npm run cli -- search "summoning sickness"
  npm run cli -- rule 302.6
  npm run cli -- glossary haste
  npm run cli -- card "Sol Ring"
  npm run cli -- rulings "Sol Ring"
  npm run cli -- health

Env: MTG_RULES_URL (default http://127.0.0.1:3848)
`;
}

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

function takeFlag(args: string[], name: string): string[] {
  const values: string[] = [];
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === name) {
      const next = args[i + 1];
      if (!next) throw new Error(`${name} requires a value`);
      values.push(next);
      i += 1;
      continue;
    }
    if (arg?.startsWith(`${name}=`)) {
      values.push(arg.slice(name.length + 1));
      continue;
    }
    if (arg) out.push(arg);
  }
  args.length = 0;
  args.push(...out);
  return values;
}

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const url = `${backendUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Backend not reachable at ${backendUrl()} (${message}). Start it with: npm run server`
    );
  }
  const json: unknown = await res.json();
  if (!res.ok) {
    const errObj = json as { error?: unknown };
    const msg = typeof errObj.error === "string" ? errObj.error : JSON.stringify(json);
    throw new Error(msg);
  }
  return json;
}

function print(value: unknown): void {
  if (typeof value === "string") {
    process.stdout.write(`${value}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    print(help());
    return;
  }

  const raw = [...argv];
  const cards = takeFlag(raw, "--card");
  const head = raw[0];
  if (!head) {
    print(help());
    return;
  }

  const command: Command = isCommand(head) ? head : "ask";
  const rest = isCommand(head) ? raw.slice(1) : raw;

  switch (command) {
    case "health": {
      print(await api("/health"));
      return;
    }
    case "ask": {
      const question = rest.join(" ").trim();
      if (!question) throw new Error("ask requires a question");
      const result = (await api("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, cards }),
      })) as { answer: string };
      print(result.answer);
      return;
    }
    case "search": {
      const q = rest.join(" ").trim();
      if (!q) throw new Error("search requires a query");
      const result = (await api(`/search?q=${encodeURIComponent(q)}`)) as {
        hits: Array<{ id: string; source: string; text: string }>;
      };
      print(
        result.hits.map((h) => `--- ${h.id} (${h.source}) ---\n${h.text}`).join("\n\n")
      );
      return;
    }
    case "rule": {
      const id = rest.join(" ").trim();
      if (!id) throw new Error("rule requires an id");
      const result = (await api(`/rule/${encodeURIComponent(id)}`)) as {
        rules: Array<{ id: string; text: string }>;
      };
      print(result.rules.map((r) => r.text).join("\n\n"));
      return;
    }
    case "glossary": {
      const term = rest.join(" ").trim();
      if (!term) throw new Error("glossary requires a term");
      const result = (await api(`/glossary/${encodeURIComponent(term)}`)) as {
        entry: { text: string };
      };
      print(result.entry.text);
      return;
    }
    case "card": {
      const name = rest.join(" ").trim();
      if (!name) throw new Error("card requires a name");
      const result = (await api(`/card?name=${encodeURIComponent(name)}`)) as {
        text: string;
      };
      print(result.text);
      return;
    }
    case "rulings": {
      const name = rest.join(" ").trim();
      if (!name) throw new Error("rulings requires a name");
      const result = (await api(`/card/rulings?name=${encodeURIComponent(name)}`)) as {
        card: { name: string };
        rulings: Array<{ source: string; publishedAt: string; comment: string }>;
      };
      const body =
        result.rulings.length === 0
          ? "No official rulings."
          : result.rulings.map((r) => `- (${r.source} ${r.publishedAt}) ${r.comment}`).join("\n");
      print(`${result.card.name}\n\n${body}`);
      return;
    }
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
