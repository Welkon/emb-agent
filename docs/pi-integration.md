# emb-agent + pi 集成

## 原理

pi-subagents 原生支持从 `.pi/agents/` 读取自定义 agent 定义。  
emb-agent agent 按 pi-subagents 格式适配后放入该目录，即可直接使用。

**不需要 bridge、不需要扩展。** 就 agent 文件 + pi-subagents。

```
emb-agent/agents/*.md   →  适配格式  →  .pi/agents/*.md   ← pi-subagents 自动发现
```

## 安装（2 步）

```bash
cd emb-agent
pi install npm:pi-subagents
```

启动 pi 后直接用：

```
Use emb-hw-scout to find all PWM channels in this project.
Run emb-arch-reviewer to check the new ISR for latency issues.
```

## Agent 模型配置

编辑 `.pi/settings.json` → `subagents.agentOverrides`：

| Agent | 默认模型 | thinking | 场景 |
|-------|---------|----------|------|
| `emb-hw-scout` | `claude-haiku-4-5` | off | 快速侦察 |
| `emb-fw-doer` | `claude-sonnet-4` | medium | 代码实现 |
| `emb-arch-reviewer` | `claude-sonnet-4` | high | 架构审查 |
| `emb-bug-hunter` | `claude-sonnet-4` | high | 根因追踪 |
| `emb-sys-reviewer` | `claude-sonnet-4` | high | 系统审查 |
| `emb-release-checker` | `claude-haiku-4-5` | off | 发布检查 |
| `emb-onboard` | `claude-sonnet-4` | medium | 项目初始化 |

**换模型直接改一行**，比如 GPT 写代码 + DeepSeek 审查：

```json
"emb-fw-doer": { "model": "openai/gpt-4o", "thinking": "medium" },
"emb-arch-reviewer": { "model": "deepseek/deepseek-chat", "thinking": "high" }
```

## 使用

### 自然语言

```
Use emb-hw-scout to find the PWM peripheral config for STM32F407.
Ask emb-arch-reviewer to review this interrupt handler.
Run emb-bug-hunter to trace the SPI DMA byte drops.
After implementing, run parallel reviewers: emb-sys-reviewer and emb-arch-reviewer.
```

### Slash 命令

```
/run emb-hw-scout "Locate all timer peripherals in this project"
/chain emb-hw-scout "Analyze ADC" -> emb-fw-doer "Fix ADC sampling rate"
/parallel emb-arch-reviewer "review ISR" -> emb-sys-reviewer "cross-check schematic"
/run emb-fw-doer[model=openai/gpt-4o] "Implement LED dimming driver"
```

### 工作流

```text
# 嵌入式标准流程：侦察 → 实现 → 并行审查 → 修复 → 发布检查
Use emb-hw-scout to understand TIM1 PWM registers.
Then have emb-fw-doer implement the LED driver.
Then run emb-arch-reviewer and emb-sys-reviewer in parallel.
Apply fixes, then run emb-release-checker.
```

## Agent 同步

当 `agents/` 中的 emb-agent agent 有更新时，重新生成 pi 格式：

```bash
node -e "
const fs=require('fs'),path=require('path');
const MAP={Read:'read',Bash:'bash',Grep:'grep',Glob:'find'};
fs.readdirSync('agents').filter(f=>f.endsWith('.md')).forEach(f=>{
  const c=fs.readFileSync(path.join('agents',f),'utf8');
  const m=c.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if(!m)return;
  const y=m[1],b=m[2];
  const nm=(y.match(/^name:\s*(.+)$/m)||[])[1]?.trim()||'';
  const ds=(y.match(/^description:\s*(.+)$/m)||[])[1]?.trim()||'';
  const ts=(y.match(/^tools:\s*(.+)$/m)||[])[1]?.trim()||'';
  const piTools=new Set(['read','grep','find','ls']);
  ts.split(',').map(t=>t.trim()).filter(Boolean).forEach(t=>{
    const m=MAP[t];if(m)piTools.add(m);
  });
  if(ts.includes('Bash')){piTools.add('write');piTools.add('edit');}
  const out='---\nname: '+nm+'\ndescription: '+ds+'\ntools: '+[...piTools].join(', ')+'\n---\n\n'+b;
  fs.writeFileSync(path.join('.pi','agents',f),out,'utf8');
});
console.log('Done.');
"
```

## 目录结构

```
emb-agent/
├── agents/                      ← emb-agent 原始 agent 定义（源）
│   ├── emb-hw-scout.md
│   ├── emb-fw-doer.md
│   └── ...
├── .pi/
│   ├── settings.json            ← pi-subagents 配置 + agent 模型覆盖
│   └── agents/                  ← pi 格式 agent（从 agents/ 适配生成）
│       ├── emb-hw-scout.md
│       ├── emb-fw-doer.md
│       └── ...
```
