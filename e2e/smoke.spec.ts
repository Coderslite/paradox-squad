import { expect, test, type Page } from "@playwright/test";

interface DevGame {
  player: { alive: boolean; sim: { move: { x: number; y: number; z: number } } };
  net: { remotes: { players: Map<string, unknown> } | null } | null;
}

async function waitForGame(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __paradox?: DevGame }).__paradox, null, { timeout: 60_000 });
}

test("landing → private room → second player joins → both spawn", async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  const errors: string[] = [];
  for (const p of [pa, pb]) p.on("pageerror", (e) => errors.push(e.message));

  await pa.goto("/");
  await expect(pa.getByRole("heading", { level: 1 })).toContainText("Paradox Squad");
  await pa.getByRole("link", { name: "Play now" }).click();
  await pa.getByRole("button", { name: /Create private match/ }).click();
  await pa.waitForURL(/\/play\/[A-Z0-9]{6}$/);
  const code = pa.url().split("/").pop()!;

  await pb.goto(`/play/${code}`);
  await Promise.all([waitForGame(pa), waitForGame(pb)]);

  for (const p of [pa, pb]) {
    // Spawned at a team spawn (inside the arena, on the ground) and sees the other player.
    await p.waitForFunction(() => {
      const g = (window as unknown as { __paradox: DevGame }).__paradox;
      const m = g.player.sim.move;
      return g.player.alive && Math.abs(m.z) > 30 && m.y > -1 && m.y < 1 && (g.net?.remotes?.players.size ?? 0) === 1;
    }, null, { timeout: 20_000 });
  }
  const zs = await Promise.all([pa, pb].map((p) => p.evaluate(() => (window as unknown as { __paradox: DevGame }).__paradox.player.sim.move.z)));
  // Opposite teams spawn at opposite ends.
  expect(Math.sign(zs[0]!)).not.toBe(Math.sign(zs[1]!));
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});
