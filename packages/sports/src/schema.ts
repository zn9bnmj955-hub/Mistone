import { z } from "zod";

/**
 * A sport is pure configuration. The draw engine and the shared UI only read
 * these fields; they never branch on a sport slug.
 */

export const COMPETITION_FORMATS = [
  "single_elimination",
  "pools_then_bracket",
  "swiss",
  "round_robin",
  "melee_rotation",
] as const;
export type CompetitionFormat = (typeof COMPETITION_FORMATS)[number];

export const RANKING_CRITERIA = [
  "wins",
  "match_points",
  "point_diff",
  "points_for",
  "head_to_head",
  "random",
] as const;
export type RankingCriterion = (typeof RANKING_CRITERIA)[number];

export const CATEGORIES = ["all", "seniors", "veterans", "women", "mixed", "youth"] as const;
export type Category = (typeof CATEGORIES)[number];

const nounSchema = z.object({
  singular: z.string().min(1),
  plural: z.string().min(1),
});

const teamFormatSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  label: z.string().min(1),
  players: z.number().int().min(1),
  /** Inclusive range of substitutes a club may allow. */
  substitutes: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }),
  /** Mêlée: players register alone and teams are drawn. */
  individualRegistration: z.boolean().default(false),
  /**
   * Competition formats this team format can be played in (subset of the
   * sport's list). Omitted = all of them. A drawn mêlée (individual
   * registration) only works with a format that draws the teams.
   */
  competitionFormats: z.array(z.enum(COMPETITION_FORMATS)).min(1).optional(),
});

const scoringSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("points"),
    /** Points needed to win (pétanque: 13). */
    target: z.number().int().min(1),
    /** Optional time limit in minutes; null = no limit. */
    timeLimitMinutes: z.number().int().min(1).nullable(),
    allowDraw: z.literal(false),
  }),
  z.object({
    mode: z.literal("time"),
    /** Match duration in minutes (all periods). */
    durationMinutes: z.number().int().min(1),
    periods: z.number().int().min(1),
    allowDraw: z.boolean(),
    /** How a knockout draw is decided. */
    knockoutTieBreak: z.enum(["penalties", "extra_time_then_penalties", "golden_goal"]),
  }),
  z.object({
    mode: z.literal("sets"),
    setsToWin: z.number().int().min(1),
    pointsPerSet: z.number().int().min(1),
    allowDraw: z.literal(false),
  }),
]);

const notificationTemplatesSchema = z.object({
  /** Placeholders: {venue}, {venueLabel}, {time}, {opponent}, {minutes} */
  yourTurn: z.string(),
  drawPublished: z.string(),
  scoreValidated: z.string(),
  tournamentStarting: z.string(),
  reminderDayBefore: z.string(),
  notCheckedIn: z.string(),
  /** Team qualified « d'office » (one-sided match after the cadrage). Placeholders: {round} (may open the message: it is capitalised). */
  office: z.string(),
  /** Team entered a B or C bracket on its own (« opt_in »). Placeholders: {bracket} */
  bracketEntry: z.string(),
  /** Two-day tournament: the automatic chain stopped for the night. */
  paused: z.string(),
});

export const sportConfigSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  /** Icon id from the shared icon set. */
  icon: z.string().min(1),
  /** Accent colors are references to design tokens, not literal colors. */
  accentToken: z.string().regex(/^[a-z0-9-]+$/),
  enabled: z.boolean(),
  sortOrder: z.number().int(),

  venue: z.object({
    kind: z.enum(["field", "pitch", "table", "target", "court", "lane"]),
    noun: nounSchema,
    /**
     * parallel: many matches at once, one per venue (pétanque).
     * scheduled: few venues reused in time slots (football).
     */
    usage: z.enum(["parallel", "scheduled"]),
  }),
  teamNoun: nounSchema,
  teamFormats: z.array(teamFormatSchema).min(1),
  competitionFormats: z.array(z.enum(COMPETITION_FORMATS)).min(1),
  categories: z.array(z.enum(CATEGORIES)).min(1),
  scoring: scoringSchema,
  /** Average match length in minutes, used for scheduling estimates. */
  typicalMatchMinutes: z.number().int().min(1),
  /** Gap between two matches on the same venue (changeover, walking). */
  changeoverMinutes: z.number().int().min(0),
  ranking: z.object({
    criteria: z.array(z.enum(RANKING_CRITERIA)).min(1),
    /** Used when the criteria include match_points (round robin). */
    matchPoints: z.object({ win: z.number(), draw: z.number(), loss: z.number() }),
  }),
  license: z.object({
    requiredByDefault: z.boolean(),
    federation: z.string().nullable(),
    /** Format check only. Official verification stays with the organizer. */
    numberPattern: z.string().nullable(),
    numberHint: z.string().nullable(),
  }),
  defaults: z.object({
    teamFormat: z.string(),
    competitionFormat: z.enum(COMPETITION_FORMATS),
    category: z.enum(CATEGORIES),
    maxTeams: z.number().int().min(2),
    venues: z.number().int().min(1),
    rounds: z.number().int().min(1).nullable(),
    feeCents: z.number().int().min(0),
    feePer: z.enum(["team", "player"]),
    consolation: z.boolean(),
    consolationFromRound: z.number().int().min(1).nullable(),
    /** Concours B entry: "auto" = every eligible team, "opt_in" = teams that sign up. */
    consolationEntry: z.enum(["auto", "opt_in"]),
    /** Concours C (losers of the B's 1st game). */
    consolationC: z.boolean(),
    /** Elimination: full draws for this many games, then the "cadrage" to a power of two. */
    cadrageAfterRound: z.union([z.literal(1), z.literal(2)]),
    /** Score of a team exempt before the cadrage; null = same as the forfeit score. */
    byeScore: z.object({ winner: z.number().int().min(0), loser: z.number().int().min(0) }).nullable(),
    avoidSameClubFirstRound: z.boolean(),
    redrawEachRound: z.boolean(),
    /** Pools: "gsl" = pétanque 4-team pool in 3 games, "round_robin" = everyone plays everyone. */
    poolSystem: z.enum(["gsl", "round_robin"]),
    poolSize: z.number().int().min(3).max(8),
    /** Usual schedule of the day, local time (Europe/Paris). */
    schedule: z.object({
      startTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
      registrationClosesBeforeMinutes: z.number().int().min(0),
      checkInClosesBeforeMinutes: z.number().int().min(0),
    }),
  }),
  notifications: notificationTemplatesSchema,
});

export type SportConfig = z.infer<typeof sportConfigSchema>;
export type SportConfigInput = z.input<typeof sportConfigSchema>;
export type TeamFormat = SportConfig["teamFormats"][number];
export type Scoring = SportConfig["scoring"];
