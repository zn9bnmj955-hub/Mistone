import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Read from apps/web/.env.local (loaded by playwright.config.ts): no key in the code.
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const CRON = `Bearer ${process.env.CRON_SECRET ?? ""}`;

async function pinLogin(page: Page, code = "7KQ2", pin = "4821") {
  await page.goto(`/c/${code}/table`);
  await page.getByLabel("Code PIN").fill(pin);
  await page.getByRole("button", { name: "Ouvrir la table de marque" }).click();
  await expect(page.getByText("En ligne")).toBeVisible({ timeout: 15_000 });
}

type State = {
  version: number;
  state: {
    matches: Record<string, { id: string; status: string; sideA: string[]; sideB: string[]; venueId: string | null; scoreA: number | null }>;
    teams: Record<string, { id: string; number: number }>;
    venues: Record<string, { id: string; label: string }>;
    teamSecrets: Record<string, { code: string }>;
  };
};

async function staffState(request: APIRequestContext, code = "7KQ2"): Promise<State> {
  await request.post(`/api/t/${code}/pin`, { data: { pin: "4821" } });
  const res = await request.get(`/api/t/${code}/state`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as State;
}

test.describe("public tournament page", () => {
  test("works without JavaScript and stays far below 100 KB", async ({ browser, request }) => {
    const res = await request.get("/c/7KQ2?equipe=14");
    const body = await res.text();
    expect(body.length).toBeLessThan(100_000);
    expect(body).not.toContain("_next/static");

    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/c/7KQ2");
    await page.getByLabel("Trouver mon équipe").fill("14");
    await page.getByRole("button", { name: "OK" }).click();
    const card = page.locator("#mon-equipe");
    await expect(card).toContainText("Équipe 14");
    await expect(card).toContainText("À vous !");
    await expect(card.locator(".v").first()).toHaveText("12");
    // Other tabs work too (plain links).
    await page.getByRole("link", { name: "Tableau" }).click();
    await expect(page.getByRole("heading", { name: "Cadrage" })).toBeVisible();
    await context.close();
  });

  test("a player finds the next match in seconds after scanning the QR code", async ({ page }) => {
    const start = Date.now();
    await page.goto("/c/7KQ2");
    await page.getByLabel("Trouver mon équipe").fill("Benali / Morin");
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.locator("#mon-equipe")).toContainText("Terrain");
    expect(Date.now() - start).toBeLessThan(10_000);
    // Remember it on this device: next visit opens the team directly.
    await page.getByRole("link", { name: "C'est mon équipe" }).click();
    await page.goto("/c/7KQ2");
    await expect(page.locator("#mon-equipe")).toContainText("Équipe 14");
    // Draw sheets: the team's cells are outlined in every round it played.
    await expect(page.locator("table.sheet td.me").first()).toBeVisible();
  });

  test("updates live when the scoring table enters a result", async ({ page, request }) => {
    const { state } = await staffState(request);
    const playing = Object.values(state.matches).find((m) => m.status === "playing")!;
    const teamNumber = state.teams[playing.sideA[0]!]!.number;
    await page.goto(`/c/7KQ2?equipe=${teamNumber}`);
    await expect(page.locator("#mon-equipe")).not.toContainText("Gagné 13–4");
    await page.waitForTimeout(1500); // websocket joined
    const res = await request.post("/api/t/7KQ2/commands", {
      data: { clientOpId: crypto.randomUUID(), command: { type: "match.score", matchId: playing.id, scoreA: 13, scoreB: 4 } },
    });
    expect(res.ok()).toBe(true);
    await expect(page.locator("#mon-equipe")).toContainText("Gagné 13–4", { timeout: 10_000 });
  });

  test("printable A4 poster with the QR code", async ({ page }) => {
    await page.goto("/c/7KQ2/affiche");
    await expect(page.getByText("7KQ2").first()).toBeVisible();
    await expect(page.locator("svg")).toHaveCount(1);
    const qr = await page.request.get("/c/7KQ2/qr.svg");
    expect(qr.headers()["content-type"]).toContain("image/svg+xml");
  });
});

