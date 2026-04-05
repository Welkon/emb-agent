# emb-agent Release

这份文档定义 `emb-agent` 和 `emb-agent-adapters` 的最小发布闭环。

## 仓库职责

- `emb-agent`:
  installer、runtime、命令、agent、抽象 tool/chip 合同
- `emb-agent-adapters`:
  外部 family/device/chip profile、route、algorithm

## 什么时候只发 emb-agent

- installer 结构变更
- runtime 命令或状态契约变更
- `adapter sync` / `tool run` 加载逻辑变更
- 模板、profile、pack、session、hook 变更

## 什么时候只发 emb-agent-adapters

- 新增或修正某个 MCU/family/device/chip profile
- 新增 route / algorithm
- 只调整外设公式、参数、寄存器提示

## 双仓库一起改时的顺序

如果 adapter 依赖新的 runtime 合同，顺序固定：

1. 先发 `emb-agent`
2. 再发 `emb-agent-adapters`
3. 最后做一次 fresh install + adapter sync 验证

原因：

- `emb-agent` 定义 loader、sync 和 runtime 合同
- `emb-agent-adapters` 只是消费这些合同
- 先推 adapter、后推 runtime，会出现用户拉到新 adapter 但老 runtime 还不支持的窗口期

## emb-agent 发布前检查

在仓库根目录执行：

```bash
npm run release:check
git status --short
```

这一步会做：

- 校验 `package.json` 关键字段
- 跑全量测试
- 跑 `npm pack --dry-run`

工作区必须是干净的，再继续下一步。

## emb-agent 提交与推送

```bash
git add .
git commit -m "feat: short summary"
git push -u origin main
```

如果要发 npm：

```bash
npm version patch
npm publish
git push --follow-tags
```

版本策略建议：

- `patch`: 文档、小修复、兼容性不变
- `minor`: 新命令、新能力、兼容扩展
- `major`: 安装结构、runtime 合同、adapter 合同破坏性变更

## emb-agent-adapters 发布前检查

在 adapter 仓库根目录执行：

```bash
npm run release:check
git status --short
```

这一步会做：

- 校验 route / algorithm / core 基本结构
- 校验 device profile 的 `bindings`
- 校验 binding 指向的 route 和 algorithm 是否存在

## emb-agent-adapters 提交与推送

```bash
git add .
git commit -m "feat: short summary"
git push -u origin main
```

适合打 tag，但不建议发 npm 包；它的主消费方式是 `adapter source add --type git`。

## 最终联调验证

建议每次双仓库联动后，至少做一次：

```bash
npx ./emb-agent --local
node ./.codex/emb-agent/bin/emb-agent.cjs init
node ./.codex/emb-agent/bin/emb-agent.cjs adapter source add default-pack --type git --location https://github.com/Welkon/emb-agent-adapters.git
node ./.codex/emb-agent/bin/emb-agent.cjs adapter sync default-pack
```

然后对一个真实芯片执行最少一组工具调用，例如：

- `timer-calc`
- `pwm-calc`
- `comparator-threshold`

## 当前已知阻塞

- 当前环境对 `https://github.com` 没有可用 HTTPS 凭据
- 当前环境到 GitHub SSH `22` 端口不可用

所以这里的“发布流程”已经整理好，但真正 `git push` / `npm publish` 仍需要你在本机补认证后执行。
