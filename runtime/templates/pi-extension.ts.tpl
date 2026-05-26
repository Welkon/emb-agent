// emb-agent Pi extension
// emb-hook-version: {{EMB_VERSION}}

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";

const RUNTIME_CLI = {{RUNTIME_CLI_JSON}};
const RUNTIME_CLI_PATH = {{RUNTIME_CLI_PATH_JSON}};
const SESSION_START_HOOK = {{SESSION_START_HOOK_JSON}};
const CONTEXT_MONITOR_HOOK = {{CONTEXT_MONITOR_HOOK_JSON}};
const STATUSLINE_HOOK = {{STATUSLINE_HOOK_JSON}};
const HOOK_RUNTIME = {{HOOK_RUNTIME_JSON}};
const PUBLIC_COMMANDS = {{PUBLIC_COMMANDS_JSON}};
const ACTION_ALIASES = ["scan", "plan", "do", "debug", "review", "verify"];

// Derive Rust binary path from HOOK_RUNTIME
const RUST_BINARY = (() => {
  const plan = HOOK_RUNTIME?.session_start;
  if (plan?.command) {
    const parts = String(plan.command).split(" ");
    if (parts.length >= 1) return parts[0];
  }
  // fallback: derive from RUNTIME_CLI_PATH
  return RUNTIME_CLI_PATH.replace(/\.cjs$/, "-rs");
})();

function runNodeHook(filePath, payload, timeoutMs = 120000) {
  try {
    const result = spawnSync(process.execPath, [filePath], {
      cwd: payload && payload.cwd ? payload.cwd : process.cwd(),
      input: JSON.stringify(payload || {}),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: timeoutMs,
      env: {
        ...process.env,
        EMB_AGENT_WORKSPACE_TRUST: "1"
      }
    });

    if (result.error || result.status !== 0) {
      return "";
    }

    return String(result.stdout || "").trim();
  } catch {
    return "";
  }
}

function runCommandString(commandText, payload, timeoutMs = 120000) {
  const words = splitCommandLine(commandText || "");
  if (words.length === 0) {
    return "";
  }

  try {
    const result = spawnSync(words[0], words.slice(1), {
      cwd: payload && payload.cwd ? payload.cwd : process.cwd(),
      input: JSON.stringify(payload || {}),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: timeoutMs,
      env: {
        ...process.env,
        EMB_AGENT_WORKSPACE_TRUST: "1"
      }
    });

    if (result.error || result.status !== 0) {
      return "";
    }

    return String(result.stdout || "").trim();
  } catch {
    return "";
  }
}

function getHookRuntimePlan(name) {
  const plans = HOOK_RUNTIME && typeof HOOK_RUNTIME === "object" ? HOOK_RUNTIME : {};
  const plan = plans[name];
  return plan && typeof plan === "object" ? plan : null;
}

function runResolvedHook(name, payload, timeoutMs, nodeHookFile) {
  const plan = getHookRuntimePlan(name);
  if (plan && typeof plan.command === "string") {
    const output = runCommandString(plan.command, payload, timeoutMs);
    if (output) return output;
    if (typeof plan.fallback === "string" && plan.fallback.trim()) {
      const fallbackOutput = runCommandString(plan.fallback, payload, timeoutMs);
      if (fallbackOutput) return fallbackOutput;
    }
  }

  return runNodeHook(nodeHookFile, payload, timeoutMs);
}

function extractAdditionalContext(rawOutput) {
  const raw = String(rawOutput || "").trim();
  if (!raw) {
    return "";
  }

  try {
    const payload = JSON.parse(raw);
    if (typeof payload.additional_context === "string") {
      return payload.additional_context;
    }
    if (typeof payload.additionalContext === "string") {
      return payload.additionalContext;
    }
    const hookOutput = payload.hookSpecificOutput || payload.hook_specific_output || {};
    if (typeof hookOutput.additionalContext === "string") {
      return hookOutput.additionalContext;
    }
    if (typeof hookOutput.additional_context === "string") {
      return hookOutput.additional_context;
    }
  } catch {
    return raw;
  }

  return "";
}

