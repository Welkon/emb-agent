// emb-agent Pi extension
// emb-hook-version: {{EMB_VERSION}}

import { spawnSync } from "node:child_process";

const RUNTIME_CLI = {{RUNTIME_CLI_JSON}};
const RUNTIME_CLI_PATH = {{RUNTIME_CLI_PATH_JSON}};
const SESSION_START_HOOK = {{SESSION_START_HOOK_JSON}};
const CONTEXT_MONITOR_HOOK = {{CONTEXT_MONITOR_HOOK_JSON}};
const STATUSLINE_HOOK = {{STATUSLINE_HOOK_JSON}};
const PUBLIC_COMMANDS = {{PUBLIC_COMMANDS_JSON}};
const ACTION_ALIASES = ["scan", "plan", "do", "debug", "review", "verify"];

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
  return extractAdditionalContext(runNodeHook(SESSION_START_HOOK, {
    event: "SessionStart",
    hook_event_name: "SessionStart",
    cwd,
    workspace_trusted: true
  }));
}

function runContextMonitor(cwd) {
  return extractAdditionalContext(runNodeHook(CONTEXT_MONITOR_HOOK, {
    event: "PostToolUse",
    hook_event_name: "PostToolUse",
    cwd,
    workspace_trusted: true
  }, 30000));
}

function runStatusLine(cwd, model) {
  const output = runNodeHook(STATUSLINE_HOOK, {
    cwd,
    model: model
      ? {
          display_name: model.name || model.id || "",
          name: model.name || model.id || "",
          provider: model.provider || ""
        }
      : undefined
  }, 10000);
  return output;
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

  const infoLine = lines.find(line => /\b(ctx|context)\b/i.test(line)) || lines[0] || "";
  const taskLine = lines.find(line => line !== infoLine && /^\[P\d\]/.test(line)) || "";
  const infoParts = infoLine
    .split("·")
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => !/^\d+[hm]$/i.test(part))
    .filter(part => !/^\[[^\]]+\]\s+next:/i.test(part));
  const primaryInfo = infoParts
    .filter(part => /\b(ctx|context)\b/i.test(part) || infoParts.indexOf(part) === 0)
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
    "Use it only for routing; do not paste raw JSON, long node commands, or command transcripts to the human.",
    "Reply to the human in concise Chinese with the state, the blocking gate if any, and the next confirmation/input needed.",
    "Respect agent_protocol.gate.allowed_actions and agent_protocol.gate.forbidden_actions when present.",
    "If agent_protocol.gate.kind is alignment, stop after PRD/task creation, ask about unclear items, update PRD/task truth, and repeat until explicit agreement before activation/planning/implementation.",
    "If agent_protocol.gate.kind is execution, treat this as an execution brief: perform the requested repository change, then verify after implementation evidence exists.",
    "",
    JSON.stringify({ argv: result.argv, status: result.status, payload }, null, 2)
  ].join("\n");
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
      content: buildAiProtocolMessage(result),
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
    const status = compactStatusLine(runStatusLine(ctx.cwd, ctx.model));
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
}
