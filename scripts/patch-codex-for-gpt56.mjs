#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const REQUIRED_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
const MODEL_CATALOG_URL = "https://raw.githubusercontent.com/openai/codex/main/codex-rs/models-manager/models.json";
const DEFAULT_NAME = "Codex for GPT-5.6";
const DEFAULT_ROOT = path.join(os.homedir(), "Downloads", "Report", "CodexForGPT56");
const DEFAULT_BUNDLE_ID = "com.openai.codex.gpt56";
const SKILL_ID = "codex-for-gpt56";

function usage() {
  console.log(`Usage: patch-codex-for-gpt56.mjs [options]

Options:
  --root <path>                  Output root (default: ~/Downloads/Report/CodexForGPT56)
  --name <name>                  App/display name (default: Codex for GPT-5.6)
  --source-app <path>            Source app bundle/folder/exe to copy
  --launch                       Launch after patching
  --no-desktop                   Do not create a Desktop launcher/link
  --verify-wire                  Optional mock /v1/responses request capture
  --with-plugin-marketplace      Validate plugin-account.json for optional plugin sync
  --plugin-account <path>        Path to plugin-account.json
  -h, --help                     Show this help
`);
}

function parseArgs(argv) {
  const opts = {
    root: DEFAULT_ROOT,
    name: DEFAULT_NAME,
    sourceApp: process.env.CODEX_SOURCE_APP || "",
    launch: false,
    desktop: true,
    verifyWire: false,
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
    if (arg === "--root") opts.root = readValue();
    else if (arg === "--name") opts.name = readValue();
    else if (arg === "--source-app") opts.sourceApp = readValue();
    else if (arg === "--launch") opts.launch = true;
    else if (arg === "--no-desktop") opts.desktop = false;
    else if (arg === "--verify-wire") opts.verifyWire = true;
    else if (arg === "--with-plugin-marketplace") opts.withPluginMarketplace = true;
    else if (arg === "--plugin-account") opts.pluginAccount = readValue();
    else if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  opts.root = expandHome(opts.root);
  opts.pluginAccount = opts.pluginAccount ? expandHome(opts.pluginAccount) : path.join(opts.root, "plugin-account.json");
  return opts;
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
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

function platformPaths(opts, sourceApp) {
  const appParent = path.join(opts.root, "app");
  if (process.platform === "darwin") {
    const targetApp = path.join(appParent, `${opts.name}.app`);
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
  return {
    appParent,
    targetApp,
    sourceAsar: path.join(sourceApp, "resources", "app.asar"),
    targetAsar: path.join(targetApp, "resources", "app.asar"),
    codexPath: firstExisting([path.join(targetApp, "resources", "codex.exe"), path.join(targetApp, "resources", "codex")]),
    launchTarget: null,
  };
}

function firstExisting(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

function copyApp(sourceApp, targetApp) {
  fs.rmSync(targetApp, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetApp), { recursive: true });
  if (process.platform === "darwin") run("ditto", [sourceApp, targetApp], { stdio: "inherit" });
  else fs.cpSync(sourceApp, targetApp, { recursive: true, force: true });
}

function plistSet(plist, key, value) {
  run("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist], { allowFailure: true });
}

function updateAppIdentity(targetApp, opts) {
  if (process.platform !== "darwin") return { skipped: true };
  const plist = path.join(targetApp, "Contents", "Info.plist");
  plistSet(plist, "CFBundleDisplayName", opts.name);
  plistSet(plist, "CFBundleName", opts.name);
  plistSet(plist, "CFBundleIdentifier", DEFAULT_BUNDLE_ID);
  return { skipped: false, bundleId: DEFAULT_BUNDLE_ID };
}

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "user-agent": "codex-for-gpt56" } }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} while fetching ${url}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      })
      .on("error", reject);
  });
}

