#!/usr/bin/env node
/**
 * Scans the downloaded Mixamo files and writes public/assets/characters.json.
 *
 *   public/assets/raw/characters/*.fbx|glb   → playable characters (T-pose, with skin)
 *   public/assets/raw/animations/*.fbx|glb   → clips (without skin, "In Place"), matched by file name
 *
 * Run: pnpm --filter @paradox/web characters:manifest   (re-run whenever you add files)
 */
import { readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(webRoot, "public");
const charDir = join(pub, "assets/raw/characters");
const animDir = join(pub, "assets/raw/animations");
const out = join(pub, "assets/characters.json");

const MODEL_EXT = new Set([".fbx", ".glb", ".gltf"]);
const list = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => MODEL_EXT.has(extname(f).toLowerCase())).sort() : []);
const slug = (s) => s.toLowerCase().replace(/\(\d+\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const url = (dir, f) => `/assets/raw/${dir}/${f}`;

// Order matters: the first rule that matches wins.
const RULES = [
  ["crouch_walk", /crouch.*(walk|forward)|sneak/],
  ["crouch_idle", /crouch/],
  ["death", /dying|death|dead/],
  ["reload", /reload/],
  ["fire", /fir(e|ing)|shoot/],
  ["hit", /hit|reaction|impact/],
  ["strafe_l", /(strafe|walk|run).*left|left.*strafe/],
  ["strafe_r", /(strafe|walk|run).*right|right.*strafe/],
  ["walk_back", /back(ward)?/],
  ["sprint", /sprint/],
  ["run", /run/],
  ["jump", /jump/],
  ["fall", /fall/],
  ["land", /land/],
  ["walk_fwd", /walk/],
  ["idle", /idle/],
  ["victory", /victory|win|cheer/],
  ["emote", /.*/],
];

const characters = list(charDir).map((f) => {
  const name = basename(f, extname(f)).replace(/\s*\(\d+\)$/, "");
  return { id: slug(name), name, url: url("characters", f) };
});

const clips = {};
for (const f of list(animDir)) {
  const key = basename(f, extname(f)).toLowerCase();
  const rule = RULES.find(([, re]) => re.test(key));
  (clips[rule[0]] ??= []).push(url("animations", f));
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ characters, clips }, null, 2) + "\n");

console.log(`Characters (${characters.length}): ${characters.map((c) => c.id).join(", ") || "none"}`);
for (const [id, files] of Object.entries(clips)) console.log(`  ${id.padEnd(12)} ${files.map((f) => basename(f)).join(", ")}`);
if (!characters.length) console.warn("! No characters found in public/assets/raw/characters");
const missing = ["idle", "run", "walk_back", "strafe_l", "strafe_r"].filter((r) => !clips[r]);
if (missing.length) console.warn(`! Missing recommended clips: ${missing.join(", ")}`);
console.log(`Wrote ${out}`);
