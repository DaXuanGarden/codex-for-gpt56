# Codex for GPT-5.6

`codex-for-gpt56` is a Codex skill and local repair script for an installed Codex or ChatGPT desktop app. It creates a separate app copy and adjusts its local model-picker behavior for GPT-5.6 Sol, Terra, and Luna.

This is an unsupported local client modification. It can make model metadata and controls visible in the copied app, but it does not grant server-side model access, account entitlement, billing privileges, or feature availability. Use it only with an account already authorized to use the relevant models.

The repository contains source code for the skill only. It does not contain a modified OpenAI app, generated app copy, user data, credentials, auth files, tokens, or API keys.

## Scope And Requirements

- Repair targets are macOS and Windows only. Linux can store the skill, but cannot run this repair.
- Install a current Node.js distribution with both `node` and `npx` on `PATH`.
- Keep a local Codex or ChatGPT Electron app whose bundle contains `app.asar`. Close the copied app before rebuilding it.
- Allow network access while running: the script fetches the current upstream model catalog and `npx` fetches `@electron/asar` when needed.
- Leave enough disk space for a second app copy and a temporary unpacked `app.asar` tree.
- Expect app-build sensitivity. The WebView changes use exact code signatures; a desktop update can make a patch point unavailable.

`CODEX_HOME` controls the Codex configuration root. When it is unset, the paths below use `~/.codex` on macOS and the equivalent user-home path on Windows.

## What Changes

The script intentionally makes these local changes after a successful patch analysis:

- Creates a copied app beside the source app when writable, otherwise in a user-owned Applications/Programs folder.
- Creates an isolated user-data directory and a root launcher. It also creates a Desktop launcher unless `--no-desktop` is used.
- Downloads the full current upstream model catalog to `$CODEX_HOME/model-catalogs/codex-for-gpt56/model-catalog.json` and stores a report copy under the state root.
- Backs up `$CODEX_HOME/config.toml`, then sets its top-level `model_catalog_json` to that persistent catalog path. If missing, it also adds `model_reasoning_effort = "xhigh"` and `service_tier = "priority"`.
- Writes a JSON report under the state root. The default is `$CODEX_HOME/codex-for-gpt56/repair-report.json`.

The launcher profile is isolated, but the `config.toml` changes are global to the active `CODEX_HOME`. Review the dry-run plan before approving a repair.

## Install As A Codex Skill

macOS or Linux:

```bash
mkdir -p "$HOME/.codex/skills"
git clone https://github.com/DaXuanGarden/codex-for-gpt56.git "$HOME/.codex/skills/codex-for-gpt56"
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills" | Out-Null
git clone https://github.com/DaXuanGarden/codex-for-gpt56.git "$env:USERPROFILE\.codex\skills\codex-for-gpt56"
```

Ask Codex to inspect the plan before any files are written:

```text
Use $codex-for-gpt56 to inspect my installed Codex/ChatGPT app and show the dry-run plan, risks, and output paths. Do not run the repair until I approve it.
```

After reviewing the plan, explicitly approve the repair in the same conversation.

## Run Directly

Run these commands from the cloned skill directory. Start with `--dry-run`; it reads local inputs and prints planned paths, configuration changes, network dependencies, and output conflicts without writing files.

macOS:

```bash
cd "$HOME/.codex/skills/codex-for-gpt56"
./scripts/patch-codex-for-gpt56.sh --dry-run
./scripts/patch-codex-for-gpt56.sh --launch
```

Windows PowerShell:

```powershell
$skill = Join-Path $env:USERPROFILE ".codex\skills\codex-for-gpt56"
Set-Location $skill
.\scripts\patch-codex-for-gpt56.ps1 --dry-run
.\scripts\patch-codex-for-gpt56.ps1 --launch
```

For a nonstandard installation, pass the original app explicitly:

```bash
./scripts/patch-codex-for-gpt56.sh --source-app "/Applications/Codex.app" --dry-run
./scripts/patch-codex-for-gpt56.sh --source-app "/Applications/Codex.app" --launch
```

Use `node scripts/patch-codex-for-gpt56.mjs --help` to view the same options without the platform wrapper.

## Outputs And Rebuilds

With default options, the generated app is placed here:

- macOS: beside the source app, for example `/Applications/Codex for GPT-5.6.app`; when that parent is not writable, `~/Applications/Codex for GPT-5.6.app`
- Windows: beside the source app when writable; otherwise `%LOCALAPPDATA%\Programs\Codex for GPT-5.6`
- Persistent model catalog: `$CODEX_HOME/model-catalogs/codex-for-gpt56/model-catalog.json`
- State, launcher, isolated user data, and report: `$CODEX_HOME/codex-for-gpt56`

