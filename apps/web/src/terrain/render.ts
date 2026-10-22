import { roundsOf as engineRounds, type EngineState, type Match } from "@orgasport/engine";
import type { SportConfig } from "@orgasport/sports";
import { fmt, getMessages, type Messages } from "@/i18n";
import { env } from "@/lib/env";
import { formatDay, formatEuros, formatTime } from "@/lib/format";
import type { TournamentMeta } from "@/lib/tournament/load";
import { registrationWindow } from "@/lib/tournament/registration-rules";
import { legalLinks } from "./legal";
import { html, jsonForScript, raw, type SafeHtml } from "./html";
import { TERRAIN_CSS } from "./styles.generated";
import { LIVE_SCRIPT } from "./live-script";

/** Browser bar color = the light « inverse » token (read from the token stylesheet, never hard-coded). */
const THEME_COLOR = /--os-inverse:([^;}]+)/.exec(TERRAIN_CSS)?.[1] ?? "";
import { notifyBlock, notifyScriptTag, TERRAIN_HEAD_LINKS } from "./notify-script";
import {
  buildTeamViews,
  currentMatch,
  currentRounds,
  drawSheets,
  findTeams,
  matchesOfRound,
  poolLabels,
  poolMatches,
  roundLabel,
  sideShort,
  sideText,
  standings,
  teamTimeline,
  venueName,
  type DrawSide,
  type MyMatchInfo,
  type TeamView,
} from "./view-model";

export type TerrainView = "tirage" | "tableau" | "poules" | "classement" | "complementaire" | "infos";
export const VIEWS: TerrainView[] = ["tirage", "tableau", "poules", "classement", "complementaire", "infos"];

export interface RenderInput {
  meta: TournamentMeta;
  sport: SportConfig;
  state: EngineState;
  version: number;
  view: TerrainView;
  /** Team asked for (?equipe=) or remembered on this device. */
  query: string | null;
  mine: number | null;
  message: string | null;
  now: Date;
}

const ordinal = (n: number) => (n === 1 ? "1er" : `${n}e`);
const timeHM = (iso: string | null) => (iso ? formatTime(iso) : "");

interface Ctx {
  m: Messages;
  t: RenderInput;
  teams: Map<string, TeamView>;
  venue: string;
  venues: Map<string, string>;
  /** Teams highlighted (searched or remembered). */
  mineIds: Set<string>;
  /** Team remembered on this device ("C'est mon équipe"). */
  rememberedId: string | null;
  base: string;
  /** « Enregistrer pour hors ligne » file: no form, input or button is written. */
  saved: boolean;
}

function link(ctx: Ctx, params: Record<string, string | number | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `${ctx.base}?${s}` : ctx.base;
}

function scoreText(match: Match, side: "A" | "B"): string {
  const a = side === "A" ? match.scoreA : match.scoreB;
  const b = side === "A" ? match.scoreB : match.scoreA;
  if (a === null || b === null) return "";
  const tb = match.tiebreakA !== null && match.tiebreakB !== null ? ` (t.a.b. ${side === "A" ? match.tiebreakA : match.tiebreakB}–${side === "A" ? match.tiebreakB : match.tiebreakA})` : "";
  return `${a}–${b}${tb}`;
}

// ---------------------------------------------------------------------------
// "My team" card
// ---------------------------------------------------------------------------

function captainForm(ctx: Ctx, team: TeamView, info: MyMatchInfo): SafeHtml {
  const c = ctx.m.terrain.captain;
  if (ctx.saved || ctx.t.state.tournament.config.scoreEntry !== "captains" || isEnded(ctx.t.state)) return html``;
  if (!["ready", "playing", "score_submitted", "disputed"].includes(info.match.status)) return html``;
  return html`<form class="score-form" method="post" action="${ctx.base}/score">
    <p class="k">${c.title}</p>
    <input type="hidden" name="equipe" value="${team.number}">
    <div class="row">
      <label>${c.us}<input name="us" inputmode="numeric" pattern="[0-9]*" required></label>
      <label>${c.them}<input name="them" inputmode="numeric" pattern="[0-9]*" required></label>
      <label>${c.code}<input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off"></label>
      <button class="btn" type="submit">${c.send}</button>
    </div>
  </form>`;
}

