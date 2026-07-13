---
name: codex-for-gpt56
description: Build and verify a local, separately copied Codex or ChatGPT desktop app whose local model picker exposes GPT-5.6 Sol, Terra, and Luna. Use when a user explicitly requests an on-device repair or rebuild on macOS or Windows, asks to inspect its dry-run plan, or packages this repair workflow as a Codex skill. Do not use merely to explain model availability, or to modify original apps or non-Codex/ChatGPT apps.
---

# Codex for GPT-5.6

Create a local copy from the user's installed Codex or ChatGPT Electron app. Never distribute a modified OpenAI app bundle or patch the original app in place.

Treat the directory containing this `SKILL.md` as `SKILL_DIR`. Invoke bundled entrypoints with an absolute path from `SKILL_DIR`; do not assume the user's current working directory is the skill directory.

## Establish Consent And Compatibility

1. Confirm that the user wants a local client-side repair, not an explanation of model availability.
2. Confirm macOS or Windows. Stop on Linux because the repair script does not support it.
3. Confirm an installed Codex or ChatGPT Electron app with `app.asar`, `node` and `npx` on `PATH`, network access for the upstream catalog (or an existing previously validated persistent catalog for a clearly reported cached fallback), and a pinned `@electron/asar` version (`4.2.0` on Node 22.12+, `3.4.1` on older runtimes), and enough disk space for an app copy plus temporary unpacked files.
4. Explain that the repair creates a separate app and launcher, changes the active `$CODEX_HOME/config.toml`, and can add a default `xhigh` reasoning effort and `priority` service tier when those keys are absent.
5. Explain that local visibility does not grant server authorization, account entitlement, billing privileges, or product access. Keep the copied app's client-side behavior clearly separate from service-side access control.
6. Ask the user to close any previously generated copy before rebuilding it. Explain that macOS repair validation briefly opens the copied app with disposable user-data and Codex-home directories, then closes it; this renderer smoke test happens before global configuration is changed.

## Inspect Before Writing

Run a read-only plan first. On macOS:

```bash
"$SKILL_DIR/scripts/patch-codex-for-gpt56.sh" --dry-run
```

On Windows PowerShell:

```powershell
& "$SKILL_DIR\scripts\patch-codex-for-gpt56.ps1" --dry-run
```

Add `--source-app <path>` if auto-discovery does not select the intended original app. If the user requests `--with-plugin-marketplace`, include it in the dry run so the local account file is validated before the repair. Read the JSON plan and tell the user:

- the original source app and separate target app;
- the state root, persistent model catalog, and global `config.toml` path;
- any existing output paths and whether `--replace` is required;
- the current upstream catalog URL and the runtime-selected pinned transient ASAR dependency (`npx --yes @electron/asar@4.2.0` on Node 22.12+, otherwise `@electron/asar@3.4.1`);
- when `--managed-updates` is requested, the managed-update plan/helper paths and the fact that future launcher starts can rebuild the copied app after the official source or copied bundle changes.

Do not run the mutating command until the user explicitly approves those paths and global-config changes. If an existing output is not unquestionably the previous generated output, stop instead of using `--replace`.

## Run The Repair

Use the default target locations unless the user has approved a custom source, app parent, root, or name. Remember that `--root <path>` also makes `<path>/app` the copied-app location unless `--app-parent` is specified.

On macOS:

```bash
"$SKILL_DIR/scripts/patch-codex-for-gpt56.sh" --launch
```

On Windows PowerShell:

```powershell
& "$SKILL_DIR\scripts\patch-codex-for-gpt56.ps1" --launch
```

