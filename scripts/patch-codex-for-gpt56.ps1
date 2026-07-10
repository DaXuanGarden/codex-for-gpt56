$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script = Join-Path $ScriptDir "patch-codex-for-gpt56.mjs"

& node $Script @args
exit $LASTEXITCODE