async function writeModelCatalog(modelCatalogPath) {
  const text = await download(MODEL_CATALOG_URL);
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.models)) throw new Error("Official model catalog does not contain models[]");
  for (const slug of REQUIRED_MODELS) {
    if (!parsed.models.some((model) => model.slug === slug)) throw new Error(`Official model catalog is missing ${slug}`);
  }
  fs.mkdirSync(path.dirname(modelCatalogPath), { recursive: true });
  fs.writeFileSync(modelCatalogPath, `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
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
  return { configPath, backupPath };
}

function writeMacLauncher(root, targetApp, name) {
  const launcher = path.join(root, `${name}.command`);
  const userData = path.join(root, "user-data");
  const content = `#!/usr/bin/env bash
set -euo pipefail
USER_DATA=${JSON.stringify(userData)}
mkdir -p "$USER_DATA"
open -n ${JSON.stringify(targetApp)} --args --user-data-dir="$USER_DATA" "$@"
`;
  fs.writeFileSync(launcher, content, { mode: 0o755 });
  fs.chmodSync(launcher, 0o755);
  return launcher;
}

function writeWindowsLauncher(root, targetApp, name) {
  const exe = findWindowsAppExe(targetApp);
  if (exe == null) throw new Error(`Could not find copied Windows app exe in ${targetApp}`);
  const launcher = path.join(root, `${name}.cmd`);
  const userData = path.join(root, "user-data");
  const content = `@echo off\r\nset "USER_DATA=${userData}"\r\nif not exist "%USER_DATA%" mkdir "%USER_DATA%"\r\nstart "" "${exe}" --user-data-dir="%USER_DATA%" %*\r\n`;
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

function createMacLauncherApp(root, targetApp, name) {
  const desktop = path.join(os.homedir(), "Desktop");
  const launcherApp = path.join(desktop, `${name}.app`);
  const contents = path.join(launcherApp, "Contents");
  const macos = path.join(contents, "MacOS");
  const resources = path.join(contents, "Resources");
  const executableName = `${appSlug(name)}-launcher`;
  const userData = path.join(root, "user-data");
  fs.mkdirSync(desktop, { recursive: true });
  if (fs.existsSync(launcherApp)) fs.rmSync(launcherApp, { recursive: true, force: true });
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
USER_DATA=${JSON.stringify(userData)}
mkdir -p "$USER_DATA"
open -n ${JSON.stringify(targetApp)} --args --user-data-dir="$USER_DATA" "$@"
`,
    { mode: 0o755 },
  );
  fs.chmodSync(executable, 0o755);
  run("codesign", ["--force", "--deep", "--sign", "-", launcherApp], { allowFailure: true });
  return { type: "mac-launcher-app", path: launcherApp, status: "created", targetApp, userData };
}

function createDesktopEntry(root, targetApp, name) {
  if (process.platform === "darwin") {
    try {
      return createMacLauncherApp(root, targetApp, name);
    } catch (error) {
      return { type: "mac-launcher-app", path: path.join(os.homedir(), "Desktop", `${name}.app`), status: "failed", error: error.message };
    }
  }

  if (process.platform === "win32") {
    const desktop = path.join(os.homedir(), "Desktop");
    const shortcut = path.join(desktop, `${name}.lnk`);
    const exe = findWindowsAppExe(targetApp);
    const userData = path.join(root, "user-data");
    if (exe == null) return { type: "windows-lnk", path: shortcut, status: "failed", error: "missing exe" };
    const ps = [
      "$w = New-Object -ComObject WScript.Shell",
      `$s = $w.CreateShortcut(${psSingle(shortcut)})`,
      `$s.TargetPath = ${psSingle(exe)}`,
      `$s.Arguments = ${psSingle(`--user-data-dir="${userData}"`)}`,
      `$s.WorkingDirectory = ${psSingle(path.dirname(exe))}`,
      `$s.IconLocation = ${psSingle(`${exe},0`)}`,
      "$s.Save()",
    ].join("; ");
    const result = run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { allowFailure: true });
    if (result.status === 0) return { type: "windows-lnk", path: shortcut, status: "created" };
    const fallback = path.join(desktop, `${name}.cmd`);
    fs.writeFileSync(fallback, `@echo off\r\nstart "" "${exe}" --user-data-dir="${userData}" %*\r\n`);
    return { type: "windows-lnk", path: shortcut, status: "failed-fallback-cmd-created", fallback, error: result.stderr.trim() };
  }

  return { type: "desktop", status: "skipped" };
}