/** Finished (corrections only, by the scoring table) or closed for good: nothing to enter from the public page. */
const isEnded = (state: EngineState) => state.tournament.status === "finished" || state.tournament.status === "archived";

/** Winner of the main knockout bracket (last round, a single decided match), else null. */
function mainChampion(state: EngineState): string[] | null {
  const final = engineRounds(state, "main", "final");
  const last = (final.length ? final : engineRounds(state, "main", "elimination")).at(-1);
  if (!last) return null;
  const ms = matchesOfRound(state, last.id);
  const x = ms.length === 1 ? ms[0]! : null;
  if (!x || (x.winner !== "A" && x.winner !== "B")) return null;
  return x.winner === "A" ? x.sideA : x.sideB;
}

/** « Concours terminé » (and « Lien clôturé » once closed) above the final results. */
function endedBanner(ctx: Ctx): SafeHtml | string {
  const state = ctx.t.state;
  if (!isEnded(state)) return "";
  const tm = ctx.m.terrain;
  const archived = state.tournament.status === "archived";
  const champion = mainChampion(state);
  return html`<section class="ended" id="termine" role="status">
    <p class="title">${tm.finished}${archived ? ` · ${tm.ended.closed}` : ""}</p>
    ${champion ? html`<p class="win">${fmt(tm.ended.winner, { team: sideText(ctx.teams, champion, ctx.m) })}</p>` : ""}
    <p class="muted">${archived ? tm.ended.archivedText : tm.ended.finishedText}</p>
  </section>`;
}