function runSessionStart(cwd) {
  return extractAdditionalContext(runResolvedHook("session_start", {
    event: "SessionStart",
    hook_event_name: "SessionStart",
    cwd,
    workspace_trusted: true
  }, 120000, SESSION_START_HOOK));
}

function runContextMonitor(cwd) {
  return extractAdditionalContext(runResolvedHook("context_monitor", {
    event: "PostToolUse",
    hook_event_name: "PostToolUse",
    cwd,
    workspace_trusted: true
  }, 30000, CONTEXT_MONITOR_HOOK));
}

function runStatusLine(cwd) {
  return runResolvedHook("statusline", {
    cwd
  }, 10000, STATUSLINE_HOOK);
}

function stripAnsi(text) {
  return String(text || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function shortenMiddle(text, maxLength) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value || value.length <= maxLength) {
    return value;
  }
  const keep = Math.max(4, Math.floor((maxLength - 1) / 2));
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

function compactStatusLine(raw) {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map(line => stripAnsi(line).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return "";
  }

  const infoLine = lines[0] || "";
  const taskLine = lines.find(line => line !== infoLine && /^\[P\d\]/.test(line)) || "";
  const infoParts = infoLine
    .split("·")
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => !/^\d+[hm]$/i.test(part))
    .filter(part => !/^\[[^\]]+\]\s+next:/i.test(part));
  const primaryInfo = infoParts
    .slice(0, 2)
    .map(part => shortenMiddle(part, 22));
  const extraInfo = infoParts
    .filter(part => !primaryInfo.some(kept => part.includes(kept) || kept.includes(part)))
    .filter(part => !/task\(s\)|open task/i.test(part))
    .slice(0, 2)
    .map(part => shortenMiddle(part, 18));
  const taskCount = infoParts.find(part => /task\(s\)|open task/i.test(part));
  const info = [...primaryInfo, ...extraInfo, taskCount ? shortenMiddle(taskCount, 18) : ""]
    .filter(Boolean)
    .join(" · ");
  const task = taskLine ? shortenMiddle(taskLine, 30) : "";

  return [info, task]
    .filter(Boolean)
    .join(" | ");
}

function splitCommandLine(input) {
  const args = [];
  let current = "";
  let quote = "";
  let escape = false;

  for (const char of String(input || "")) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    args.push(current);
  }
  return args;
}

function withCompactOutput(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const hasOutputFlag = args.includes("--brief") || args.includes("--json");
  if (!hasOutputFlag && (args[0] === "start" || args[0] === "next")) {
    args.push("--brief");
  }
  return args;
}

function runEmbAgent(argv, cwd) {
  const args = withCompactOutput(argv);
  const result = spawnSync(process.execPath, [RUNTIME_CLI_PATH, ...args], {
    cwd: cwd || process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 120000,
    env: {
      ...process.env,
      EMB_AGENT_WORKSPACE_TRUST: "1"
    }
  });

  return {
    argv: args,
    status: typeof result.status === "number" ? result.status : 1,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || result.error || "").trim()
  };
}

function parseJsonMaybe(text) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return null;
  }
}

