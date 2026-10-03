# 小克桌宠 · Claude 桌面端本体版

蹲在桌面右下角的一只小克，陪你用 Claude Code。点她还是会冒出各种 Claude 味的碎碎念。

这是二创：在 [aklnaaw/dsh-xiaoke-widget](https://github.com/aklnaaw/dsh-xiaoke-widget) 原有的小克基础上，
把她从 DSH 网页里搬出来，做成了跟着 **Claude 桌面端 / Claude Code** 走的本体版。

> 「小克」是 SillyTavern 中文圈对 Claude 的习惯叫法。

## 能看什么

脚下一根 **Weekly · all models** 量槽，用得越多剩得越少；每轮对话结束冒个泡，告诉你这轮花了多少；点量槽能看今日和近 7 天的账本。

## 和原版的区别

- 挂在 DSH 网页 → **独立桌宠**，跟着 Claude Code 一起开关
- DeepSeek 余额 → **Claude 每周额度量槽**（按 API 价折算，第一次用点量槽填一下当前已用百分比）
- 双击小克 → 弹出 **Claude 快捷输入框**，回车直接开新对话
- 61 条台词照旧

## 安装

```bash
git clone https://github.com/Hatk3451/xiaoke-cc.git
cd xiaoke-cc
npm install
npm run hooks:install
```

装完开个 Claude Code 对话，她就出来了。不想自动开关就跳过最后一步，用 `npm start` 手动启动。

需要 Windows + Node.js 18+。

## 致谢

小克的立绘、台词、音效全是原作者的功劳，我只换了个家。
原作者 **aklnaaw**，再往上是 **MeteorNOX** 的小鲸鱼挂件。

立绘和音效原作者声明不授予再分发，所以本仓库不附带，`npm install` 时从原仓库下载，仅供个人使用。
代码 MIT，见 [LICENSE](LICENSE)。