Add `--replace` only after the user explicitly approves replacement of every existing target and launcher. Use `--no-desktop` when the user does not want a Desktop launcher. Use `--verify-wire` only to test the copied CLI against a local mock Responses endpoint; it is not a live-access or UI test. Use `--managed-updates` only when the user explicitly approves future launcher-triggered rebuilds: it never writes the original app and does not install a background agent. Generated launchers validate source/copy fingerprints (`app.asar`, embedded Codex CLI, and app identity), the persistent catalog checksum, the patch-engine generation, and the approved config path before opening. They serialize refreshes with a lock and rebuild from the official original when needed. A rebuild must also pass the renderer smoke test. The helper prefers the current Skill script and falls back to a bundled snapshot; updating the Skill checkout therefore supplies future semantic-matcher improvements when that path still exists, and a newer managed-plan/patch-engine generation forces revalidation even if the official app fingerprint did not change.

Treat `--with-plugin-marketplace` as local credential-file validation only. It must not be described as a plugin upload or marketplace sync, and it must reject values that contain `sk-` API keys.

## Verify And Report

Read the `repair-report.json` path printed by the script. Report success only when all applicable checks pass:

- `status` is `success`, with no warnings needing resolution.
- `jsPatch.missing` is empty.
- `modelCatalogCompatibility.status` is `passed`; each `debugModels` entry is present and has the reasoning efforts, context window, and service tiers from the normalized current upstream catalog.
- macOS signing has `signing.ok: true`; Windows signing is expected to be skipped.
- On macOS, `rendererSmoke.status` is `"passed"`, `rendererSmoke.routesMounted` is true, and `rendererSmoke.fatalErrors` is empty. This is the runtime UI check; `node --check` alone is insufficient.
- A requested wire check has `wireVerification.status: "passed"`.
- `configPath` points to `$CODEX_HOME/config.toml` and `modelCatalogPath` points to `$CODEX_HOME/model-catalogs/codex-for-gpt56/model-catalog.json`. On managed refresh, `configChanged` must be `false`.

Open the generated Desktop launcher or root `.command`/`.cmd` launcher so the copied app receives its isolated user-data directory. When managed updates are enabled, these launchers also run the fingerprint refresh before opening the copy; opening the copied app directly bypasses that safety step. State that a separate sign-in can be required and that the user must manually confirm the picker and service access.

## Handle Failures Safely

- Treat a non-empty `jsPatch.missing` array as an incompatible semantic UI shape. The patch engine does not use an app-version allowlist or fixed minifier names; it finds bounded model-picker behaviors and records `jsPatch.capabilities` in the report. If a future build no longer has a validated behavior shape, it writes `repair-failure-report.json` and stops before creating a copied app or changing global config. Do not guess a replacement or claim a repair.
- Treat signing, renderer-smoke, catalog-compatibility, or model-validation failures as failed repairs. The copied app can exist, but global config has not changed at that point. For managed updates, a missing helper/Node runtime, fingerprint or catalog drift that cannot be repaired, config-path drift, or any failed validation must stop the launcher rather than starting an unvalidated copied app. Inspect `managed-update-failure.json` and the detailed repair failure report. Managed refresh must never overwrite a later user change to `config.toml`; require a fresh approved repair instead.
- Treat Desktop-launcher or optional wire-check warnings as incomplete verification, not full success. A `modelCatalogRetrieval.status` of `cached-fallback` is usable only when the cached catalog passes the same schema/model/CLI validation; report the warning and do not describe it as a fresh upstream fetch.
- Never point global `model_catalog_json` to an app copy, report path, Desktop folder, temporary path, or isolated user-data directory.
- Do not modify API-key/Fast-mode eligibility or other account-entitlement logic; this Skill is limited to local GPT-5.6 model-picker/catalog compatibility.
- Never log or package credentials, auth JSON contents, API keys, generated apps, `.patch-work`, or `user-data`.

## Remove A Repair

When the user asks to remove the repair, read `configBackupPath` from the latest report first. Restore only the top-level `model_catalog_json`, `model_reasoning_effort`, and `service_tier` values changed by this tool; if the backup path is `null`, remove only the keys that were added. Do not overwrite unrelated later changes in `config.toml`. Then remove the generated app, Desktop launcher, and state root. Remove the persistent model catalog only after `config.toml` no longer references it.
