import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import Markdown from "react-markdown";
import { ask, autocomplete, fetchCard, fetchRule, scan } from "./api.js";
import { indexCards, toMarkdown } from "./cards.js";
import { activeMention, insertMention, mentionedNames, type Mention } from "./mention.js";
import type { Card, ChatMessage } from "./types.js";

type Peek =
  | { kind: "card"; name: string; card: Card | null; missing: boolean; x: number; y: number }
  | { kind: "rule"; id: string; text: string | null; missing: boolean; x: number; y: number };

function placePeek(el: HTMLElement, w: number, h: number): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  let x = r.right + 12;
  let y = r.top;
  if (x + w > window.innerWidth - 12) x = r.left - w - 12;
  if (x < 12) x = 12;
  if (y + h > window.innerHeight - 12) y = window.innerHeight - h - 12;
  if (y < 12) y = 12;
  return { x, y };
}

export function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [rules, setRules] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [peek, setPeek] = useState<Peek | null>(null);
  const [mention, setMention] = useState<Mention | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestIdx, setSuggestIdx] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hoverableRef = useRef(false);
  const [sheet, setSheet] = useState(false);
  const known = useMemo(() => indexCards(cards), [cards]);

  useEffect(() => {
    const hoverMq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const narrowMq = window.matchMedia("(max-width: 720px)");
    const sync = (): void => {
      hoverableRef.current = hoverMq.matches;
      setSheet(!hoverMq.matches || narrowMq.matches);
    };
    sync();
    hoverMq.addEventListener("change", sync);
    narrowMq.addEventListener("change", sync);
    return () => {
      hoverMq.removeEventListener("change", sync);
      narrowMq.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const mentionQuery = mention?.query ?? "";

  useEffect(() => {
    if (mentionQuery.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const t = window.setTimeout(() => {
      void autocomplete(mentionQuery)
        .then((names) => {
          setSuggestions(names);
          setSuggestIdx(0);
        })
        .catch(() => setSuggestions([]));
    }, 160);
    return () => window.clearTimeout(t);
  }, [mentionQuery]);

  function mergeCards(next: Card[]): void {
    setCards((prev) => {
      const map = new Map(prev.map((c) => [c.id, c]));
      for (const c of next) map.set(c.id, c);
      return [...map.values()];
    });
  }

  function syncMention(text: string, caret: number): void {
    const next = activeMention(text, caret);
    setMention((prev) => {
      if (prev === next) return prev;
      if (
        prev &&
        next &&
        prev.start === next.start &&
        prev.end === next.end &&
        prev.query === next.query
      ) {
        return prev;
      }
      return next;
    });
  }

  function pickSuggestion(name: string): void {
    if (!mention) return;
    const next = insertMention(draft, mention, name);
    setDraft(next);
    setMention(null);
    setSuggestions([]);
    void fetchCard(name).then((card) => mergeCards([card]));
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function mergeRules(next: Record<string, string>): void {
    setRules((prev) => ({ ...prev, ...next }));
  }

  const hoverKey = useRef<string | null>(null);
  const hideTimer = useRef<number | null>(null);

  function cancelHide(): void {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  function scheduleHide(): void {
    if (!hoverableRef.current) return;
    cancelHide();
    hideTimer.current = window.setTimeout(() => {
      hoverKey.current = null;
      setPeek(null);
    }, 280);
  }

  function closePeek(): void {
    cancelHide();
    hoverKey.current = null;
    setPeek(null);
  }

  async function onHoverCard(name: string, ev: MouseEvent<HTMLElement>): Promise<void> {
    cancelHide();
    const key = `card:${name}`;
    hoverKey.current = key;
    const pos = hoverableRef.current
      ? placePeek(ev.currentTarget, 244, 340)
      : { x: 0, y: 0 };
    const cached = known.get(name.toLowerCase());
    if (cached) {
      setPeek({ kind: "card", name, card: cached, missing: false, ...pos });
      return;
    }
    setPeek({ kind: "card", name, card: null, missing: false, ...pos });
    try {
      const card = await fetchCard(name);
      if (hoverKey.current !== key) return;
      mergeCards([card]);
      setPeek({ kind: "card", name, card, missing: false, ...pos });
    } catch {
      if (hoverKey.current !== key) return;
      setPeek({ kind: "card", name, card: null, missing: true, ...pos });
    }
  }

  async function onHoverRule(id: string, ev: MouseEvent<HTMLElement>): Promise<void> {
    cancelHide();
    const key = `rule:${id}`;
    hoverKey.current = key;
    const pos = hoverableRef.current
      ? placePeek(ev.currentTarget, 380, 220)
      : { x: 0, y: 0 };
    const cached = rules[id];
    if (cached) {
      setPeek({ kind: "rule", id, text: cached, missing: false, ...pos });
      return;
    }
    setPeek({ kind: "rule", id, text: null, missing: false, ...pos });
    try {
      const entry = await fetchRule(id);
      if (hoverKey.current !== key) return;
      mergeRules({ [entry.id]: entry.text });
      setPeek({ kind: "rule", id, text: entry.text, missing: false, ...pos });
    } catch {
      if (hoverKey.current !== key) return;
      setPeek({ kind: "rule", id, text: null, missing: true, ...pos });
    }
  }

  const onCardRef = useRef(onHoverCard);
  const onRuleRef = useRef(onHoverRule);
  const onLeaveRef = useRef(scheduleHide);
  const onCloseRef = useRef(closePeek);
  onCardRef.current = onHoverCard;
  onRuleRef.current = onHoverRule;
  onLeaveRef.current = scheduleHide;
  onCloseRef.current = closePeek;

  const mdComponents = useMemo(
    () => ({
      a: ({ href, children }: { href?: string; children?: ReactNode }) => {
        if (href?.startsWith("#card/")) {
          const name = decodeURIComponent(href.slice("#card/".length));
          return (
            <span
              className="card-name"
              onMouseEnter={(e) => {
                if (hoverableRef.current) void onCardRef.current(name, e);
              }}
              onMouseLeave={() => {
                if (hoverableRef.current) onLeaveRef.current();
              }}
              onClick={(e) => {
                e.preventDefault();
                if (hoverableRef.current) return;
                const open = hoverKey.current === `card:${name}`;
                if (open) onCloseRef.current();
                else void onCardRef.current(name, e);
              }}
            >
              {children}
            </span>
          );
        }
        if (href?.startsWith("#rule/")) {
          const id = decodeURIComponent(href.slice("#rule/".length));
          return (
            <span
              className="rule-id"
              onMouseEnter={(e) => {
                if (hoverableRef.current) void onRuleRef.current(id, e);
              }}
              onMouseLeave={() => {
                if (hoverableRef.current) onLeaveRef.current();
              }}
              onClick={(e) => {
                e.preventDefault();
                if (hoverableRef.current) return;
                const open = hoverKey.current === `rule:${id}`;
                if (open) onCloseRef.current();
                else void onRuleRef.current(id, e);
              }}
            >
              {children}
            </span>
          );
        }
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      },
    }),
    []
  );

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (suggestions.length > 0 && mention) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggestIdx((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggestIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const pick = suggestions[suggestIdx];
        if (pick) {
          e.preventDefault();
          pickSuggestion(pick);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMention(null);
        setSuggestions([]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function newChat(): void {
    setMessages([]);
    setDraft("");
    setError(null);
    setPeek(null);
    setMention(null);
    setSuggestions([]);
    setBusy(false);
    closePeek();
    inputRef.current?.focus();
  }

  async function send(): Promise<void> {
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    setMention(null);
    setSuggestions([]);
    setError(null);
    setBusy(true);
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", text: question };
    setMessages((m) => [...m, userMsg]);
    void scan(question)
      .then(mergeCards)
      .catch(() => undefined);
    try {
      const result = await ask(question, mentionedNames(question), messages);
      mergeCards(result.resolved);
      mergeRules(result.rules);
      setMessages((m) => [
        ...m,
        { id: `a-${Date.now()}`, role: "assistant", text: result.answer },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      {messages.length > 0 && (
        <div className="top">
          <button type="button" className="new-chat" onClick={newChat}>
            New chat
          </button>
        </div>
      )}
      <main className="thread">
        {messages.map((msg) => (
          <div key={msg.id} className={`msg ${msg.role} md`}>
            <Markdown
              urlTransform={(url) => {
                if (url.startsWith("#card/") || url.startsWith("#rule/")) return url;
                if (url.startsWith("http://") || url.startsWith("https://")) return url;
                return "";
              }}
              components={mdComponents}
            >
              {toMarkdown(msg.text)}
            </Markdown>
          </div>
        ))}
        {busy && <div className="busy">Thinking…</div>}
        {error && <p className="err">{error}</p>}
      </main>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {suggestions.length > 0 && (
          <ul className="suggest">
            {suggestions.map((name, i) => (
              <li key={name}>
                <button
                  type="button"
                  className={i === suggestIdx ? "on" : ""}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickSuggestion(name);
                  }}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="box">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            placeholder="@ to search cards"
            onChange={(e) => {
              setDraft(e.target.value);
              syncMention(e.target.value, e.target.selectionStart);
            }}
            onKeyUp={(e) => {
              if (
                e.key === "ArrowDown" ||
                e.key === "ArrowUp" ||
                e.key === "Enter" ||
                e.key === "Tab" ||
                e.key === "Escape"
              ) {
                return;
              }
              syncMention(e.currentTarget.value, e.currentTarget.selectionStart);
            }}
            onClick={(e) => syncMention(e.currentTarget.value, e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
          />
          <button className="send" type="submit" disabled={busy || !draft.trim()} aria-label="Send">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M12 19V5M5 12l7-7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </form>

      {peek && sheet && (
        <button type="button" className="scrim" aria-label="Close preview" onClick={closePeek} />
      )}
      {peek && peek.kind === "card" && (peek.missing || peek.card) && (
        <div
          className={`peek live${sheet ? " sheet" : ""}${peek.missing || !peek.card?.imageUri ? " missing" : ""}`}
          style={sheet ? undefined : { left: peek.x, top: peek.y }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          {peek.missing && <div>No Scryfall card for “{peek.name}”.</div>}
          {!peek.missing && peek.card?.imageUri && (
            <img src={peek.card.imageUri} alt={peek.card.name} />
          )}
          {!peek.missing && peek.card && !peek.card.imageUri && (
            <div>No image for {peek.card.name}.</div>
          )}
        </div>
      )}
      {peek && peek.kind === "rule" && (peek.missing || peek.text) && (
        <div
          className={`peek live rule-peek${sheet ? " sheet" : ""}`}
          style={sheet ? undefined : { left: peek.x, top: peek.y }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          {peek.missing && <div>No rule {peek.id}.</div>}
          {peek.text && (
            <>
              <div className="rule-peek-id">{peek.id}</div>
              <div>{peek.text}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
