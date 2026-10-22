import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { isShortCode, normalizeShortCode } from "@orgasport/engine";
import { enabledSports, getSport } from "@orgasport/sports";
import { fmt, getMessages } from "@/i18n";
import { listCatalog, toCatalogQuery, type CatalogFilters } from "@/lib/data/catalog";
import { getMyNextMatch } from "@/lib/data/tournaments";
import { formatDay, formatEuros, formatLongDate, formatTime } from "@/lib/format";
import { createPublicClient } from "@/lib/supabase/public";
import { defaultForm, suggestFormat } from "@/lib/tournament-form";
import { loadTournament } from "@/lib/tournament/load";
import { registrationWindow } from "@/lib/tournament/registration-rules";
import type { Viewer } from "@/lib/viewer";
import { buildTeamViews, currentMatch, sideText, teamTimeline } from "@/terrain/view-model";

/**
 * Tools of the assistant. Every official fact (dates, draws, venues,
 * results, rules of a tournament) comes from here — the model is told never
 * to state such facts without a tool result. Tool results are compact JSON;
 * private data (licenses, contacts) is never returned.
 */
export type ToolContext = {
  viewer: Viewer | null;
  /** Where the person is (profile or device preferences), for "near me". */
  origin: { lat: number; lng: number } | null;
  nowMs: number;
  siteUrl: string;
};

const sportSlugs = () => enabledSports().map((s) => s.slug);

const searchInput = z.object({
  sport: z.string().optional(),
  city: z.string().max(80).optional(),
  near_me: z.boolean().optional(),
  when: z.enum(["today", "weekend", "week", "month", "all"]).optional(),
  radius_km: z.number().int().min(5).max(300).optional(),
  only_with_places: z.boolean().optional(),
});
const codeInput = z.object({ code: z.string().min(4).max(8) });
const nextMatchInput = z.object({ code: z.string().min(4).max(8).optional(), team_number: z.number().int().min(1).max(5000).optional() });
const adviceInput = z.object({
  sport: z.string(),
  teams: z.number().int().min(2).max(1024),
  venues: z.number().int().min(1).max(500),
  start_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});
const kbInput = z.object({ query: z.string().min(2).max(300), sport: z.string().optional() });

