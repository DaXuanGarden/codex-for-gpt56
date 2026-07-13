#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const REQUIRED_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
const MODEL_CATALOG_URL = "https://raw.githubusercontent.com/openai/codex/main/codex-rs/models-manager/models.json";
const DEFAULT_NAME = "Codex for GPT-5.6";
const DEFAULT_BUNDLE_ID = "com.openai.codex.gpt56";
const SKILL_ID = "codex-for-gpt56";
const MANAGED_UPDATE_VERSION = 2;
const LEGACY_MANAGED_UPDATE_VERSION = 1;
const MODERN_ASAR_PACKAGE = "@electron/asar@4.2.0";
const LEGACY_ASAR_PACKAGE = "@electron/asar@3.4.1";
const ASAR_PACKAGE = nodeVersionAtLeast(22, 12) ? MODERN_ASAR_PACKAGE : LEGACY_ASAR_PACKAGE;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_CATALOG_BYTES = 32 * 1024 * 1024;
const MANAGED_LOCK_STALE_MS = 30 * 60 * 1000;
const MANAGED_LOCK_WAIT_MS = 10 * 60 * 1000;
const REPAIR_SCRIPT_PATH = fileURLToPath(import.meta.url);


function nodeVersionAtLeast(requiredMajor, requiredMinor) {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  return major > requiredMajor || (major === requiredMajor && minor >= requiredMinor);
}

function usage() {
  console.log(`Usage: patch-codex-for-gpt56.mjs [options]

Options:
  --root <path>                  State/report root; also app parent when --app-parent is omitted
  --app-parent <path>            Folder for the copied app (default: source app's parent when writable)
  --name <name>                  App/display name (default: Codex for GPT-5.6)
  --source-app <path>            Source app bundle/folder/exe to copy
  --dry-run                      Inspect inputs, outputs, and conflicts without writing files
  --replace                      Replace existing generated app and launchers
  --launch                       Launch after patching
  --no-desktop                   Do not create a Desktop launcher/link
  --verify-wire                  Optional mock /v1/responses request capture
  --managed-updates              Validate and refresh the copied app before each launcher start
  --refresh-managed-copy         Internal launcher command used by managed launchers
  --with-plugin-marketplace      Validate plugin-account.json only; no plugin sync is performed
  --plugin-account <path>        Path to plugin-account.json
  -h, --help                     Show this help
`);
}

function parseArgs(argv) {
  const opts = {
    root: "",
    rootProvided: false,
    appParent: "",
    name: DEFAULT_NAME,
    sourceApp: process.env.CODEX_SOURCE_APP || "",
    dryRun: false,
    replace: false,
    launch: false,
    desktop: true,
    verifyWire: false,
    managedUpdates: false,
    refreshManagedCopy: false,
    withPluginMarketplace: false,
    pluginAccount: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const value = argv[i + 1];
      if (value == null || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    if (arg === "--root") {
      opts.root = readValue();
      opts.rootProvided = true;
    }
    else if (arg === "--app-parent") opts.appParent = readValue();
    else if (arg === "--name") opts.name = readValue();
    else if (arg === "--source-app") opts.sourceApp = readValue();
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--replace") opts.replace = true;
    else if (arg === "--launch") opts.launch = true;
    else if (arg === "--no-desktop") opts.desktop = false;
    else if (arg === "--verify-wire") opts.verifyWire = true;
    else if (arg === "--managed-updates") opts.managedUpdates = true;
    else if (arg === "--refresh-managed-copy") opts.refreshManagedCopy = true;
    else if (arg === "--with-plugin-marketplace") opts.withPluginMarketplace = true;
    else if (arg === "--plugin-account") opts.pluginAccount = readValue();
    else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  opts.root = opts.root ? expandHome(opts.root) : defaultStateRoot();
  opts.appParent = opts.appParent ? expandHome(opts.appParent) : "";
  opts.name = validateAppName(opts.name);
  opts.pluginAccount = opts.pluginAccount ? expandHome(opts.pluginAccount) : path.join(opts.root, "plugin-account.json");
  return opts;
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

function validateAppName(value) {
  const name = String(value).trim();
  if (
    name.length === 0
    || name !== value
    || name === "."
    || name === ".."
    || /[<>:"/\\|?*\u0000-\u001F]/.test(name)
  ) {
    throw new Error("--name must be a non-empty app name without path separators or reserved filename characters");
  }
  return name;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    maxBuffer: options.maxBuffer ?? 128 * 1024 * 1024,
    timeout: options.timeout,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const stderr = result.stderr ? `\n${result.stderr}` : "";
    const stdout = result.stdout ? `\n${result.stdout}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}${stderr}${stdout}`);
  }
  return result;
}

function commandExists(command) {
  const probe = process.platform === "win32" ? ["where", [command]] : ["which", [command]];
  return run(probe[0], probe[1], { allowFailure: true }).status === 0;
}

function requireCommand(command) {
  if (!commandExists(command)) throw new Error(`Missing required command: ${command}`);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sha256IfExists(file) {
  return file && fs.existsSync(file) ? sha256(file) : null;
}

function commandPath(command) {
  const probe = process.platform === "win32" ? ["where", [command]] : ["which", [command]];
  const result = run(probe[0], probe[1], { allowFailure: true });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

function isMacAppRunning(appBundle) {
  if (process.platform !== "darwin") return false;
  const result = run("ps", ["-axo", "command="], { allowFailure: true });
  if (result.status !== 0) return false;
  const executableRoot = `${path.join(canonicalPath(appBundle), "Contents", "MacOS")}${path.sep}`;
  return result.stdout.split(/\r?\n/).some((command) => command.includes(executableRoot));
}

function appSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "codex-for-gpt56";
}

function isMacAppRoot(dir) {
  return fs.existsSync(path.join(dir, "Contents", "Resources", "app.asar"));
}

function isWinAppRoot(dir) {
  return fs.existsSync(path.join(dir, "resources", "app.asar")) && findWindowsAppExe(dir) != null;
}

function findWindowsAppExe(dir) {
  const preferred = ["Codex.exe", "ChatGPT.exe", "OpenAI ChatGPT.exe"];
  for (const name of preferred) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => /\.exe$/i.test(name) && !/uninstall|update|crashpad|squirrel/i.test(name))
      .map((name) => path.join(dir, name))[0] ?? null;
  } catch {
    return null;
  }
}

function findWinRootsUnder(start, maxDepth = 2) {
  const found = [];
  function walk(dir, depth) {
    if (depth < 0) return;
    if (isWinAppRoot(dir)) {
      found.push(dir);
      return;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (depth === maxDepth && !/chatgpt|codex|openai/i.test(entry.name)) continue;
      walk(path.join(dir, entry.name), depth - 1);
      if (found.length > 0) return;
    }
  }
  if (start && fs.existsSync(start)) walk(start, maxDepth);
  return found;
}

function findSourceApp(sourceApp) {
  if (process.platform === "darwin") return findMacSourceApp(sourceApp);
  if (process.platform === "win32") return findWindowsSourceApp(sourceApp);
  throw new Error(`Unsupported platform: ${process.platform}. This skill supports macOS and Windows.`);
}

function findMacSourceApp(sourceApp) {
  const candidates = sourceApp
    ? [sourceApp]
    : [
        "/Applications/ChatGPT.app",
        "/Applications/Codex.app",
        path.join(os.homedir(), "Applications", "ChatGPT.app"),
        path.join(os.homedir(), "Applications", "Codex.app"),
      ];
  for (const candidate of candidates) {
    const app = expandHome(candidate);
    if (isMacAppRoot(app)) return app;
  }
  throw new Error("Could not find a local ChatGPT/Codex.app with Contents/Resources/app.asar");
}

function findWindowsSourceApp(sourceApp) {
  if (sourceApp) {
    const resolved = expandHome(sourceApp);
    const root = fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? path.dirname(resolved) : resolved;
    if (isWinAppRoot(root)) return root;
    throw new Error(`Source app does not look like an Electron Codex/ChatGPT root: ${resolved}`);
  }
  const env = process.env;
  const starts = [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs"),
    env.LOCALAPPDATA,
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    env.ProgramW6432,
    env.ProgramFiles && path.join(env.ProgramFiles, "WindowsApps"),
  ].filter(Boolean);
  for (const start of starts) {
    const roots = findWinRootsUnder(start, /WindowsApps$/i.test(start) ? 3 : 2);
    if (roots.length > 0) return roots[0];
  }
  throw new Error("Could not find a local Windows ChatGPT/Codex Electron app with resources\\app.asar");
}

function sourceCodexPath(sourceApp) {
  if (process.platform === "darwin") return path.join(sourceApp, "Contents", "Resources", "codex");
  return firstExisting([path.join(sourceApp, "resources", "codex.exe"), path.join(sourceApp, "resources", "codex")]);
}

function platformPaths(opts, sourceApp) {
  const appParent = resolveAppParent(opts, sourceApp);
  if (process.platform === "darwin") {
    const targetApp = path.join(appParent, `${opts.name}.app`);
    assertOutputPathInside(appParent, targetApp);
    return {
      appParent,
      targetApp,
      sourceAsar: path.join(sourceApp, "Contents", "Resources", "app.asar"),
      targetAsar: path.join(targetApp, "Contents", "Resources", "app.asar"),
      codexPath: path.join(targetApp, "Contents", "Resources", "codex"),
      launchTarget: targetApp,
    };
  }
  const targetApp = path.join(appParent, opts.name);
  assertOutputPathInside(appParent, targetApp);
  return {
    appParent,
    targetApp,
    sourceAsar: path.join(sourceApp, "resources", "app.asar"),
    targetAsar: path.join(targetApp, "resources", "app.asar"),
    codexPath: firstExisting([path.join(targetApp, "resources", "codex.exe"), path.join(targetApp, "resources", "codex")]),
    launchTarget: null,
  };
}

function defaultStateRoot() {
  return path.join(codexHomeDir(), SKILL_ID);
}

function isWritableDirectory(dir) {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory() && (fs.accessSync(dir, fs.constants.W_OK), true);
  } catch {
    return false;
  }
}

