import { expect, test, type Page } from "@playwright/test";

/**
 * Phase 6 — AI assistant. Without an API key (local and CI) the assistant
 * answers from the knowledge base: the same streamed route, the same chips.
 */

async function signIn(page: Page, email: string) {
  await page.goto("/connexion");
  await page.getByRole("button", { name: "Se connecter avec un mot de passe" }).click();
  await page.getByLabel("Adresse email").fill(email);
  await page.getByLabel("Mot de passe").fill("orgasport-demo");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.waitForURL("**/accueil");
}

test.describe("assistant", () => {
  test("a guest asks a starter question and gets a streamed answer with suggestions", async ({ page }) => {
    await page.goto("/assistant");
    await page.getByRole("list", { name: "Exemples de questions" }).getByRole("button", { name: "Que dit le règlement sur le but ?" }).click();

    const conversation = page.getByRole("list", { name: "Conversation avec l'assistant" });
    await expect(conversation).toContainText("Que dit le règlement sur le but ?");
    await expect(conversation).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
    // The answer talks about the jack (« but »), from the help or from the model.
    await expect(conversation.getByRole("listitem").last()).toContainText(/\bbut\b/i);
    await expect(page.getByRole("list", { name: "Questions suggérées" }).getByRole("button").first()).toBeVisible();
  });

  test("an off-topic question is refused politely, with sport and site suggestions", async ({ page }) => {
    await page.goto("/assistant");
    await page.getByLabel("Votre question").fill("Pour qui voter à l'élection présidentielle ?");
    await page.getByRole("button", { name: "Envoyer" }).click();
    const conversation = page.getByRole("list", { name: "Conversation avec l'assistant" });
    await expect(conversation).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
    await expect(conversation.getByRole("listitem").last()).toContainText("questions de sport et sur le site OrgaSport");
    await expect(page.getByRole("list", { name: "Questions suggérées" }).getByRole("button", { name: "Comment marche le PIN des bénévoles ?" })).toBeVisible();
  });

  test("the help sheets answer « PIN » and rules questions, a rulebook sheet cites its version (A2)", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/assistant");
    const conversation = page.getByRole("list", { name: "Conversation avec l'assistant" });
    const ask = async (question: string) => {
      await page.getByLabel("Votre question").fill(question);
      await page.getByRole("button", { name: "Envoyer" }).click();
      await expect(conversation).toContainText(question);
      await expect(conversation).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
      return conversation.getByRole("listitem").last();
    };
    await expect(await ask("Comment marche le PIN des bénévoles ?")).toContainText(/PIN/);
    await expect(await ask("Que dit le règlement officiel quand le but est nul ?")).toContainText(/Règlement en vigueur au \d{1,2}(er)? \S+ \d{4}/);
  });

  test("without an API key, the fallback answer quotes the « cadrage » and « PIN » help sheets (A2)", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/assistant");
    const conversation = page.getByRole("list", { name: "Conversation avec l'assistant" });
    const ask = async (question: string) => {
      await page.getByLabel("Votre question").fill(question);
      await page.getByRole("button", { name: "Envoyer" }).click();
      await expect(conversation).toContainText(question);
      await expect(conversation).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
      return conversation.getByRole("listitem").last();
    };
    const cadrage = await ask("Qu'est-ce que le cadrage ?");
    // It never passes itself off as the AI: it says the assistant is not on yet.
    await expect(cadrage).toContainText("L'assistant intelligent n'est pas encore activé sur ce site.");
    await expect(cadrage).toContainText("Aide OrgaSport : le cadrage et les qualifiés d'office (Office)");
    await expect(cadrage).toContainText(/qualifiée d'office/);
    const pin = await ask("Comment marche le PIN des bénévoles ?");
    await expect(pin).toContainText("Aide OrgaSport : le PIN des bénévoles");
    await expect(pin).not.toContainText(/Règlement en vigueur au/);
    // Help sheets are dated too (A2).
    await expect(pin).toContainText(/Fiche d'aide à jour au \d{1,2}(er)? \S+ \d{4}/);
  });

  test("the admin sees usage, adds a knowledge document, finds it, then deletes it", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, "admin@demo.orgasport.fr");
    await page.goto("/admin/assistant");
    await expect(page.getByRole("heading", { name: "Utilisation et coûts" })).toBeVisible({ timeout: 30_000 });

    const stamp = Date.now().toString(36);
    const title = `Test e2e ${stamp}`;
    const word = `zorbiflette${stamp}`;

    // Rulebook sheets show the version they summarise (A2).
    await expect(page.getByRole("list", { name: "Documents" }).getByText(/^Règlement en vigueur au /).first()).toBeVisible();

    const create = page.locator('[aria-labelledby="admin-ai-kb-new"]');
    await create.getByLabel("Titre").fill(title);
    await create.getByRole("textbox", { name: /^Texte/ }).fill(`Le ${word} se joue en doublette sur un terrain de pétanque.`);
    await create.getByRole("button", { name: "Enregistrer" }).click();
    await expect(create.getByRole("status")).toHaveText("Document enregistré.", { timeout: 20_000 });

    const docs = page.getByRole("list", { name: "Documents" });
    const item = docs.getByRole("listitem").filter({ hasText: title });
    await expect(item).toBeVisible();

    const search = page.getByRole("search", { name: "Tester une question" });
    await search.getByLabel("Question").fill(word);
    await search.getByRole("button", { name: "Chercher" }).click();
    await expect(search.getByRole("status")).toHaveText(/paragraphes? trouvés?/, { timeout: 20_000 });
    await expect(page.getByText(word, { exact: false }).first()).toBeVisible();

    await item.getByText("Supprimer", { exact: true }).click();
    await item.getByRole("button", { name: "Supprimer définitivement ce document" }).click();
    await expect(docs.getByRole("listitem").filter({ hasText: title })).toHaveCount(0, { timeout: 20_000 });
  });
});
