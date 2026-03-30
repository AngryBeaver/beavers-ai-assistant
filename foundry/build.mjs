#!/usr/bin/env node
// build.mjs - esbuild-based build script for beavers-voice-transcript
// Usage: node build.mjs <command>
//   Commands: build | dev | devwatch | watch | zip | clean

import esbuild from "esbuild";
import chokidar from "chokidar";
import archiver from "archiver";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let PACKAGE = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));

const DIST = path.join(__dirname, "dist");
const BUNDLE_DIR = path.join(__dirname, "package");
const TEMPLATES_DIR = path.join(__dirname, "templates");
const CSS_DIR = path.join(__dirname, "css");
const ICONS_DIR = path.join(__dirname, "icons");
const MODULE_JSON_SRC = path.join(__dirname, "module.json");

const SRC_DIR = path.join(__dirname, "src");
// Forward-slash path used inside module.json esmodules array
const BUNDLE_JS_PATH = "src/beavers-ai-assistant.js";

// Recursively collect all .ts files under a directory
function findTsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findTsFiles(full));
    else if (entry.name.endsWith(".ts")) results.push(full);
  }
  return results;
}

function devDist() {
  return path.join(PACKAGE.devDir, PACKAGE.name);
}

// ---------------------------------------------------------------------------
// esbuild options
// ---------------------------------------------------------------------------

function esbuildOptions(outputRoot) {
  return {
    entryPoints: findTsFiles(SRC_DIR),
    bundle: false,          // one .js per .ts, preserves file structure
    format: "esm",
    platform: "browser",
    target: "esnext",
    outbase: SRC_DIR,       // strip the src/ prefix so output mirrors source layout
    outdir: path.join(outputRoot, "src"),
    sourcemap: true,        // inline source maps for readable error locations
    logLevel: "info",
  };
}

// ---------------------------------------------------------------------------
// buildManifest
// ---------------------------------------------------------------------------

async function buildManifest(outputRoot) {
  const js = [BUNDLE_JS_PATH];

  // Collect .css files under css/ using forward-slash paths for Foundry
  const css = [];
  if (fs.existsSync(CSS_DIR)) {
    const collectCss = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectCss(full);
        else if (entry.name.endsWith(".css"))
          css.push(path.relative(__dirname, full).replaceAll(path.sep, "/"));
      }
    };
    collectCss(CSS_DIR);
  }

  const template = await fsp.readFile(MODULE_JSON_SRC, "utf8");

  // Produce compact arrays: ["a"] or ["a", "b"] on multiple lines
  const formatArray = (arr) => {
    if (arr.length === 0) return "[]";
    return "[\n\t\t" + arr.map((s) => JSON.stringify(s)).join(",\n\t\t") + "\n\t]";
  };

  const output = template
    .replaceAll("{{name}}", PACKAGE.name)
    .replaceAll("{{title}}", PACKAGE.title)
    .replaceAll("{{version}}", PACKAGE.version)
    .replaceAll("{{description}}", PACKAGE.description)
    .replace('"{{sources}}"', formatArray(js))
    .replace('"{{css}}"', formatArray(css));

  await fsp.mkdir(outputRoot, { recursive: true });
  await fsp.writeFile(path.join(outputRoot, "module.json"), output, "utf8");
  console.log(`[manifest] → ${outputRoot}`);
}

// ---------------------------------------------------------------------------
// copyAssets
// ---------------------------------------------------------------------------

async function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  await fsp.mkdir(dest, { recursive: true });
  for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(srcPath, destPath);
    else await fsp.copyFile(srcPath, destPath);
  }
}

async function copyAssets(outputRoot) {
  await Promise.all([
    copyDir(TEMPLATES_DIR, path.join(outputRoot, "templates")),
    copyDir(CSS_DIR, path.join(outputRoot, "css")),
    copyDir(ICONS_DIR, path.join(outputRoot, "icons")),
    fsp.copyFile(path.join(__dirname, "LICENSE"), path.join(outputRoot, "LICENSE")).catch(() => {}),
    fsp.copyFile(path.join(__dirname, "README.md"), path.join(outputRoot, "README.md")).catch(() => {}),
  ]);
  console.log(`[assets] → ${outputRoot}`);
}

// ---------------------------------------------------------------------------
// rimraf
// ---------------------------------------------------------------------------

async function rimraf(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
  console.log(`[clean] ${dir}`);
}

// ---------------------------------------------------------------------------
// Non-TS watch globs (shared between watch and devwatch)
// ---------------------------------------------------------------------------