function defaultMacAppParent(sourceApp) {
  const sourceParent = path.dirname(sourceApp);
  if (isWritableDirectory(sourceParent)) return sourceParent;
  return path.join(os.homedir(), "Applications");
}

function defaultWindowsAppParent(sourceApp) {
  const sourceParent = path.dirname(sourceApp);
  if (!/\bWindowsApps\b/i.test(sourceParent) && isWritableDirectory(sourceParent)) return sourceParent;
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "Programs");
}

function resolveAppParent(opts, sourceApp) {
  if (opts.appParent) return opts.appParent;
  if (opts.rootProvided) return path.join(opts.root, "app");
  if (process.platform === "darwin") return defaultMacAppParent(sourceApp);
  if (process.platform === "win32") return defaultWindowsAppParent(sourceApp);
  return path.join(opts.root, "app");
}

function assertOutputPathInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (relative.length === 0 || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Refusing an output path outside its app parent: ${target}`);
  }
}

function canonicalPath(input) {
  let existing = path.resolve(input);
  const missing = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  const resolved = fs.existsSync(existing) ? fs.realpathSync.native(existing) : existing;
  return path.join(resolved, ...missing);
}

function comparablePath(input) {
  const resolved = canonicalPath(input);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isSameOrChild(candidate, parent) {
  const childPath = comparablePath(candidate);
  const parentPath = comparablePath(parent);
  return childPath === parentPath || childPath.startsWith(`${parentPath}${path.sep}`);
}

function assertRepairPathsSafe(sourceApp, root, targetApp) {
  if (isSameOrChild(root, sourceApp)) {
    throw new Error(`--root must not be inside the original app: ${root}`);
  }
  if (isSameOrChild(targetApp, sourceApp) || isSameOrChild(sourceApp, targetApp)) {
    throw new Error(`Copied app target must not overlap the original app: ${targetApp}`);
  }
}

function firstExisting(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function copyApp(sourceApp, targetApp, { replace }) {
  assertCopyTargetSafe(sourceApp, targetApp);
  if (fs.existsSync(targetApp)) {
    if (!replace) throw new Error(`Target app already exists: ${targetApp}. Re-run with --replace to overwrite it.`);
    fs.rmSync(targetApp, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(targetApp), { recursive: true });
  if (process.platform === "darwin") run("ditto", [sourceApp, targetApp], { stdio: "inherit" });
  else fs.cpSync(sourceApp, targetApp, { recursive: true, force: true });
}

function assertCopyTargetSafe(sourceApp, targetApp) {
  if (isSameOrChild(targetApp, sourceApp) || isSameOrChild(sourceApp, targetApp)) {
    throw new Error(`Refusing to copy into or over the original app: ${targetApp}`);
  }
}

function managedUpdatePlanPath(root) {
  return path.join(root, "managed-update.json");
}

function managedUpdateHelperPath(root) {
  return path.join(root, process.platform === "win32" ? "refresh-managed-copy.cmd" : "refresh-managed-copy.command");
}

function managedRepairScriptPath(root) {
  return path.join(root, "managed-repair.mjs");
}

function managedUpdateLockPath(root) {
  return path.join(root, ".managed-update.lock");
}

function managedUpdateFailurePath(root) {
  return path.join(root, "managed-update-failure.json");
}

function appFingerprint(appRoot, asarPath, codexPath) {
  const identityPath = process.platform === "darwin"
    ? path.join(appRoot, "Contents", "Info.plist")
    : findWindowsAppExe(appRoot);
  for (const [label, file] of [["app.asar", asarPath], ["Codex CLI", codexPath], ["app identity", identityPath]]) {
    if (!file || !fs.existsSync(file)) throw new Error(`${label} not found while fingerprinting ${appRoot}: ${file ?? "unknown"}`);
  }
  return {
    appAsarSha256: sha256(asarPath),
    codexSha256: sha256(codexPath),
    identitySha256: sha256(identityPath),
  };
}

function sameFingerprint(left, right) {
  return left != null && right != null && isDeepStrictEqual(left, right);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireManagedUpdateLock(root) {
  const lockPath = managedUpdateLockPath(root);
  const started = Date.now();
  fs.mkdirSync(root, { recursive: true });
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      writeJson(path.join(lockPath, "owner.json"), { pid: process.pid, createdAt: new Date().toISOString() });
      return () => fs.rmSync(lockPath, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let age = 0;
      try {
        age = Date.now() - fs.statSync(lockPath).mtimeMs;
      } catch {
        continue;
      }
      if (age > MANAGED_LOCK_STALE_MS) {
        fs.rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > MANAGED_LOCK_WAIT_MS) {
        throw new Error(`Timed out waiting for another managed refresh: ${lockPath}`);
      }
      await sleep(250);
    }
  }
}

function expectedOutputPaths(opts, paths) {
  const outputs = [paths.targetApp];
  if (opts.managedUpdates) outputs.push(managedUpdatePlanPath(opts.root), managedUpdateHelperPath(opts.root), managedRepairScriptPath(opts.root));
  if (process.platform === "darwin") {
    outputs.push(path.join(opts.root, `${opts.name}.command`));
    if (opts.desktop) outputs.push(path.join(os.homedir(), "Desktop", `${opts.name}.app`));
  } else if (process.platform === "win32") {
    outputs.push(path.join(opts.root, `${opts.name}.cmd`));
    if (opts.desktop) {
      outputs.push(path.join(os.homedir(), "Desktop", `${opts.name}.lnk`));
      outputs.push(path.join(os.homedir(), "Desktop", `${opts.name}.cmd`));
    }
  }
  return outputs;
}

function assertOutputsAvailable(opts, paths) {
  const existing = expectedOutputPaths(opts, paths).filter((output) => fs.existsSync(output));
  if (existing.length > 0 && !opts.replace) {
    throw new Error(`Output already exists: ${existing.join(", ")}. Re-run with --replace to overwrite generated output.`);
  }
  return existing;
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function removeExistingOutput(file, { replace }) {
  if (!fs.existsSync(file)) return;
  if (!replace) throw new Error(`Output already exists: ${file}. Re-run with --replace to overwrite it.`);
  fs.rmSync(file, { recursive: true, force: true });
}

function plistSet(plist, key, value) {
  run("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist]);
  const actual = run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist]).stdout.trim();
  if (actual !== value) throw new Error(`Failed to verify ${key} in ${plist}: expected ${value}; received ${actual}`);
}

function updateAppIdentity(targetApp, opts) {
  if (process.platform !== "darwin") return { skipped: true };
  const plist = path.join(targetApp, "Contents", "Info.plist");
  plistSet(plist, "CFBundleDisplayName", opts.name);
  plistSet(plist, "CFBundleName", opts.name);
  plistSet(plist, "CFBundleIdentifier", DEFAULT_BUNDLE_ID);
  return { skipped: false, bundleId: DEFAULT_BUNDLE_ID };
}

function download(url, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const request = https
      .get(url, { headers: { "user-agent": "codex-for-gpt56" } }, (res) => {
        if (res.statusCode != null && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsRemaining <= 0) {
            reject(new Error(`Too many redirects while fetching ${url}`));
            return;
          }
          const redirected = new URL(res.headers.location, url);
          if (redirected.protocol !== "https:") {
            reject(new Error(`Refusing non-HTTPS redirect while fetching ${url}: ${redirected}`));
            return;
          }
          resolve(download(redirected.toString(), redirectsRemaining - 1));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} while fetching ${url}`));
          res.resume();
          return;
        }
        const chunks = [];
        let total = 0;
        res.on("data", (chunk) => {
          total += chunk.length;
          if (total > MAX_CATALOG_BYTES) {
            request.destroy(new Error(`Model catalog exceeded ${MAX_CATALOG_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      })
      .on("error", reject);
    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => request.destroy(new Error(`Timed out fetching ${url}`)));
  });
}

async function fetchModelCatalog() {
  const text = await download(MODEL_CATALOG_URL);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Official model catalog is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed.models)) throw new Error("Official model catalog does not contain models[]");
  for (const slug of REQUIRED_MODELS) {
    if (!parsed.models.some((model) => model.slug === slug)) throw new Error(`Official model catalog is missing ${slug}`);
  }
  return parsed;
}

function writeModelCatalog(modelCatalogPath, modelCatalog) {
  fs.mkdirSync(path.dirname(modelCatalogPath), { recursive: true });
  fs.writeFileSync(modelCatalogPath, `${JSON.stringify(modelCatalog, null, 2)}\n`);
}

function runDebugModels(codexPath, modelCatalogPath = null) {
  if (!fs.existsSync(codexPath)) throw new Error(`Codex CLI not found: ${codexPath}`);
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-gpt56-debug-home-"));
  const args = modelCatalogPath == null ? ["debug", "models"] : ["-c", `model_catalog_json=${JSON.stringify(modelCatalogPath)}`, "debug", "models"];
  try {
    const raw = execFileSync(codexPath, args, {
      encoding: "utf8",
      env: { ...process.env, CODEX_HOME: tempHome },
      maxBuffer: 128 * 1024 * 1024,
    });
    return JSON.parse(raw);
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

function uniformBaselineDefaults(models) {
  if (!Array.isArray(models) || models.length === 0) return {};
  const common = {};
  for (const [key, value] of Object.entries(models[0])) {
    if (key === "slug") continue;
    if (models.every((model) => Object.hasOwn(model, key) && isDeepStrictEqual(model[key], value))) common[key] = value;
  }
  return common;
}

export function normalizeModelCatalogForCliBaseline(upstreamCatalog, baseline) {
  if (!Array.isArray(upstreamCatalog?.models)) throw new Error("Upstream model catalog does not contain models[]");
  if (!Array.isArray(baseline?.models) || baseline.models.length === 0) {
    throw new Error("Source-app Codex CLI did not return a baseline model catalog");
  }
  const bySlug = new Map(baseline.models.map((model) => [model.slug, model]));
  const uniformDefaults = uniformBaselineDefaults(baseline.models);
  const filledFields = {};
  let matchedBaselineModels = 0;
  let unmatchedUpstreamModels = 0;
  const models = upstreamCatalog.models.map((model) => {
    const matched = bySlug.get(model.slug);
    const defaults = matched ?? uniformDefaults;
    if (matched) matchedBaselineModels += 1;
    else unmatchedUpstreamModels += 1;
    for (const key of Object.keys(defaults)) {
      if (!Object.hasOwn(model, key)) filledFields[key] = (filledFields[key] ?? 0) + 1;
    }
    return { ...defaults, ...model };
  });
  return {
    catalog: { ...upstreamCatalog, models },
    normalization: {
      baselineModelCount: baseline.models.length,
      matchedBaselineModels,
      unmatchedUpstreamModels,
      uniformFallbackFields: Object.keys(uniformDefaults).sort(),
      filledFields,
    },
  };
}

function makeCliCompatibleModelCatalog(codexPath, upstreamCatalog) {
  // Codex's upstream catalog can evolve before an already-installed desktop
  // CLI learns a newly required/defaulted field. Start from the current
  // upstream values, then fill only fields absent from a model with that CLI's
  // own serialized baseline. This is schema compatibility, not a version
  // allowlist: every generated catalog is immediately parsed by that exact CLI.
  const baseline = runDebugModels(codexPath);
  const normalized = normalizeModelCatalogForCliBaseline(upstreamCatalog, baseline);
  const { catalog } = normalized;
  const compatibilityRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-gpt56-catalog-"));
  const compatibilityCatalogPath = path.join(compatibilityRoot, "model-catalog.json");
  try {
    fs.writeFileSync(compatibilityCatalogPath, `${JSON.stringify(catalog)}\n`);
    const parsed = runDebugModels(codexPath, compatibilityCatalogPath);
    return {
      catalog,
      verification: {
        status: "passed",
        parsedModelCount: Array.isArray(parsed.models) ? parsed.models.length : 0,
        ...normalized.normalization,
      },
    };
  } finally {
    fs.rmSync(compatibilityRoot, { recursive: true, force: true });
  }
}

function codexHomeDir() {
  return process.env.CODEX_HOME ? expandHome(process.env.CODEX_HOME) : path.join(os.homedir(), ".codex");
}

function stableModelCatalogPath() {
  return path.join(codexHomeDir(), "model-catalogs", SKILL_ID, "model-catalog.json");
}

function backupFileIfExists(file, label) {
  if (!fs.existsSync(file)) return null;
  const dir = path.join(codexHomeDir(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const backup = path.join(dir, `${path.basename(file)}.before-${label}-${stamp}`);
  fs.copyFileSync(file, backup);
  return backup;
}

function upsertTopLevelToml(text, key, value, { onlyIfMissing = false } = {}) {
  const lines = text.split(/\n/);
  const firstSection = lines.findIndex((line) => /^\s*\[/.test(line));
  const end = firstSection === -1 ? lines.length : firstSection;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyPattern = new RegExp(`^\\s*${escaped}\\s*=`);
  for (let i = 0; i < end; i += 1) {
    if (keyPattern.test(lines[i])) {
      if (!onlyIfMissing) lines[i] = `${key} = ${value}`;
      return lines.join("\n");
    }
  }
  lines.splice(end, 0, `${key} = ${value}`);
  return lines.join("\n");
}

function updateCodexConfig(modelCatalogPath) {
  const codexDir = codexHomeDir();
  const configPath = path.join(codexDir, "config.toml");
  fs.mkdirSync(codexDir, { recursive: true });
  let text = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const backupPath = backupFileIfExists(configPath, "gpt56-catalog");
  text = upsertTopLevelToml(text, "model_catalog_json", JSON.stringify(modelCatalogPath));
  text = upsertTopLevelToml(text, "model_reasoning_effort", JSON.stringify("xhigh"), { onlyIfMissing: true });
  text = upsertTopLevelToml(text, "service_tier", JSON.stringify("priority"), { onlyIfMissing: true });
  fs.writeFileSync(configPath, text.endsWith("\n") ? text : `${text}\n`);
  return { configPath, backupPath, changed: true };
}

export function readTopLevelTomlString(text, key) {
  const lines = text.split(/\r?\n/);
  const firstSection = lines.findIndex((line) => /^\s*\[/.test(line));
  const end = firstSection === -1 ? lines.length : firstSection;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*${escaped}\\s*=\\s*("(?:\\\\.|[^"\\\\])*"|'[^']*')\\s*(?:#.*)?$`);
  for (let index = 0; index < end; index += 1) {
    const match = lines[index].match(pattern);
    if (!match) continue;
    if (match[1].startsWith("\"")) return JSON.parse(match[1]);
    return match[1].slice(1, -1);
  }
  return null;
}

function assertManagedConfigState(plan, modelCatalogPath) {
  const configPath = path.join(codexHomeDir(), "config.toml");
  if (!fs.existsSync(configPath)) throw new Error(`Managed Codex config is missing: ${configPath}. Re-run an approved repair.`);
  const configured = readTopLevelTomlString(fs.readFileSync(configPath, "utf8"), "model_catalog_json");
  if (configured == null || comparablePath(configured) !== comparablePath(modelCatalogPath)) {
    throw new Error(`Managed Codex config no longer points to ${modelCatalogPath}. The launcher will not overwrite this user change; re-run an approved repair.`);
  }
  if (plan.configPath && comparablePath(plan.configPath) !== comparablePath(configPath)) {
    throw new Error(`Managed-update plan config path does not match the active CODEX_HOME: ${plan.configPath}`);
  }
  return configPath;
}

function readPreviousConfigBackup(reportPath) {
  if (!fs.existsSync(reportPath)) return null;
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    return typeof report.configBackupPath === "string" ? report.configBackupPath : null;
  } catch {
    return null;
  }
}

function isSha256String(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isCompleteAppFingerprint(value) {
  return value != null
    && isSha256String(value.appAsarSha256)
    && isSha256String(value.codexSha256)
    && isSha256String(value.identitySha256);
}

function readManagedUpdatePlan(root) {
  const planPath = managedUpdatePlanPath(root);
  if (!fs.existsSync(planPath)) throw new Error(`Managed-update plan not found: ${planPath}`);
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  } catch (error) {
    throw new Error(`Managed-update plan is not valid JSON: ${planPath}: ${error.message}`);
  }
  const commonShapeValid = [LEGACY_MANAGED_UPDATE_VERSION, MANAGED_UPDATE_VERSION].includes(plan?.version)
    && typeof plan.stateRoot === "string"
    && typeof plan.sourceApp === "string"
    && typeof plan.appParent === "string"
    && typeof plan.targetApp === "string"
    && typeof plan.name === "string"
    && typeof plan.codexHome === "string"
    && isSha256String(plan.sourceAsarSha256)
    && isSha256String(plan.targetAsarSha256);
  if (!commonShapeValid) throw new Error(`Managed-update plan has an unsupported shape: ${planPath}`);

  if (plan.version === LEGACY_MANAGED_UPDATE_VERSION) {
    plan.sourceFingerprint = { appAsarSha256: plan.sourceAsarSha256 };
    plan.targetFingerprint = { appAsarSha256: plan.targetAsarSha256 };
    return plan;
  }

  if (
    typeof plan.configPath !== "string"
    || typeof plan.modelCatalogPath !== "string"
    || !isSha256String(plan.modelCatalogSha256)
    || !isCompleteAppFingerprint(plan.sourceFingerprint)
    || !isCompleteAppFingerprint(plan.targetFingerprint)
    || typeof plan.repairScript !== "string"
    || typeof plan.bundledRepairScript !== "string"
    || typeof plan.nodePath !== "string"
    || typeof plan.npxPath !== "string"
  ) {
    throw new Error(`Managed-update v${MANAGED_UPDATE_VERSION} plan is incomplete: ${planPath}`);
  }
  return plan;
}

function configureManagedRefresh(opts) {
  if (!opts.refreshManagedCopy) return null;
  if (opts.dryRun) throw new Error("--refresh-managed-copy cannot be combined with --dry-run");
  const plan = readManagedUpdatePlan(opts.root);
  if (comparablePath(plan.codexHome) !== comparablePath(codexHomeDir())) {
    throw new Error(`Managed-update plan belongs to a different CODEX_HOME: ${plan.codexHome}`);
  }
  opts.sourceApp = plan.sourceApp;
  opts.appParent = plan.appParent;
  opts.name = validateAppName(plan.name);
  opts.desktop = Boolean(plan.desktop);
  opts.replace = true;
  opts.managedUpdates = true;
  return plan;
}

function assertManagedRefreshPlan(plan, opts, sourceApp, paths, modelCatalogPath) {
  if (comparablePath(plan.stateRoot) !== comparablePath(opts.root)) {
    throw new Error("Managed-update plan state root does not match the requested --root");
  }
  if (comparablePath(plan.sourceApp) !== comparablePath(sourceApp)) {
    throw new Error("Managed-update source app does not match the saved plan");
  }
  if (comparablePath(plan.appParent) !== comparablePath(paths.appParent)) {
    throw new Error("Managed-update app parent does not match the saved plan");
  }
  if (comparablePath(plan.targetApp) !== comparablePath(paths.targetApp)) {
    throw new Error("Managed-update target app does not match the saved plan");
  }
  if (plan.version === MANAGED_UPDATE_VERSION && comparablePath(plan.modelCatalogPath) !== comparablePath(modelCatalogPath)) {
    throw new Error("Managed-update catalog path does not match the approved stable catalog path");
  }
}

function writeManagedUpdateFiles(opts, sourceApp, paths, sourceFingerprint, targetFingerprint, modelCatalogPath, modelCatalogSha256) {
  const planPath = managedUpdatePlanPath(opts.root);
  const helperPath = managedUpdateHelperPath(opts.root);
  const bundledRepairScript = managedRepairScriptPath(opts.root);
  const npxPath = commandPath("npx");
  if (npxPath == null) throw new Error("Could not resolve an absolute npx path for managed updates");
  if (comparablePath(REPAIR_SCRIPT_PATH) !== comparablePath(bundledRepairScript)) {
    removeExistingOutput(bundledRepairScript, opts);
    fs.mkdirSync(path.dirname(bundledRepairScript), { recursive: true });
    fs.copyFileSync(REPAIR_SCRIPT_PATH, bundledRepairScript);
    fs.chmodSync(bundledRepairScript, 0o700);
  }
  const plan = {
    version: MANAGED_UPDATE_VERSION,
    generatedAt: new Date().toISOString(),
    stateRoot: opts.root,
    codexHome: codexHomeDir(),
    configPath: path.join(codexHomeDir(), "config.toml"),
    modelCatalogPath,
    modelCatalogSha256,
    sourceApp,
    appParent: paths.appParent,
    targetApp: paths.targetApp,
    name: opts.name,
    desktop: opts.desktop,
    sourceAsarSha256: sourceFingerprint.appAsarSha256,
    targetAsarSha256: targetFingerprint.appAsarSha256,
    sourceFingerprint,
    targetFingerprint,
    repairScript: REPAIR_SCRIPT_PATH,
    bundledRepairScript,
    nodePath: process.execPath,
    npxPath,
  };
  removeExistingOutput(planPath, opts);
  removeExistingOutput(helperPath, opts);
  writeJson(planPath, plan);
  if (process.platform === "darwin") {
    const content = `#!/usr/bin/env bash
set -euo pipefail
export CODEX_HOME=${shSingle(plan.codexHome)}
NODE_BIN=${shSingle(plan.nodePath)}
PREFERRED_REPAIR=${shSingle(plan.repairScript)}
BUNDLED_REPAIR=${shSingle(plan.bundledRepairScript)}
if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
if [[ -f "$PREFERRED_REPAIR" ]]; then
  REPAIR_SCRIPT="$PREFERRED_REPAIR"
elif [[ -f "$BUNDLED_REPAIR" ]]; then
  REPAIR_SCRIPT="$BUNDLED_REPAIR"
else
  echo "Managed repair script is missing; refusing to launch an unchecked copy." >&2
  exit 1
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Node.js is unavailable; refusing to launch an unchecked copy." >&2
  exit 1
fi
export PATH=${shSingle(path.dirname(npxPath))}:${shSingle(path.dirname(plan.nodePath))}:"\${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"
exec "$NODE_BIN" "$REPAIR_SCRIPT" --refresh-managed-copy --root ${shSingle(opts.root)}
`;
    fs.writeFileSync(helperPath, content, { mode: 0o700 });
    fs.chmodSync(helperPath, 0o700);
  } else if (process.platform === "win32") {
    const content = `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "CODEX_HOME=${cmdEscape(plan.codexHome)}"\r\nset "NODE_BIN=${cmdEscape(plan.nodePath)}"\r\nset "REPAIR_SCRIPT=${cmdEscape(plan.repairScript)}"\r\nif not exist "%REPAIR_SCRIPT%" set "REPAIR_SCRIPT=${cmdEscape(plan.bundledRepairScript)}"\r\nif not exist "%REPAIR_SCRIPT%" (echo Managed repair script is missing; refusing to launch an unchecked copy. 1>&2& exit /b 1)\r\nif not exist "%NODE_BIN%" for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE_FALLBACK set "NODE_FALLBACK=%%I"\r\nif defined NODE_FALLBACK set "NODE_BIN=%NODE_FALLBACK%"\r\nif not exist "%NODE_BIN%" (echo Node.js is unavailable; refusing to launch an unchecked copy. 1>&2& exit /b 1)\r\nset "PATH=${cmdEscape(path.dirname(npxPath))};${cmdEscape(path.dirname(plan.nodePath))};%PATH%"\r\n"%NODE_BIN%" "%REPAIR_SCRIPT%" --refresh-managed-copy --root "${cmdEscape(opts.root)}"\r\nexit /b %ERRORLEVEL%\r\n`;
    fs.writeFileSync(helperPath, content);
  }
  return {
    enabled: true,
    planPath,
    helperPath,
    bundledRepairScript,
    sourceFingerprint,
    targetFingerprint,
    modelCatalogSha256,
  };
}

function shSingle(value) {
  return `'${String(value).replace(/'/g, "'\"'\"'")}'`;
}

export function macManagedUpdatePrelude(managedUpdateHelper) {
  if (managedUpdateHelper == null) return "";
  return `MANAGED_UPDATER=${shSingle(managedUpdateHelper)}
if [[ ! -x "$MANAGED_UPDATER" ]]; then
  echo "Managed update helper is missing or not executable; refusing to launch an unchecked copy." >&2
  exit 1
fi
"$MANAGED_UPDATER"
`;
}

function writeMacLauncher(root, targetApp, name, options, managedUpdateHelper = null) {
  const launcher = path.join(root, `${name}.command`);
  const userData = path.join(root, "user-data");
  const content = `#!/usr/bin/env bash
set -euo pipefail
${macManagedUpdatePrelude(managedUpdateHelper)}USER_DATA=${shSingle(userData)}
mkdir -p "$USER_DATA"
open -n ${shSingle(targetApp)} --args --user-data-dir="$USER_DATA" "$@"
`;
  removeExistingOutput(launcher, options);
  fs.writeFileSync(launcher, content, { mode: 0o755 });
  fs.chmodSync(launcher, 0o755);
  return launcher;
}

function cmdEscape(value) {
  return String(value)
    .replace(/\^/g, "^^")
    .replace(/%/g, "%%")
    .replace(/[&|<>()]/g, "^$&");
}

function writeWindowsLauncher(root, targetApp, name, options, managedUpdateHelper = null) {
  const exe = findWindowsAppExe(targetApp);
  if (exe == null) throw new Error(`Could not find copied Windows app exe in ${targetApp}`);
  const launcher = path.join(root, `${name}.cmd`);
  const userData = path.join(root, "user-data");
  const update = managedUpdateHelper == null ? "" : `call "${cmdEscape(managedUpdateHelper)}"\r\nif errorlevel 1 exit /b %ERRORLEVEL%\r\n`;
  const content = `@echo off\r\nsetlocal DisableDelayedExpansion\r\n${update}set "USER_DATA=${cmdEscape(userData)}"\r\nif not exist "%USER_DATA%" mkdir "%USER_DATA%"\r\nstart "" "${cmdEscape(exe)}" --user-data-dir="%USER_DATA%" %*\r\n`;
  removeExistingOutput(launcher, options);
  fs.writeFileSync(launcher, content);
  return { launcher, exe, userData };
}

function psSingle(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function plistXml(entries) {
  const escape = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = Object.entries(entries)
    .map(([key, value]) => `\t<key>${escape(key)}</key>\n\t<string>${escape(value)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`;
}

function createMacLauncherApp(root, targetApp, name, options, managedUpdateHelper = null) {
  const desktop = path.join(os.homedir(), "Desktop");
  const launcherApp = path.join(desktop, `${name}.app`);
  const contents = path.join(launcherApp, "Contents");
  const macos = path.join(contents, "MacOS");
  const resources = path.join(contents, "Resources");
  const executableName = `${appSlug(name)}-launcher`;
  const userData = path.join(root, "user-data");
  fs.mkdirSync(desktop, { recursive: true });
  removeExistingOutput(launcherApp, options);
  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(resources, { recursive: true });

  const sourcePlist = path.join(targetApp, "Contents", "Info.plist");
  const iconName = run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIconFile", sourcePlist], { allowFailure: true }).stdout.trim();
  if (iconName) {
    const iconFile = iconName.endsWith(".icns") ? iconName : `${iconName}.icns`;
    const sourceIcon = path.join(targetApp, "Contents", "Resources", iconFile);
    if (fs.existsSync(sourceIcon)) fs.copyFileSync(sourceIcon, path.join(resources, iconFile));
  }

  fs.writeFileSync(
    path.join(contents, "Info.plist"),
    plistXml({
      CFBundleName: name,
      CFBundleDisplayName: name,
      CFBundleIdentifier: `${DEFAULT_BUNDLE_ID}.launcher`,
      CFBundlePackageType: "APPL",
      CFBundleExecutable: executableName,
      CFBundleIconFile: iconName || "",
    }),
  );

  const executable = path.join(macos, executableName);
  fs.writeFileSync(
    executable,
    `#!/usr/bin/env bash
set -euo pipefail
${macManagedUpdatePrelude(managedUpdateHelper)}USER_DATA=${shSingle(userData)}
mkdir -p "$USER_DATA"
open -n ${shSingle(targetApp)} --args --user-data-dir="$USER_DATA" "$@"
`,
    { mode: 0o755 },
  );
  fs.chmodSync(executable, 0o755);
  run("codesign", ["--force", "--deep", "--sign", "-", launcherApp], { allowFailure: true });
  return { type: "mac-launcher-app", path: launcherApp, status: "created", targetApp, userData };
}

function createDesktopEntry(root, targetApp, name, options, launcherInfo, managedUpdateHelper = null) {
  if (process.platform === "darwin") {
    try {
      return createMacLauncherApp(root, targetApp, name, options, managedUpdateHelper);
    } catch (error) {
      return { type: "mac-launcher-app", path: path.join(os.homedir(), "Desktop", `${name}.app`), status: "failed", error: error.message };
    }
  }

  if (process.platform === "win32") {
    const desktop = path.join(os.homedir(), "Desktop");
    const shortcut = path.join(desktop, `${name}.lnk`);
    const fallback = path.join(desktop, `${name}.cmd`);
    const exe = findWindowsAppExe(targetApp);
    const userData = path.join(root, "user-data");
    const target = managedUpdateHelper == null ? exe : launcherInfo?.launcher;
    if (exe == null || target == null) return { type: "windows-lnk", path: shortcut, status: "failed", error: "missing exe or launcher" };
    const shortcutTarget = managedUpdateHelper == null ? exe : (process.env.ComSpec || process.env.COMSPEC || "cmd.exe");
    const shortcutArguments = managedUpdateHelper == null
      ? `--user-data-dir="${userData}"`
      : `/d /s /c ""${target}""`;
    removeExistingOutput(shortcut, options);
    const ps = [
      "$w = New-Object -ComObject WScript.Shell",
      `$s = $w.CreateShortcut(${psSingle(shortcut)})`,
      `$s.TargetPath = ${psSingle(shortcutTarget)}`,
      `$s.Arguments = ${psSingle(shortcutArguments)}`,
      `$s.WorkingDirectory = ${psSingle(path.dirname(target))}`,
      `$s.IconLocation = ${psSingle(`${exe},0`)}`,
      "$s.Save()",
    ].join("; ");
    const result = run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { allowFailure: true });
    if (result.status === 0) {
      removeExistingOutput(fallback, options);
      return { type: "windows-lnk", path: shortcut, status: "created" };
    }
    removeExistingOutput(fallback, options);
    fs.writeFileSync(fallback, managedUpdateHelper == null
      ? `@echo off\r\nsetlocal DisableDelayedExpansion\r\nstart "" "${cmdEscape(exe)}" --user-data-dir="${cmdEscape(userData)}" %*\r\n`
      : `@echo off\r\ncall "${cmdEscape(target)}" %*\r\n`);
    return { type: "windows-lnk", path: shortcut, status: "failed-fallback-cmd-created", fallback, error: result.stderr.trim() };
  }

  return { type: "desktop", status: "skipped" };
}

function writeLauncher(root, targetApp, name, options, managedUpdateHelper = null) {
  if (process.platform === "darwin") return { launcher: writeMacLauncher(root, targetApp, name, options, managedUpdateHelper) };
  if (process.platform === "win32") return writeWindowsLauncher(root, targetApp, name, options, managedUpdateHelper);
  throw new Error(`Unsupported platform for launcher: ${process.platform}`);
}

function walkFiles(dir, predicate, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, predicate, out);
    else if (entry.isFile() && predicate(full)) out.push(full);
  }
  return out;
}

const PATCH_ENGINE_VERSION = "semantic-v1";
const GPT56_MODEL_CONDITION = "($MODEL.model===`gpt-5.6-sol`||$MODEL.model===`gpt-5.6-terra`||$MODEL.model===`gpt-5.6-luna`)";

// These rules deliberately match stable *behavioral* shapes rather than minified
// variable names, bundle filenames, or a particular desktop build number. Each
// rule is bounded by model/reasoning-specific literals and is validated after
// rewriting, so a new bundle either patches safely or fails before an app copy
// or Codex configuration is written.
const PATCH_CAPABILITIES = [
  { id: "enable-gpt56-reasoning-efforts", required: true, apply: patchReasoningEffortLists },
  { id: "enable-ultra-reasoning-effort", required: true, apply: patchUltraFeatureGate },
  { id: "show-hidden-gpt56-models", required: true, apply: patchHiddenGpt56ModelFilter },
  { id: "gpt56-power-selection-fallback", required: false, apply: patchGpt56PowerSelectionFallback },
];

function emptyPatchOutcome() {
  return { matches: 0, replacements: 0, alreadyPatched: 0, text: null };
}

function mergePatchOutcome(target, outcome) {
  target.matches += outcome.matches;
  target.replacements += outcome.replacements;
  target.alreadyPatched += outcome.alreadyPatched;
}

function isReasoningEffortList(items) {
  const allowed = new Set(["minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
  return items.length >= 4
    && items.includes("low")
    && items.includes("medium")
    && items.includes("high")
    && items.includes("xhigh")
    && items.every((item) => allowed.has(item));
}

function patchReasoningEffortLists(text) {
  const outcome = emptyPatchOutcome();
  // Intentionally only matches an assignment whose complete array consists of
  // known reasoning effort literals. This avoids changing arbitrary arrays in
  // minified vendor code while surviving renamed minifier variables.
  const assignment = /\b([A-Za-z_$][\w$]*)=\[((?:`(?:minimal|low|medium|high|xhigh|max|ultra)`)(?:,`(?:minimal|low|medium|high|xhigh|max|ultra)`){3,})\]/g;
  outcome.text = text.replace(assignment, (whole, variable, rawItems, offset) => {
    const items = rawItems.split(",").map((item) => item.slice(1, -1));
    if (!isReasoningEffortList(items) || !hasModelListContext(text, offset)) return whole;
    outcome.matches += 1;
    const normalized = [
      ...(items.includes("minimal") ? ["minimal"] : []),
      "low", "medium", "high", "xhigh", "max", "ultra",
    ];
    const replacement = `${variable}=[${normalized.map((item) => `\`${item}\``).join(",")}]`;
    if (replacement === whole) {
      outcome.alreadyPatched += 1;
      return whole;
    }
    outcome.replacements += 1;
    return replacement;
  });
  return outcome;
}

function hasModelListContext(text, offset) {
  const start = Math.max(0, offset - 2500);
  const end = Math.min(text.length, offset + 2500);
  const context = text.slice(start, end);
  return context.includes("list-models-for-host") || context.includes("includeUltraReasoningEffort");
}

function patchUltraFeatureGate(text) {
  const outcome = emptyPatchOutcome();
  // 1186680773 is the stable Statsig experiment identifier used by this UI
  // path. The surrounding list-model context prevents a broad flag rewrite.
  const gated = /\b([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)&&([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),`1186680773`\)/g;
  outcome.text = text.replace(gated, (whole, variable, _enabled, _reader, _flag, offset) => {
    if (!hasModelListContext(text, offset)) return whole;
    outcome.matches += 1;
    outcome.replacements += 1;
    return `${variable}=!0`;
  });
  // A repeated run against a previously patched unpacked tree should remain a
  // no-op while still recognizing the model-list capability.
  const already = /includeUltraReasoningEffort:([A-Za-z_$][\w$]*)/g;
  for (let match; outcome.replacements === 0 && (match = already.exec(outcome.text)) != null;) {
    const variable = match[1];
    const before = outcome.text.slice(Math.max(0, match.index - 800), match.index);
    if (new RegExp(`\\b${variable}=!0\\b`).test(before)) {
      outcome.matches += 1;
      outcome.alreadyPatched += 1;
      break;
    }
  }
  return outcome;
}

function gpt56Condition(modelVariable) {
  return GPT56_MODEL_CONDITION.replaceAll("$MODEL", modelVariable);
}

function patchHiddenGpt56ModelFilter(text) {
  const outcome = emptyPatchOutcome();
  // Match the visibility branch structurally: hidden models are currently
  // selected through a Set when useHiddenModels is enabled, otherwise their
  // `hidden` marker excludes them. Only that branch is widened for GPT-5.6.
  const filter = /if\(([A-Za-z_$][\w$]*)\?([A-Za-z_$][\w$]*)\.has\(([A-Za-z_$][\w$]*)\.model\):!\3\.hidden\)\{/g;
  outcome.text = text.replace(filter, (whole, useHidden, availableModels, model, offset) => {
    if (!hasModelListContext(text, offset)) return whole;
    outcome.matches += 1;
    outcome.replacements += 1;
    const condition = gpt56Condition(model);
    return `if(${useHidden}?${availableModels}.has(${model}.model)||${condition}:!${model}.hidden||${condition}){`;
  });
  const already = /if\(([A-Za-z_$][\w$]*)\?([A-Za-z_$][\w$]*)\.has\(([A-Za-z_$][\w$]*)\.model\)\|\|\(\3\.model===`gpt-5\.6-sol`/g;
  if (outcome.replacements === 0 && already.test(outcome.text)) {
    outcome.matches += 1;
    outcome.alreadyPatched += 1;
  }
  return outcome;
}

function hasGpt56PresetList(text, variable) {
  const initializer = new RegExp("\\b" + variable + "=\\[\\{id:`gpt-5\\.6-(?:sol|terra|luna):", "u");
  return initializer.test(text);
}

function patchGpt56PowerSelectionFallback(text) {
  const outcome = emptyPatchOutcome();
  // The power picker has shipped with several minified function/variable names,
  // but its shape remains: a GPT-5.6 preset list, an optional Ultra preset, a
  // preferred list and a four-item fallback. Restore the preset list only when
  // that exact GPT-5.6 data is present in the same JavaScript chunk.
  const fallback = /function\s+([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)=!1\)\{let\s+([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\(\3\?\[\.\.\.([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*)\]:\6,\2\);if\(\4\.length>=4\)return\s+\4;let\s+([A-Za-z_$][\w$]*)=\5\(([A-Za-z_$][\w$]*),\2\);return\s+\8\.length>=4\?\8:\[\]\}/g;
  outcome.text = text.replace(fallback, (whole, fn, models, includeUltra, preferred, selector, presets, ultraPreset, fallbackItems, fallbackSelector, fallbackSource) => {
    if (!hasGpt56PresetList(text, presets)) return whole;
    outcome.matches += 1;
    outcome.replacements += 1;
    return `function ${fn}(${models},${includeUltra}=!1){let ${preferred}=${selector}(${includeUltra}?[...${presets},${ultraPreset}]:${presets},${models});if(${preferred}.length>=4)return ${preferred};let ${fallbackItems}=${fallbackSelector}(${fallbackSource},${models});return ${fallbackItems}.length>=4?${fallbackItems}:${includeUltra}?[...${presets},${ultraPreset}]:${presets}}`;
  });
  // This broad enough check recognizes the fallback we inject without relying
  // on its minifier names, but only in chunks that contain GPT-5.6 presets.
  if (outcome.replacements === 0 && /return\s+[A-Za-z_$][\w$]*\.length>=4\?[A-Za-z_$][\w$]*:[A-Za-z_$][\w$]*\?\[\.\.\.[A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*\]:[A-Za-z_$][\w$]*\}/.test(text) && /gpt-5\.6-(?:sol|terra|luna):/.test(text)) {
    outcome.matches += 1;
    outcome.alreadyPatched += 1;
  }
  return outcome;
}

export function patchJsTree(unpacked) {
  const files = walkFiles(unpacked, (file) => file.endsWith(".js"));
  const report = {
    engine: PATCH_ENGINE_VERSION,
    patchedFiles: [],
    capabilities: Object.fromEntries(PATCH_CAPABILITIES.map(({ id, required }) => [id, { required, matches: 0, replacements: 0, alreadyPatched: 0 }])),
    missing: [],
  };
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    let next = text;
    const applied = [];
    for (const capability of PATCH_CAPABILITIES) {
      const outcome = capability.apply(next);
      mergePatchOutcome(report.capabilities[capability.id], outcome);
      next = outcome.text;
      if (outcome.replacements > 0) applied.push({ id: capability.id, count: outcome.replacements });
    }
    if (next !== text) {
      fs.writeFileSync(file, next);
      report.patchedFiles.push({ file: path.relative(unpacked, file), applied });
    }
  }
  for (const capability of PATCH_CAPABILITIES) {
    const result = report.capabilities[capability.id];
    if (capability.required && result.matches === 0) report.missing.push(capability.id);
  }
  return report;
}

function checkPatchedJs(unpacked, jsReport) {
  const checked = [];
  for (const item of jsReport.patchedFiles) {
    const file = path.join(unpacked, item.file);
    run(process.execPath, ["--check", file]);
    checked.push(item.file);
  }
  return checked;
}

function validateAsarList(targetAsar) {
  const list = run("npx", ["--yes", ASAR_PACKAGE, "list", targetAsar]).stdout;
  const bad = list.split(/\n/).filter((line) => /app\.asar\.orig|\.bak|patch-work|codex-for-gpt56|CodexForGPT56|CodexCurrent|user-data/.test(line));
  if (bad.length > 0) throw new Error(`Unexpected generated files inside app.asar: ${bad.join(", ")}`);
  return { checked: true };
}

function signAndVerify(targetApp) {
  if (process.platform !== "darwin" || !commandExists("codesign")) return { skipped: true };
  run("codesign", ["--force", "--deep", "--sign", "-", targetApp], { allowFailure: true });
  const verify = run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", targetApp], { allowFailure: true });
  return { skipped: false, ok: verify.status === 0, stderr: verify.stderr.trim() };
}

function parseDebugModels(codexPath, modelCatalogPath) {
  const data = runDebugModels(codexPath, modelCatalogPath);
  return REQUIRED_MODELS.map((slug) => {
    const model = data.models.find((entry) => entry.slug === slug);
    return {
      slug,
      present: Boolean(model),
      display_name: model?.display_name,
      default_reasoning_level: model?.default_reasoning_level,
      supported_reasoning_levels: (model?.supported_reasoning_levels ?? []).map((entry) => entry.effort),
      context_window: model?.context_window,
      service_tiers: (model?.service_tiers ?? []).map((entry) => entry.id),
      additional_speed_tiers: model?.additional_speed_tiers ?? [],
      multi_agent_version: model?.multi_agent_version,
      visibility: model?.visibility,
    };
  });
}

function assertModelRequirements(models, modelCatalog) {
  for (const model of models) {
    if (!model.present) throw new Error(`${model.slug} missing from codex debug models`);
    const expected = modelCatalog.models.find((entry) => entry.slug === model.slug);
    if (expected == null) throw new Error(`${model.slug} missing from the downloaded official model catalog`);
    const expectedEfforts = (expected.supported_reasoning_levels ?? []).map((entry) => entry.effort);
    if (JSON.stringify(model.supported_reasoning_levels) !== JSON.stringify(expectedEfforts)) {
      throw new Error(`${model.slug} efforts mismatch: expected ${expectedEfforts.join(", ")}; received ${model.supported_reasoning_levels.join(", ")}`);
    }
    if (expected.context_window != null && model.context_window !== expected.context_window) {
      throw new Error(`${model.slug} context_window mismatch: expected ${expected.context_window}; received ${model.context_window}`);
    }
    const expectedServiceTiers = (expected.service_tiers ?? []).map((entry) => entry.id);
    for (const serviceTier of expectedServiceTiers) {
      if (!model.service_tiers.includes(serviceTier)) throw new Error(`${model.slug} missing ${serviceTier} service tier`);
    }
  }
}

function rejectSkValues(value, location = "plugin-account.json") {
  if (typeof value === "string") {
    if (/sk-[A-Za-z0-9_-]+/.test(value)) throw new Error(`${location} contains an sk-* API key; use ChatGPT/Codex OAuth credentials only`);
    return;
  }
  if (Array.isArray(value)) value.forEach((entry, index) => rejectSkValues(entry, `${location}[${index}]`));
  else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) rejectSkValues(entry, `${location}.${key}`);
  }
}

function validatePluginAccount(pluginAccountPath) {
  if (!fs.existsSync(pluginAccountPath)) throw new Error(`--with-plugin-marketplace requires ${pluginAccountPath}`);
  const parsed = JSON.parse(fs.readFileSync(pluginAccountPath, "utf8"));
  rejectSkValues(parsed);
  if (parsed.authFile) {
    const authFile = expandHome(parsed.authFile);
    if (!fs.existsSync(authFile)) throw new Error(`plugin authFile does not exist: ${authFile}`);
  }
  return { requested: true, status: "credential-file-validated", pluginAccountPath };
}

function startMockResponsesServer(captures) {
  function sse(res, event) {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || (req.url !== "/v1/responses" && req.url !== "/responses")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      captures.push(body);
      const response = {
        id: `resp_mock_${Date.now()}`,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: "completed",
        model: body.model,
        output: [{ id: `msg_mock_${Date.now()}`, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: "ok" }] }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      };
      if (body.stream === true) {
        const output = response.output[0];
        const part = output.content[0];
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
        sse(res, { type: "response.created", response: { ...response, status: "in_progress", output: [] } });
        sse(res, { type: "response.output_item.added", output_index: 0, item: { ...output, status: "in_progress", content: [] } });
        sse(res, { type: "response.content_part.added", output_index: 0, content_index: 0, part: { type: "output_text", text: "" } });
        sse(res, { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: part.text });
        sse(res, { type: "response.output_text.done", output_index: 0, content_index: 0, text: part.text });
        sse(res, { type: "response.content_part.done", output_index: 0, content_index: 0, part });
        sse(res, { type: "response.output_item.done", output_index: 0, item: output });
        sse(res, { type: "response.completed", response });
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(response));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function verifyWire(codexPath, modelCatalogPath) {
  const captures = [];
  const server = await startMockResponsesServer(captures);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  const provider = "codex-gpt56-mock";
  const common = [
    "exec", "--json", "--ignore-user-config", "--skip-git-repo-check", "--ephemeral", "--ignore-rules", "-C", os.tmpdir(),
    "-c", `model_provider=${JSON.stringify(provider)}`,
    "-c", `model_catalog_json=${JSON.stringify(modelCatalogPath)}`,
    "-c", `model_providers.${provider}.name="Codex GPT-5.6 Mock"`,
    "-c", `model_providers.${provider}.base_url=${JSON.stringify(baseUrl)}`,
    "-c", `model_providers.${provider}.wire_api="responses"`,
    "-c", `model_providers.${provider}.requires_openai_auth=false`,
    "-c", `service_tier="priority"`,
  ];
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-gpt56-wire-home-"));
  fs.writeFileSync(path.join(tempHome, "config.toml"), "disable_response_storage = true\n");
  const env = { ...process.env, CODEX_HOME: tempHome, OPENAI_API_KEY: "not-a-real-key" };
  try {
    run(codexPath, [...common, "-m", "gpt-5.6-terra", "-c", `model_reasoning_effort="xhigh"`, "Say ok."], { env, timeout: 60000 });
    run(codexPath, [...common, "-m", "gpt-5.6-sol", "-c", `model_reasoning_effort="ultra"`, "Say ok."], { env, timeout: 60000 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
  const terra = captures.find((body) => body.model === "gpt-5.6-terra");
  const sol = captures.find((body) => body.model === "gpt-5.6-sol");
  if (terra == null || sol == null) throw new Error(`Wire verification did not capture both GPT-5.6 requests; captured ${captures.length}`);
  if (terra.reasoning?.effort !== "xhigh") throw new Error(`Terra wire effort mismatch: ${JSON.stringify(terra.reasoning)}`);
  if (terra.service_tier !== "priority") throw new Error(`Terra wire service_tier mismatch: ${terra.service_tier}`);
  if (sol.reasoning?.effort !== "max" || sol.reasoning?.context !== "all_turns") throw new Error(`Sol ultra wire normalization mismatch: ${JSON.stringify(sol.reasoning)}`);
  if (sol.service_tier !== "priority") throw new Error(`Sol wire service_tier mismatch: ${sol.service_tier}`);
  return {
    requested: true,
    status: "passed",
    baseUrl,
    capturedCount: captures.length,
    terra: { model: terra.model, reasoning: terra.reasoning, service_tier: terra.service_tier },
    sol: { model: sol.model, reasoning: sol.reasoning, service_tier: sol.service_tier },
  };
}

function dryRunPlan(opts, sourceApp, paths, modelCatalogPath, pluginMarketplace) {
  const configPath = path.join(codexHomeDir(), "config.toml");
  const existingOutputs = expectedOutputPaths(opts, paths).filter((output) => fs.existsSync(output));
  return {
    dryRun: true,
    platform: process.platform,
    sourceApp,
    targetApp: paths.targetApp,
    stateRoot: opts.root,
    modelCatalogPath,
    configPath,
    desktopLauncherRequested: opts.desktop,
    managedUpdates: opts.managedUpdates
      ? { enabled: true, planPath: managedUpdatePlanPath(opts.root), helperPath: managedUpdateHelperPath(opts.root), behavior: "The generated launchers validate source/copy app fingerprints (app.asar, embedded Codex CLI, and app identity), the managed catalog checksum, and the approved config path before launch; they rebuild/revalidate on critical drift and fail closed on incompatibility." }
      : { enabled: false },
    existingOutputs,
    requiresReplace: existingOutputs.length > 0,
    globalConfigChanges: {
      model_catalog_json: modelCatalogPath,
      model_reasoning_effort: "xhigh when absent",
      service_tier: "priority when absent",
    },
    networkRequirements: {
      modelCatalog: MODEL_CATALOG_URL,
      asarTool: `npx --yes ${ASAR_PACKAGE}`,
    },
    pluginMarketplace,
  };
}

function writeFailureReport(reportPath, details) {
  const failureReportPath = path.join(path.dirname(reportPath), "repair-failure-report.json");
  writeJson(failureReportPath, {
    generatedAt: new Date().toISOString(),
    status: "failed",
    skill: SKILL_ID,
    previousSuccessfulReportPath: fs.existsSync(reportPath) ? reportPath : null,
    ...details,
  });
  return failureReportPath;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let releaseManagedLock = null;
  try {
    if (opts.refreshManagedCopy) releaseManagedLock = await acquireManagedUpdateLock(opts.root);
    const managedRefreshPlan = configureManagedRefresh(opts);
    const sourceApp = findSourceApp(opts.sourceApp);
    const paths = platformPaths(opts, sourceApp);
    assertRepairPathsSafe(sourceApp, opts.root, paths.targetApp);
    const pluginMarketplace = opts.withPluginMarketplace ? validatePluginAccount(opts.pluginAccount) : { requested: false, status: "skipped" };
    const work = path.join(opts.root, ".patch-work");
    const unpacked = path.join(work, "unpacked");
    const packedAsar = path.join(work, "app.asar");
    const modelCatalogPath = stableModelCatalogPath();
    const modelCatalogReportCopy = path.join(opts.root, "model-catalog.json");
    const modelCatalogValidationPath = path.join(work, "validated-model-catalog.json");
    const reportPath = path.join(opts.root, "repair-report.json");
    if (managedRefreshPlan != null) assertManagedRefreshPlan(managedRefreshPlan, opts, sourceApp, paths, modelCatalogPath);

    if (opts.dryRun) {
      console.log(JSON.stringify(dryRunPlan(opts, sourceApp, paths, modelCatalogPath, pluginMarketplace), null, 2));
      return;
    }

    const sourceFingerprint = appFingerprint(sourceApp, paths.sourceAsar, sourceCodexPath(sourceApp));
    const sourceAsarSha256 = sourceFingerprint.appAsarSha256;
    let currentTargetFingerprint = null;
    if (fs.existsSync(paths.targetApp)) {
      try {
        currentTargetFingerprint = appFingerprint(paths.targetApp, paths.targetAsar, paths.codexPath);
      } catch {
        currentTargetFingerprint = null;
      }
    }

    let managedConfigPath = null;
    if (managedRefreshPlan != null) {
      managedConfigPath = assertManagedConfigState(managedRefreshPlan, modelCatalogPath);
      const catalogSha256 = sha256IfExists(modelCatalogPath);
      const managedCopyIsCurrent = managedRefreshPlan.version === MANAGED_UPDATE_VERSION
        && sameFingerprint(managedRefreshPlan.sourceFingerprint, sourceFingerprint)
        && sameFingerprint(managedRefreshPlan.targetFingerprint, currentTargetFingerprint)
        && catalogSha256 === managedRefreshPlan.modelCatalogSha256;
      if (managedCopyIsCurrent) {
        fs.rmSync(managedUpdateFailurePath(opts.root), { force: true });
        console.log(`Managed copy is current for ${sourceApp}; no rebuild was needed.`);
        return;
      }
      if (isMacAppRunning(paths.targetApp)) {
        throw new Error(`Managed update detected a changed source/copy/catalog, but the copied app is still running. Close ${paths.targetApp} and launch again.`);
      }
      console.log(`Source app, copied bundle, or managed catalog changed; rebuilding the managed copy from ${sourceApp}.`);
    }

    requireCommand("npx");
    if (process.platform === "darwin") requireCommand("ditto");
    assertOutputsAvailable(opts, paths);

    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(unpacked, { recursive: true });
    run("npx", ["--yes", ASAR_PACKAGE, "extract", paths.sourceAsar, unpacked], { stdio: "inherit" });
    const jsPatch = patchJsTree(unpacked);
    if (jsPatch.missing.length > 0) {
      writeFailureReport(reportPath, {
        failureStage: "patch-analysis",
        platform: process.platform,
        stateRoot: opts.root,
        sourceApp,
        targetApp: paths.targetApp,
        sourceAsarSha256,
        sourceFingerprint,
        jsPatch,
        globalConfigChanged: false,
      });
      throw new Error(`Required WebView patch points are missing: ${jsPatch.missing.join(", ")}. No copied app or global Codex config was changed.`);
    }
    const jsChecked = checkPatchedJs(unpacked, jsPatch);
    run("npx", ["--yes", ASAR_PACKAGE, "pack", unpacked, packedAsar], { stdio: "inherit" });
    const asarList = validateAsarList(packedAsar);
    const packedAsarSha256 = sha256(packedAsar);
    const upstreamModelCatalog = await fetchModelCatalog();
    const modelCatalogCompatibility = makeCliCompatibleModelCatalog(sourceCodexPath(sourceApp), upstreamModelCatalog);
    const modelCatalog = modelCatalogCompatibility.catalog;

    copyApp(sourceApp, paths.targetApp, opts);
    const appIdentity = updateAppIdentity(paths.targetApp, opts);
    const backupAsar = `${paths.targetAsar}.orig.bak`;
    fs.copyFileSync(paths.targetAsar, backupAsar);
    fs.copyFileSync(packedAsar, paths.targetAsar);
    const targetAsarSha256 = sha256(paths.targetAsar);
    if (packedAsarSha256 !== targetAsarSha256) {
      writeFailureReport(reportPath, {
        failureStage: "copy-patched-asar",
        platform: process.platform,
        stateRoot: opts.root,
        sourceApp,
        targetApp: paths.targetApp,
        sourceAsarSha256,
        sourceFingerprint,
        packedAsarSha256,
        targetAsarSha256,
        jsPatch,
        globalConfigChanged: false,
      });
      throw new Error("Packed app.asar SHA does not match target app.asar. No global Codex config was changed.");
    }

    const signing = signAndVerify(paths.targetApp);
    if (!signing.skipped && !signing.ok) {
      writeFailureReport(reportPath, {
        failureStage: "signing",
        platform: process.platform,
        stateRoot: opts.root,
        sourceApp,
        targetApp: paths.targetApp,
        sourceAsarSha256,
        sourceFingerprint,
        packedAsarSha256,
        targetAsarSha256,
        jsPatch,
        signing,
        globalConfigChanged: false,
      });
      throw new Error("Copied app signature verification failed. No global Codex config was changed.");
    }

    // Validate the copied CLI against the new catalog before committing that
    // catalog to $CODEX_HOME or editing config.toml.
    writeModelCatalog(modelCatalogValidationPath, modelCatalog);
    let debugModels;
    try {
      debugModels = parseDebugModels(paths.codexPath, modelCatalogValidationPath);
      assertModelRequirements(debugModels, modelCatalog);
    } catch (error) {
      writeFailureReport(reportPath, {
        failureStage: "model-validation",
        platform: process.platform,
        stateRoot: opts.root,
        sourceApp,
        targetApp: paths.targetApp,
        sourceAsarSha256,
        sourceFingerprint,
        packedAsarSha256,
        targetAsarSha256,
        jsPatch,
        signing,
        globalConfigChanged: false,
        error: error.message,
      });
      throw error;
    }

    const targetFingerprint = appFingerprint(paths.targetApp, paths.targetAsar, paths.codexPath);
    writeModelCatalog(modelCatalogPath, modelCatalog);
    const modelCatalogSha256 = sha256(modelCatalogPath);
    const managedUpdates = opts.managedUpdates
      ? writeManagedUpdateFiles(opts, sourceApp, paths, sourceFingerprint, targetFingerprint, modelCatalogPath, modelCatalogSha256)
      : { enabled: false, status: "disabled" };
    const launcherInfo = writeLauncher(opts.root, paths.targetApp, opts.name, opts, managedUpdates.helperPath ?? null);
    const desktopEntry = opts.desktop ? createDesktopEntry(opts.root, paths.targetApp, opts.name, opts, launcherInfo, managedUpdates.helperPath ?? null) : { status: "skipped" };
    fs.mkdirSync(path.dirname(modelCatalogReportCopy), { recursive: true });
    fs.copyFileSync(modelCatalogPath, modelCatalogReportCopy);
    const configUpdate = managedRefreshPlan != null
      ? {
          configPath: managedConfigPath,
          backupPath: readPreviousConfigBackup(reportPath),
          changed: false,
        }
      : updateCodexConfig(modelCatalogPath);

    let wireVerification = { requested: false, status: "skipped" };
    if (opts.verifyWire) {
      try {
        wireVerification = await verifyWire(paths.codexPath, modelCatalogPath);
      } catch (error) {
        wireVerification = { requested: true, status: "failed", error: error.message };
      }
    }

    let launch = { requested: opts.launch, status: opts.launch ? "failed" : "skipped" };
    if (opts.launch) {
      try {
        if (process.platform === "darwin") {
          run("open", ["-n", paths.targetApp, "--args", `--user-data-dir=${path.join(opts.root, "user-data")}`], { stdio: "inherit" });
          launch = { requested: true, status: "started" };
        } else if (process.platform === "win32") {
          const result = run(launcherInfo.exe, [`--user-data-dir=${launcherInfo.userData}`], { stdio: "inherit", allowFailure: true });
          launch = result.status === 0 ? { requested: true, status: "started" } : { requested: true, status: "failed", error: result.stderr?.trim() };
        }
      } catch (error) {
        launch = { requested: true, status: "failed", error: error.message };
      }
    }

    const warnings = [];
    if (opts.desktop && !["created", "skipped"].includes(desktopEntry.status)) warnings.push(`Desktop launcher: ${desktopEntry.status}`);
    if (signing.skipped && process.platform === "darwin") warnings.push("macOS signing verification was skipped");
    if (wireVerification.status === "failed") warnings.push("Optional wire verification failed");
    if (launch.status === "failed") warnings.push("Requested app launch failed");

    const report = {
      generatedAt: new Date().toISOString(),
      status: warnings.length === 0 ? "success" : "completed-with-warnings",
      warnings,
      platform: process.platform,
      skill: SKILL_ID,
      appName: opts.name,
      appSlug: appSlug(opts.name),
      bundleId: process.platform === "darwin" ? DEFAULT_BUNDLE_ID : null,
      stateRoot: opts.root,
      appParent: paths.appParent,
      rootProvided: opts.rootProvided,
      sourceApp,
      targetApp: paths.targetApp,
      launcher: launcherInfo.launcher,
      desktopEntry,
      appIdentity,
      configPath: configUpdate.configPath,
      configBackupPath: configUpdate.backupPath,
      configChanged: configUpdate.changed,
      modelCatalogPath,
      modelCatalogReportCopy,
      modelCatalogSource: MODEL_CATALOG_URL,
      modelCatalogModelCount: modelCatalog.models.length,
      modelCatalogCompatibility: modelCatalogCompatibility.verification,
      managedUpdates,
      sourceFingerprint,
      targetFingerprint,
      sourceAsarSha256,
      packedAsarSha256,
      targetAsarSha256,
      jsPatch,
      jsChecked,
      asarList,
      signing,
      debugModels,
      pluginMarketplace,
      wireVerification,
      launch,
    };
    writeJson(reportPath, report);
    if (managedRefreshPlan != null) fs.rmSync(managedUpdateFailurePath(opts.root), { force: true });

    console.log(warnings.length === 0 ? `${opts.name} built successfully.` : `${opts.name} built with warnings.`);
    console.log(`Target app: ${paths.targetApp}`);
    console.log(`Launcher: ${launcherInfo.launcher}`);
    console.log(`Desktop: ${desktopEntry.path ?? desktopEntry.status}`);
    console.log(`Report: ${reportPath}`);
  } catch (error) {
    if (opts.refreshManagedCopy) {
      try {
        writeJson(managedUpdateFailurePath(opts.root), {
          generatedAt: new Date().toISOString(),
          status: "failed",
          skill: SKILL_ID,
          stateRoot: opts.root,
          planPath: managedUpdatePlanPath(opts.root),
          error: error.message,
        });
      } catch {
        // Preserve the original managed-refresh error.
      }
    }
    throw error;
  } finally {
    releaseManagedLock?.();
  }
}
if (process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}
