# Codex 没有 GPT-5.6？开源 Skill 一键修复

最近在使用 Codex 桌面端时，我遇到了一个问题：

GPT-5.6 明明已经上线了，但我的 Codex 模型选择器里就是看不到。

GPT-5.6 这次对应的是三个模型：

- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`

但在一些 Codex/ChatGPT 桌面端版本里，底层模型目录、前端模型筛选、reasoning effort 展示并没有完全同步。结果就是：模型可能已经在你的使用环境里可用，前端却没有把它展示出来。

所以我整理了一个开源 Codex Skill：`codex-for-gpt56`。

> 项目地址：
> `https://github.com/DaXuanGarden/codex-for-gpt56`

它的目标很简单：让 Codex 自己修 Codex。

你把 GitHub 地址和修复目标告诉 Codex，它会安装这个 Skill，然后在本机生成一个修复版应用：

```text
Codex for GPT-5.6
```

修复完成后，桌面会出现对应入口。之后打开这个入口，就可以在本地修复版里看到 GPT-5.6 相关模型。

## 它主要修什么

这个 Skill 不是简单往配置里塞几个模型名，而是围绕 Codex 桌面端的真实问题做了几类修复：

- 修复 GPT-5.6 三个模型在前端模型列表里不显示的问题
- 补全 `xhigh`、`max`、`ultra` 等 reasoning effort 展示
- 让 Luna 只显示自己支持的 effort，不错误展示 `ultra`
- 保留 Sol/Terra 的 `ultra` 能力语义
- 修复 API Key 模式下 Fast Mode 和 service tier 的可见性读取
- 遇到官方新版已经支持的逻辑时，优先保留官方实现

当前适配的 GPT-5.6 能力如下：

- `gpt-5.6-sol`：`low`、`medium`、`high`、`xhigh`、`max`、`ultra`
- `gpt-5.6-terra`：`low`、`medium`、`high`、`xhigh`、`max`、`ultra`
- `gpt-5.6-luna`：`low`、`medium`、`high`、`xhigh`、`max`

这里有个小提醒：`max` 和 `ultra` 是 reasoning effort，不是模型后缀。

也就是说，应该识别的是 Sol、Terra、Luna 三个模型，而不是自己拼一个 `gpt-5.6-ultra` 或 `gpt-5.6-pro`。

## 怎么用

最省事的方式，是直接把下面这段 Prompt 发给 Codex：

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

如果你的 Codex 已经支持从 GitHub 安装 Skill，它会按照这段 Prompt 完成安装、运行和验证。

如果你已经安装过这个 Skill，也可以直接说：

```text
$codex-for-gpt56 修复本机 Codex，让 GPT-5.6 显示出来
```

整个过程不需要你手动去找 `app.asar`，也不需要自己拆 WebView 资源文件。Codex 会根据 Skill 里的脚本完成复制、解包、补丁、重新打包和验证。

## 修复后会生成什么

macOS 默认生成：

```text
/Applications/Codex for GPT-5.6.app
如果 /Applications 不可写，则回退到 ~/Applications/Codex for GPT-5.6.app
~/Desktop/Codex for GPT-5.6.app
```

Windows 默认生成：

```text
%LOCALAPPDATA%\Programs\Codex for GPT-5.6
%USERPROFILE%\Desktop\Codex for GPT-5.6.lnk
```

状态文件、报告和隔离 user data 会放在：

```text
~/.codex/codex-for-gpt56
```

桌面入口会打开修复后的本地副本。原本安装的 Codex/ChatGPT App 仍然保留，后续如果官方 App 更新了，也可以重新运行这个 Skill，再基于新版重新生成一次。

## 为什么用 Skill 会更稳

Codex 桌面端的前端资源通常会带 hash。版本一变，文件名也会变。

所以这个 Skill 不依赖固定文件名，而是按代码特征搜索相关 WebView 文件，再做条件式补丁。这样它更适合在官方版本变化后重复运行。

它也不会无脑覆盖所有东西：

- 如果 native model catalog 已经有 GPT-5.6，就优先用官方数据
- 如果某个补丁点在新版里已经不存在，就记录到报告里，而不是强行改未知代码
- 每个模型只显示自己支持的 reasoning effort
- Luna 不会被误改成支持 `ultra`

生成完成后，它会写出 `repair-report.json`，方便你检查修复结果。

## 最后提醒

这个仓库只包含 Skill 源码和修复脚本，不包含修改后的完整 App，不包含 `app.asar`，也不包含用户数据、token、auth 文件或 API key。

如果你也遇到 Codex 桌面端看不到 GPT-5.6 的问题，可以直接把上面的 Prompt 丢给 Codex。

> 项目地址：
> `https://github.com/DaXuanGarden/codex-for-gpt56`

欢迎大家试用、反馈和一起改进。如果遇到问题，或者有更好的兼容方案，欢迎到 GitHub 提 Issue：

```text
https://github.com/DaXuanGarden/codex-for-gpt56/issues
```

如果这个 Skill 对你有帮助，也欢迎点赞、收藏、转发，让更多遇到同样问题的人能少踩一点坑。这个项目还会继续迭代，欢迎一起建设。

# 分享一个超酷的 Codex 宠物

顺手再分享一个最近装上的小东西：Codex 宠物「篮球小鸡」。

它是一只篮球主题的小鸡宠物，适合放在 Codex Desktop / Petdex Desktop 里当小陪伴。写代码、学习或工作时，桌面上多一个小宠物，确实会轻松一点。

![](https://files.mdnice.com/user/40759/02f2d6a2-2a53-4a95-9de1-f5d611b601e3.png)

安装方式很简单，在终端运行：

```bash
npx petdex install basketball-chick
```

安装完成后，可以在 Codex Desktop 中这样启用：

```text
Settings -> Appearance -> Pets
```

如果你使用 Petdex Desktop，也可以右键桌面宠物进行切换和启用。

安装后宠物文件会放在：

```text
~/.petdex/pets/   # Petdex Desktop
~/.codex/pets/    # Codex Desktop
```

宠物名称是「篮球小鸡」，英文包名是 `basketball-chick`。

喜欢可爱桌宠、篮球主题小装饰，或者想让开发环境多一点陪伴感的话，可以试试这个。
