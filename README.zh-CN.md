<div align="center">

<img src="./assets/banner.svg" alt="Neodrop Skills" width="720">

<p><strong>让你的 AI agent 以你的身份操作 <a href="https://neodrop.ai">Neodrop</a></strong> —— 查频道、看 post、管理订阅、创建频道，全程不离开你的编辑器。</p>

[![npm version](https://img.shields.io/npm/v/neodrop-cli?color=e2b878&label=neodrop-cli&logo=npm)](https://www.npmjs.com/package/neodrop-cli)
[![node](https://img.shields.io/node/v/neodrop-cli?color=1d1d1d)](https://nodejs.org)
[![downloads](https://img.shields.io/npm/dm/neodrop-cli?color=5a5a5a)](https://www.npmjs.com/package/neodrop-cli)
[![license](https://img.shields.io/npm/l/neodrop-cli?color=1d1d1d)](./LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-2e7d32.svg)](https://github.com/NeoDropAI/neodrop-skills/pulls)

[English](./README.md) · **简体中文**

</div>

---

本仓库收录所有官方 **Neodrop AI skill**。当前只有一个 —— [`neodrop-cli`](./skills/neodrop-cli/)，将来会有更多。

## ✨ 装好之后 AI 能帮你做什么

所有操作都以**你的身份**进行（用 Personal Access Token 鉴权），等价于你自己登录 Neodrop 网页操作。

| 你说…… | AI 就会 |
|---|---|
| *「我订阅了哪些频道？」* | 直接调 CLI 拿真实数据回答你 |
| *「帮我建一个追踪 AI 行业的频道」* | 拼好 input 并 `channels create` |
| *「Neodrop 上有没有讲量化交易的频道？」* | 综合 `channels search` + `channels by-category` |
| *「订阅这个频道 / 取消订阅 X」* | 直接调 `channels subscribe` / `unsubscribe` |
| *「这是一条 Neodrop 链接，里面是啥？」* | 把 URL 映射到对应的 `get` 命令 |

## 🚀 快速开始

### 1 · 准备

| 要求 | 说明 |
|---|---|
| **Node 18+** | `node --version` 自查，自带 `npx`。没有就去 [nodejs.org](https://nodejs.org/) 装 LTS。 |
| **一个 Neodrop 账号** | 没注册的话先去 [neodrop.ai](https://neodrop.ai)。 |
| **一个 AI agent** | Claude Code / Cursor / Codex —— 任何能跑 shell 的 agent。 |

> CLI 用 Node 原生 `fetch` 实现，**零运行时依赖** —— `npx neodrop-cli` 即用，不需要 clone 仓库、不需要 pip / Python。

### 2 · 登录（一次）

```bash
npx neodrop-cli login
```

<div align="center">
<img src="./assets/auth-flow.svg" alt="neodrop login 工作原理" width="880">
</div>

CLI 会打印一条 `https://neodrop.ai/cli-auth?session=…` URL。复制到**任意**浏览器（本机 / 手机 / 另一台机器都行）打开 → 登录 → 确认客户端名 → 点同意。CLI 通过轮询自动检测到，把凭证写入 `~/.neodrop/credentials.json`（`chmod 0600`）。

**不会自动拉起浏览器、不开本地端口** —— 所以同一条命令在 **SSH / 云沙箱 / 容器**里同样适用。完整流程与安全模型见 [`references/auth.md`](./skills/neodrop-cli/references/auth.md)。

验证：

```bash
npx neodrop-cli whoami --pretty
```

应看到包含你的用户信息和 token 元信息的 JSON。

### 3 · 接入你的 AI agent

<details open>
<summary><strong>Claude Code</strong></summary>

<br>

一条命令把 skill 描述装进 Claude Code 的 skill 目录：

```bash
npx neodrop-cli install-skill
```

它会把 `SKILL.md` + `references/` 拷到 `~/.claude/skills/neodrop-cli/`。重启 Claude Code（或新开会话）—— AI 看到「我订阅了什么频道」之类的提问就会自动路由到本 skill（调用 `npx neodrop-cli …`）。

可选 —— 把 `npx neodrop-cli` 加进 Claude Code 的 Bash allowlist（免去每次确认权限），编辑 `~/.claude/settings.json`：

```json
{
  "permissions": {
    "allow": ["Bash(npx neodrop-cli:*)"]
  }
}
```

> 嫌每次 `npx` 拉包慢？全局装一份 `npm i -g neodrop-cli`，之后直接 `neodrop <command>`，allowlist 写 `Bash(neodrop:*)`。
> 需要同时写明包名和 bin 名时，用 `npx -p neodrop-cli neodrop <command>`。

</details>

<details>
<summary><strong>Cursor / 其他 agent</strong></summary>

<br>

把 [`SKILL.md`](./skills/neodrop-cli/SKILL.md) 的内容复制到 Cursor 的 `.cursorrules` / system prompt（或任何 agent 的 instructions）末尾，告诉它「需要操作 Neodrop 时调 `npx neodrop-cli …`」。只要 agent 能跑 shell、能读 stdout 就能用。

</details>

## 📖 命令速查

```
元命令        login / logout / whoami / me / install-skill
PAT 管理      tokens list / tokens revoke <id>
频道          channels list [--mine] / get <id> / create / subscribe <id> / unsubscribe <id>
              channels search <q> / categories / by-category <slug>
Post          posts list [--subscribed | --channel <id>] / get <id> / search <q>
              feed  (= posts list --subscribed)
兜底          api <procedure> [--json '…' | --stdin] [--mutation]
全局          --pretty  (缩进 JSON，但仍是合法 JSON)
```

详细用法：`npx neodrop-cli --help` 或 [`SKILL.md`](./skills/neodrop-cli/SKILL.md) · [`references/commands.md`](./skills/neodrop-cli/references/commands.md)。

## 🔌 输出契约

CLI 是给 AI 用的：

| 通道 | 内容 |
|---|---|
| `stdout` | **永远是合法 JSON** —— AI 直接 `JSON.parse` |
| `stderr` | 日志、进度、错误描述（给人看） |
| 退出码 `0` | 成功 |
| 退出码 `1` | 业务错误（鉴权失败 / 找不到 / 后端拒绝参数） |
| 退出码 `2` | 参数错误（CLI 用法不对） |

默认 stdout 是单行 JSON；加 `--pretty` 切缩进 JSON —— **两种都是合法 JSON**，AI 不需要切 flag 也能 parse。

## 🔐 数据安全

- token 明文存在 `~/.neodrop/credentials.json`，文件权限自动设为 `0600`（只有你能读）。
- 同 GitHub PAT / npm token 一样，**请保护好你的 home 目录** —— 任何能读它的进程都持有你的登录身份。
- 默认 token 90 天过期；可在 [neodrop.ai/settings/cli-tokens](https://neodrop.ai/settings/cli-tokens) 随时撤销任意一个。
- 丢了机器？`npx neodrop-cli logout`（撤销 + 删本地凭证），再 `login` 重发。

## 🏠 私有部署 / Self-host

跑的是私有 Neodrop 实例？

```bash
# 方式 A —— 环境变量
NEODROP_SERVER=https://your-neodrop.example.com npx neodrop-cli login

# 方式 B —— login flag
npx neodrop-cli login --server https://your-neodrop.example.com
```

默认 API 域按 web origin 启发式推断：`neodrop.ai` → `api.neodrop.ai`；`localhost:4001` → `localhost:3001`；其他默认与 web origin 同域（假设 backend 反代在 `/trpc/*`）。若 api 域不同，传 `--api <url>` 或设 `NEODROP_API`。

## 🛠 开发与发布

CLI 源码在 [`skills/neodrop-cli/`](./skills/neodrop-cli/) —— 纯 Node、零运行时依赖。本地跑：

```bash
cd skills/neodrop-cli
node bin/neodrop.mjs --help
```

发布到 npm 由打 git tag 触发，走 OIDC 可信发布（CI 无长期 token），见 [`.github/workflows/publish.yml`](./.github/workflows/publish.yml)。

<details>
<summary><strong>仓库结构</strong></summary>

<br>

每个 skill 在 `skills/<skill-name>/` 一个独立目录，目录名即 skill 名（与 `SKILL.md` frontmatter 的 `name:` 完全一致，遵循 [Anthropic Skill 规范](https://docs.anthropic.com/claude/docs/build-skills)）：

```
neodrop-skills/
├── README.md              ← 英文主文档
├── README.zh-CN.md        ← 你在看的这个（简体中文）
├── LICENSE                ← MIT
├── assets/                ← logo、banner、图示（仅 GitHub 可见，不进 npm 包）
└── skills/                ← 所有 skill 在这里并列
    └── neodrop-cli/        ← 第一个 skill（将来可有 neodrop-pm/、neodrop-search/ 等）
        ├── SKILL.md        ← AI skill 描述 + 路由触发词
        ├── package.json    ← npm 包（发布为 neodrop-cli，bin: neodrop）
        ├── bin/neodrop.mjs ← Node 入口
        ├── lib/            ← api / credentials / origins / output / web-urls / install-skill
        └── references/     ← 命令清单 / 鉴权 / 故障排查 / URL 路由
```

</details>

## 🤝 反馈与贡献

- 用着不爽 / 命令不够用？[开 issue](https://github.com/NeoDropAI/neodrop-skills/issues)。
- 想加命令糖衣 / 新 skill？PR welcome。

<div align="center">
<br>
<img src="./assets/logo.svg" alt="" width="40">
<br><sub>MIT · Built by <a href="https://neodrop.ai">Neodrop</a></sub>
</div>
