"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@orgasport/ui";
import { fmt, getMessages } from "@/i18n";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { DISABLED_BORDERED } from "@/components/ui/disabled";
import { MAX_CHARS, type ChatMessage, type ErrorCode } from "@/lib/assistant-client";
import { chatStore } from "./chat-store";
import { Markdown } from "./Markdown";

type Texts = ReturnType<typeof getMessages>["assistantUi"];
export type Prefill = { text: string; n: number } | null;

const RETRYABLE = new Set<ErrorCode>(["busy", "unavailable", "offline", "limited"]);
const CHIP =
  `inline-flex min-h-12 items-center rounded-full border-2 border-line bg-surface px-4 py-2 text-left text-sm font-bold text-ink transition hover:border-accent hover:bg-accent-soft ${DISABLED_BORDERED}`;

const currentPage = () => (typeof window === "undefined" ? undefined : window.location.pathname);
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Chips({ items, label, disabled }: { items: string[]; label: string; disabled: boolean }) {
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {items.map((s) => (
        <li key={s}>
          <button type="button" className={CHIP} disabled={disabled} onClick={() => void chatStore.send(s, currentPage())}>
            {s}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Message({ msg, m, status, last }: { msg: ChatMessage; m: Texts; status: string | null; last: boolean }) {
  if (msg.role === "user")
    return (
      <li className="max-w-[85%] justify-self-end whitespace-pre-wrap break-words rounded-[var(--radius-lg)] rounded-br-sm bg-inverse px-4 py-2.5 text-on-inverse">
        <span className="sr-only">{m.you} </span>
        {msg.content}
      </li>
    );
  return (
    <li className="grid max-w-[92%] gap-2 justify-self-start rounded-[var(--radius-lg)] rounded-bl-sm border border-line bg-surface px-4 py-3 text-ink">
      <span className="sr-only">{m.bot}</span>
      {msg.content && <Markdown text={msg.content} newTab={m.newTab} />}
      {status && (
        <p className="flex items-center gap-2 text-sm font-bold text-ink-soft">
          <span aria-hidden className="size-2 rounded-full bg-accent motion-safe:animate-pulse" />
          {status}
        </p>
      )}
      {msg.error && (
        <div className="grid gap-2">
          <p className="text-sm font-bold text-danger">{m.errors[msg.error]}</p>
          {last && RETRYABLE.has(msg.error) && (
            <Button variant="outline" className="justify-self-start" onClick={() => chatStore.retry(currentPage())}>
              {m.retry}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Text box: Enter sends, Shift+Enter goes to the line. Remounted (key) when
 * another part of the app opens the assistant with a prefilled question.
 */
function Composer({ initial, busy, autoFocus, m }: { initial: string; busy: boolean; autoFocus: boolean; m: Texts }) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!autoFocus || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);
  const submit = () => {
    const q = text.trim();
    if (!q || busy) return;
    void chatStore.send(q, currentPage());
    setText("");
  };
  return (
    <form
      className="grid gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {m.label}
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id={id}
          ref={ref}
          value={text}
          rows={1}
          maxLength={MAX_CHARS}
          enterKeyHint="send"
          placeholder={m.placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="field-sizing-content max-h-40 min-h-12 flex-1 resize-none rounded-[var(--radius)] border-2 border-line bg-surface px-3 py-2.5 text-base text-ink placeholder:text-ink-soft focus:border-accent"
        />
        {busy ? (
          <Button variant="outline" onClick={() => chatStore.stop()}>
            {m.stop}
          </Button>
        ) : (
          <Button type="submit" disabled={!text.trim()}>
            {m.send}
          </Button>
        )}
      </div>
      {text.length > MAX_CHARS - 200 && (
        <p className="tabular text-xs font-bold text-ink-soft">{fmt(m.counter, { count: text.length, max: MAX_CHARS })}</p>
      )}
    </form>
  );
}

/**
 * The chat itself, used full page (/assistant) and in the bubble's panel.
 * Answers appear as they are written; only the finished answer is read out
 * (live region), not every fragment.
 */
export function AssistantChat({ variant, prefill = null, autoFocus = false }: { variant: "page" | "panel"; prefill?: Prefill; autoFocus?: boolean }) {
  const m = getMessages().assistantUi;
  const state = useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot, chatStore.getServerSnapshot);
  const { messages, busy, tool, quota, finished } = state;
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const count = useRef(messages.length);
  const panel = variant === "panel";

  // Follow the answer while it is written, unless the person scrolled up.
  useEffect(() => {
    const isNew = messages.length !== count.current;
    count.current = messages.length;
    const box = scrollRef.current;
    if (panel && box) {
      if (isNew || box.scrollHeight - box.scrollTop - box.clientHeight < 160) box.scrollTop = box.scrollHeight;
      return;
    }
    const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240;
    if ((isNew && messages.length > 0) || (busy && nearBottom))
      endRef.current?.scrollIntoView({ block: "end", behavior: isNew && !reducedMotion() ? "smooth" : "auto" });
  }, [messages, tool, busy, panel]);

  const last = messages[messages.length - 1];
  const done = finished ? messages.find((x) => x.id === finished) : undefined;
  const announce = done ? [done.content, done.error ? m.errors[done.error] : ""].filter(Boolean).join(" ") : "";
  const status = busy && last?.role === "assistant" && last.done === false ? (tool ? (m.tools[tool] ?? m.tools.default!) : last.content ? null : m.thinking) : null;

  return (
    <div className={cn("flex flex-col", panel ? "min-h-0 flex-1" : "flex-1 gap-4")}>
      <div ref={scrollRef} className={cn("grid content-start gap-4", panel && "min-h-0 flex-1 overflow-y-auto overscroll-contain p-4")}>
        {messages.length === 0 ? (
          <div className="grid gap-4">
            <p className={cn("text-ink-soft", panel ? "text-base" : "text-lg")}>{m.intro}</p>
            <Chips items={m.starters} label={m.startersLabel} disabled={busy} />
          </div>
        ) : (
          <ol aria-label={m.conversation} aria-busy={busy} className="grid gap-3">
            {messages.map((msg) => (
              <Message key={msg.id} msg={msg} m={m} last={msg === last} status={msg === last ? status : null} />
            ))}
          </ol>
        )}
        {!busy && last?.role === "assistant" && last.suggestions && last.suggestions.length > 0 && (
          <Chips items={last.suggestions} label={m.suggestionsLabel} disabled={busy} />
        )}
        <div ref={endRef} className="scroll-mb-56" />
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </div>
      <div
        className={cn(
          "grid gap-2 border-t border-line",
          panel
            ? "bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            : "sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] z-10 -mx-4 mt-auto bg-bg/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:px-0",
        )}
      >
        <Composer key={prefill?.n ?? 0} initial={prefill?.text ?? ""} busy={busy} autoFocus={autoFocus || Boolean(prefill)} m={m} />
        <div className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
          {quota ? <p className="tabular font-bold text-ink-soft">{fmt(m.quota, { used: quota.used, limit: quota.limit })}</p> : <span />}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => chatStore.reset()}
              className="inline-flex min-h-12 items-center gap-1.5 rounded-[var(--radius)] px-2 font-bold text-ink hover:bg-surface-2"
            >
              <Icon name="plus" size={18} />
              {m.newChat}
            </button>
          )}
        </div>
        <p className="text-xs text-ink-soft">{m.smallPrint}</p>
      </div>
    </div>
  );
}
