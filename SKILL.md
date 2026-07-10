---
name: codex-for-gpt56
description: Build a local Codex for GPT-5.6 app copy that repairs Codex/ChatGPT desktop model visibility for GPT-5.6 Sol, Terra, and Luna. Use when a user says GPT-5.6 models do not show in Codex desktop, wants Codex or a Codex-like IDE to patch the local desktop app, wants a repeatable macOS/Windows repair workflow, or wants to share the repair as a skill instead of distributing a modified app.
---

# Codex for GPT-5.6

## Overview

Use this skill to create a local repaired desktop app from the user's own installed Codex/ChatGPT app. Do not distribute a modified OpenAI app bundle; share this skill so each user patches their own local installation.

The bundled script supports macOS and Windows from one Node implementation. It copies the installed app, unpacks `app.asar`, applies feature-based WebView patches, repacks, updates Codex model catalog config, writes a report, and creates a Desktop launcher.

## Quick Start

macOS:

```bash
scripts/patch-codex-for-gpt56.sh
```

Windows PowerShell:

```powershell
.\scripts\patch-codex-for-gpt56.ps1
```

Useful options:

```bash
scripts/patch-codex-for-gpt56.sh --launch
scripts/patch-codex-for-gpt56.sh --root "$HOME/Downloads/Report/CodexForGPT56" --name "Codex for GPT-5.6"
scripts/patch-codex-for-gpt56.sh --source-app "/Applications/ChatGPT.app"
scripts/patch-codex-for-gpt56.sh --no-desktop
```

Default outputs:

- `~/Downloads/Report/CodexForGPT56/app/Codex for GPT-5.6.app` on macOS
- `~/Downloads/Report/CodexForGPT56/app/Codex for GPT-5.6/` on Windows
- `~/Downloads/Report/CodexForGPT56/model-catalog.json`
- `~/Downloads/Report/CodexForGPT56/repair-report.json`
- A Desktop app link on macOS or Desktop `.lnk` on Windows

## Workflow

1. Confirm the user wants a local repair, not a redistributed modified app.
2. Run the platform entrypoint with default options unless the user specifies a source app or output root.
3. Inspect `repair-report.json` and summarize:
   - source app and target app paths
   - Desktop launcher/link status
   - patched `app.asar` SHA256
   - JavaScript patch IDs applied or already present
   - GPT-5.6 model metadata from `codex debug models`
   - skipped or failed optional diagnostics
4. If the user wants to share the fix, zip only the `codex-for-gpt56` skill folder. Exclude generated app copies, `.patch-work`, `user-data`, auth files, tokens, and full app bundles.

## Safety Rules

- Never modify the original installed app.
- Never place the copied app bundle/folder inside this skill folder.
- Never log access tokens, auth JSON contents, or API keys.
- Reject plugin credentials containing `sk-` values; remote plugin sync uses ChatGPT/Codex OAuth credentials only.
- Preserve official behavior when a newer build no longer matches a patch point. The script records missing patch points instead of rewriting unknown code.

## Verification

Run before claiming success:

```bash
node --check scripts/patch-codex-for-gpt56.mjs
```

macOS:

```bash
shasum -a 256 "$HOME/Downloads/Report/CodexForGPT56/.patch-work/app.asar" "$HOME/Downloads/Report/CodexForGPT56/app/Codex for GPT-5.6.app/Contents/Resources/app.asar"
codesign --verify --deep --strict --verbose=2 "$HOME/Downloads/Report/CodexForGPT56/app/Codex for GPT-5.6.app"
```

Expected GPT-5.6 efforts:

- `gpt-5.6-sol`: `low, medium, high, xhigh, max, ultra`
- `gpt-5.6-terra`: `low, medium, high, xhigh, max, ultra`
- `gpt-5.6-luna`: `low, medium, high, xhigh, max`

If checking a live process, the app path must point inside the generated output root, not the original installed app.
