// emb-agent Pi extension
// emb-hook-version: {{EMB_VERSION}}

import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";

const RUNTIME_CLI = "node {{PROJECT_ROOT}}/.pi/emb-agent/bin/emb-agent.cjs";
const RUNTIME_CLI_PATH = "{{PROJECT_ROOT}}/.pi/emb-agent/bin/emb-agent.cjs";
const SESSION_START_HOOK = "{{PROJECT_ROOT}}/.pi/emb-agent/hooks/emb-session-start.js";
const CONTEXT_MONITOR_HOOK = "{{PROJECT_ROOT}}/.pi/emb-agent/hooks/emb-context-monitor.js";
const STATUSLINE_HOOK = "{{PROJECT_ROOT}}/.pi/emb-agent/hooks/emb-statusline.js";
const HOOK_RUNTIME = {
  session_start: {
    hook: "session-start",
    host: "pi",
    runtime: "rust",
    command: "{{PROJECT_ROOT}}/.pi/emb-agent/bin/emb-agent-rs hook session-start",
    fallback: "",
    reason: "rust",
    supported: true
  },
  statusline: {
    hook: "statusline",
    host: "pi",
    runtime: "rust",
    command: "{{PROJECT_ROOT}}/.pi/emb-agent/bin/emb-agent-rs statusline",
    fallback: "",
    reason: "rust",
    supported: true
  },
  context_monitor: {
    hook: "context-monitor",
    host: "pi",
    runtime: "rust",
    command: "{{PROJECT_ROOT}}/.pi/emb-agent/bin/emb-agent-rs hook context-monitor",
    fallback: "",
    reason: "rust",
    supported: true
  }
};
const PUBLIC_COMMANDS = ["capability", "decision", "help", "ingest", "migrate", "next", "pause", "resume", "start", "task"];
const ACTION_ALIASES = ["scan", "plan", "do", "debug", "review", "verify"];

function runNodeHook(filePath, payload, timeoutMs = 120000) {
  try {
    const result = spawnSync(process.execPath, [filePath], {
      cwd: payload && payload.cwd ? payload.cwd : process.cwd(),
      input: JSON.stringify(payload || {}),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: timeoutMs,
      env: { ...process.env, EMB_AGENT_WORKSPACE_TRUST: "1" }
    });
    if (result.error || result.status !== 0) return "";
    return String(result.stdout || "").trim();
  } catch {
    return "";
  }
}