export function toolDefinitions(): Anthropic.Tool[] {
  const sports = sportSlugs();
  return [
    {
      name: "search_tournaments",
      description:
        "Cherche les concours publiés sur OrgaSport (à venir ou en cours). Utilise-le pour « concours près de chez moi », « ce week-end », un sport ou une ville.",
      input_schema: {
        type: "object",
        properties: {
          sport: { type: "string", enum: sports, description: "Sport (slug)." },
          city: { type: "string", description: "Ville ou commune citée par la personne." },
          near_me: { type: "boolean", description: "Autour de la position connue de la personne (profil ou appareil)." },
          when: { type: "string", enum: ["today", "weekend", "week", "month", "all"] },
          radius_km: { type: "integer", minimum: 5, maximum: 300 },
          only_with_places: { type: "boolean", description: "Seulement les concours avec des places restantes." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "my_next_match",
      description:
        "Prochain match d'une équipe : terrain, heure, adversaire. Sans argument : l'équipe de la personne connectée dans un concours en cours. Sinon donner le code du concours (4 caractères) et le numéro d'équipe.",
      input_schema: {
        type: "object",
        properties: {
          code: { type: "string", description: "Code du concours, ex. 7KQ2." },
          team_number: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
    },
    {
      name: "tournament_info",
      description:
        "Informations officielles d'un concours par son code : date, lieu, format, inscription (ouverte ou non), prix, pointage, contact, règlement particulier.",
      input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"], additionalProperties: false },
    },
    {
      name: "tournament_registrants",
      description: "Liste publique des équipes inscrites à un concours (numéros et noms tels qu'affichés publiquement).",
      input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"], additionalProperties: false },
    },
    {
      name: "format_advice",
      description:
        "Aide un organisateur à choisir un format : à partir du sport, du nombre d'équipes attendu, des terrains et de l'heure de début, calcule une proposition (format, tours, terrains nécessaires au 1er tour, nombre de matchs). Ne donne jamais d'heure de fin ni de durée.",
      input_schema: {
        type: "object",
        properties: {
          sport: { type: "string", enum: sports },
          teams: { type: "integer", minimum: 2, maximum: 1024 },
          venues: { type: "integer", minimum: 1, maximum: 500 },
          start_time: { type: "string", description: "HH:MM, heure de début (facultatif)." },
        },
        required: ["sport", "teams", "venues"],
        additionalProperties: false,
      },
    },
    {
      name: "knowledge_search",
      description:
        "Cherche dans la base de connaissances OrgaSport : fiches de règlement (résumé du règlement officiel, avec sa source et sa date) et fiches d'aide du site (fonctions, inscription, lien concours, table de marque, PIN des bénévoles, cadrage et Office, N.H., concours B et C, 2 jours, clôture et suppression des résultats, pointage, forfaits, exempts et liste d'attente, saisie des scores par les capitaines). À utiliser AVANT tes connaissances générales pour toute question de règle ou d'utilisation du site. Un résultat de règlement porte un champ « cite » : reprends-le tel quel dans ta réponse. Une fiche d'aide porte un champ « updated » (date de sa mise à jour), à donner si on te demande si l'information est récente.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string" }, sport: { type: "string", enum: sports } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  ].map((t) => ({ ...t, eager_input_streaming: true }) as Anthropic.Tool);
}

function code(raw: string): string | null {
  const c = normalizeShortCode(raw);
  return isShortCode(c) ? c : null;
}

async function searchTournaments(input: z.infer<typeof searchInput>, ctx: ToolContext) {
  const sport = input.sport && getSport(input.sport) ? input.sport : null;
  const filters: CatalogFilters = {
    sport,
    when: input.when ?? "all",
    radiusKm: input.near_me ? (input.radius_km ?? 50) : null,
    format: null,
    eligibility: null,
    category: null,
    places: Boolean(input.only_with_places),
    view: "list",
    sort: input.near_me ? "distance" : "date",
    point: null,
  };
  const origin = input.near_me ? ctx.origin : null;
  if (input.near_me && !origin) return { error: "position_inconnue", hint: "Demander la ville de la personne, ou l'inviter à la renseigner dans son profil." };
  let rows = await listCatalog(toCatalogQuery(filters, origin, ctx.nowMs));
  if (input.city) {
    const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const want = fold(input.city);
    rows = rows.filter((r) => r.city && fold(r.city).includes(want));
  }
  const m = getMessages();
  return {
    count: rows.length,
    tournaments: rows.slice(0, 8).map((r) => ({
      code: r.short_code,
      name: r.name,
      sport: getSport(r.sport_slug)?.name ?? r.sport_slug,
      status: m.status[r.status as keyof typeof m.status] ?? r.status,
      date: r.starts_at ? `${formatDay(r.starts_at)} à ${formatTime(r.starts_at)}` : null,
      city: r.city,
      distance_km: r.distance_km != null ? Math.round(r.distance_km) : null,
      team_format: getSport(r.sport_slug)?.teamFormats.find((f) => f.id === r.team_format)?.label ?? null,
      places_left: r.max_teams != null ? Math.max(0, r.max_teams - r.active_teams) : null,
      fee: r.fee_cents > 0 ? formatEuros(r.fee_cents) : "gratuit",
      eligibility: r.eligibility,
      club: r.club_name,
      url: `${ctx.siteUrl}/concours/${r.short_code}`,
    })),
  };
}

async function nextMatch(input: z.infer<typeof nextMatchInput>, ctx: ToolContext) {
  if (!input.code) {
    if (!ctx.viewer) return { error: "non_connecte", hint: "Demander le code du concours et le numéro d'équipe, ou proposer « Mon tirage »." };
    const mine = await getMyNextMatch(ctx.viewer.id);
    if (!mine) return { error: "aucun_concours_en_cours", hint: "La personne ne joue pas de concours en cours avec ce compte." };
    return {
      tournament: mine.tournament.name,
      code: mine.tournament.shortCode,
      team_number: mine.teamNumber,
      status: mine.status,
      venue: mine.venue ? `${mine.venueNoun} ${mine.venue}` : null,
      time: mine.scheduledAt ? formatTime(mine.scheduledAt) : null,
      opponent: mine.opponent,
      url: `${ctx.siteUrl}/c/${mine.tournament.shortCode}?equipe=${mine.teamNumber}`,
    };
  }
  const c = code(input.code);
  if (!c) return { error: "code_invalide" };
  const loaded = await loadTournament(c);
  if (!loaded) return { error: "concours_introuvable" };
  if (!input.team_number) return { error: "numero_equipe_manquant" };
  const team = Object.values(loaded.state.teams).find((t) => t.number === input.team_number);
  if (!team) return { error: "equipe_introuvable" };
  const views = buildTeamViews(loaded.state, loaded.meta.name_display);
  const now = currentMatch(teamTimeline(loaded.state, team.id));
  const venueNoun = getSport(loaded.meta.sport_slug)?.venue.noun.singular ?? "terrain";
  if (!now) return { tournament: loaded.meta.name, team_number: team.number, status: team.status, match: null, url: `${ctx.siteUrl}/c/${c}?equipe=${team.number}` };
  const venue = now.match.venueId ? loaded.state.venues[now.match.venueId]?.label : null;
  return {
    tournament: loaded.meta.name,
    team_number: team.number,
    team: views.get(team.id)?.label,
    match_status: now.match.status,
    venue: venue ? `${venueNoun} ${venue}` : null,
    time: now.match.scheduledAt ? formatTime(now.match.scheduledAt) : null,
    queue_position: now.queue,
    opponent: now.opponent.length ? sideText(views, now.opponent, getMessages()) : null,
    url: `${ctx.siteUrl}/c/${c}?equipe=${team.number}`,
  };
}

async function tournamentInfo(input: z.infer<typeof codeInput>, ctx: ToolContext) {
  const c = code(input.code);
  if (!c) return { error: "code_invalide" };
  const loaded = await loadTournament(c);
  if (!loaded) return { error: "concours_introuvable" };
  const { meta, sport, state } = loaded;
  const m = getMessages();
  const active = Object.values(state.teams).filter((t) => t.status !== "waitlist" && t.status !== "withdrawn").length;
  const cfg = state.tournament.config;
  return {
    code: c,
    name: meta.name,
    sport: sport.name,
    status: m.status[meta.status as keyof typeof m.status] ?? meta.status,
    date: meta.starts_at ? `${formatDay(meta.starts_at)} à ${formatTime(meta.starts_at)}` : null,
    check_in_until: meta.checkin_closes_at ? formatTime(meta.checkin_closes_at) : null,
    registrations_close: meta.registration_closes_at ? `${formatDay(meta.registration_closes_at)} à ${formatTime(meta.registration_closes_at)}` : null,
    registration: registrationWindow(meta, active, ctx.nowMs),
    place: [meta.address, meta.postcode, meta.city].filter(Boolean).join(", "),
    parking: meta.parking,
    food: meta.food,
    team_format: sport.teamFormats.find((f) => f.id === meta.team_format)?.label ?? null,
    competition_format: m.formatLabels[cfg.format],
    consolation: cfg.consolation.enabled,
    category: m.categoryLabels[meta.category as keyof typeof m.categoryLabels] ?? meta.category,
    eligibility: meta.eligibility,
    teams: { registered: active, max: meta.max_teams },
    fee: meta.fee_cents > 0 ? `${formatEuros(meta.fee_cents)} par ${meta.fee_per === "player" ? "joueur" : "équipe"}` : "gratuit",
    prize: meta.prize_text,
    organizer: meta.club?.name ?? null,
    contact: [meta.contact_name, meta.contact_phone].filter(Boolean).join(" · ") || null,
    rules: meta.rules_text ? meta.rules_text.slice(0, 3000) : null,
    links: { page: `${ctx.siteUrl}/concours/${c}`, live: `${ctx.siteUrl}/c/${c}`, register: `${ctx.siteUrl}/c/${c}/inscription` },
  };
}

async function registrants(input: z.infer<typeof codeInput>) {
  const c = code(input.code);
  if (!c) return { error: "code_invalide" };
  const loaded = await loadTournament(c);
  if (!loaded) return { error: "concours_introuvable" };
  const views = buildTeamViews(loaded.state, loaded.meta.name_display);
  const teams = Object.values(loaded.state.teams)
    .filter((t) => t.status !== "withdrawn")
    .sort((a, b) => a.number - b.number);
  return {
    count: teams.filter((t) => t.status !== "waitlist").length,
    waitlist: teams.filter((t) => t.status === "waitlist").length,
    max: loaded.meta.max_teams,
    teams: teams.slice(0, 60).map((t) => ({ number: t.number, name: views.get(t.id)?.label, club: t.club, waitlist: t.status === "waitlist" || undefined })),
  };
}

function formatAdvice(input: z.infer<typeof adviceInput>, ctx: ToolContext) {
  const sport = getSport(input.sport);
  if (!sport) return { error: "sport_inconnu" };
  const base = defaultForm(sport, { club: { name: "Club" }, person: {}, nowMs: ctx.nowMs });
  const form = { ...base, name: "Concours", maxTeams: input.teams, venueCount: input.venues, startTime: input.start_time ?? base.startTime };
  const advice = suggestFormat(form, sport, input.teams);
  const m = getMessages();
  const merged = { ...form, ...advice.changes };
  return {
    format: m.formatLabels[merged.format],
    rounds: merged.rounds,
    consolation: merged.consolation,
    venues_needed_first_round: advice.plan.firstRoundVenuesNeeded,
    first_round_delayed_matches: advice.plan.firstRoundDelayed,
    total_matches: advice.plan.totalMatches,
    reasons: advice.reasons.map((r) => r.key),
    venue_noun: sport.venue.noun.plural,
  };
}

async function knowledgeSearch(input: z.infer<typeof kbInput>) {
  const { data, error } = await createPublicClient().rpc("kb_search", {
    p_query: input.query,
    p_sport: input.sport && getSport(input.sport) ? input.sport : (null as unknown as string),
    p_limit: 5,
  });
  if (error) return { error: "recherche_indisponible" };
  return {
    results: (data ?? []).map((r) => {
      const cite = rulesCitation(r);
      const updated = helpUpdated(r);
      return { title: r.title, text: r.content.slice(0, 1500), source: r.source_url ?? null, kind: r.kind, ...(cite ? { cite } : {}), ...(updated ? { updated } : {}) };
    }),
  };
}

/**
 * « Règlement en vigueur au 16 octobre 2026 (source : …) » for a rulebook
 * sheet, null for a help sheet. The assistant repeats it word for word, and
 * the fallback answer (no API key) prints it under the paragraph.
 */
export function rulesCitation(r: { kind?: string | null; version_date?: string | null; source_url?: string | null }): string | null {
  if (r.kind !== "rules" || !r.version_date) return null;
  const m = getMessages().assistantUi;
  const date = formatLongDate(r.version_date);
  return r.source_url ? fmt(m.rulesCitation, { date, source: r.source_url }) : fmt(m.rulesCitationNoSource, { date });
}

/**
 * « Fiche d'aide à jour au 22 octobre 2026. » for a dated help sheet, null
 * otherwise (a rulebook sheet cites its version instead).
 */
export function helpUpdated(r: { kind?: string | null; reviewed_at?: string | null }): string | null {
  if (r.kind !== "help" || !r.reviewed_at) return null;
  return fmt(getMessages().assistantUi.helpUpdated, { date: formatLongDate(r.reviewed_at) });
}

const SCHEMAS = {
  search_tournaments: searchInput,
  my_next_match: nextMatchInput,
  tournament_info: codeInput,
  tournament_registrants: codeInput,
  format_advice: adviceInput,
  knowledge_search: kbInput,
} as const;

export type ToolName = keyof typeof SCHEMAS;

/** Validates the model's input (never trusted), runs the tool, returns JSON text. */
export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const schema = SCHEMAS[name as ToolName];
  if (!schema) return { content: JSON.stringify({ error: "outil_inconnu" }), isError: true };
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) return { content: JSON.stringify({ error: "parametres_invalides", details: parsed.error.issues.map((i) => i.path.join(".")) }), isError: true };
  try {
    const input = parsed.data as never;
    const result =
      name === "search_tournaments"
        ? await searchTournaments(input, ctx)
        : name === "my_next_match"
          ? await nextMatch(input, ctx)
          : name === "tournament_info"
            ? await tournamentInfo(input, ctx)
            : name === "tournament_registrants"
              ? await registrants(input)
              : name === "format_advice"
                ? formatAdvice(input, ctx)
                : await knowledgeSearch(input);
    return { content: JSON.stringify(result), isError: false };
  } catch (e) {
    console.error("assistant tool failed", name, e);
    return { content: JSON.stringify({ error: "erreur_interne" }), isError: true };
  }
}

export { sportSlugs };
