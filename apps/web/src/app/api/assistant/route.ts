import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSport } from "@orgasport/sports";
import { fmt, getMessages } from "@/i18n";
import { checkQuota, deviceHash, recordUsage, resolveTier } from "@/lib/assistant/quota";
import { contextNote, questionScope } from "@/lib/assistant/prompt";
import { runAssistant, type AssistantEvent } from "@/lib/assistant/run";
import { assistantConfigured, getAiSettings } from "@/lib/assistant/settings";
import { runTool } from "@/lib/assistant/tools";
import { clientIp, json, rateLimit } from "@/lib/tournament/http";
import { getDevicePrefs, getSportFilter, getViewer } from "@/lib/viewer";

/**
 * Chat with the assistant: POST the conversation (short, text only), get
 * Server-Sent Events back (`data: {"type":"text","text":"…"}` …). Quotas
 * per day (guest / account / paying club) and a monthly spending cap.
 */
const DEVICE_COOKIE = "os_device";

const body = z.object({
  turns: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(12)
    .refine((t) => t[t.length - 1]!.role === "user" && t[0]!.role === "user", "conversation must start and end with the person"),
  page: z.string().max(120).optional(),
});

function sse(events: (emit: (e: AssistantEvent | { type: "quota"; used: number; limit: number }) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await events(emit);
      } catch (e) {
        console.error("assistant stream failed", e);
        emit({ type: "error", code: "unavailable" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

export async function POST(request: NextRequest) {
  const m = getMessages().assistantUi;
  if (!(await rateLimit(`ai:ip:${clientIp(request)}`, 30, 600))) return json({ error: { code: "limited", message: m.errors.limited } }, 429);
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: { code: "invalid", message: m.errors.invalid } }, 400);
  const { turns, page } = parsed.data;

  const store = await cookies();
  let deviceId = store.get(DEVICE_COOKIE)?.value;
  if (!deviceId || !/^[A-Za-z0-9_-]{20,64}$/.test(deviceId)) {
    deviceId = randomBytes(24).toString("base64url");
    store.set(DEVICE_COOKIE, deviceId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  const [viewer, settings, prefs, sportFilter] = await Promise.all([getViewer(), getAiSettings(), getDevicePrefs(), getSportFilter()]);
  const who = { userId: viewer?.id ?? null, deviceHash: deviceHash(deviceId) };
  const tier = await resolveTier(viewer);
  const quota = await checkQuota(who, tier, settings);
  const nowMs = Date.now();
  const origin =
    viewer?.profile?.lat != null && viewer.profile.lng != null
      ? { lat: viewer.profile.lat, lng: viewer.profile.lng }
      : prefs?.lat != null && prefs.lng != null
        ? { lat: prefs.lat, lng: prefs.lng }
        : null;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  const toolCtx = { viewer, origin, nowMs, siteUrl };

  return sse(async (emit) => {
    if (!quota.ok) {
      const text =
        quota.reason === "daily"
          ? fmt(tier === "guest" ? m.errors.daily : m.errors.dailyAccount, { limit: quota.limit })
          : quota.reason === "budget"
            ? m.errors.budget
            : m.errors.disabled;
      emit({ type: "text", text });
      emit({ type: "done", suggestions: [] });
      return;
    }
    const question = turns[turns.length - 1]!.content;

    // Clearly unrelated question: polite refusal, no model call, no cost.
    if (questionScope(question) === "off_topic") {
      emit({ type: "text", text: m.offTopic });
      emit({ type: "done", suggestions: m.offTopicSuggestions });
      return;
    }

    // Without an API key (local development, or not configured yet): answer
    // from the knowledge base only, never pretending to be the AI.
    if (!assistantConfigured()) {
      const kb = await runTool("knowledge_search", { query: question }, toolCtx);
      const results = (JSON.parse(kb.content) as { results?: { title: string; text: string; cite?: string; updated?: string }[] }).results ?? [];
      if (results.length === 0) emit({ type: "text", text: m.fallbackNothing });
      else {
        emit({ type: "text", text: `${m.fallbackIntro}\n\n` });
        // The two best paragraphs, under one title per document.
        let lastTitle = "";
        for (const r of results.slice(0, 2)) {
          const heading = r.title === lastTitle ? "" : `**${r.title}**\n`;
          lastTitle = r.title;
          // A rulebook sheet always says which version it summarises, a help
          // sheet when it was last brought up to date.
          const dated = r.cite ?? r.updated;
          const cite = dated ? `${dated}\n\n` : "";
          emit({ type: "text", text: `${heading}${r.text.replace(/^.*? — /, "")}\n\n${cite}` });
        }
      }
      emit({ type: "done", suggestions: m.fallbackSuggestions });
      return;
    }

    const sportSlug = sportFilter !== "all" ? sportFilter : null;
    const note = contextNote({
      signedIn: Boolean(viewer),
      clubName: viewer?.activeClub?.name ?? null,
      city: viewer?.profile?.city ?? prefs?.city ?? null,
      sport: sportSlug ? (getSport(sportSlug)?.name ?? null) : null,
      todayLabel: new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(nowMs),
      page: page ?? null,
    });
    const result = await runAssistant({ turns, note, settings, tools: toolCtx, emit, signal: request.signal });
    emit({ type: "quota", used: quota.used + 1, limit: quota.limit });
    await recordUsage(who, { input: result.usage.input_tokens + (result.usage.cache_read_input_tokens ?? 0), output: result.usage.output_tokens, costMicroEur: result.costMicroEur });
  });
}