const NON_TS_GLOBS = [
  path.join(__dirname, "css", "**"),
  path.join(__dirname, "templates", "**"),
  path.join(__dirname, "icons", "**"),
  path.join(__dirname, "module.json"),
  path.join(__dirname, "package.json"),
  path.join(__dirname, "LICENSE"),
  path.join(__dirname, "README.md"),
];

async function handleNonTsChange(filePath, outputRoot) {
  const rel = path.relative(__dirname, filePath).replaceAll(path.sep, "/");
  console.log(`[watch] changed: ${rel}`);

  if (rel === "package.json") {
    PACKAGE = JSON.parse(await fsp.readFile(path.join(__dirname, "package.json"), "utf8"));
  }
  if (rel.startsWith("css/") || rel === "module.json" || rel === "package.json") {
    await buildManifest(outputRoot).catch(console.error);
  }
  if (rel.startsWith("css/")) {
    await copyDir(CSS_DIR, path.join(outputRoot, "css")).catch(console.error);
    console.log("[watch] css done");
  }
  if (rel.startsWith("templates/")) {
    await copyDir(TEMPLATES_DIR, path.join(outputRoot, "templates")).catch(console.error);
    console.log("[watch] templates done");
  }
  if (rel.startsWith("icons/")) {
    await copyDir(ICONS_DIR, path.join(outputRoot, "icons")).catch(console.error);
    console.log("[watch] icons done");
  }
  if (rel === "LICENSE" || rel === "README.md") {
    await fsp.copyFile(filePath, path.join(outputRoot, path.basename(filePath))).catch(console.error);
    console.log("[watch] meta done");
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdBuild() {
  await rimraf(DIST);
  await esbuild.build(esbuildOptions(DIST));
  await Promise.all([buildManifest(DIST), copyAssets(DIST)]);
  console.log("[build] done");
}

async function cmdDev() {
  const dest = devDist();
  await rimraf(dest);
  await esbuild.build(esbuildOptions(dest));
  await Promise.all([buildManifest(dest), copyAssets(dest)]);
  console.log("[dev] done →", dest);
}

async function cmdWatch() {
  await rimraf(DIST);
  const ctx = await esbuild.context(esbuildOptions(DIST));
  await ctx.watch();
  console.log("[watch] esbuild watching TypeScript…");
  await Promise.all([buildManifest(DIST), copyAssets(DIST)]);
  chokidar
    .watch(NON_TS_GLOBS, { ignoreInitial: true })
    .on("all", (_, filePath) => handleNonTsChange(filePath, DIST));
  console.log("[watch] watching. Press Ctrl+C to stop.");
}

async function cmdDevWatch() {
  const dest = devDist();
  await rimraf(dest);
  const ctx = await esbuild.context(esbuildOptions(dest));
  await ctx.watch();
  console.log("[devwatch] esbuild watching TypeScript…");
  await Promise.all([buildManifest(dest), copyAssets(dest)]);
  chokidar
    .watch(NON_TS_GLOBS, { ignoreInitial: true })
    .on("all", (_, filePath) => handleNonTsChange(filePath, dest));
  console.log("[devwatch] watching →", dest, ". Press Ctrl+C to stop.");
}

async function cmdZip() {
  await cmdBuild();
  await fsp.mkdir(BUNDLE_DIR, { recursive: true });

  const zipPath = path.join(BUNDLE_DIR, `${PACKAGE.name}.zip`);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    out.on("close", () => {
      console.log(`[zip] ${zipPath} (${archive.pointer()} bytes)`);
      resolve();
    });
    archive.on("error", reject);
    archive.pipe(out);
    // Archive root folder = module name, containing all dist/ files
    archive.directory(DIST + path.sep, PACKAGE.name);
    archive.finalize();
  });

  // module.json next to the zip so the Foundry manifest URL works without downloading the zip
  await fsp.copyFile(path.join(DIST, "module.json"), path.join(BUNDLE_DIR, "module.json"));
  await rimraf(DIST);
  console.log("[zip] done → package/");
}

async function cmdClean() {
  await Promise.all([rimraf(DIST), rimraf(BUNDLE_DIR)]);
  console.log("[clean] done");
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const COMMANDS = { build: cmdBuild, dev: cmdDev, devwatch: cmdDevWatch, watch: cmdWatch, zip: cmdZip, clean: cmdClean };
const command = process.argv[2];

if (!command || !COMMANDS[command]) {
  console.error(`Usage: node build.mjs <${Object.keys(COMMANDS).join(" | ")}>`);
  process.exit(1);
}

COMMANDS[command]().catch((err) => {
  console.error(err);
  process.exit(1);
});
