# Codex for GPT-5.6

`codex-for-gpt56` is a Codex skill that builds a local repaired copy of the user's own installed Codex/ChatGPT desktop app so GPT-5.6 Sol, Terra, and Luna are visible in the desktop model picker.

This repository contains the skill only. It does not include a modified OpenAI app bundle, generated app copy, user data, auth files, tokens, or API keys.

## What It Builds

- macOS: `~/Downloads/Report/CodexForGPT56/app/Codex for GPT-5.6.app`
- Windows: `%USERPROFILE%\Downloads\Report\CodexForGPT56\app\Codex for GPT-5.6`
- Desktop launcher: `Codex for GPT-5.6`
- Stable model catalog: `~/.codex/model-catalogs/codex-for-gpt56/model-catalog.json`
- Report copy of the model catalog: `~/Downloads/Report/CodexForGPT56/model-catalog.json`
- Repair report: `repair-report.json`

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

Then ask Codex:

```text
$codex-for-gpt56 repair my local Codex app and make GPT-5.6 visible
```

## Run The Script Directly

macOS:

```bash
scripts/patch-codex-for-gpt56.sh
scripts/patch-codex-for-gpt56.sh --launch
```

Windows PowerShell:

```powershell
.\scripts\patch-codex-for-gpt56.ps1
```

Advanced:

```bash
node scripts/patch-codex-for-gpt56.mjs --root "$HOME/Downloads/Report/CodexForGPT56" --name "Codex for GPT-5.6"
node scripts/patch-codex-for-gpt56.mjs --verify-wire
```

## Safety Notes

- The script copies the installed app and patches only the copy.
- The original app in `/Applications` or `C:\Program Files\WindowsApps` is not modified.
- The Desktop launcher uses an isolated user data directory for the repaired copy.
- Global `model_catalog_json` points to `~/.codex/model-catalogs/codex-for-gpt56/model-catalog.json`, not the deletable output directory.
- `config.toml` is backed up before the script changes `model_catalog_json`.
- Deleting `~/Downloads/Report/CodexForGPT56` removes the generated app copy, but should not break native Codex task creation.
- Remote plugin sync is disabled by default and must be explicitly requested.
- Credentials containing `sk-` API keys are rejected for plugin sync.

## Models

The generated catalog includes:

- `gpt-5.6-sol`: `low`, `medium`, `high`, `xhigh`, `max`, `ultra`
- `gpt-5.6-terra`: `low`, `medium`, `high`, `xhigh`, `max`, `ultra`
- `gpt-5.6-luna`: `low`, `medium`, `high`, `xhigh`, `max`

`ultra` is a reasoning effort, not a model suffix.

## Social Posts

- [WeChat article draft](docs/social/wechat-post.md)
- [Xiaohongshu post draft](docs/social/xiaohongshu-post.md)
