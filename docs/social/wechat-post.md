# 公众号推文：Codex 没有 GPT-5.6？开源 Skill 一键修复

## 标题

Codex 没有 GPT-5.6？开源 Skill 一键修复

## 正文

这两天在折腾 Codex 桌面端时，我遇到了一个很典型的问题：

GPT-5.6 明明已经上线了，但我的 Codex 模型选择器里就是看不到。

目前 GPT-5.6 对应三个模型：

- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`

其中 Sol 和 Terra 支持 `ultra` reasoning effort，Luna 则支持到 `max`。但在一些桌面端版本里，模型目录、前端筛选逻辑、reasoning effort 展示逻辑没有完全跟上，于是就会出现一个有点尴尬的现象：

底层模型可能已经能用，但前端不让你选。

所以我做了一个开源 Codex Skill：`codex-for-gpt56`。

项目地址：

https://github.com/DaXuanGarden/codex-for-gpt56

## 这个 Skill 是做什么的

它会让 Codex 在你的电脑上自动生成一个本地修复版应用，名字叫：

```text
Codex for GPT-5.6
```

它主要修复这些问题：

- Codex 桌面端模型选择器里不显示 GPT-5.6
- `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna` 被前端过滤
- reasoning effort 缺少 `xhigh`、`max`、`ultra`
- Luna 不应该显示 `ultra`，Sol/Terra 才应该显示
- API Key 模式下 Fast Mode 可见性和 service tier 读取不完整

修复完成后，它会在桌面生成入口。之后你打开 `Codex for GPT-5.6`，就能在修复后的本地副本里使用这些模型。

## GPT-5.6 支持情况

这个 Skill 当前按下面的模型能力进行适配：

- `gpt-5.6-sol`：`low`、`medium`、`high`、`xhigh`、`max`、`ultra`
- `gpt-5.6-terra`：`low`、`medium`、`high`、`xhigh`、`max`、`ultra`
- `gpt-5.6-luna`：`low`、`medium`、`high`、`xhigh`、`max`

这里有一个容易混淆的点：

`max` 和 `ultra` 是 reasoning effort，不是模型后缀。

所以不要自己创建 `gpt-5.6-ultra`、`gpt-5.6-pro` 这类模型名。GPT-5.6 当前要识别的是 Sol、Terra、Luna 三个模型。

## 怎么安装和使用

最简单的方式：直接把下面这段 Prompt 发给 Codex。

```text
请帮我安装并使用这个 Codex Skill：

https://github.com/DaXuanGarden/codex-for-gpt56

目标：
1. 将这个仓库安装到我的 Codex skills 目录，skill 名称保持为 codex-for-gpt56。
2. 安装后调用 $codex-for-gpt56。
3. 修复我本机 Codex/ChatGPT 桌面端里 GPT-5.6 不显示的问题。
4. 生成本地修复版应用 Codex for GPT-5.6，并在桌面创建入口。
5. 不要修改原始安装的 Codex/ChatGPT App，只处理复制出来的本地副本。
6. 完成后请验证 gpt-5.6-sol、gpt-5.6-terra、gpt-5.6-luna 是否出现在 codex debug models 或模型目录里，并告诉我结果。
```

如果你的 Codex 支持安装 GitHub skill，它会根据这段 Prompt 完成安装、调用和修复。读者不需要先理解脚本结构，也不需要手动去找 `app.asar` 或 WebView 资源文件。

如果已经安装过这个 Skill，也可以直接对 Codex 说：

```text
$codex-for-gpt56 修复本机 Codex，让 GPT-5.6 显示出来
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

修复完成后，桌面会出现 `Codex for GPT-5.6`。它和原本安装的 Codex/ChatGPT 桌面端是分开的，后续官方 App 更新后，也可以重新运行这个 Skill，再基于新版重新生成一次。

## 它不是简单写死模型名

这个 Skill 的处理方式不是粗暴地改某个固定文件名。

Codex 桌面端的前端资源通常会带 hash，版本一变，文件名也会变。所以脚本会按代码特征搜索相关 WebView 文件，再做条件式补丁。

它会尽量保留官方已有实现：

- 如果新版官方已经支持 GPT-5.6，就优先使用官方数据
- 如果 native model catalog 里已经有模型，就不重复注入
- 每个模型只显示自己真实支持的 reasoning effort
- Luna 不会因为补丁而错误显示 `ultra`

这也是为什么它适合做成 Skill：以后版本更新了，可以让 Codex 再跑一次修复流程，而不是靠手工找文件。

## 使用前的小提醒

这个仓库只包含 Skill 源码和修复脚本，不包含修改后的完整 App，不包含 `app.asar`，也不包含用户数据、token、auth 文件或 API key。

如果你要分享给朋友，建议直接分享 GitHub 仓库：

https://github.com/DaXuanGarden/codex-for-gpt56

让朋友在自己的电脑上用 Codex 安装并运行这个 Skill，就能生成属于他自己电脑环境的本地修复版。

如果你的 Codex 桌面端也看不到 GPT-5.6，可以试试这个方式。把上面的 Prompt 丢给 Codex，剩下的交给它处理。