function myTeamCard(ctx: Ctx, team: TeamView): SafeHtml {
  const { m, t } = ctx;
  const tm = m.terrain;
  const timeline = teamTimeline(t.state, team.id);
  const now = currentMatch(timeline);
  const finished = timeline.filter((x) => ["done", "forfeit", "bye"].includes(x.match.status));
  const isMine = ctx.rememberedId === team.id;

  let body: SafeHtml;
  if (now) {
    const opp = now.opponent.length ? fmt(tm.against, { team: sideText(ctx.teams, now.opponent, m) }) : tm.waitingOpponent;
    const venueLabelText = now.match.venueId ? ctx.venues.get(now.match.venueId) ?? "—" : "—";
    const active = ["ready", "playing", "score_submitted", "disputed"].includes(now.match.status);
    const head = now.match.status === "ready" ? `${tm.yourTurn} ` : "";
    const flag =
      now.match.status === "score_submitted" ? tm.scoreSubmitted : now.match.status === "disputed" ? tm.disputed : null;
    body = html`<div class="big">
        <div><div class="k">${ctx.venue}</div><div class="v">${active ? venueLabelText : "—"}</div></div>
        <div><div class="k">${active ? m.home.time : tm.nextMatch}</div><div class="v">${active ? timeHM(now.match.scheduledAt).replace(" h ", ":") : now.queue ? ordinal(now.queue) : "…"}</div></div>
      </div>
      <div class="vs${active ? "" : " wait"}">${head}${opp}</div>
      ${
        !active && now.match.status === "waiting_venue"
          ? html`<div class="note">${now.queue ? fmt(tm.waitingVenue, { venue: ctx.venue.toLowerCase(), position: ordinal(now.queue) }) : fmt(tm.waitingVenueNoPos, { venue: ctx.venue.toLowerCase() })}</div>`
          : ""
      }
      ${now.match.status === "playing" ? html`<div class="note">${fmt(tm.playingOn, { venue: ctx.venue, label: venueLabelText })}</div>` : ""}
      ${flag ? html`<div class="note">${flag}</div>` : ""}
      <div class="note muted">${roundLabel(t.state, now.round, m)}</div>
      ${captainForm(ctx, team, now)}`;
  } else {
    const last = finished[finished.length - 1];
    let text = t.state.tournament.status === "finished" ? tm.finished : tm.notDrawn;
    if (last) {
      const won = last.match.winner === last.side;
      const consolationLater = timeline.some((x) => x.round.bracket === "consolation");
      if (last.match.status === "bye") text = tm.bye;
      else if (won && last.round.phase !== "pool" && engineRounds(t.state, last.round.bracket, last.round.phase).at(-1)?.id === last.round.id && matchesOfRound(t.state, last.round.id).length === 1)
        text = tm.champion;
      else if (!won && last.round.bracket === "main" && !consolationLater && (last.round.phase === "elimination" || last.round.phase === "final"))
        text = fmt(tm.eliminated, { round: roundLabel(t.state, last.round, m).toLowerCase() });
      else if (!won && consolationLater) text = tm.toConsolation;
    }
    body = html`<div class="vs wait">${text}</div>`;
  }

  const history = finished.length
    ? html`<div class="note"><div class="k">${tm.history}</div>${finished
        .slice()
        .reverse()
        .map((x) => {
          const label = roundLabel(t.state, x.round, m);
          if (x.match.status === "bye") return html`<div>${label} · ${tm.bye}</div>`;
          const score = scoreText(x.match, x.side);
          const result =
            x.match.status === "forfeit"
              ? x.match.winner === x.side
                ? tm.forfeitWon
                : tm.forfeitLost
              : x.match.winner === "draw"
                ? fmt(tm.draw, { score })
                : fmt(x.match.winner === x.side ? tm.won : tm.lost, { score });
          return html`<div>${label} · <span class="${x.match.winner === x.side ? "win" : ""}">${result}</span> · ${fmt(tm.against, { team: sideText(ctx.teams, x.opponent, m) })}</div>`;
        })}</div>`
    : "";

  return html`<section class="card" id="mon-equipe" aria-labelledby="team-title">
    <div class="head" id="team-title">${fmt(tm.team, { number: team.number })} · ${team.label}${team.club ? html`<small>${team.club}</small>` : ""}</div>
    ${body}
    ${history}
    ${["finished", "archived"].includes(t.meta.status) ? "" : notifyBlock(t.meta.short_code!, team.number)}
    <div class="note no-print">${
      isMine
        ? html`<a href="${link(ctx, { moi: 0 })}">${tm.notMine}</a>`
        : html`<a class="btn secondary" href="${link(ctx, { moi: team.number })}">${tm.myTeam}</a>`
    }</div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function matchRows(ctx: Ctx, matches: Match[]): SafeHtml {
  const tm = ctx.m.terrain;
  const order = (x: Match) => (["ready", "playing", "score_submitted", "disputed"].includes(x.status) ? 0 : x.status === "waiting_venue" ? 1 : x.status === "pending" ? 2 : 3);
  const venuePos = (x: Match) => (x.venueId ? ctx.t.state.venues[x.venueId]?.position ?? 999 : 999);
  const sorted = [...matches].sort((a, b) => order(a) - order(b) || venuePos(a) - venuePos(b) || a.position - b.position);
  return html`<table>
    <thead><tr><th>${tm.venue}</th><th>${tm.teams}</th><th class="score">${tm.scoreCol}</th></tr></thead>
    <tbody>${sorted.map((x) => {
      const a = sideShort(ctx.teams, x.sideA);
      const b = sideShort(ctx.teams, x.sideB);
      const mine = [...x.sideA, ...x.sideB].some((id) => ctx.mineIds.has(id));
      const finished = x.status === "done" || x.status === "forfeit";
      const statusText = tm.status[x.status];
      return html`<tr class="${mine ? "mine" : ""}">
        <td class="venue">${x.venueId && !finished ? ctx.venues.get(x.venueId) : x.status === "bye" ? "" : finished ? "" : "—"}</td>
        <td class="team">
          <div class="${x.winner === "A" ? "win" : ""}"><b>${a.number}</b> ${a.label}</div>
          ${x.status === "bye" ? "" : html`<div class="${x.winner === "B" ? "win" : ""}"><b>${b.number}</b> ${b.label}</div>`}
        </td>
        <td class="score">${finished ? html`<div>${x.scoreA ?? ""}</div><div>${x.scoreB ?? ""}</div>` : html`<span class="st ${x.status === "playing" || x.status === "ready" ? "live" : ""}">${statusText}</span>`}</td>
      </tr>`;
    })}</tbody>
  </table>`;
}

// ---------------------------------------------------------------------------
// Draw sheets: one big table per round (Terrain | Équipe | Équipe | Score)
// ---------------------------------------------------------------------------

const BRACKET_ANCHOR = { main: "concours-a", consolation: "concours-b", consolation_c: "concours-c" } as const;

/** One team cell: number, players one per line, club or « (N.H.) »; greyed when it lost. */
function sheetCell(ctx: Ctx, side: DrawSide): SafeHtml {
  const me = side.teamIds.some((id) => ctx.mineIds.has(id));
  const lines = side.affiliation ? [...side.players, side.affiliation] : side.players;
  const cls = side.lost ? (me ? "l me" : "l") : me ? "me" : "";
  return html`<td${cls ? raw(` class="${cls}"`) : ""}><i>${side.number}</i>${lines.map((x, i) => html`${i ? raw("<br>") : ""}${x}`)}</td>`;
}

/** The draw tab once drawn: A, B, C sections, newest round first, like the federation results pages. */
function sheetsBlock(ctx: Ctx): SafeHtml {
  const { m, t } = ctx;
  const s = m.terrain.sheet;
  const sheets = drawSheets(t.state, ctx.teams, t.sport, m);
  const head = html`<thead><tr><th>${ctx.venue}</th><th>${s.team}</th><th>${s.team}</th><th>${s.score}</th></tr></thead>`;
  return html`<p class="sheet-nav no-print">${
    sheets.length > 1
      ? html`<span class="muted">${s.jump} :</span> ${sheets.map((b) => html`<a href="#${BRACKET_ANCHOR[b.bracket]}">${b.title}</a> `)}<br>`
      : ""
  }<a href="${ctx.base}/equipes">${s.byTeams}</a><br><span class="muted">${s.hint}</span></p>${sheets.map(
    (b) => html`<section class="sheets" id="${BRACKET_ANCHOR[b.bracket]}">${sheets.length > 1 ? html`<h2>${b.title}</h2>` : ""}${b.rounds.map(
      (r) => html`<h3>${fmt(s.results, { label: r.label })}</h3><table class="sheet">${head}<tbody>${r.rows.map(
        (row) =>
          html`<tr><td class="c">${row.venue}</td>${row.a ? sheetCell(ctx, row.a) : raw("<td></td>")}${
            row.alone ? html`<td class="l o">${row.alone === "office" ? s.office : s.exempt}</td>` : row.b ? sheetCell(ctx, row.b) : raw("<td></td>")
          }<td class="c">${row.score}</td></tr>`,
      )}</tbody></table>`,
    )}</section>`,
  )}`;
}

function drawTab(ctx: Ctx, bracket: "main" | "consolation"): SafeHtml {
  const { m, t } = ctx;
  const rounds = currentRounds(t.state, bracket);
  if (rounds.length === 0) {
    if (bracket === "consolation") return html`<p class="muted">${m.terrain.notDrawn}</p>`;
    const teams = [...ctx.teams.values()].sort((a, b) => a.number - b.number);
    const autoAt = t.state.tournament.config.autoDrawAt;
    return html`<p class="msg">${m.terrain.notDrawn} ${autoAt ? fmt(m.terrain.notDrawnTime, { time: formatTime(autoAt) }) : ""}</p>
      <h2>${m.terrain.teams} (${teams.length})</h2>
      <table><tbody>${teams.map(
        (x) => html`<tr class="${ctx.mineIds.has(x.id) ? "mine" : ""}"><td class="venue n">${x.number}</td><td class="team">${x.label}${x.club ? html` <span class="muted">· ${x.club}</span>` : ""}</td><td class="score st">${t.state.teams[x.id]?.status === "checked_in" ? "✓" : ""}</td></tr>`,
      )}</tbody></table>`;
  }
  if (bracket === "main") return sheetsBlock(ctx);
  return html`${rounds.map((r) => {
    const ms = matchesOfRound(t.state, r.id);
    return html`<h2>${roundLabel(t.state, r, m)}</h2>${matchRows(ctx, ms)}`;
  })}`;
}

function bracketColumns(ctx: Ctx, bracket: "main" | "consolation"): SafeHtml {
  const { m, t } = ctx;
  const rounds = engineRounds(t.state, bracket).filter((r) => r.phase === "elimination" || r.phase === "final");
  if (rounds.length === 0) return html`<p class="muted">${m.terrain.notDrawn}</p>`;
  return html`<div class="bracket"><div class="cols">${rounds.map(
    (r) => html`<div class="col"><h3>${roundLabel(t.state, r, m)}</h3>${matchesOfRound(t.state, r.id).map((x) => {
      const a = sideShort(ctx.teams, x.sideA);
      const b = sideShort(ctx.teams, x.sideB);
      const mine = [...x.sideA, ...x.sideB].some((id) => ctx.mineIds.has(id));
      return html`<div class="box${mine ? " mine" : ""}">
        <div class="${x.winner === "A" ? "w" : ""}"><span>${a.number ? html`<b>${a.number}</b> ` : ""}${a.label}</span><span class="n">${x.scoreA ?? ""}</span></div>
        ${x.status === "bye" ? "" : html`<div class="${x.winner === "B" ? "w" : ""}"><span>${b.number ? html`<b>${b.number}</b> ` : ""}${b.label}</span><span class="n">${x.scoreB ?? ""}</span></div>`}
      </div>`;
    })}</div>`,
  )}</div></div>`;
}

function standingsTable(ctx: Ctx, rows: ReturnType<typeof standings>[number]["rows"]): SafeHtml {
  const tm = ctx.m.terrain;
  const usesPoints = ctx.t.state.tournament.config.ranking.includes("match_points");
  return html`<table>
    <thead><tr><th>${tm.rank}</th><th>${tm.teams}</th><th class="score">${tm.played}</th><th class="score">${usesPoints ? tm.points : tm.wins}</th><th class="score">${tm.diff}</th></tr></thead>
    <tbody>${rows.map((r) => {
      const team = ctx.teams.get(r.id);
      return html`<tr class="${ctx.mineIds.has(r.id) ? "mine" : ""}"><td class="venue">${r.rank}</td><td class="team"><b>${team?.number ?? ""}</b> ${team?.label ?? ""}</td><td class="score">${r.stats.played}</td><td class="score">${usesPoints ? r.stats.matchPoints : r.stats.wins}</td><td class="score">${r.stats.diff > 0 ? `+${r.stats.diff}` : r.stats.diff}</td></tr>`;
    })}</tbody>
  </table>`;
}

function poolsTab(ctx: Ctx): SafeHtml {
  const { m, t } = ctx;
  const labels = poolLabels(t.state);
  if (labels.length === 0) return html`<p class="muted">${m.terrain.notDrawn}</p>`;
  const blocks = standings(t.state, m).filter((b) => b.title.startsWith(fmt(m.terrain.pool, { label: "" }).trim()));
  return html`${labels.map((label, i) => html`<section class="pool"><h2>${fmt(m.terrain.pool, { label })}</h2>
      ${blocks[i] ? standingsTable(ctx, blocks[i]!.rows) : ""}
      ${matchRows(ctx, poolMatches(t.state, label))}
    </section>`)}`;
}

function standingsTab(ctx: Ctx): SafeHtml {
  const blocks = standings(ctx.t.state, ctx.m);
  if (blocks.every((b) => b.rows.length === 0)) return html`<p class="muted">${ctx.m.terrain.notDrawn}</p>`;
  return html`${blocks.map((b) => html`<h2>${b.title}</h2>${standingsTable(ctx, b.rows)}`)}`;
}

function infoTab(ctx: Ctx): SafeHtml {
  const { m, t } = ctx;
  const i = m.terrain.info;
  const meta = t.meta;
  const address = [meta.address, meta.postcode, meta.city].filter(Boolean).join(", ");
  const maps = meta.lat != null && meta.lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${meta.lat},${meta.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  const fee =
    meta.fee_cents > 0
      ? fmt(m.tournament.fee, { amount: formatEuros(meta.fee_cents), per: meta.fee_per === "player" ? m.tournament.perPlayer : m.tournament.perTeam })
      : m.tournament.free;
  return html`<dl class="info">
    <dt>${i.when}</dt><dd>${formatDay(meta.starts_at)} · ${formatTime(meta.starts_at)}</dd>
    <dt>${i.where}</dt><dd>${address} · <a href="${maps}" rel="noopener" target="_blank">${i.directions}</a></dd>
    ${meta.parking ? html`<dt>${i.parking}</dt><dd>${meta.parking}</dd>` : ""}
    ${meta.food ? html`<dt>${i.food}</dt><dd>${meta.food}</dd>` : ""}
    <dt>${i.fee}</dt><dd>${fee}</dd>
    ${meta.prize_text ? html`<dt>${i.prize}</dt><dd>${meta.prize_text}</dd>` : ""}
    ${meta.rules_text ? html`<dt>${i.rules}</dt><dd>${meta.rules_text}</dd>` : ""}
    ${meta.club ? html`<dt>${i.organizer}</dt><dd>${meta.club.name}</dd>` : ""}
    ${meta.contact_name || meta.contact_phone ? html`<dt>${i.contact}</dt><dd>${meta.contact_name ?? ""} ${meta.contact_phone ? html`· <a href="tel:${meta.contact_phone.replace(/\s/g, "")}">${meta.contact_phone}</a>` : ""}</dd>` : ""}
  </dl>`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function availableViews(state: EngineState): TerrainView[] {
  const cfg = state.tournament.config;
  const views: TerrainView[] = ["tirage"];
  if (cfg.format === "single_elimination" || cfg.format === "pools_then_bracket") views.push("tableau");
  if (cfg.format === "pools_then_bracket") views.push("poules");
  views.push("classement");
  if (cfg.consolation.enabled && (cfg.format === "single_elimination" || cfg.format === "pools_then_bracket")) views.push("complementaire");
  views.push("infos");
  return views;
}

function liveContent(ctx: Ctx, found: TeamView[] | null): SafeHtml {
  const { m, t } = ctx;
  const tm = m.terrain;
  const views = availableViews(t.state);
  const view = views.includes(t.view) ? t.view : "tirage";
  const tabLabel: Record<TerrainView, string> = {
    tirage: tm.tabs.draw,
    tableau: tm.tabs.bracket,
    poules: tm.tabs.pools,
    classement: tm.tabs.standings,
    complementaire: tm.tabs.consolation,
    infos: tm.tabs.info,
  };
  let teamBlock: SafeHtml | string = "";
  if (found && found.length === 1) teamBlock = myTeamCard(ctx, found[0]!);
  else if (found && found.length > 1)
    teamBlock = html`<div class="msg">${tm.several}<br>${found.slice(0, 20).map(
      (x) => html`<a href="${link(ctx, { equipe: x.number, vue: view === "tirage" ? null : view })}"><b>${x.number}</b> ${x.label}</a><br>`,
    )}</div>`;
  else if (found && found.length === 0 && t.query) teamBlock = html`<p class="msg err">${fmt(tm.notFound, { q: t.query })}</p>`;

  const content =
    view === "tableau"
      ? bracketColumns(ctx, "main")
      : view === "poules"
        ? poolsTab(ctx)
        : view === "classement"
          ? standingsTab(ctx)
          : view === "complementaire"
            ? html`${drawTab(ctx, "consolation")}<h2>${tm.tabs.bracket}</h2>${bracketColumns(ctx, "consolation")}`
            : view === "infos"
              ? infoTab(ctx)
              : drawTab(ctx, "main");

  const teamParam = t.query && found?.length === 1 ? t.query : null;
  return html`<div id="live" data-version="${t.version}">
    <p class="status">${t.meta.status === "live" ? html`<span class="dot"></span>` : ""}${m.status[t.meta.status as keyof Messages["status"]] ?? ""} · <span class="muted">${fmt(tm.updatedAt, { time: formatTime(t.now.toISOString()) })}</span></p>
    ${t.message ? html`<p class="msg ${t.message.startsWith("!") ? "err" : "ok"}" role="status">${t.message.replace(/^!/, "")}</p>` : ""}
    ${endedBanner(ctx)}
    ${teamBlock}
    <nav class="tabs" aria-label="Vues">${views.map(
      (v) => html`<a href="${link(ctx, { vue: v === "tirage" ? null : v, equipe: teamParam })}"${v === view ? raw(' aria-current="page"') : ""}>${tabLabel[v]}</a>`,
    )}</nav>
    <main>${content}</main>
  </div>`;
}

/** « S'inscrire » while online registrations are open (or on the waiting list). */
function registerLink(t: RenderInput): SafeHtml {
  const active = Object.values(t.state.teams).filter((x) => x.status !== "waitlist" && x.status !== "withdrawn").length;
  const window = registrationWindow(t.meta, active, t.now.getTime());
  if (window !== "open" && window !== "waitlist") return html``;
  const r = getMessages().terrain.register;
  return html`<p class="cta no-print"><a class="btn" href="/c/${t.meta.short_code}/inscription">${window === "waitlist" ? r.waitlist : r.open}</a></p>`;
}

/**
 * opts.standalone (« Enregistrer pour hors ligne », ?enregistrer=1): a self-contained
 * file that opens from file:// without network — CSS inlined, no script, no external
 * link (icons, manifest), no form; `origin` makes « Version à jour » an absolute link
 * to the live page (for when the network is back).
 */
export function renderTerrainPage(t: RenderInput, opts: { fragment: boolean; standalone?: boolean; origin?: string }): string {
  const m = getMessages();
  const teams = buildTeamViews(t.state, t.meta.name_display);
  const venues = new Map(Object.values(t.state.venues).map((v) => [v.id, v.label]));
  const code = t.meta.short_code!;
  // In the saved file (opened from file://) every link points to the live site.
  const site = opts.standalone ? (opts.origin ?? "") : "";
  const ctx: Ctx = {
    m,
    t,
    teams,
    venue: venueName(t.sport),
    venues,
    mineIds: new Set(),
    rememberedId: null,
    base: `${site}/c/${code}`,
    saved: opts.standalone === true,
  };
  const mineTeam = t.mine ? [...teams.values()].find((x) => x.number === t.mine) : undefined;
  if (mineTeam) {
    ctx.mineIds.add(mineTeam.id);
    ctx.rememberedId = mineTeam.id;
  }
  const found = t.query ? findTeams(teams, t.query) : mineTeam ? [mineTeam] : null;
  if (found?.length === 1) ctx.mineIds.add(found[0]!.id);

  const live = liveContent(ctx, found);
  if (opts.fragment) return live.value;

  const tm = m.terrain;
  const wsUrl = env.supabaseUrl && env.supabaseKey ? `${env.supabaseUrl.replace(/^http/, "ws")}/realtime/v1/websocket?apikey=${env.supabaseKey}&vsn=1.0.0` : "";
  const sportToken = t.sport.accentToken;
  const format = t.sport.teamFormats.find((f) => f.id === t.meta.team_format)?.label;
  const saved = opts.standalone === true;
  const viewParam = t.view === "tirage" ? null : t.view;
  const head = saved
    ? html`<style>${raw(TERRAIN_CSS)}</style>`
    : html`<noscript><meta http-equiv="refresh" content="30"></noscript>
<script>${raw('try{var th=localStorage.getItem("os_theme");if(th==="light"||th==="dark")document.documentElement.setAttribute("data-theme",th)}catch(e){}')}</script>
<style>${raw(TERRAIN_CSS)}</style>
${raw(TERRAIN_HEAD_LINKS)}`;
  const page = html`<!doctype html>
<html lang="fr" data-sport="${sportToken}"${saved ? raw(' class="saved"') : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t.meta.name} · ${code}</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="${THEME_COLOR}">
${head}
</head>
<body data-code="${code}" data-ws="${wsUrl}">
<div class="wrap">
  <header class="top">
    <a class="brand" href="${site}/">Orga<b>Sport</b></a><span class="code">${code}</span>
    <h1>${t.meta.name}</h1>
    <p class="meta">${[t.sport.name, format, t.meta.city].filter(Boolean).join(" · ")} · ${formatDay(t.meta.starts_at)}</p>
    ${saved ? "" : registerLink(t)}
  </header>
  ${
    saved
      ? html`<p class="msg">${fmt(tm.saved.note, { day: formatDay(t.now.toISOString()), time: formatTime(t.now.toISOString()) })} <a href="${site}/c/${code}">${tm.saved.live}</a></p>`
      : html`<p class="offline" role="status">${tm.offline}</p>
  <form class="find" method="get" action="/c/${code}" role="search">
    <label for="q">${tm.findLabel}</label>
    <div class="row"><input id="q" name="equipe" value="${t.query ?? ""}" placeholder="${tm.findPlaceholder}" autocomplete="off" inputmode="search"><button type="submit">${tm.findButton}</button></div>
  </form>`
  }
  ${live}<!--/live-->
  ${
    saved
      ? ""
      : html`<p class="save no-print"><a class="btn secondary" href="${link(ctx, { vue: viewParam, enregistrer: 1 })}" download>${tm.saved.button}</a><small>${tm.saved.help}</small></p>`
  }
  ${saved ? "" : html`<footer class="foot no-print">
    <a href="/c/${code}/affiche">${tm.poster}</a>
    <a href="/c/${code}/table">${tm.table}</a>
    <a href="/">${tm.poweredBy}</a>
    ${legalLinks()}
  </footer>`}
</div>
${!saved && found?.length === 1 && !["finished", "archived"].includes(t.meta.status) ? notifyScriptTag() : ""}
${saved ? "" : html`<script>var OS_V=${jsonForScript(t.version)};${raw(LIVE_SCRIPT)}</script>`}
</body>
</html>`;
  return page.value;
}

/**
 * Page of a tournament whose personal data was purged (14 days after the final):
 * only « Résultats supprimés », the name and the date stay. The fragment keeps the
 * #live wrapper so a page left open swaps to the same message.
 */
export function renderPurgedPage(meta: Pick<TournamentMeta, "short_code" | "name" | "starts_at" | "state_version">, opts: { fragment: boolean }): string {
  const m = getMessages().terrain;
  const code = meta.short_code!;
  const live = html`<div id="live" data-version="${meta.state_version}"><main><h2>${m.purged.title}</h2><p class="msg">${m.purged.text}</p></main></div>`;
  if (opts.fragment) return live.value;
  return html`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${meta.name} · ${code}</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="${THEME_COLOR}">
<script>${raw('try{var th=localStorage.getItem("os_theme");if(th==="light"||th==="dark")document.documentElement.setAttribute("data-theme",th)}catch(e){}')}</script>
<style>${raw(TERRAIN_CSS)}</style>
</head>
<body data-code="${code}">
<div class="wrap">
  <header class="top">
    <a class="brand" href="/">Orga<b>Sport</b></a><span class="code">${code}</span>
    <h1>${meta.name}</h1>
    <p class="meta">${formatDay(meta.starts_at)}</p>
  </header>
  ${live}
  <footer class="foot no-print">
    <a href="/">${m.poweredBy}</a>
    ${legalLinks()}
  </footer>
</div>
</body>
</html>`.value;
}