test.describe("scoring table", () => {
  test("a wrong PIN is refused", async ({ page }) => {
    await page.goto("/c/7KQ2/table");
    await page.getByLabel("Code PIN").fill("0000");
    await page.getByRole("button", { name: "Ouvrir la table de marque" }).click();
    await expect(page.getByText("Code PIN incorrect")).toBeVisible();
  });

  test("quick score, history and undo", async ({ page, request }) => {
    await pinLogin(page);
    const { state } = await staffState(request);
    const venueById = new Map(Object.values(state.venues).map((v) => [v.id, v.label]));
    const target = Object.values(state.matches).find((m) => m.status === "playing" && m.venueId)!;
    const label = venueById.get(target.venueId!)!;
    await page.getByRole("button", { name: /Scores/ }).click();
    await page.locator("#quick-score").fill(`${label} 13 8`);
    await page.keyboard.press("Enter");
    await expect(page.getByText(`Terrain ${label} :`)).toBeVisible();
    await expect(page.getByText(/saisie\(s\) en attente/)).toHaveCount(0, { timeout: 10_000 });
    let after = await staffState(request);
    expect(after.state.matches[target.id]!.status).toBe("done");

    await page.getByRole("button", { name: /Historique/ }).click();
    await expect(page.getByText("Score · 13–8")).toBeVisible();
    await page.getByRole("button", { name: /Annuler/ }).first().click();
    await expect(page.getByText("Score · 13–8 · annulée")).toBeVisible();
    after = await staffState(request);
    expect(after.state.matches[target.id]!.status).toBe("playing");
  });

  test("no entry is lost when the network drops", async ({ page, context, request }) => {
    await pinLogin(page);
    const { state } = await staffState(request);
    const venueById = new Map(Object.values(state.venues).map((v) => [v.id, v.label]));
    const target = Object.values(state.matches).find((m) => m.status === "playing" && m.venueId)!;
    await page.getByRole("button", { name: /Scores/ }).click();
    await context.setOffline(true);
    await page.locator("#quick-score").fill(`${venueById.get(target.venueId!)} 2 13`);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Hors ligne" })).toBeVisible();
    await expect(page.getByText("1 saisie(s) en attente").first()).toBeVisible();
    // Reloading while offline keeps the queue (stored on the device).
    await context.setOffline(false);
    await expect(page.getByText(/saisie\(s\) en attente/)).toHaveCount(0, { timeout: 20_000 });
    const after = await staffState(request);
    expect(after.state.matches[target.id]!.status).toBe("done");
    expect(after.state.matches[target.id]!.scoreA).toBe(2);
  });

  test("backup printing works from the data on the device", async ({ page }) => {
    await pinLogin(page);
    // Record what is on the page at the moment the print dialog would open:
    // the document only exists while printing, so polling the DOM is racy.
    await page.evaluate(() => {
      const w = window as unknown as { __printed?: string };
      window.print = () => {
        w.__printed = document.getElementById("print-root")?.textContent ?? "";
        window.dispatchEvent(new Event("afterprint"));
      };
    });
    await page.getByRole("button", { name: /Impression/ }).click();
    await page.getByRole("button", { name: /Feuilles de match/ }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __printed?: string }).__printed ?? null))
      .toContain("Feuille de match");
    // Once printed, the page goes back to normal.
    await expect(page.locator("#print-root")).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveClass(/printing/);
  });

  test("organizer: check-in, on-site registration, draw, then the public page shows it", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByRole("button", { name: "Se connecter avec un mot de passe" }).click();
    await page.getByLabel("Adresse email").fill("club@demo.orgasport.fr");
    await page.getByLabel("Mot de passe").fill("orgasport-demo");
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    await page.waitForURL("**/accueil");

    await page.goto("/c/GP3M/table");
    await expect(page.getByText("En ligne")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Ouvrir le pointage" }).click();
    for (const n of [1, 2, 3, 4, 5]) {
      await page
        .locator("li")
        .filter({ has: page.locator("span", { hasText: new RegExp(`^${n}$`) }) })
        .getByRole("button", { name: "Présente" })
        .click();
    }
    await page.getByRole("button", { name: /Ajouter une équipe sur place/ }).click();
    await page.getByLabel(/Joueur 1 · Prénom/).fill("Marie");
    await page.getByLabel("Nom", { exact: true }).first().fill("Sur-Place");
    await page.getByRole("button", { name: "Inscrire et pointer" }).click();
    await expect(page.getByText("6 pointée(s) sur 24")).toBeVisible();

    await page.getByRole("button", { name: /Tirage/ }).first().click();
    await page.getByRole("button", { name: "Lancer le tirage" }).click();
    await expect(page.getByRole("heading", { name: /1re partie|Cadrage|1\/4 de finale|1\/2 finale/ }).first()).toBeVisible();
    await expect(page.getByText(/saisie\(s\) en attente/)).toHaveCount(0, { timeout: 10_000 });

    await page.goto("/c/GP3M");
    await expect(page.locator("table tbody tr")).toHaveCount(3);
    // This tournament shows initials only, in « NOM PRÉNOM » order: "Marie Sur-Place" → "S. M.".
    await expect(page.getByText("S. M.").first()).toBeVisible();
    await expect(page.getByText("Sur-Place")).toHaveCount(0);
  });
});

