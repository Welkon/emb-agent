# emb-agent runtime

这是安装到 runtime 配置目录下的 emb-agent 运行时目录。

## 目录

- `bin/`: emb-agent 主 CLI
- `config.json`: runtime 默认配置
- `lib/`: 校验、状态与路径辅助逻辑
- `scripts/`: 模板等辅助脚本
- `templates/`: 类似 GSD 的扁平模板库
- `profiles/`: 内置项目画像
- `packs/`: 内置场景 pack
- `state/`: 按项目路径索引的轻量状态

## 用法

初始化当前项目状态：

```bash
node ~/.codex/emb-agent/scripts/init-project.cjs
node ~/.codex/emb-agent/bin/emb-agent.cjs init
```

写入轻量 handoff：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs pause
node ~/.codex/emb-agent/bin/emb-agent.cjs resume
```

查看下一步命令：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs next
```

查看或修改轻量偏好：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs show
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs set plan_mode always
node ~/.codex/emb-agent/bin/emb-agent.cjs prefs reset
node ~/.codex/emb-agent/bin/emb-agent.cjs project show
```

列出模板：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs template list
```

查看轻量调度结果：

```bash
node ~/.codex/emb-agent/bin/emb-agent.cjs scan
node ~/.codex/emb-agent/bin/emb-agent.cjs scan save hardware "Captured current entry and truth source order" --fact "main.c remains latest touched file"
node ~/.codex/emb-agent/bin/emb-agent.cjs plan
node ~/.codex/emb-agent/bin/emb-agent.cjs plan save "Prepare minimal wakeup-timer fix plan" --risk "Wakeup path may re-trigger timer flag" --verify "Verify wakeup path on bench"
node ~/.codex/emb-agent/bin/emb-agent.cjs debug
node ~/.codex/emb-agent/bin/emb-agent.cjs review
node ~/.codex/emb-agent/bin/emb-agent.cjs review save "Reconnect path needs offline gate" --finding "Offline fallback is underspecified" --check "Verify reconnect after timeout"
node ~/.codex/emb-agent/bin/emb-agent.cjs note
node ~/.codex/emb-agent/bin/emb-agent.cjs note add hardware "PROGRAM_PIN is flashing path" --kind hardware_truth --evidence docs/MCU-datasheet.md
node ~/.codex/emb-agent/bin/emb-agent.cjs schedule show do
```
