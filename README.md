# 小克 · Claude Code 记账桌宠

蹲在桌面右下角的「小克」（Claude 拟人）。她读 Claude Code 的本地对话记录，帮你看着这周还剩多少额度，每轮对话结束告诉你花了多少，还会跟着 Claude Code 一起上下班。

角色、台词和音效来自 [aklnaaw/dsh-xiaoke-widget](https://github.com/aklnaaw/dsh-xiaoke-widget)（原本是 DeepSeek DSH 的挂件，再往上二创自 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)）。本项目把它改造成了 Claude Code 版。

## 能干什么

- **每周额度量槽**：脚下的 `Weekly · all models`，橙色越用越短，显示剩余百分比；每周自动重置（默认周四 1:00）。
- **每轮结束冒泡**：Claude 回完一轮，小克冒泡告诉你这一轮花了多少（含子代理），带提示音。
- **账本**：点量槽 → 今日花费、近 7 天柱状图、按模型分。
- **单击小克**：随机说一句 Claude 梗台词（61 条）。
- **双击小克**：弹出仿 Claude 快捷输入框，回车后交给 Claude 桌面版开新对话。
- **跟着 Claude Code 开关**：开对话她就出现，最后一个对话关掉她就下班（可关）。
- 拖动、调大小、$ / ¥ 切换、音效开关都在右键菜单 / 托盘图标里。

## 要求

- Windows 10/11（其它系统没测过）
- [Node.js](https://nodejs.org/) 18+
- 用过 Claude Code（CLI 或桌面版的 Code 标签页都行），本地有 `~/.claude/projects/` 记录

## 安装

```bash
git clone https://github.com/Hatk3451/xiaoke-cc.git
cd xiaoke-cc
npm install
```

`npm install` 会顺便从原仓库下载角色图和音效（见下方「素材说明」）。

然后二选一：

```bash
# A. 跟着 Claude Code 自动开关（推荐）：往 ~/.claude/settings.json 里加 3 个 hook
npm run hooks:install
```

```bash
# B. 手动启动
npm start
```

也可以双击 `启动小克.vbs`（不弹黑窗）。

不想要自动开关了：`npm run hooks:uninstall`。安装/卸载 hook 前都会把原设置备份成 `settings.json.bak-xiaoke`，且只动这 3 条，其它设置不碰。

## 第一次用：校准额度

Claude 不提供“每周额度”的查询接口，所以小克是**按 API 标价折算花费，再和你给的额度比**。

1. 打开 Claude 的用量页面，看 “Weekly · all models” 现在用了百分之几；
2. 点小克脚下的量槽（显示「点我校准」），填进去回车。

小克会用「本周已花的钱 ÷ 已用百分比」反推你的每周额度。时间久了会有偏差，右键「校准每周额度…」随时重校。

重置时间不是周四 1:00 的话，退出小克后改 `%APPDATA%\xiaoke-cc\config.json` 里的 `resetDay`（0=周日 … 4=周四）和 `resetHour`。

## 说明

- **只读**：数据来自 `~/.claude/projects/**/*.jsonl`，不联网上传任何东西（唯一的网络请求是安装时下载素材）。
- **金额是估算**：按 Anthropic 官方 API 价格折算（`pricing.json`，可自己改）。订阅用户看的是“等价 API 花费”；走第三方中转的，实际扣费以中转站为准。
- 首次启动要扫最近 8 天的记录，记录多的话要等十几秒，之后有缓存。
- 台词在 `lines.json`，改完右键「重新加载台词和价格」。
- 双击输入框用的是 Claude 桌面版的 `claude://claude.ai/new?q=` 链接，没装桌面版的话回车无效。

## 素材说明（重要）

角色图 `xiaoke1.png` 和音效**不在本仓库里**。原作者声明这些素材「不适用 MIT、不授予再许可，仅用于运行插件」，所以这里不转载，`npm install` 时从原仓库（固定版本）直接下载到本地 `assets/`，仅供个人使用，请勿再打包分发。

## 许可

代码 MIT（见 [LICENSE](LICENSE)）。台词来自原项目（MIT，见 [LICENSE.upstream](LICENSE.upstream)）。素材见上一节。
