import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyRendererSmokeOutput,
  isManagedCopyCurrent,
  macManagedUpdatePrelude,
  normalizeModelCatalogForCliBaseline,
  patchJsTree,
  removeManagedUpdateFiles,
  readTopLevelTomlString,
  reconcileManagedCatalogConfigText,
  syncIsolatedCodexConfig,
} from "../scripts/patch-codex-for-gpt56.mjs";

function withJsTree(source, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-gpt56-test-"));
  const assets = path.join(root, "webview", "assets");
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, "bundle.js"), source);
  try {
    return callback(root, path.join(assets, "bundle.js"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const adaptiveFixture = [
  "var ta;ta=[`low`,`medium`,`high`,`xhigh`];",
  "function list(){let l=i&&s(ie,`1186680773`);return{queryFn:()=>Nt(`list-models-for-host`,{includeUltraReasoningEffort:l})}}",
  "function select({models:a,useHiddenModels:o,authMethod:e}){let l=o&&e!==`amazonBedrock`;return a.forEach(n=>{if(l?t.has(n.model):!n.hidden){return n.supportedReasoningEfforts}})}",
  "function js(e,t=!1){let n=Fs(t?[...Is,Ls]:Is,e);if(n.length>=4)return n;let r=Fs(Rs,e);return r.length>=4?r:[]}",
  "var Is,Ls,Rs;Is=[{id:`gpt-5.6-sol:low`,model:`gpt-5.6-sol`}];Ls={id:`gpt-5.6-sol:ultra`,model:`gpt-5.6-sol`};Rs=[];",
].join("\n");

test("semantic patcher survives renamed minifier variables", () => {
  withJsTree(adaptiveFixture, (root, jsFile) => {
    const report = patchJsTree(root);
    const patched = fs.readFileSync(jsFile, "utf8");

    assert.deepEqual(report.missing, []);
    assert.equal(report.capabilities["enable-gpt56-reasoning-efforts"].replacements, 1);
    assert.equal(report.capabilities["enable-ultra-reasoning-effort"].replacements, 1);
    assert.equal(report.capabilities["show-hidden-gpt56-models"].replacements, 1);
    assert.equal(report.capabilities["gpt56-power-selection-fallback"].replacements, 1);
    assert.match(patched, /ta=\[`low`,`medium`,`high`,`xhigh`,`max`,`ultra`\]/);
    assert.match(patched, /let l=!0/);
    assert.match(patched, /t\.has\(n\.model\)\|\|\(n\.model===`gpt-5\.6-sol`/);
    assert.match(patched, /let r=Fs\(Rs,e\)/);
    assert.doesNotMatch(patched, /let r=Rs\(\d+,e\)/);
    assert.match(patched, /return r\.length>=4\?r:t\?\[\.\.\.Is,Ls\]:Is/);

    const rerun = patchJsTree(root);
    assert.deepEqual(rerun.missing, []);
    for (const id of [
      "enable-gpt56-reasoning-efforts",
      "enable-ultra-reasoning-effort",
      "show-hidden-gpt56-models",
      "gpt56-power-selection-fallback",
    ]) {
      assert.equal(rerun.capabilities[id].replacements, 0);
      assert.equal(rerun.capabilities[id].alreadyPatched, 1);
    }
  });
});

test("semantic patcher refuses unrelated source shapes", () => {
  withJsTree("const efforts=[`low`,`medium`,`high`,`xhigh`]; const flag=i&&s(ie,`1186680773`);", (root, jsFile) => {
    const report = patchJsTree(root);
    assert.deepEqual(report.missing.sort(), [
      "enable-gpt56-reasoning-efforts",
      "enable-ultra-reasoning-effort",
      "show-hidden-gpt56-models",
    ]);
    assert.equal(fs.readFileSync(jsFile, "utf8"), "const efforts=[`low`,`medium`,`high`,`xhigh`]; const flag=i&&s(ie,`1186680773`);");
  });
});


test("catalog normalization uses exact-model fields and only uniform unmatched defaults", () => {
  const upstream = {
    models: [
      { slug: "gpt-5.6-sol" },
      { slug: "gpt-5.6-luna", display_name: "Luna from upstream" },
    ],
  };
  const baseline = {
    models: [
      {
        slug: "gpt-5.6-sol",
        display_name: "Sol baseline",
        context_window: 400000,
        supports_reasoning_summaries: true,
        effective_context_window_percent: 95,
      },
      {
        slug: "gpt-5.5-codex",
        display_name: "Codex baseline",
        context_window: 200000,
        supports_reasoning_summaries: true,
        effective_context_window_percent: 95,
      },
    ],
  };

  const result = normalizeModelCatalogForCliBaseline(upstream, baseline);
  const [sol, luna] = result.catalog.models;

  assert.equal(sol.display_name, "Sol baseline");
  assert.equal(sol.context_window, 400000);
  assert.equal(sol.supports_reasoning_summaries, true);
  assert.equal(luna.display_name, "Luna from upstream");
  assert.equal(luna.supports_reasoning_summaries, true);
  assert.equal(luna.effective_context_window_percent, 95);
  assert.equal(Object.hasOwn(luna, "context_window"), false);
  assert.equal(result.normalization.matchedBaselineModels, 1);
  assert.equal(result.normalization.unmatchedUpstreamModels, 1);
  assert.deepEqual(result.normalization.uniformFallbackFields, [
    "effective_context_window_percent",
    "supports_reasoning_summaries",
  ]);
  assert.deepEqual(upstream.models[0], { slug: "gpt-5.6-sol" });
});

test("semantic model repair does not rewrite legacy API-key Fast auth logic", () => {
  const authSource = [
    "a=i?.authMethod===`chatgpt`,o=i?.authMethod??null",
    "u=!!i?.isLoading||a&&l,d=a&&!u&&c!=null&&c?.requirements?.featureRequirements?.fast_mode!==!1",
  ].join(";");
  withJsTree(`${adaptiveFixture}\n${authSource}`, (root, jsFile) => {
    const report = patchJsTree(root);
    const patched = fs.readFileSync(jsFile, "utf8");
    assert.deepEqual(report.missing, []);
    assert.match(patched, /a=i\?\.authMethod===`chatgpt`,o=i\?\.authMethod\?\?null/);
    assert.match(patched, /u=!!i\?\.isLoading\|\|a&&l,d=a&&!u&&c!=null&&c\?\.requirements\?\.featureRequirements\?\.fast_mode!==!1/);
    assert.doesNotMatch(patched, /authMethod===`apikey`/);
  });
});


test("managed refresh rebuilds when the patch-engine generation changes", () => {
  const sourceFingerprint = { appAsarSha256: "a".repeat(64), codexSha256: "b".repeat(64), identitySha256: "c".repeat(64) };
  const targetFingerprint = { appAsarSha256: "d".repeat(64), codexSha256: "e".repeat(64), identitySha256: "f".repeat(64) };
  const modelCatalogSha256 = "1".repeat(64);
  const plan = {
    version: 5,
    patchEngineVersion: "semantic-v2",
    sourceFingerprint,
    targetFingerprint,
    modelCatalogSha256,
  };

  assert.equal(isManagedCopyCurrent(plan, sourceFingerprint, targetFingerprint, modelCatalogSha256, "semantic-v2"), true);
  assert.equal(isManagedCopyCurrent(plan, sourceFingerprint, targetFingerprint, modelCatalogSha256, "semantic-v3"), false);
});

test("managed macOS launcher prelude fails closed when helper is unavailable", () => {
  const prelude = macManagedUpdatePrelude("/tmp/missing managed helper.command");
  assert.match(prelude, /if \[\[ ! -x "\$MANAGED_UPDATER" \]\]/);
  assert.match(prelude, /refusing to launch an unchecked copy/);
  assert.match(prelude, /exit 1/);
  assert.match(prelude, /"\$MANAGED_UPDATER"/);
});

test("top-level TOML reader handles quotes and ignores section-local keys", () => {
  assert.equal(readTopLevelTomlString('model_catalog_json = "/tmp/catalog.json"\n[other]\nmodel_catalog_json = "wrong"\n', "model_catalog_json"), "/tmp/catalog.json");
  assert.equal(readTopLevelTomlString("model_catalog_json = '/tmp/single.json' # keep\n", "model_catalog_json"), "/tmp/single.json");
  assert.equal(readTopLevelTomlString('[other]\nmodel_catalog_json = "/tmp/wrong.json"\n', "model_catalog_json"), null);
});

test("managed config reconciliation restores only model_catalog_json", () => {
  const before = [
    'model_provider = "custom"',
    'model = "gpt-5.6-terra"',
    'model_reasoning_effort = "medium"',
    'model_catalog_json = "cc-switch-model-catalog.json"',
    '',
    '[model_providers.custom]',
    'base_url = "http://127.0.0.1:15721/v1"',
    '',
  ].join("\n");
  const catalog = "/Users/example/.codex/model-catalogs/codex-for-gpt56/model-catalog.json";
  const after = reconcileManagedCatalogConfigText(before, catalog);

  assert.equal(readTopLevelTomlString(after, "model_catalog_json"), catalog);
  assert.match(after, /model_provider = "custom"/);
  assert.match(after, /model = "gpt-5\.6-terra"/);
  assert.match(after, /model_reasoning_effort = "medium"/);
  assert.match(after, /base_url = "http:\/\/127\.0\.0\.1:15721\/v1"/);
  assert.equal((after.match(/model_catalog_json/g) || []).length, 1);
});

test("explicit managed opt-out removes only managed metadata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-gpt56-managed-opt-out-"));
  const helper = process.platform === "win32" ? "refresh-managed-copy.cmd" : "refresh-managed-copy.command";
  const managedFiles = ["managed-update.json", helper, "managed-repair.mjs", "managed-update-failure.json"];
  const managedHome = path.join(root, "codex-home");
  const unrelated = path.join(root, "keep.txt");
  try {
    for (const name of managedFiles) fs.writeFileSync(path.join(root, name), name);
    fs.mkdirSync(managedHome);
    fs.writeFileSync(path.join(managedHome, "config.toml"), "generated");
    fs.writeFileSync(unrelated, "keep");

    const result = removeManagedUpdateFiles(root);

    assert.equal(result.status, "disabled-explicitly");
    assert.equal(result.removed.length, managedFiles.length + 1);
    for (const name of managedFiles) assert.equal(fs.existsSync(path.join(root, name)), false);
    assert.equal(fs.existsSync(managedHome), false);
    assert.equal(fs.readFileSync(unrelated, "utf8"), "keep");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("isolated managed config preserves the external manager's global config", () => {
  const sourceHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-gpt56-global-home-"));
  const root = path.join(sourceHome, "codex-for-gpt56");
  const isolatedHome = path.join(root, "codex-home");
  const sourceConfigPath = path.join(sourceHome, "config.toml");
  const modelCatalogPath = path.join(sourceHome, "model-catalog.json");
  const authPath = path.join(sourceHome, "auth.json");
  const before = [
    'model_provider = "custom"',
    'model_catalog_json = "cc-switch-model-catalog.json"',
    '',
    '[model_providers.custom]',
    'base_url = "http://127.0.0.1:15721/v1"',
    'env_key = "OPENAI_API_KEY"',
    '',
  ].join("\n");
  const previousHome = process.env.CODEX_HOME;
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(sourceConfigPath, before);
    fs.writeFileSync(modelCatalogPath, '{"models":[]}\n');
    fs.writeFileSync(authPath, '{}\n');
    process.env.CODEX_HOME = sourceHome;
    const result = syncIsolatedCodexConfig({
      stateRoot: root,
      codexHome: sourceHome,
      sourceConfigPath,
      launchCodexHome: isolatedHome,
      configPath: path.join(isolatedHome, "config.toml"),
    }, modelCatalogPath);

    assert.equal(fs.readFileSync(sourceConfigPath, "utf8"), before);
    const isolated = fs.readFileSync(result.configPath, "utf8");
    assert.equal(readTopLevelTomlString(isolated, "model_catalog_json"), modelCatalogPath);
    assert.match(isolated, /base_url = "http:\/\/127\.0\.0\.1:15721\/v1"/);
    assert.equal(fs.realpathSync(path.join(isolatedHome, "auth.json")), fs.realpathSync(authPath));
  } finally {
    if (previousHome == null) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    fs.rmSync(sourceHome, { recursive: true, force: true });
  }
});

test("renderer smoke classifier rejects the React error boundary seen in broken copies", () => {
  const result = classifyRendererSmokeOutput([
    "DevTools listening on ws://127.0.0.1:60766/devtools/browser/test",
    "[startup][renderer] app routes mounted after 3029ms",
    "Electron renderer console [error] app://-/assets/chunk.js:8 TypeError: Rs is not a function",
    "[electron-message-handler] error boundary componentStack=...",
  ].join("\n"));
  assert.equal(result.routesMounted, true);
  assert.equal(result.devToolsListening, true);
  assert.equal(result.fatalErrors.length, 2);
});

test("renderer smoke classifier accepts a mounted renderer with nonfatal warnings", () => {
  const result = classifyRendererSmokeOutput([
    "DevTools listening on ws://127.0.0.1:60766/devtools/browser/test",
    "Electron renderer console [warning] WARN [Statsig] missing userID",
    "[startup][renderer] app routes mounted after 12422ms",
  ].join("\n"));
  assert.equal(result.routesMounted, true);
  assert.equal(result.devToolsListening, true);
  assert.deepEqual(result.fatalErrors, []);
});