function writeLauncher(root, targetApp, name) {
  if (process.platform === "darwin") return { launcher: writeMacLauncher(root, targetApp, name) };
  if (process.platform === "win32") return writeWindowsLauncher(root, targetApp, name);
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

const REPLACEMENTS = [
  {
    id: "fast-auth-apikey-eligibility",
    from: "a=i?.authMethod===`chatgpt`,o=i?.authMethod??null",
    to: "a=i?.authMethod===`chatgpt`||i?.authMethod===`apikey`,o=i?.authMethod??null",
  },
  {
    id: "fast-auth-apikey-loading-and-allow",
    from: "u=!!i?.isLoading||a&&l,d=a&&!u&&c!=null&&c?.requirements?.featureRequirements?.fast_mode!==!1",
    to: "u=!!i?.isLoading||i?.authMethod===`chatgpt`&&l,d=a&&!u&&(i?.authMethod===`apikey`||c!=null&&c?.requirements?.featureRequirements?.fast_mode!==!1)",
  },
  {
    id: "enabled-efforts-webview-baseline",
    from: "Xv=[`low`,`medium`,`high`,`xhigh`]",
    to: "Xv=[`low`,`medium`,`high`,`xhigh`,`max`,`ultra`]",
  },
  {
    id: "enabled-efforts-config-default",
    from: "default:[`low`,`medium`,`high`,`xhigh`,`ultra`]",
    to: "default:[`low`,`medium`,`high`,`xhigh`,`max`,`ultra`]",
  },
  {
    id: "enabled-efforts-pull-request-default",
    from: "WCe=[`low`,`medium`,`high`,`xhigh`,`ultra`]",
    to: "WCe=[`low`,`medium`,`high`,`xhigh`,`max`,`ultra`]",
  },
  {
    id: "remove-ultra-statsig-list-models-gate",
    from: "let c=s(Zv),l=i&&s(Xi,`1186680773`);return",
    to: "let c=s(Zv),l=i;return",
  },
  {
    id: "remove-ultra-statsig-thread-tools-gate",
    from: "includeUltraReasoningEffort:Ir(r,`1186680773`)",
    to: "includeUltraReasoningEffort:!0",
  },
  {
    id: "show-native-gpt56-models-webview",
    from: "l=o&&e!==`amazonBedrock`,u=a.some(e=>e.supportedReasoningEfforts.some(({reasoningEffort:e})=>e===`max`)),d=i&&a.some(e=>e.supportedReasoningEfforts.some(({reasoningEffort:e})=>e===`ultra`));return a.forEach(n=>{if(l?t.has(n.model):!n.hidden){",
    to: "l=o&&e!==`amazonBedrock`,f=e=>e===`gpt-5.6-sol`||e===`gpt-5.6-terra`||e===`gpt-5.6-luna`,u=a.some(e=>e.supportedReasoningEfforts.some(({reasoningEffort:e})=>e===`max`)),d=i&&a.some(e=>e.supportedReasoningEfforts.some(({reasoningEffort:e})=>e===`ultra`));return a.forEach(n=>{if(l?t.has(n.model)||f(n.model):!n.hidden||f(n.model)){",
  },
  {
    id: "show-gpt56-power-selections-webview",
    from: "function ARe(e){let t=PRe(FRe,e);if(t.length>=4)return t;let n=PRe(IRe,e);return n.length>=4?n:[]}",
    to: "function ARe(e){let t=MRe(e?.filter(e=>e.model===`gpt-5.6-sol`||e.model===`gpt-5.6-terra`||e.model===`gpt-5.6-luna`));if(t.length>=4)return t;let n=PRe(FRe,e);if(n.length>=4)return n;let r=PRe(IRe,e);return r.length>=4?r:[]}",
  },
];

function patchJsTree(unpacked) {
  const files = walkFiles(unpacked, (file) => file.endsWith(".js"));
  const report = { patchedFiles: [], replacements: {}, alreadyPatched: {}, missing: [] };
  for (const replacement of REPLACEMENTS) {
    report.replacements[replacement.id] = 0;
    report.alreadyPatched[replacement.id] = 0;
  }
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    let next = text;
    const applied = [];
    for (const replacement of REPLACEMENTS) {
      const count = next.split(replacement.from).length - 1;
      const already = next.split(replacement.to).length - 1;
      if (count > 0) {
        next = next.split(replacement.from).join(replacement.to);
        report.replacements[replacement.id] += count;
        applied.push({ id: replacement.id, count });
      } else if (already > 0) {
        report.alreadyPatched[replacement.id] += already;
      }
    }
    if (next !== text) {
      fs.writeFileSync(file, next);
      report.patchedFiles.push({ file: path.relative(unpacked, file), applied });
    }
  }
  for (const replacement of REPLACEMENTS) {
    if (report.replacements[replacement.id] === 0 && report.alreadyPatched[replacement.id] === 0) {
      report.missing.push(replacement.id);
    }
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
  const list = run("npx", ["--yes", "@electron/asar", "list", targetAsar]).stdout;
  const bad = list.split(/\n/).filter((line) => /app\.asar\.orig|\.bak|patch-work|CodexForGPT56|CodexCurrent|user-data/.test(line));
  if (bad.length > 0) throw new Error(`Unexpected generated files inside app.asar: ${bad.join(", ")}`);
  return { checked: true };
}

function signAndVerify(targetApp) {
  if (process.platform !== "darwin" || !commandExists("codesign")) return { skipped: true };
  run("codesign", ["--force", "--deep", "--sign", "-", targetApp], { allowFailure: true });
  const verify = run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", targetApp], { allowFailure: true });
  return { skipped: false, ok: verify.status === 0, stderr: verify.stderr.trim() };
}

function parseDebugModels(codexPath) {
  if (!fs.existsSync(codexPath)) throw new Error(`Codex CLI not found in copied app: ${codexPath}`);
  const raw = execFileSync(codexPath, ["debug", "models"], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  const data = JSON.parse(raw);
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

function assertModelRequirements(models) {
  const expected = new Map([
    ["gpt-5.6-sol", ["low", "medium", "high", "xhigh", "max", "ultra"]],
    ["gpt-5.6-terra", ["low", "medium", "high", "xhigh", "max", "ultra"]],
    ["gpt-5.6-luna", ["low", "medium", "high", "xhigh", "max"]],
  ]);
  for (const model of models) {
    if (!model.present) throw new Error(`${model.slug} missing from codex debug models`);
    const wanted = expected.get(model.slug);
    if (JSON.stringify(model.supported_reasoning_levels) !== JSON.stringify(wanted)) {
      throw new Error(`${model.slug} efforts mismatch: ${model.supported_reasoning_levels.join(", ")}`);
    }
    if (model.context_window !== 372000) throw new Error(`${model.slug} context_window mismatch`);
    if (!model.service_tiers.includes("priority")) throw new Error(`${model.slug} missing priority service tier`);
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
    baseUrl,
    capturedCount: captures.length,
    terra: { model: terra.model, reasoning: terra.reasoning, service_tier: terra.service_tier },
    sol: { model: sol.model, reasoning: sol.reasoning, service_tier: sol.service_tier },
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  requireCommand("node");
  requireCommand("npx");
  if (process.platform === "darwin") requireCommand("ditto");

  const sourceApp = findSourceApp(opts.sourceApp);
  const paths = platformPaths(opts, sourceApp);
  const work = path.join(opts.root, ".patch-work");
  const unpacked = path.join(work, "unpacked");
  const packedAsar = path.join(work, "app.asar");
  const modelCatalogPath = stableModelCatalogPath();
  const modelCatalogReportCopy = path.join(opts.root, "model-catalog.json");
  const reportPath = path.join(opts.root, "repair-report.json");

  copyApp(sourceApp, paths.targetApp);
  const appIdentity = updateAppIdentity(paths.targetApp, opts);
  const backupAsar = `${paths.targetAsar}.orig.bak`;
  fs.copyFileSync(paths.targetAsar, backupAsar);

  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(unpacked, { recursive: true });
  run("npx", ["--yes", "@electron/asar", "extract", paths.targetAsar, unpacked], { stdio: "inherit" });
  const jsPatch = patchJsTree(unpacked);
  const jsChecked = checkPatchedJs(unpacked, jsPatch);
  run("npx", ["--yes", "@electron/asar", "pack", unpacked, packedAsar], { stdio: "inherit" });
  fs.copyFileSync(packedAsar, paths.targetAsar);

  const modelCatalog = await writeModelCatalog(modelCatalogPath);
  fs.mkdirSync(path.dirname(modelCatalogReportCopy), { recursive: true });
  fs.copyFileSync(modelCatalogPath, modelCatalogReportCopy);
  const configUpdate = updateCodexConfig(modelCatalogPath);
  const launcherInfo = writeLauncher(opts.root, paths.targetApp, opts.name);
  const desktopEntry = opts.desktop ? createDesktopEntry(opts.root, paths.targetApp, opts.name) : { status: "skipped" };
  const signing = signAndVerify(paths.targetApp);
  const asarList = validateAsarList(paths.targetAsar);
  const sourceAsarSha256 = sha256(paths.sourceAsar);
  const packedAsarSha256 = sha256(packedAsar);
  const targetAsarSha256 = sha256(paths.targetAsar);
  if (packedAsarSha256 !== targetAsarSha256) throw new Error("Packed app.asar SHA does not match target app.asar");

  const debugModels = parseDebugModels(paths.codexPath);
  assertModelRequirements(debugModels);

  const pluginMarketplace = opts.withPluginMarketplace ? validatePluginAccount(opts.pluginAccount) : { requested: false, status: "skipped" };
  let wireVerification = { requested: false, status: "skipped" };
  if (opts.verifyWire) {
    try {
      wireVerification = await verifyWire(paths.codexPath, modelCatalogPath);
    } catch (error) {
      wireVerification = { requested: true, status: "failed", error: error.message };
    }
  }

  if (opts.launch) {
    if (process.platform === "darwin") run("open", ["-n", paths.targetApp, "--args", `--user-data-dir=${path.join(opts.root, "user-data")}`], { stdio: "inherit" });
    else if (process.platform === "win32") run(launcherInfo.exe, [`--user-data-dir=${launcherInfo.userData}`], { stdio: "inherit", allowFailure: true });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    skill: SKILL_ID,
    appName: opts.name,
    appSlug: appSlug(opts.name),
    bundleId: process.platform === "darwin" ? DEFAULT_BUNDLE_ID : null,
    sourceApp,
    targetApp: paths.targetApp,
    launcher: launcherInfo.launcher,
    desktopEntry,
    appIdentity,
    configPath: configUpdate.configPath,
    configBackupPath: configUpdate.backupPath,
    modelCatalogPath,
    modelCatalogReportCopy,
    modelCatalogModelCount: modelCatalog.models.length,
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
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`${opts.name} built successfully.`);
  console.log(`Target app: ${paths.targetApp}`);
  console.log(`Launcher: ${launcherInfo.launcher}`);
  console.log(`Desktop: ${desktopEntry.path ?? desktopEntry.status}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
});
