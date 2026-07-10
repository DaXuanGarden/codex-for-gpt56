# Codex for GPT-5.6

`codex-for-gpt56` is a Codex skill that builds a local repaired copy of the user's own installed Codex/ChatGPT desktop app so GPT-5.6 Sol, Terra, and Luna are visible in the desktop model picker.

This repository contains the skill only. It does not include a modified OpenAI app bundle, generated app copy, user data, auth files, tokens, or API keys.

## What It Builds

- macOS: a sibling app next to the source app, such as `/Applications/Codex for GPT-5.6.app`; if that folder is not writable, `~/Applications/Codex for GPT-5.6.app`
- Windows: a sibling folder next to the source app when writable; otherwise `%LOCALAPPDATA%\Programs\Codex for GPT-5.6`
- Desktop launcher: `Codex for GPT-5.6`
- Stable model catalog: `~/.codex/model-catalogs/codex-for-gpt56/model-catalog.json`
- State, work files, isolated user data, and repair reports: `~/.codex/codex-for-gpt56`
- Report copy of the model catalog: `~/.codex/codex-for-gpt56/model-catalog.json`

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
node scripts/patch-codex-for-gpt56.mjs --app-parent "$HOME/Applications" --name "Codex for GPT-5.6"
node scripts/patch-codex-for-gpt56.mjs --root "$HOME/.codex/codex-for-gpt56"
node scripts/patch-codex-for-gpt56.mjs --verify-wire
```

## Safety Notes

- The script copies the installed app and patches only the copy.
- The original app in `/Applications` or `C:\Program Files\WindowsApps` is not modified.
- By default, the copied app is placed beside the original app when that folder is writable, never inside the original app bundle.
- The Desktop launcher uses an isolated user data directory for the repaired copy.
- Global `model_catalog_json` points to `~/.codex/model-catalogs/codex-for-gpt56/model-catalog.json`, not an app copy or report directory.
- `config.toml` is backed up before the script changes `model_catalog_json`.
- Deleting `~/.codex/codex-for-gpt56` removes the generated app's isolated user data and reports, but should not break native Codex task creation.
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
