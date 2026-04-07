---
name: emb-ingest
description: Persist newly learned hardware or requirement facts into project truth files without introducing a heavy knowledge system.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - SlashCommand
---

# emb-ingest

你负责把刚确认的硬件或需求事实写回项目真值层，或先把外部文档解析进项目缓存。

## 执行规则

1. 若是硬件事实，使用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" ingest hardware --truth <text> --constraint <text> --unknown <text> --source <path>`
2. 若是需求事实，使用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" ingest requirements --goal <text> --feature <text> --constraint <text> --accept <text> --failure <text> --unknown <text> --source <path>`
3. 若是要先解析 datasheet / 规格书 / 原理图片段，使用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" ingest doc --file <path> --provider mineru --kind datasheet [--pages <range>] [--to hardware|requirements]`
   如果命令结果里已经带出 `apply_ready`，优先直接执行它，再回到 `next`
4. 若是要把文档草稿应用到项目真值层，使用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" ingest apply doc <doc-id> --to hardware|requirements`
   若只想应用部分字段，可加：
   `--only constraints,sources`
   若想直接复用刚才 `doc diff` 的字段选择，可改用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" ingest apply doc <doc-id> --from-last-diff`
   若想复用命名选择，可改用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" ingest apply doc <doc-id> --preset hw-safe`
5. 若是要查可用 `doc-id` 或查看缓存摘要，使用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" doc list`
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" doc show <doc-id>`
   若要直接预览某个 preset 套到当前文档后的结构化变更，可用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" doc show <doc-id> --preset hw-safe`
   若还想顺手拿到 apply 命令提示，可加：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" doc show <doc-id> --preset hw-safe --apply-ready`
6. 若是要在 apply 前预览会改哪些字段，使用：
   `node "$HOME/.codex/emb-agent/bin/emb-agent.cjs" doc diff <doc-id> --to hardware|requirements [--only <fields>]`
   若想把这次字段选择存成命名预设，可加：
   `--save-as hw-safe`
7. 只把已经足够稳定、后续会复用的事实写回真值层。
8. 结果要写入：
   - `emb-agent/hw.yaml`
   - `emb-agent/req.yaml`
   或先落到：
   - `emb-agent/cache/docs/`

## MinerU API

若项目想让 MinerU 自动判断调用链路，在 `emb-agent/project.json` 里配置：

```json
{
  "integrations": {
    "mineru": {
      "mode": "auto",
      "base_url": "",
      "api_key_env": "MINERU_API_KEY",
      "model_version": "vlm",
      "auto_api_page_threshold": 12,
      "auto_api_file_size_kb": 4096
    }
  }
}
```

`mode=auto` 时，小文档默认走 agent；页数或文件大小超过阈值且有 token 时自动走 API。若显式设置 `base_url` 指向 `api/v4` 或 `api/v1/agent`，则以该路由为准。

再在环境变量或 `.env` 里提供 token：

`export MINERU_API_KEY=<your-token>`

## 要求

- 不引入数据库
- 不引入全局 MCU 缓存
- 文档解析先落项目缓存，再把确认过的事实沉到项目内，让 `scan/plan` 复用
- `hardware` 可选字段：`model,package,truths,constraints,unknowns,sources`
- `requirements` 可选字段：`goals,features,constraints,acceptance,unknowns,sources`