function splitCommandLine(cmd) {
  const parts = [];
  let current = "";
  let inQuote: string | false = false;
  for (const ch of cmd || "") {
    if (inQuote) {
      if (ch === inQuote) { inQuote = false; current += ch; }
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch; current += ch;
    } else if (ch === " " || ch === "\t") {
      if (current) { parts.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts.map(p => {
    if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
      return p.slice(1, -1);
    }
    return p;
  });
}

function runCommandString(commandText, payload, timeoutMs = 120000) {
  const words = splitCommandLine(commandText || "");
  if (words.length === 0) return "";
  try {
    const result = spawnSync(words[0], words.slice(1), {
      cwd: payload && payload.cwd ? payload.cwd : process.cwd(),
      input: JSON.stringify(payload || {}),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: timeoutMs,
      env: { ...process.env, EMB_AGENT_WORKSPACE_TRUST: "1" }
    });
    if (result.error || result.status !== 0) return "";
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
  if (!raw) return "";
  try {
    const payload = JSON.parse(raw);
    if (typeof payload.additional_context === "string") return payload.additional_context;
    if (typeof payload.additionalContext === "string") return payload.additionalContext;
    const hookOutput = payload.hookSpecificOutput || payload.hook_specific_output || {};
    if (typeof hookOutput.additionalContext === "string") return hookOutput.additionalContext;
    if (typeof hookOutput.additional_context === "string") return hookOutput.additional_context;
  } catch {
    return raw;
  }
  return "";
}

function extractWelcomeMessage(rawOutput) {
  try {
    const payload = JSON.parse(String(rawOutput || "").trim());
    return payload.hookSpecificOutput?.welcome || payload.welcome || "";
  } catch {
    return "";
  }
}

function runSessionStart(cwd) {
  return extractAdditionalContext(
    runResolvedHook("session_start", {
      event: "SessionStart",
      hook_event_name: "SessionStart",
      cwd,
      workspace_trusted: true
    }, 120000, SESSION_START_HOOK)
  );
}

function runWelcomeMessage(cwd) {
  return extractWelcomeMessage(
    runResolvedHook("session_start", {
      event: "SessionStart",
      hook_event_name: "SessionStart",
      cwd,
      workspace_trusted: true
    }, 120000, SESSION_START_HOOK)
  );
}

function runContextMonitor(cwd) {
  return extractAdditionalContext(
    runResolvedHook("context_monitor", {
      event: "PostToolUse",
      hook_event_name: "PostToolUse",
      cwd,
      workspace_trusted: true
    }, 30000, CONTEXT_MONITOR_HOOK)
  );
}

function runStatusLine(cwd) {
  return runResolvedHook("statusline", { cwd }, 10000, STATUSLINE_HOOK);
}

function stripAnsi(text) {
  return String(text || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function compactStatusLine(raw) {
  return stripAnsi(raw).replace(/\s+/g, " ").trim();
}

function runCommandAndReport(pi, ctx, commandLine) {
  const cmdParts = splitCommandLine(commandLine);
  if (cmdParts.length === 0) return;
  const proc = spawn(cmdParts[0], [...cmdParts.slice(1), "--json"], {
    cwd: ctx.cwd,
    encoding: "utf8",
    env: { ...process.env, EMB_AGENT_WORKSPACE_TRUST: "1" }
  });
  let stdout = "";
  let stderr = "";
  proc.stdout?.on("data", (d: string) => { stdout += d; });
  proc.stderr?.on("data", (d: string) => { stderr += d; });
  proc.on("close", (code) => {
    const output = stdout.trim();
    const err = stderr.trim();
    if (code === 0 && output) {
      try {
        const data = JSON.parse(output);
        pi.sendMessage({
          customType: "emb-agent-output",
          content: formatCommandOutput(commandLine, data),
          display: true,
          details: { command: commandLine }
        });
      } catch {
        pi.sendMessage({
          customType: "emb-agent-output",
          content: output,
          display: true,
          details: { command: commandLine }
        });
      }
    } else {
      pi.sendMessage({
        customType: "emb-agent-output",
        content: err || "Command failed",
        display: true,
        details: { command: commandLine }
      });
    }
  });
}

function formatCommandOutput(cmd, data) {
  const label = cmd.split(" ")[0] || "emb-agent";
  if (typeof data === "string") return `**/${label}**\n\`\`\`\n${data}\n\`\`\``;
  return `**/${label}**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
}

export default async function (pi, config) {
  let startupContext = "";
  let startupContextInjected = false;
  let lastMonitorMessage = "";

  function updateStatus(ctx) {
    if (!ctx.hasUI) return;
    const status = compactStatusLine(runStatusLine(ctx.cwd));
    ctx.ui.setStatus("emb-agent", status || undefined);
  }

  function emitMonitorMessage(ctx) {
    const message = runContextMonitor(ctx.cwd);
    if (!message || message === lastMonitorMessage) return;
    lastMonitorMessage = message;
    pi.sendMessage({
      customType: "emb-agent-protocol",
      content: message,
      display: false,
      details: { kind: "context-monitor" }
    }, { deliverAs: ctx.isIdle() ? "nextTurn" : "steer" });
  }

  pi.registerCommand("emb", {
    description: "Run an emb-agent CLI command, for example /emb next or /emb task add <summary>",
    handler: async (args, ctx) => {
      runCommandAndReport(pi, ctx, String(args || "").trim() || "help");
      updateStatus(ctx);
    }
  });

  for (const commandName of [...PUBLIC_COMMANDS, ...ACTION_ALIASES]) {
    pi.registerCommand(`emb:${commandName}`, {
      description: `Run emb-agent ${commandName}`,
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

    // Show welcome message to user
    const welcome = runWelcomeMessage(ctx.cwd);
    if (ctx.hasUI && welcome) {
      ctx.ui.notify("emb-agent ready", "info");
      pi.sendMessage({
        customType: "emb-agent-welcome",
        content: welcome,
        display: true,
        details: { kind: "welcome" }
      }, {
        deliverAs: "nextTurn",
        triggerTurn: false
      });
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!startupContext) {
      startupContext = runSessionStart(ctx.cwd);
    }
    if (!startupContext || startupContextInjected) return undefined;
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
}
