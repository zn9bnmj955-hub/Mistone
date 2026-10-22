import {
  consolationEntrants,
  isBracketEnabled,
  isOfficeBye,
  isPauseHeld,
  pausedAt,
  roundsOf,
  type Bracket,
  type EngineState,
  type ExtraBracket,
  type Match,
  type PausePoint,
} from "@orgasport/engine";

/**
 * What the scoring table shows for the A, the B and the C (Lot 2, TM3).
 * Pure: computed from the engine state on this device, so it works offline.
 */

/** The brackets of this tournament: the A always, the B and the C when the configuration has them. */
export function tableBrackets(state: EngineState): Bracket[] {
  const list: Bracket[] = ["main"];
  if (isBracketEnabled(state, "consolation")) list.push("consolation");
  if (isBracketEnabled(state, "consolation_c")) list.push("consolation_c");
  return list;
}

const settingsOf = (state: EngineState, bracket: ExtraBracket) =>
  bracket === "consolation" ? state.tournament.config.consolation : state.tournament.config.consolationC;

/** Teams enter this bracket on their own (« opt_in ») and its first draw is not done yet: the table collects entries. */
export function collectsEntries(state: EngineState, bracket: Bracket): bracket is ExtraBracket {
  if (bracket === "main" || !isBracketEnabled(state, bracket)) return false;
  return settingsOf(state, bracket).entry === "opt_in" && roundsOf(state, bracket).length === 0;
}

export interface EntryCandidate {
  id: string;
  number: number;
  entered: boolean;
  /** Known to go to this bracket (lost the game that feeds it); false = may still win and stay in the A. */
  eligible: boolean;
}

/**
 * Teams the table can tick « Inscrite au B / C »: the teams that will feed
 * the bracket (losers of the A's 1st game, pool non-qualifiers, losers of
 * the B's 1st game) once known; before that, every team still in, so the
 * fee can be collected early. Entered teams are always listed.
 */
export function entryCandidates(state: EngineState, bracket: ExtraBracket): EntryCandidate[] {
  // Same rule as the engine, as if every team had entered.
  const asAuto: EngineState = {
    ...state,
    tournament: {
      ...state.tournament,
      config: {
        ...state.tournament.config,
        [bracket === "consolation" ? "consolation" : "consolationC"]: { ...settingsOf(state, bracket), entry: "auto" },
      },
    },
  };
  let known: Set<string> | null = null;
  try {
    known = new Set(consolationEntrants(asAuto, bracket).map((t) => t.id));
  } catch {
    known = null;
  }
  return Object.values(state.teams)
    .filter((t) => {
      const entered = Boolean(t.entries?.includes(bracket));
      if (known) return known.has(t.id) || entered;
      return entered || (t.status !== "waitlist" && t.status !== "withdrawn" && t.status !== "forfeit");
    })
    .sort((a, b) => a.number - b.number)
    .map((t) => ({ id: t.id, number: t.number, entered: Boolean(t.entries?.includes(bracket)), eligible: known ? known.has(t.id) : false }));
}

/** The two-day pause holds the next draw: the table shows « Reprendre le concours ». */
export function pauseOf(state: EngineState): PausePoint | null {
  if (state.tournament.status !== "live") return null;
  return pausedAt(state);
}

/**
 * The two-day pause holds every bracket: also while a match of the A's last
 * round before the pause is reopened during the night (pauseOf is then null,
 * « Reprendre » waits for its score). No draw button is offered meanwhile.
 */
export function pauseHeld(state: EngineState): boolean {
  return state.tournament.status === "live" && isPauseHeld(state);
}

/** One-sided game: « Office » in a cadrage (qualified without playing), « Exempt » before it, null for a real game. */
export function loneSideLabel(state: EngineState, match: Match): "office" | "exempt" | null {
  if (match.status !== "bye" || (match.sideA.length > 0 && match.sideB.length > 0)) return null;
  return isOfficeBye(state, match) ? "office" : "exempt";
}
