import express from "express";
import { z } from "zod";
import { ask } from "./agent.js";
import { backendPort, loadEnv } from "./env.js";
import { defaultRulesPath, parseRulesFile } from "./parse.js";
import { Retriever } from "./retrieve.js";
import { autocompleteCards, formatCard, lookupCard, lookupRulings, scanCards } from "./scryfall.js";

loadEnv();

const corpus = parseRulesFile(defaultRulesPath());
const retriever = new Retriever(corpus);

const app = express();
const allowedOrigins = new Set(
  (process.env.CORS_ORIGIN ?? "http://127.0.0.1:5173,http://localhost:5173").split(",")
);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});
app.use(express.json({ limit: "256kb" }));

const AskBody = z.object({
  question: z.string().min(1),
  cards: z.array(z.string().min(1)).default([]),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().min(1),
      })
    )
    .default([]),
});

function sendError(res: express.Response, err: unknown, status = 400): void {
  const message = err instanceof Error ? err.message : String(err);
  res.status(status).json({ error: message });
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    effectiveDate: corpus.effectiveDate,
    rules: corpus.chunks.filter((c) => c.kind === "rule").length,
    glossary: corpus.chunks.filter((c) => c.kind === "glossary").length,
  });
});

app.post("/ask", async (req, res) => {
  const parsed = AskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const preload = [];
    for (const name of parsed.data.cards) {
      preload.push(await lookupCard(name));
    }
    const result = await ask(
      retriever,
      parsed.data.question,
      preload,
      parsed.data.history
    );
    res.json(result);
  } catch (err) {
    sendError(res, err, 500);
  }
});

app.get("/search", (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const k = req.query.k === undefined ? 8 : Number(req.query.k);
    if (!Number.isInteger(k) || k < 1 || k > 32) {
      throw new Error("k must be an integer 1-32");
    }
    const hits = retriever.search(q, k).map((h) => ({
      id: h.chunk.id,
      kind: h.chunk.kind,
      title: h.chunk.title,
      text: h.chunk.text,
      score: h.score,
      source: h.source,
    }));
    res.json({ hits });
  } catch (err) {
    sendError(res, err);
  }
});

app.get("/rules/:id", (req, res) => {
  try {
    const id = req.params.id;
    if (!id) throw new Error("Rule id is required");
    const rule = retriever.getExact(id);
    res.json({ id: rule.id, text: rule.text });
  } catch (err) {
    sendError(res, err);
  }
});

app.get("/rule/:id", (req, res) => {
  try {
    const id = req.params.id;
    if (!id) throw new Error("Rule id is required");
    const rules = retriever.getRule(id);
    res.json({ rules });
  } catch (err) {
    sendError(res, err);
  }
});

app.get("/glossary/:term", (req, res) => {
  try {
    const term = req.params.term;
    if (!term) throw new Error("Glossary term is required");
    res.json({ entry: retriever.getGlossary(term) });
  } catch (err) {
    sendError(res, err);
  }
});

app.get("/cards/autocomplete", async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const names = await autocompleteCards(q);
    res.json({ names });
  } catch (err) {
    sendError(res, err);
  }
});

app.get("/cards/scan", async (req, res) => {
  try {
    const text = typeof req.query.text === "string" ? req.query.text : "";
    if (!text.trim()) throw new Error("text is required");
    const cards = await scanCards(text);
    res.json({ cards });
  } catch (err) {
    sendError(res, err);
  }
});

app.get("/card", async (req, res) => {
  try {
    const name = typeof req.query.name === "string" ? req.query.name : "";
    const card = await lookupCard(name);
    res.json({ card, text: formatCard(card) });
  } catch (err) {
    sendError(res, err);
  }
});

app.get("/card/rulings", async (req, res) => {
  try {
    const name = typeof req.query.name === "string" ? req.query.name : "";
    const result = await lookupRulings(name);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

const port = backendPort();
app.listen(port, () => {
  process.stdout.write(
    `mtg-rules ${corpus.effectiveDate} · ${corpus.chunks.length} chunks · :${port}\n`
  );
});
