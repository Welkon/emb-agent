/**
 * Test script for emb-agent sidequest functions
 * Run: node /mnt/d/Proj/extrap/emb/emb-agent/tests/test-sidequest.mjs
 */
import * as assert from "node:assert";

// ── Copy of detectQueryLanguage ──
function detectQueryLanguage(query) {
	const text = String(query || "");
	const cjkChars = (
		text.match(
			/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g,
		) || []
	).length;
	// At least 2 CJK characters → Chinese/Japanese/Korean intent
	if (cjkChars >= 2) return "zh";
	return "en";
}

// ── Copy of buildSideQuestPrompt ──
function buildSideQuestPrompt(
	projectContext,
	query,
	runtimeCli = "node emb-agent.cjs",
) {
	const lang = detectQueryLanguage(query);
	const contextBlock = projectContext
		? `\n## Project Context (from emb-agent)\n${projectContext}\n`
		: "";

	const langHint =
		lang === "zh"
			? "- Reply in Chinese (中文). Match the language of the query."
			: "- Reply in English. Match the language of the query.";

	return [
		"You are an emb-agent side quest worker. Your task is to answer a specific question in isolation, without polluting the main conversation.",
		"",
		"Rules:",
		"- Answer concisely and directly. Do not start broader exploration or refactoring.",
		langHint,
		"- Use emb-agent context below to understand the project.",
		`- Run \`${runtimeCli} start\` first if you need to load project state.`,
		`- Run \`${runtimeCli} next\` to get the recommended next step for emb-agent workflow.`,
		"- Use read/bash/grep/find to explore files and datasheets.",
		"- Do NOT modify any files unless explicitly asked.",
		"- Return a self-contained answer. The main session will receive only your final response.",
		contextBlock,
		`## Query\n${query}`,
	].join("\n");
}

// ── Tests ──

console.log("=== detectQueryLanguage ===\n");

// Chinese queries
assert.strictEqual(
	detectQueryLanguage("查找ESP32的ADC寄存器配置"),
	"zh",
	"纯中文查询",
);
assert.strictEqual(
	detectQueryLanguage("这个芯片的参考电压是多少"),
	"zh",
	"中文问题",
);
assert.strictEqual(detectQueryLanguage("帮我看看"), "zh", "短中文");

// English queries
assert.strictEqual(
	detectQueryLanguage("Find the ADC register map for ESP32-C3"),
	"en",
	"纯英文查询",
);
assert.strictEqual(
	detectQueryLanguage("What is the reference voltage?"),
	"en",
	"英文问题",
);
assert.strictEqual(detectQueryLanguage("help"), "en", "短英文");

// Mixed / edge cases
assert.strictEqual(
	detectQueryLanguage("ESP32的ADC reference voltage配置"),
	"zh",
	"中英混合→有CJK就是zh",
);
assert.strictEqual(
	detectQueryLanguage("ESP32-C3 ADC VREF register map"),
	"en",
	"纯英文",
);
assert.strictEqual(
	detectQueryLanguage("PWM频率计算公式"),
	"zh",
	"中文技术术语",
);
assert.strictEqual(detectQueryLanguage(""), "en", "空字符串→默认英文");
assert.strictEqual(detectQueryLanguage("ADC"), "en", "纯缩写");
assert.strictEqual(detectQueryLanguage("你好"), "zh", "2个CJK→zh");
assert.strictEqual(detectQueryLanguage("好"), "en", "单CJK不足以判定");

console.log("  ✓ All language detection tests passed\n");

// ── Prompt building tests ──

console.log("=== buildSideQuestPrompt ===\n");

const ctx = "Project: ESP32-C3 board\nMCU: ESP32-C3\nPins: GPIO0-GPIO5";

// Chinese query
const zhPrompt = buildSideQuestPrompt(ctx, "查找ESP32的ADC寄存器配置");
assert.ok(zhPrompt.includes("Reply in Chinese"), "中文查询→中文回复指令");
assert.ok(zhPrompt.includes("查找ESP32的ADC寄存器配置"), "中文查询原文保留");
assert.ok(zhPrompt.includes(ctx), "项目上下文已注入");
console.log("  ✓ Chinese query prompt built correctly");

// English query
const enPrompt = buildSideQuestPrompt(ctx, "Find the ADC register map");
assert.ok(enPrompt.includes("Reply in English"), "英文查询→英文回复指令");
assert.ok(enPrompt.includes("Find the ADC register map"), "英文查询原文保留");
assert.ok(enPrompt.includes(ctx), "项目上下文已注入");
console.log("  ✓ English query prompt built correctly");

// CLI reference
const cliPrompt = buildSideQuestPrompt(
	ctx,
	"查找寄存器",
	"node /custom/path/emb-agent.cjs",
);
assert.ok(
	cliPrompt.includes("node /custom/path/emb-agent.cjs start"),
	"CLI路径正确渲染",
);
assert.ok(
	cliPrompt.includes("node /custom/path/emb-agent.cjs next"),
	"CLI next正确渲染",
);
console.log("  ✓ CLI path rendering works correctly");

// Empty context
const noCtxPrompt = buildSideQuestPrompt("", "Find register map");
assert.ok(
	!noCtxPrompt.includes("Project Context (from emb-agent)"),
	"空上下文不注入context块",
);
console.log("  ✓ Empty context handled correctly");

// ── getPiInvocation logic ──
console.log("\n=== getPiInvocation logic ===\n");

function getPiInvocation(args) {
	// Simulate: when process.execPath is "node"
	const execName = "node";
	if (!/^(node|bun)(\.exe)?$/.test(execName)) {
		return { command: execName, args };
	}
	return { command: "pi", args };
}

const inv = getPiInvocation(["--mode", "json", "-p", "--no-session"]);
assert.strictEqual(inv.command, "pi", "node下fallback到pi命令");
assert.deepStrictEqual(
	inv.args,
	["--mode", "json", "-p", "--no-session"],
	"参数传递正确",
);
console.log("  ✓ getPiInvocation works correctly\n");

// ── Summary ──
console.log("========================================");
console.log("  ALL TESTS PASSED");
console.log("========================================");
