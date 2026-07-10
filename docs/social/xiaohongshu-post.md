# 小红书推文：Codex for GPT-5.6

## 标题备选

- GPT-5.6 不显示？我做了个 Codex Skill 自动修
- Codex for GPT-5.6：一键生成本地修复版桌面端
- 不打包 App，只分享修复 Skill：GPT-5.6 模型可见性修好了

## 正文

最近折腾 Codex 桌面端时遇到一个问题：GPT-5.6 明明已经有三个模型，但前端模型列表里就是不显示，或者 reasoning effort 不完整。

三个模型是：

- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`

于是我做了一个 Codex skill：`codex-for-gpt56`。

GitHub：

https://github.com/DaXuanGarden/codex-for-gpt56

它不是让你下载一个别人改好的 App，而是在你自己的电脑上：

- 自动找到本机已安装的 Codex/ChatGPT 桌面端
- 复制一份副本
- 只修改副本，不动原始 App
- 修复 GPT-5.6 模型显示
- 生成桌面入口 `Codex for GPT-5.6`
- 生成修复报告，方便检查

支持的 effort：

- Sol：`low / medium / high / xhigh / max / ultra`
- Terra：`low / medium / high / xhigh / max / ultra`
- Luna：`low / medium / high / xhigh / max`

这里 `max`、`ultra` 是 reasoning effort，不是模型名后缀。不要自己乱造 `gpt-5.6-ultra` 这种模型名。

安装方式：

```bash
mkdir -p "$HOME/.codex/skills"
git clone https://github.com/DaXuanGarden/codex-for-gpt56.git "$HOME/.codex/skills/codex-for-gpt56"
```

然后在 Codex 里说：

```text
$codex-for-gpt56 repair my local Codex app and make GPT-5.6 visible
```

如果你不用 skill，也可以直接跑脚本：

```bash
scripts/patch-codex-for-gpt56.sh
```

Windows 用户可以用：

```powershell
.\scripts\patch-codex-for-gpt56.ps1
```

我比较在意的一点：这个仓库没有上传任何改好的 App，也没有 `app.asar`、token、auth 文件或 API key。它只是一套本机修复流程。

如果官方 App 更新了，重新运行一次 skill 就能基于新版再生成一份。

适合遇到这些情况的人：

- Codex 桌面端看不到 GPT-5.6
- Sol/Terra/Luna 显示不完整
- reasoning effort 没有 `xhigh`、`max`、`ultra`
- 想把修复流程分享给朋友，但不想分发完整改版 App

关键词：

#Codex #GPT56 #GPT5 #AI工具 #开发者工具 #OpenAI #桌面端 #效率工具

