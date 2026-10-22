import { roundLabel, type EngineState, type Round } from "@orgasport/engine";
import { formatTemplate, venueLabel, type SportConfig } from "@orgasport/sports";
import { fmt, type Messages } from "@/i18n";

/**
 * Notification texts come from the sport configuration (packages/sports:
 * `notifications`), so football says "Match dans 10 min, terrain 2" and
 * pétanque "À vous ! Terrain 12 · 15 h 40 · contre l'équipe 27 (…)".
 */
export type NotificationKind =
  | "your_turn"
  | "draw_published"
  | "score_validated"
  | "tournament_starting"
  | "reminder_day_before"
  | "not_checked_in"
  | "office"
  | "bracket_entry"
  | "paused";

const TEMPLATE_KEY: Record<NotificationKind, keyof SportConfig["notifications"]> = {
  your_turn: "yourTurn",
  draw_published: "drawPublished",
  score_validated: "scoreValidated",
  tournament_starting: "tournamentStarting",
  reminder_day_before: "reminderDayBefore",
  not_checked_in: "notCheckedIn",
  office: "office",
  bracket_entry: "bracketEntry",
  paused: "paused",
};

export type TemplateVars = {
  venue?: string;
  time?: string;
  opponent?: string;
  minutes?: number;
  round?: number | string;
  score?: string;
  tournament?: string;
  place?: string;
  /** « concours B » / « concours C ». */
  bracket?: string;
};

/** « 1/4 de finale », « cadrage », « concours B, 1re partie »: the round as named in a message. */
export function roundText(state: EngineState, round: Round, m: Messages): string {
  const r = m.notifications.rounds;
  const label = roundLabel(state, round);
  const text = "n" in label ? (label.key === "partie" && label.n === 1 ? r.partie1 : fmt(r[label.key], { n: label.n })) : r[label.key];
  return round.bracket === "main" ? text : fmt(m.notifications.bracketRound, { bracket: m.notifications.brackets[round.bracket], round: text });
}

export function renderBody(sport: SportConfig, kind: NotificationKind, vars: TemplateVars): string {
  const template = sport.notifications[TEMPLATE_KEY[kind]];
  const values: Record<string, string | number> = { venueLabel: venueLabel(sport) };
  for (const [k, v] of Object.entries(vars)) if (v !== undefined && v !== null) values[k] = v;
  // Unknown placeholders would show as "{x}": drop them and tidy separators.
  const body = formatTemplate(template, values)
    .replace(/\{\w+\}/g, "")
    .replace(/\s*·\s*(·\s*)+/g, " · ")
    .replace(/\s*·\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // A placeholder may open the message (« Cadrage : qualifiés d'office… »).
  return body.charAt(0).toUpperCase() + body.slice(1);
}