test("captains enter the score, the opponent confirms", async ({ page, request }) => {
  // Switch the live tournament to captain scoring (organizer setting).
  const t = await request.get(`${SUPABASE}/rest/v1/tournaments?short_code=eq.7KQ2&select=id,config,state_version`, { headers: { apikey: SECRET, authorization: `Bearer ${SECRET}` } });
  const [row] = (await t.json()) as { id: string; config: Record<string, unknown>; state_version: number }[];
  // Bump the version too: the public page rebuilds the tournament once per state_version.
  await request.patch(`${SUPABASE}/rest/v1/tournaments?id=eq.${row!.id}`, {
    headers: { apikey: SECRET, authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    data: { config: { ...row!.config, scoreEntry: "captains" }, state_version: row!.state_version + 1 },
  });
  const { state } = await staffState(request);
  const match = Object.values(state.matches).find((m) => m.status === "playing")!;
  const [a, b] = [match.sideA[0]!, match.sideB[0]!];
  const na = state.teams[a]!.number;
  const nb = state.teams[b]!.number;

  await page.goto(`/c/7KQ2?equipe=${na}`);
  await page.getByLabel("Nous").fill("13");
  await page.getByLabel("Eux").fill("6");
  await page.getByLabel("Code équipe").fill(state.teamSecrets[a]!.code);
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.getByText("Score envoyé")).toBeVisible();

  await page.goto(`/c/7KQ2?equipe=${nb}`);
  await page.getByLabel("Nous").fill("6");
  await page.getByLabel("Eux").fill("13");
  await page.getByLabel("Code équipe").fill(state.teamSecrets[b]!.code);
  await page.getByRole("button", { name: "Envoyer" }).click();
  await expect(page.getByText("Score validé")).toBeVisible();
  const after = await staffState(request);
  expect(after.state.matches[match.id]!.status).toBe("done");

  await request.patch(`${SUPABASE}/rest/v1/tournaments?id=eq.${row!.id}`, {
    headers: { apikey: SECRET, authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    data: { config: row!.config },
  });
});

test("the last draw viewed stays readable without network", async ({ page, context }) => {
  await page.goto("/c/7KQ2?equipe=14");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Second visit goes through the service worker and fills its cache.
  await page.reload();
  await expect(page.locator("#mon-equipe")).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#mon-equipe")).toContainText("Équipe 14");
  await expect(page.getByText("Hors connexion")).toBeVisible();
  await context.setOffline(false);
});

test("automatic draw at the scheduled time", async ({ request }) => {
  const headers = { apikey: SECRET, authorization: `Bearer ${SECRET}`, "content-type": "application/json" };
  const t = await request.get(`${SUPABASE}/rest/v1/tournaments?short_code=eq.PQ8P&select=id,config`, { headers });
  const [row] = (await t.json()) as { id: string; config: Record<string, unknown> }[];
  await request.patch(`${SUPABASE}/rest/v1/tournaments?id=eq.${row!.id}`, {
    headers,
    data: { config: { ...row!.config, autoDrawAt: new Date(Date.now() - 60_000).toISOString() } },
  });
  const denied = await request.get("/api/cron/tick");
  expect(denied.status()).toBe(401);
  const tick = await request.get("/api/cron/tick", { headers: { authorization: CRON } });
  expect(((await tick.json()) as { drawn: string[] }).drawn).toContain("PQ8P");
  const page = await request.get("/c/PQ8P");
  const html = await page.text();
  expect(html).toContain("Poules · partie 1");
  // A second tick does nothing more.
  const again = await request.get("/api/cron/tick", { headers: { authorization: CRON } });
  expect(((await again.json()) as { drawn: string[] }).drawn).toEqual([]);
});

test("table de marque sur téléphone : au pointage, le nom des équipes reste lisible", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await pinLogin(page);
  await page.getByRole("tab", { name: "Pointage" }).or(page.getByRole("button", { name: "Pointage" })).first().click();
  const name = page.locator("li span.truncate.text-lg").first();
  await expect(name).toBeVisible();
  const box = await name.boundingBox();
  expect(box!.width).toBeGreaterThan(200);
});
