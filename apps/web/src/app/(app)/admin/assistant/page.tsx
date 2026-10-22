import type { Metadata } from "next";
import { Suspense } from "react";
import { SPORTS, getSport } from "@orgasport/sports";
import { Icon } from "@orgasport/ui";
import { fmt, getMessages } from "@/i18n";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Section, Skeleton } from "@/components/ui/Section";
import { Disclosure } from "@/components/admin/fields";
import { decimalInput, staleRules } from "@/components/admin/assistant/forms";
import { EMPTY_KB, KbForm } from "@/components/admin/assistant/KbForm";
import { KbSearchBox } from "@/components/admin/assistant/KbSearchBox";
import { SettingsForm, type SettingsValues } from "@/components/admin/assistant/SettingsForm";
import { UsagePanel } from "@/components/admin/assistant/UsagePanel";
import { DEFAULT_PRICES } from "@/lib/assistant/pricing";
import { DEFAULT_MODEL, assistantConfigured, getAiSettings, type AiSettings } from "@/lib/assistant/settings";
import { requireAdmin } from "@/lib/data/admin";
import { getAiUsageReport } from "@/lib/data/ai-usage";
import { formatDay, formatLongDate, formatTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { deleteKbDocument, setKbPublished } from "./actions";

const t = getMessages().adminAssistant;

// Per-user area: a non-admin gets notFound() from inside the layout's Suspense.
export const instant = false;
export const metadata: Metadata = { title: t.metaTitle };

/**
 * The stored "ai.*" rows, read as the admin without cache: the form must show
 * what was just saved (getAiSettings() is cached for the API).
 */
async function storedSettings(): Promise<Record<string, unknown>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("app_settings").select("key, value").like("key", "ai.%");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Form values: what is stored, or the value in effect (defaults) when a key is missing. */
function settingsValues(stored: Record<string, unknown>, effective: AiSettings, priceModel: string): SettingsValues {
  const quota = (stored["ai.daily_quota"] ?? {}) as Record<string, unknown>;
  const pricing = (stored["ai.pricing"] ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const price = pricing[priceModel] ?? {};
  const q = (k: keyof AiSettings["dailyQuota"]) => String(isNum(quota[k]) ? quota[k] : effective.dailyQuota[k]);
  const p = (k: string) => (isNum(price[k]) ? decimalInput(price[k]) : "");
  return {
    enabled: stored["ai.enabled"] !== false,
    model: typeof stored["ai.model"] === "string" && stored["ai.model"] ? stored["ai.model"] : DEFAULT_MODEL,
    quotaGuest: q("guest"),
    quotaAccount: q("account"),
    quotaPayingClub: q("paying_club"),
    budget: decimalInput(isNum(stored["ai.monthly_budget_eur"]) ? stored["ai.monthly_budget_eur"] : effective.monthlyBudgetEur),
    usdToEur: decimalInput(isNum(stored["ai.usd_to_eur"]) ? stored["ai.usd_to_eur"] : effective.usdToEur),
    priceInput: p("inputUsdPerMTok"),
    priceOutput: p("outputUsdPerMTok"),
    priceCacheRead: p("cacheReadUsdPerMTok"),
  };
}

async function listDocuments() {
  // As the admin: RLS shows drafts to platform admins only.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("kb_documents")
    .select("id, title, sport_slug, source_url, kind, version_date, reviewed_at, body, published, updated_at, kb_chunks (count)")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  const docs = data ?? [];
  // Rulebook sheets not reviewed for 12 months: alert at the top of the page.
  return { docs, stale: staleRules(docs, Date.now()) };
}

function JumpLinks() {
  const links = [
    ["#admin-ai-usage", t.usage.title],
    ["#admin-ai-settings", t.settings.title],
    ["#admin-ai-kb", t.kb.title],
  ] as const;
  return (
    <nav aria-label={t.jump} className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {links.map(([href, label]) => (
        <a key={href} href={href} className="inline-flex min-h-12 items-center font-bold text-accent-ink underline-offset-4 hover:underline">
          {label}
        </a>
      ))}
    </nav>
  );
}

async function AssistantAdmin() {
  await requireAdmin();
  const [stored, effective, report, { docs, stale }] = await Promise.all([
    storedSettings(),
    getAiSettings(),
    getAiUsageReport(),
    listDocuments(),
  ]);
  const configured = assistantConfigured();
  const envModel = process.env.ANTHROPIC_MODEL || null;
  const values = settingsValues(stored, effective, envModel ?? (typeof stored["ai.model"] === "string" ? stored["ai.model"] : DEFAULT_MODEL));
  const priceModel = envModel ?? values.model;
  const known = DEFAULT_PRICES[priceModel];
  const defaultPrice = known
    ? {
        input: decimalInput(known.inputUsdPerMTok),
        output: decimalInput(known.outputUsdPerMTok),
        cache: decimalInput(known.cacheReadUsdPerMTok ?? known.inputUsdPerMTok * 0.1),
      }
    : null;
  const budgetEur = isNum(stored["ai.monthly_budget_eur"]) ? stored["ai.monthly_budget_eur"] : effective.monthlyBudgetEur;
  const used = new Set(docs.map((d) => d.sport_slug));
  const sports = SPORTS.filter((s) => s.enabled || used.has(s.slug)).map((s) => ({ slug: s.slug, name: s.name }));
  const staleIds = new Set(stale.map((d) => d.id));

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <p>{t.intro}</p>
        <JumpLinks />
      </div>

      {stale.length > 0 && (
        <Card className="grid gap-2 border-warning" role="alert" aria-labelledby="admin-ai-stale">
          <h3 id="admin-ai-stale" className="font-bold">
            {t.kb.staleTitle}
          </h3>
          <p className="text-sm">{t.kb.staleText}</p>
          <ul className="list-disc pl-5 text-sm">
            {stale.map((d) => (
              <li key={d.id}>
                {d.title} ({d.reviewed_at ? fmt(t.kb.reviewedBadge, { date: formatLongDate(d.reviewed_at) }) : t.kb.neverReviewed})
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="grid gap-2" aria-labelledby="admin-ai-status">
        <h3 id="admin-ai-status" className="sr-only">
          {t.status.title}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={configured ? "success" : "warning"}>{configured ? t.status.keyOk : t.status.keyMissing}</Badge>
          <Badge tone={values.enabled ? "success" : "neutral"}>{values.enabled ? t.status.enabled : t.status.disabled}</Badge>
        </div>
        <p className="text-sm">{configured ? fmt(t.status.keyOkText, { model: priceModel }) : t.status.keyMissingText}</p>
        {!values.enabled && <p className="text-sm text-ink-soft">{t.status.disabledText}</p>}
        {envModel && <p className="text-sm text-ink-soft">{fmt(t.status.envModel, { model: envModel })}</p>}
      </Card>

      <Section title={t.usage.title} id="admin-ai-usage">
        <UsagePanel report={report} budgetEur={budgetEur} />
      </Section>

      <Section title={t.settings.title} id="admin-ai-settings">
        <Card>
          <SettingsForm values={values} defaultModel={DEFAULT_MODEL} priceModel={priceModel} defaultPrice={defaultPrice} />
        </Card>
      </Section>

      <Section title={t.kb.title} id="admin-ai-kb">
        <p className="text-ink-soft">{t.kb.intro}</p>
        <Card className="grid gap-3">
          <h3 className="font-bold">{t.search.title}</h3>
          <KbSearchBox sports={sports} />
        </Card>

        <h3 className="mt-2 font-bold">{t.kb.list}</h3>
        {docs.length === 0 ? (
          <p className="text-ink-soft">{t.kb.empty}</p>
        ) : (
          <ul className="grid gap-3" aria-label={t.kb.list}>
            {docs.map((d) => {
              const sport = d.sport_slug ? getSport(d.sport_slug) : null;
              const count = d.kb_chunks[0]?.count ?? 0;
              return (
                <li key={d.id}>
                  <Card className="grid gap-3" data-sport={sport?.accentToken}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid min-w-0 gap-0.5">
                        <span className="font-bold">{d.title}</span>
                        {d.source_url && (
                          <a href={d.source_url} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-bold text-accent-ink">
                            {d.source_url}
                          </a>
                        )}
                      </div>
                      <form action={setKbPublished} className="shrink-0">
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="published" value={String(!d.published)} />
                        <Button type="submit" variant="outline">
                          {d.published ? t.kb.unpublish : t.kb.publish}
                        </Button>
                      </form>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge tone={d.published ? "success" : "neutral"}>{d.published ? t.kb.published : t.kb.draft}</Badge>
                      <Badge tone={sport ? "accent" : "neutral"}>
                        {sport && <Icon name={sport.icon} size={14} />}
                        {sport?.name ?? t.kb.allSports}
                      </Badge>
                      {d.kind === "rules" && (
                        <Badge tone="neutral">
                          {d.version_date ? fmt(t.kb.rulesBadge, { date: formatLongDate(d.version_date) }) : t.kb.kindRules}
                        </Badge>
                      )}
                      {staleIds.has(d.id) && <Badge tone="warning">{t.kb.toReview}</Badge>}
                      {(d.kind === "rules" || d.reviewed_at) && (
                        <span className="text-ink-soft">
                          {d.reviewed_at ? fmt(t.kb.reviewedBadge, { date: formatLongDate(d.reviewed_at) }) : t.kb.neverReviewed}
                        </span>
                      )}
                      <span className="text-ink-soft tabular">
                        {count === 1 ? t.kb.paragraphsOne : fmt(t.kb.paragraphs, { count })} ·{" "}
                        {fmt(t.kb.updated, { date: `${formatDay(d.updated_at)} ${formatTime(d.updated_at)}` })}
                      </span>
                    </div>
                    <Disclosure summary={t.kb.edit}>
                      <KbForm
                        values={{
                          id: d.id,
                          title: d.title,
                          sport: d.sport_slug ?? "",
                          sourceUrl: d.source_url ?? "",
                          kind: d.kind,
                          versionDate: d.version_date ?? "",
                          reviewedAt: d.reviewed_at ?? "",
                          body: d.body,
                          published: d.published,
                        }}
                        sports={sports}
                      />
                    </Disclosure>
                    <Disclosure summary={t.kb.delete}>
                      <form action={deleteKbDocument}>
                        <input type="hidden" name="id" value={d.id} />
                        <Button type="submit" variant="danger">
                          {t.kb.deleteConfirm}
                        </Button>
                      </form>
                    </Disclosure>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        <h3 className="mt-2 font-bold" id="admin-ai-kb-new">
          {t.kb.create}
        </h3>
        <Card aria-labelledby="admin-ai-kb-new">
          <KbForm values={EMPTY_KB} sports={sports} />
        </Card>
      </Section>
    </div>
  );
}

export default function AdminAssistantPage() {
  return (
    <div className="grid gap-4">
      <h2 className="display text-3xl">{t.title}</h2>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <AssistantAdmin />
      </Suspense>
    </div>
  );
}
