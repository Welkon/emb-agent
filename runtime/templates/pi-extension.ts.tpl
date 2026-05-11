// emb-agent Pi extension
// emb-hook-version: {{EMB_VERSION}}

import { spawnSync } from "node:child_process";

const RUNTIME_CLI = {{RUNTIME_CLI_JSON}};
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

function compactStatusLine(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join("  ");
}

function buildCommandPrompt(commandLine) {
  const invocation = String(commandLine || "").trim()
    ? `${RUNTIME_CLI} ${String(commandLine || "").trim()}`
    : RUNTIME_CLI;

  return [
    `emb-agent Pi command wrapper requested: \`${invocation}\`.`,
    "",
    "Run that CLI in the current repository using the bash tool.",
    "Use the runtime output as the source of truth for follow-up actions; do not improvise a parallel workflow.",
    "If the output contains `operator_handoff`, follow it as the final-answer contract.",
    "If the output reports blockers, close the blocker or ask one concise question before continuing."
  ].join("\n");
}

function sendCommandPrompt(pi, ctx, commandLine) {
  const prompt = buildCommandPrompt(commandLine);
  if (ctx.isIdle()) {
    pi.sendUserMessage(prompt);
  } else {
    pi.sendUserMessage(prompt, { deliverAs: "followUp" });
    if (ctx.hasUI) {
      ctx.ui.notify("Queued emb-agent command after the current turn.", "info");
    }
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
        customType: "emb-agent",
        content: message,
        display: true,
        details: { kind: "context-monitor" }
      },
      { deliverAs: ctx.isIdle() ? "nextTurn" : "steer" }
    );
  }

  pi.registerCommand("emb", {
    description: "Run an emb-agent CLI command, for example /emb next or /emb task add <summary>",
    handler: async (args, ctx) => {
      sendCommandPrompt(pi, ctx, String(args || "").trim() || "help");
    }
  });

  for (const commandName of [...PUBLIC_COMMANDS, ...ACTION_ALIASES]) {
    for (const wrapperName of [`emb:${commandName}`, `emb-${commandName}`]) {
      pi.registerCommand(wrapperName, {
        description: `Run emb-agent ${commandName}`,
        handler: async (args, ctx) => {
          const suffix = String(args || "").trim();
          sendCommandPrompt(pi, ctx, suffix ? `${commandName} ${suffix}` : commandName);
        }
      });
    }
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
