# emb-agent

**嵌入式固件 AI 编码助手工作流引擎。**

把芯片规格、引脚分配、硬件约束写入 `.emb-agent/` —— AI 每次会话自动读取。不再需要在聊天中反复解释你的板子。

支持 **Pi**（原生扩展）、**Codex**、**Claude Code**、**Cursor**。

---

## 架构

```
emb-agent-rs (Rust)         ← 全部逻辑
    ↑
emb-agent.cjs (59行)        ← 瘦 Node.js 转发层
    ↑
宿主扩展/hooks               ← Pi 扩展, Codex hooks.json, Cursor 命令
    ↑
AI 助手                     ← /emb:next, /emb:task, /emb:schematic...
```

## 命令

```bash
# 会话
emb-agent-rs start next status health pause resume

# 任务
emb-agent-rs task list/show/add/activate/resolve
emb-agent-rs task aar scan/record

# 原理图分析
emb-agent-rs schematic summary/components/nets/bom/advice/preview/raw
emb-agent-rs ingest schematic --file board.SchDoc
emb-agent-rs ingest board --file board.PcbDoc

# 知识图谱
emb-agent-rs knowledge graph refresh/report/query/explain
emb-agent-rs knowledge wiki
emb-agent-rs memory list/remember

# 查找
emb-agent-rs doc lookup --chip CA51M550
emb-agent-rs component lookup

# 工作流
emb-agent-rs scan plan do review verify debug
emb-agent-rs chip diff --from X --to Y
```

## 安装

```bash
cd emb-agent
cargo build --release
cp target/release/emb-agent-rs .<host>/emb-agent/bin/
cp runtime/bin/emb-agent.cjs .<host>/emb-agent/bin/
```

## License

MIT
