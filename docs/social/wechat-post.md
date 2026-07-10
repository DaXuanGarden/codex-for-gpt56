# 公众号推文：Codex for GPT-5.6

## 标题备选

- 我做了一个 Codex Skill，让 GPT-5.6 在桌面端显示出来
- Codex for GPT-5.6：把本机 Codex/ChatGPT 桌面端修到可用状态
- 不分发改版 App，只分享修复 Skill：Codex for GPT-5.6 开源了

## 正文

最近 GPT-5.6 的三个模型陆续进入 Codex 使用场景：

- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`

但有些桌面端环境会遇到一个很尴尬的问题：底层能力已经可用，模型目录和前端筛选逻辑却没有完全对齐，导致模型选择器里看不到 GPT-5.6，或者 reasoning effort 显示不完整。

于是我做了一个可以复用的 Codex skill：`codex-for-gpt56`。

项目地址：

https://github.com/DaXuanGarden/codex-for-gpt56

## 它解决什么问题

这个 skill 会在本机自动创建一个修复版桌面应用副本，名字是 `Codex for GPT-5.6`。它会尽量保持官方 App 的原始逻辑，只针对模型可见性、reasoning effort、Fast Mode 等兼容问题做补丁。

它支持的 GPT-5.6 模型包括：

- `gpt-5.6-sol`：`low`、`medium`、`high`、`xhigh`、`max`、`ultra`
- `gpt-5.6-terra`：`low`、`medium`、`high`、`xhigh`、`max`、`ultra`
- `gpt-5.6-luna`：`low`、`medium`、`high`、`xhigh`、`max`

这里特别注意：`max` 和 `ultra` 是 reasoning effort，不是模型后缀。也就是说，不应该凭空创建 `gpt-5.6-pro` 或 `gpt-5.6-ultra` 这类不存在的模型名。

## 为什么做成 skill，而不是直接打包 App

我没有直接分发修改后的完整 Codex/ChatGPT App。

原因很简单：完整 App 涉及官方签名、更新机制、授权边界和分发风险。更稳妥的方式是只分享修复流程，让每个人在自己的电脑上基于自己已安装的官方 App 生成本地副本。

这个 skill 的原则是：

- 不修改原始安装目录
- 只复制本机已安装的 App
- 在副本里解包、补丁、重新打包
- 生成桌面启动器
- 使用独立 user data，避免和原始 App 混在一起
- 不提交、不读取、不输出用户 token 或 API key

换句话说，它不是一个“改版 App 下载包”，而是一个“本机修复 skill”。

## 如何安装

macOS 或 Linux：

```bash
mkdir -p "$HOME/.codex/skills"
git clone https://github.com/DaXuanGarden/codex-for-gpt56.git "$HOME/.codex/skills/codex-for-gpt56"
```

Windows PowerShell：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills" | Out-Null
git clone https://github.com/DaXuanGarden/codex-for-gpt56.git "$env:USERPROFILE\.codex\skills\codex-for-gpt56"
```

然后在 Codex 里调用：

```text
$codex-for-gpt56 repair my local Codex app and make GPT-5.6 visible
```

也可以直接运行脚本。

macOS：

```bash
scripts/patch-codex-for-gpt56.sh
```

Windows PowerShell：

```powershell
.\scripts\patch-codex-for-gpt56.ps1
```

## 默认会生成什么

macOS 默认输出：

```text
~/Downloads/Report/CodexForGPT56/app/Codex for GPT-5.6.app
~/Desktop/Codex for GPT-5.6.app
```

Windows 默认输出：

```text
%USERPROFILE%\Downloads\Report\CodexForGPT56
```

桌面入口会启动修复后的副本，并带独立 user data 参数。这样原始 App 仍然保留，官方更新也不会被这个副本直接覆盖。

如果官方 App 更新了，重新运行一次 skill 即可基于新版重新复制和打补丁。

## 它具体修了哪些地方

这个 skill 的核心不是固定改某个哈希文件名，而是按代码特征搜索相关 WebView 文件，避免版本变化后文件名改变导致补丁失效。

主要处理几类问题：

- GPT-5.6 三模型在前端模型列表里被过滤
- reasoning effort 默认列表缺少 `xhigh`、`max`、`ultra`
- Luna 不应该显示 `ultra`
- Sol/Terra 的 `ultra` 应该保留多代理语义
- API Key 模式下 Fast Mode 的可见性和 service tier 读取
- 官方新版已经支持的逻辑不重复覆盖

生成后还会写入 `repair-report.json`，用于追踪补丁结果。

## 安全边界

再强调一次：这个仓库不包含修改后的 App，不包含 `app.asar`，不包含用户数据，不包含任何 token、auth 文件或 API key。

如果你要分享给朋友，建议分享 GitHub 仓库本身，而不是把你本机生成出来的 `Codex for GPT-5.6.app` 直接发出去。

项目地址：

https://github.com/DaXuanGarden/codex-for-gpt56

如果你也遇到 GPT-5.6 在桌面端不显示的问题，可以试试这个 skill。它更像一个可重复运行的本地修复流程，而不是一次性的手工补丁。