The script refuses to overwrite an existing generated app or launcher by default. Re-run the dry run after an app update, then use `--replace` only after confirming every planned output path is safe to replace:

```bash
./scripts/patch-codex-for-gpt56.sh --dry-run
./scripts/patch-codex-for-gpt56.sh --replace --launch
```

`--root <path>` changes more than report storage: unless `--app-parent` is also supplied, the copied app is written to `<path>/app`. Use `--app-parent` to keep the app copy outside a custom state root.

## Options

| Option | Effect |
| --- | --- |
| `--dry-run` | Reads the source app and reports planned writes and existing-output conflicts without changing files. It also validates a requested plugin-account file. |
| `--replace` | Permits replacement of existing generated app and launcher paths. |
| `--source-app <path>` | Selects the original Codex/ChatGPT app bundle, folder, or executable instead of auto-discovery. |
| `--app-parent <path>` | Chooses the parent directory for the copied app. |
| `--root <path>` | Chooses state/report storage and, unless `--app-parent` is given, the copied app parent. |
| `--name <name>` | Changes the display and output name. Path separators and reserved filename characters are rejected. |
| `--no-desktop` | Does not create a Desktop launcher. The root launcher is still created. |
| `--launch` | Starts the copied app with its isolated user-data directory after the repair. |
| `--verify-wire` | Runs a copied-CLI request against a local mock Responses endpoint. It does not test a live account, server access, or the desktop picker. |
| `--with-plugin-marketplace` | Validates a local `plugin-account.json` and optional auth-file path only. It does not upload, sync, or change plugin marketplace state. |
| `--plugin-account <path>` | Selects the file used by the optional plugin-account validation. `sk-` API-key values are rejected. |

## Verify The Result

Read `$CODEX_HOME/codex-for-gpt56/repair-report.json` rather than relying only on the terminal success line. A successful repair should have:

- `status: "success"`; resolve any `warnings` before treating the result as fully validated.
- An empty `jsPatch.missing` array.
- Every entry in `debugModels` present with the expected reasoning efforts.
- On macOS, `signing.ok: true`; Windows reports signing as skipped.
- `wireVerification.status: "passed"` when `--verify-wire` was requested.
- A `configPath` and `modelCatalogPath` that point to the persistent `$CODEX_HOME` locations, not the generated app or report folder.

An incompatible patch or pre-config validation failure is written to `$CODEX_HOME/codex-for-gpt56/repair-failure-report.json`. That file preserves the last successful `repair-report.json`, including its `configBackupPath`.

Open the generated Desktop launcher or the root `.command`/`.cmd` launcher to use the isolated profile. Opening the copied app bundle directly does not add the isolated `--user-data-dir` flag. The copied app can require a separate sign-in.

Even when all local checks pass, confirm the model picker manually and expect the service to enforce account and product eligibility.

## Update And Restore

Update the installed skill with Git, then review a new dry-run plan before rebuilding:

```bash
git -C "$HOME/.codex/skills/codex-for-gpt56" pull --ff-only
```

To remove a generated repair:

1. Close the copied app and Desktop launcher.
2. Read `configBackupPath` in the latest repair report. Use that backup to restore only the top-level `model_catalog_json`, `model_reasoning_effort`, and `service_tier` values changed by this tool. If the field is `null`, remove only the keys that the repair added. Do not replace the entire config file if it has legitimate edits made after the repair.
3. Delete the generated app, its Desktop launcher, and `$CODEX_HOME/codex-for-gpt56`.
4. Delete `$CODEX_HOME/model-catalogs/codex-for-gpt56/model-catalog.json` only after `config.toml` no longer points to it.

Removing only the state root leaves the persistent catalog and global config reference behind, so it is not a complete restore.

## Model Catalog

Each repair downloads the full current upstream catalog and verifies these entries before writing it locally:

- `gpt-5.6-sol`: `low`, `medium`, `high`, `xhigh`, `max`, `ultra`
- `gpt-5.6-terra`: `low`, `medium`, `high`, `xhigh`, `max`, `ultra`
- `gpt-5.6-luna`: `low`, `medium`, `high`, `xhigh`, `max`

`ultra` is a reasoning effort, not a model suffix.

## Safety Notes

- The original installed app is not modified. The copy is the only app bundle the script patches.
- Do not point `--source-app` at a previously generated copy or place the output inside the original app.
- Do not put a copied app, report, or Desktop path in `model_catalog_json`; the script uses the persistent catalog path instead.
- Review source changes and run from a trusted network because the current upstream catalog and the transient `npx` package are fetched at runtime.
- Do not include generated app copies, `.patch-work`, `user-data`, auth files, tokens, or full app bundles when sharing this skill.

## Social Posts

- [WeChat article draft](docs/social/wechat-post.md)
- [Xiaohongshu post draft](docs/social/xiaohongshu-post.md)
