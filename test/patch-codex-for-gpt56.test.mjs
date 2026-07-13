import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  macManagedUpdatePrelude,
  normalizeModelCatalogForCliBaseline,
  patchJsTree,
  readTopLevelTomlString,
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