function truncateText(text, maxLength = 3000) {
  const value = String(text || "").trim();
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n... (${value.length - maxLength} chars truncated)`;
}

function formatFailureResult(result) {
  return [
    `emb-agent ${result.argv.join(" ")}: failed`,
    truncateText(result.stderr || result.stdout)
  ].filter(Boolean).join("\n");
}

function buildAiProtocolMessage(result) {
  const payload = parseJsonMaybe(result.stdout) || {
    status: result.status === 0 ? "ok" : "failed",
    stdout: truncateText(result.stdout, 1200),
    stderr: truncateText(result.stderr, 1200)
  };
  return [
    "emb-agent machine protocol follows.",
    "CRITICAL: Do NOT run emb-agent-rs, emb-agent.cjs, /emb:*, or pi-coding-agent dist/index.js as bash commands.",
    "ALWAYS trigger /emb: prefix commands through the Pi slash-command channel instead (e.g., /emb:next, /emb:task, /emb:schematic).",
    "The /emb: commands auto-route through the extension and the correct binary path; they are not shell commands.",
    "Reply to the human in concise Chinese with the state, the blocking gate if any, and the next confirmation/input needed.",
    "Do NOT ask the human to run emb-agent commands. Present options or ask for missing input; when a command is needed, trigger the proper /emb: slash command yourself after any required user confirmation.",
    "Respect agent_protocol.gate.allowed_actions and agent_protocol.gate.forbidden_actions when present.",
    "If agent_protocol.gate.kind is alignment, stop after PRD/task creation, ask about unclear items, update PRD/task truth, and repeat until explicit agreement before activation/planning/implementation.",
    "If agent_protocol.gate.kind is execution, treat this as an execution brief: perform the requested repository change, then verify after implementation evidence exists.",
    "",
    JSON.stringify({ argv: result.argv, status: result.status, payload }, null, 2)
  ].join("\n");
}

function translateEmbAgentRsPaths(text) {
  // Replace `emb-agent-rs ...` references in payload to use /emb: slash commands
  return String(text || "").replace(
    /Run `emb-agent-rs (task|next|start|status|health|schematic|ingest|chip|variant|scan|plan|do|review|verify|debug|bootstrap|declare|capability|decision|help) ?([^`]*)`/g,
    (_, cmd, args) => {
      const argsStr = args.trim();
      return `Trigger \`/emb:${cmd}${argsStr ? ' ' + argsStr : ''}\``;
    }
  );
}

function runCommandAndReport(pi, ctx, commandLine) {
  const argv = splitCommandLine(commandLine || "help");
  const result = runEmbAgent(argv.length > 0 ? argv : ["help"], ctx.cwd);

  if (result.status !== 0) {
    pi.sendMessage({
      customType: "emb-agent",
      content: formatFailureResult(result),
      display: true,
      details: {
        kind: "command-result",
        argv: result.argv,
        status: result.status
      }
    });
    if (ctx.hasUI) {
      ctx.ui.notify("emb-agent command failed", "error");
    }
    return;
  }

  pi.sendMessage(
    {
      customType: "emb-agent-protocol",
      content: translateEmbAgentRsPaths(buildAiProtocolMessage(result)),
      display: false,
      details: {
        kind: "machine-protocol",
        argv: result.argv,
        status: result.status
      }
    },
    { triggerTurn: true, deliverAs: ctx.isIdle() ? "followUp" : "steer" }
  );
  if (ctx.hasUI) {
    ctx.ui.notify("emb-agent routed context to AI", "info");
  }
}

export default function embAgentPiExtension(pi) {
  let startupContext = "";
  let startupContextInjected = false;
  let lastMonitorMessage = "";

  function updateStatus(ctx) {
    if (!ctx.hasUI) {
      return;
    }
    const status = compactStatusLine(runStatusLine(ctx.cwd));
    ctx.ui.setStatus("emb-agent", status || undefined);
  }

  function emitMonitorMessage(ctx) {
    const message = runContextMonitor(ctx.cwd);
    if (!message || message === lastMonitorMessage) {
      return;
    }
    lastMonitorMessage = message;
    pi.sendMessage(
      {
        customType: "emb-agent-protocol",
        content: message,
        display: false,
        details: { kind: "context-monitor" }
      },
      { deliverAs: ctx.isIdle() ? "nextTurn" : "steer" }
    );
  }

  pi.registerCommand("emb", {
    description: "Trigger an emb-agent slash command, for example /emb next or /emb task add <summary>",
    handler: async (args, ctx) => {
      runCommandAndReport(pi, ctx, String(args || "").trim() || "help");
      updateStatus(ctx);
    }
  });

  for (const commandName of [...PUBLIC_COMMANDS, ...ACTION_ALIASES]) {
    pi.registerCommand(`emb:${commandName}`, {
      description: `Trigger emb-agent ${commandName}`,
      handler: async (args, ctx) => {
        const suffix = String(args || "").trim();
        runCommandAndReport(pi, ctx, suffix ? `${commandName} ${suffix}` : commandName);
        updateStatus(ctx);
      }
    });
  }

  pi.on("session_start", async (_event, ctx) => {
    startupContext = runSessionStart(ctx.cwd);
    startupContextInjected = false;
    lastMonitorMessage = "";
    updateStatus(ctx);
    if (ctx.hasUI && startupContext) {
      ctx.ui.notify("emb-agent startup context ready", "info");
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!startupContext) {
      startupContext = runSessionStart(ctx.cwd);
    }
    if (!startupContext || startupContextInjected) {
      return undefined;
    }
    startupContextInjected = true;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${startupContext}`
    };
  });

  pi.on("tool_execution_end", async (_event, ctx) => {
    emitMonitorMessage(ctx);
    updateStatus(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    updateStatus(ctx);
  });

  // ── Side Quest: isolated-context exploration ──

  function getPiInvocation(args: string[]): { command: string; args: string[] } {
    const currentScript = process.argv[1];
    if (currentScript && fs.existsSync(currentScript)) {
      return { command: process.execPath, args: [currentScript, ...args] };
    }
    const execName = path.basename(process.execPath).toLowerCase();
    if (!/^(node|bun)(\.exe)?$/.test(execName)) {
      return { command: process.execPath, args };
    }
    return { command: "pi", args };
  }

  function detectQueryLanguage(query: string): string {
    const text = String(query || "");
    const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
    // At least 2 CJK characters → Chinese/Japanese/Korean intent
    if (cjkChars >= 2) return "zh";
    return "en";
  }

  function buildSideQuestPrompt(projectContext: string, query: string): string {
    const lang = detectQueryLanguage(query);
    const contextBlock = projectContext
      ? `\n## Project Context (from emb-agent)\n${projectContext}\n`
      : "";

    const langHint = lang === "zh"
      ? "- Reply in Chinese (中文). Match the language of the query."
      : "- Reply in English. Match the language of the query.";

    return [
      "You are an emb-agent side quest worker. Your task is to answer a specific question in isolation, without polluting the main conversation.",
      "",
      "Rules:",
      "- Answer concisely and directly. Do not start broader exploration or refactoring.",
      langHint,
      "- Use emb-agent context below to understand the project.",
      `- The side quest may use \`${RUNTIME_CLI} start\` internally if it needs to load project state.`,
      `- The side quest may use \`${RUNTIME_CLI} next\` internally to get the recommended next step for emb-agent workflow.`,
      "- Use read/bash/grep/find to explore files and datasheets.",
      "- Do NOT modify any files unless explicitly asked.",
      "- Return a self-contained answer. The main session will receive only your final response.",
      contextBlock,
      `## Query\n${query}`,
    ].join("\n");
  }

  async function spawnSideQuest(
    query: string,
    cwd: string,
    startupContext: string,
    signal?: AbortSignal
  ): Promise<{ status: string; output: string; error?: string }> {
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "emb-sidequest-"));
    const promptPath = path.join(tmpDir, "sidequest-prompt.md");
    const promptContent = buildSideQuestPrompt(startupContext, query);

    try {
      fs.writeFileSync(promptPath, promptContent, { encoding: "utf8", mode: 0o600 });

      const args = [
        "--mode", "json",
        "-p",
        "--no-session",
        "--append-system-prompt", promptPath,
        "--tools", "read,bash,grep,find,ls",
      ];

      const invocation = getPiInvocation(args);

      let buffer = "";
      let finalText = "";
      let errorText = "";

      const exitCode = await new Promise<number>((resolve) => {
        const proc = spawn(invocation.command, invocation.args, {
          cwd,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            EMB_AGENT_WORKSPACE_TRUST: "1",
          },
        });

        const processLine = (line: string) => {
          if (!line.trim()) return;
          let event: any;
          try { event = JSON.parse(line); } catch { return; }

          if (event.type === "message_end" && event.message?.role === "assistant") {
            const msg = event.message;
            for (const part of msg.content || []) {
              if (part.type === "text") finalText += part.text;
            }
          }
        };

        proc.stdout.on("data", (data: Buffer) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) processLine(line);
        });

        proc.stderr.on("data", (data: Buffer) => {
          errorText += data.toString();
        });

        proc.on("close", (code) => {
          if (buffer.trim()) processLine(buffer);
          resolve(code ?? 0);
        });

        proc.on("error", () => resolve(1));

        if (signal) {
          const killProc = () => {
            proc.kill("SIGTERM");
            setTimeout(() => { if (!proc.killed) proc.kill("SIGKILL"); }, 5000);
          };
          if (signal.aborted) killProc();
          else signal.addEventListener("abort", killProc, { once: true });
        }
      });

      if (exitCode !== 0 && !finalText) {
        return { status: "failed", output: "", error: errorText || `Exit code ${exitCode}` };
      }

      return {
        status: exitCode === 0 ? "ok" : "partial",
        output: finalText.trim() || "(no output)",
        error: exitCode !== 0 ? errorText.trim() : undefined,
      };
    } finally {
      try { fs.unlinkSync(promptPath); } catch { /* ignore */ }
      try { fs.rmdirSync(tmpDir); } catch { /* ignore */ }
    }
  }

  // Register emb_sidequest tool — AI can call this autonomously
  pi.registerTool({
    name: "emb_sidequest",
    label: "Emb Side Quest",
    description: [
      "Spawn an isolated side quest to research or answer a question WITHOUT polluting the main conversation context.",
      "Use this when:",
      "- The user asks a tangential \"by the way\" or \"while we're at it\" question",
      "- You need to explore datasheet details, register maps, or hardware specs that would clutter the main session",
      "- Answering inline would take many turns of exploration",
      "- The question is self-contained and doesn't depend on recent conversation nuance",
      "The side quest runs in a fresh isolated context with emb-agent project knowledge.",
      "Results are returned as a compact summary — the main session stays clean.",
    ].join(" "),
    parameters: Type.Object({
      query: Type.String({ description: "Self-contained research question to answer in isolation. Include enough context so the side quest can work independently." }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = ctx.cwd || process.cwd();

      if (startupContext) {
        const result = await spawnSideQuest(params.query, cwd, startupContext, signal);
        if (result.status === "failed") {
          return {
            content: [{ type: "text", text: `Side quest failed: ${result.error || "unknown error"}` }],
            details: { kind: "sidequest", status: "failed", query: params.query },
            isError: true,
          };
        }
        return {
          content: [{ type: "text", text: result.output }],
          details: { kind: "sidequest", status: result.status, query: params.query },
        };
      }

      // No emb-agent context yet — load emb-agent context first, then the query
      const freshContext = runSessionStart(cwd);
      const result = await spawnSideQuest(params.query, cwd, freshContext, signal);
      if (result.status === "failed") {
        return {
          content: [{ type: "text", text: `Side quest failed: ${result.error || "unknown error"}` }],
          details: { kind: "sidequest", status: "failed", query: params.query },
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: result.output }],
        details: { kind: "sidequest", status: result.status, query: params.query },
      };
    },
  });

  // Register /emb:sidequest command — user can trigger manually
  pi.registerCommand("emb:sidequest", {
    description: "Start an isolated side quest without polluting the main session context",
    handler: async (args, ctx) => {
      const query = String(args || "").trim();
      if (!query) {
        ctx.ui.notify("Usage: /emb:sidequest <query>", "error");
        return;
      }

      if (ctx.hasUI) {
        ctx.ui.notify(`Spawning side quest: ${query.slice(0, 60)}...`, "info");
      }

      const cwd = ctx.cwd || process.cwd();
      const context = startupContext || runSessionStart(cwd);
      const result = await spawnSideQuest(query, cwd, context);

      if (result.status === "failed") {
        pi.sendMessage({
          customType: "emb-agent",
          content: `Side quest failed: ${result.error || "unknown error"}`,
          display: true,
          details: { kind: "sidequest", status: "failed", query },
        }, { triggerTurn: false });
        if (ctx.hasUI) {
          ctx.ui.notify("Side quest failed", "error");
        }
        return;
      }

      pi.sendMessage({
        customType: "emb-agent",
        content: `## Side Quest Result\n\n**Query:** ${query}\n\n${result.output}`,
        display: true,
        details: { kind: "sidequest", status: result.status, query },
      }, { triggerTurn: true, deliverAs: ctx.isIdle() ? "followUp" : "steer" });

      if (ctx.hasUI) {
        ctx.ui.notify("Side quest completed", "success");
      }
    },
  });
}
