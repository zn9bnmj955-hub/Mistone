import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * P2 acceptance without touching the demo database: the generated seed is
 * loaded, in one transaction, into a scratch copy of the current local schema
 * (database `seed_check`, dropped afterwards), then the demo scenarios are
 * read back with SQL. Skipped when the local Supabase container is not running.
 */
const root = path.resolve(__dirname, "../../..");
const container = `supabase_db_${/^project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(path.join(root, "supabase/config.toml"), "utf8"))![1]}`;
const DB = "seed_check";

function docker(args: string[], input?: string): string {
  return execFileSync("docker", ["exec", "-i", container, ...args], { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
}
const psql = (db: string, sql: string, extra: string[] = []) => docker(["psql", "-U", "supabase_admin", "-d", db, "-Atq", ...extra], sql);

let running = false;
try {
  running = docker(["pg_isready", "-q"]) !== undefined;
} catch {
  running = false;
}

describe.skipIf(!running)("demo seed loaded into the current schema (P2)", () => {
  const rows = (sql: string) => psql(DB, sql).trim().split("\n");

  afterAll(() => {
    psql("postgres", `drop database if exists ${DB} with (force);`);
  });

  it("loads in one transaction without error", () => {
    psql("postgres", `drop database if exists ${DB} with (force);\ncreate database ${DB};`);
    const skip = ["cron", "net", "_realtime", "realtime", "storage", "supabase_functions", "graphql", "graphql_public", "vault", "pgsodium", "_analytics", "supabase_migrations"];
    const schema = docker(["pg_dump", "-U", "supabase_admin", "-d", "postgres", "--schema-only", ...skip.flatMap((s) => ["-N", s])]);
    // Objects tied to the skipped schemas (vault) fail here and are not needed by the seed.
    try {
      psql(DB, schema);
    } catch {
      /* partial errors only, checked by the seed load below */
    }
    psql(DB, readFileSync(path.join(root, "supabase/seed.sql"), "utf8"), ["-v", "ON_ERROR_STOP=1", "-1"]);
    expect(rows("select count(*) from public.tournaments where short_code is not null")[0]).not.toBe("0");
  });

  it("is pétanque only: the six demo tournaments, no FT8S", () => {
    expect(rows("select short_code || ':' || sport_slug from public.tournaments where short_code is not null and status <> 'draft' order by 1")).toEqual(
      ["2J7P", "7KQ2", "C4DR", "GP3M", "PQ8P", "TR8E"].map((c) => `${c}:petanque`),
    );
  });

  const shape = (code: string, bracket: string) =>
    rows(`select r.number || ':' || count(m.*) || ':' || count(m.*) filter (where m.team_b_id is null and coalesce(cardinality(m.side_b), 0) = 0)
      from public.rounds r join public.tournaments t on t.id = r.tournament_id left join public.matches m on m.round_id = r.id
      where t.short_code = '${code}' and r.bracket = '${bracket}' group by r.number order by r.number`);

  it("7KQ2: 32 doublettes, 3 absent (forfeit), 1st game then a cadrage of 7 parties + 1 « Office », and the B", () => {
    expect(rows(`select count(*) || ':' || count(*) filter (where te.checked_in_at is null and te.status = 'forfeit') || ':' || min(t.team_format)
      from public.teams te join public.tournaments t on t.id = te.tournament_id where t.short_code = '7KQ2'`)).toEqual(["32:3:doublette"]);
    expect(shape("7KQ2", "main")).toEqual(["1:15:1", "2:8:1"]);
    expect(shape("7KQ2", "consolation")[0]).toBe("1:7:0");
  });

  it("7KQ2: teams of one club (club name) and « N.H. » teams (no team club)", () => {
    const [nh, nhNoClub, one, oneWithClub] = rows(`with x as (
        select te.club_name, count(distinct p.club_number) n, bool_and(p.club_number is not null) all_club
        from public.teams te join public.tournaments t on t.id = te.tournament_id join public.players p on p.team_id = te.id
        where t.short_code = '7KQ2' group by te.id, te.club_name)
      select count(*) filter (where all_club and n > 1) || ',' || count(*) filter (where all_club and n > 1 and club_name is null) || ','
        || count(*) filter (where all_club and n = 1) || ',' || count(*) filter (where all_club and n = 1 and club_name is not null) from x`)[0]!
      .split(",")
      .map(Number);
    expect(nh).toBeGreaterThan(0);
    expect(nhNoClub).toBe(nh);
    expect(one).toBeGreaterThan(0);
    expect(oneWithClub).toBe(one);
  });

  it("C4DR: finished, a cadrage (« Office ») in the A, the B and the C", () => {
    expect(rows("select status from public.tournaments where short_code = 'C4DR'")).toEqual(["finished"]);
    for (const bracket of ["main", "consolation", "consolation_c"]) {
      expect(shape("C4DR", bracket).some((r) => r.split(":")[0] !== "1" && r.split(":")[2] !== "0"), bracket).toBe(true);
    }
  });

  it("2J7P: live, on pause after the cadrage (the 1/4 not drawn); PQ8P: 8 triplettes in pools", () => {
    expect(rows("select status from public.tournaments where short_code = '2J7P'")).toEqual(["live"]);
    expect(shape("2J7P", "main")).toEqual(["1:12:0", "2:8:4"]);
    expect(rows(`select t.config->>'format' || ':' || t.team_format || ':' || count(te.*) from public.tournaments t
      join public.teams te on te.tournament_id = t.id where t.short_code = 'PQ8P' group by t.id`)).toEqual(["pools_then_bracket:triplette:8"]);
  });
});
