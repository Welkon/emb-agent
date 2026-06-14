/**
 * emb-agent Pi extension
 *
 * Hooks session_start to surface emb-agent project state
 * in the status bar, injects context on next user turn, registers
 * slash commands, and auto-syncs emb-agent agents for pi-subagents.
 *
 * Requires: emb-agent installed via `npx emb-agent --target pi`
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EmbAgentResult {
  action?: string;
  status?: string;
  reason?: string;
  summary?: string;
  instructions?: string;
  next?: { command?: string; reason?: string; cli?: string };
  open_tasks?: number;
  agent_protocol?: { gate?: { recommended_command?: string; recommended_agent?: string } };
  language?: string;
  task_candidates?: Array<{ name: string }>;
  // From status --brief
  project?: { mcu?: string; package?: string; bootstrap?: string; workflow?: string; active_variant?: string };
  tasks?: { open?: number; wiki_pages?: number; active?: string | { name?: string; title?: string } | null };
  update_available?: boolean;
  installed_version?: string | null;
  latest_version?: string | null;
  manual_update_command?: string;
}

async function runEmbAgent(
  args: string[],
  cwd: string,
): Promise<EmbAgentResult | null> {
  const binPath = join(cwd, ".pi", "emb-agent", "bin", "emb-agent.cjs");

  try {
    await access(binPath, constants.R_OK);
    const { stdout } = await execFileAsync("node", [binPath, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    if (!stdout.trim()) return null;
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function normalizeLanguage(value: unknown): string {
  const lang = String(value || "").trim().toLowerCase();
  if (!lang) return "";
  if (["zh", "zh-cn", "zh_hans", "cn", "chinese", "中文", "简体中文"].includes(lang)) return "zh";
  if (["en", "english", "英文"].includes(lang)) return "en";
  return lang;
}

function languageDirective(language: unknown): string {
  const lang = normalizeLanguage(language);
  if (lang === "zh") return "Respond to the user in Simplified Chinese (中文), unless the user explicitly asks for another language.";
  if (lang === "en") return "Respond to the user in English, unless the user explicitly asks for another language.";
  return "";
}

async function readProjectLanguage(cwd: string): Promise<string> {
  try { return normalizeLanguage(await readFile(join(cwd, ".emb-agent", ".language"), "utf8")); }
  catch { return ""; }
}

// ---------------------------------------------------------------------------
// Subagent sync — auto-generate pi-subagents compatible agent files
// ---------------------------------------------------------------------------

const TOOL_MAP: Record<string, string[]> = {
  Read: ["read"],
  Bash: ["bash"],
  Grep: ["grep"],
  Glob: ["find", "ls"],
};

const DEFAULT_MODEL_ROUTING: Record<string, { model: string; thinking: string }> = {
  "hw-scout":        { model: "deepseek/deepseek-v4-flash", thinking: "off" },
  "fw-doer":         { model: "custom/gpt-5.5",           thinking: "xhigh" },
  "arch-reviewer":   { model: "custom/gpt-5.5",           thinking: "xhigh" },
  "bug-hunter":      { model: "deepseek/deepseek-v4-pro", thinking: "high" },
  "sys-reviewer":    { model: "deepseek/deepseek-v4-pro", thinking: "high" },
  "release-checker": { model: "deepseek/deepseek-v4-flash", thinking: "off" },
  "onboard":         { model: "custom/gpt-5.5",           thinking: "xhigh" },
};

async function syncEmbAgentsToPi(cwd: string) {
  // Installed path: .emb-agent/agents/ (from npx emb-agent)
  // Dev path: agents/ (emb-agent repo itself)
  const candidates = [join(cwd, ".emb-agent", "agents"), join(cwd, "agents")];
  let agentsDir = "";
  for (const d of candidates) {
    try { await access(d, constants.R_OK); agentsDir = d; break; } catch { /* next */ }
  }
  if (!agentsDir) return;

  const piAgentsDir = join(cwd, ".pi", "agents");

  await mkdir(piAgentsDir, { recursive: true });

  const files = (await readdir(agentsDir)).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const content = await readFile(join(agentsDir, file), "utf-8");
    const fm = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!fm) continue;

    const yaml = fm[1], body = fm[2];
    const name = (yaml.match(/^name:\s*(.+)$/m) || [])[1]?.trim() || "";
    const desc = (yaml.match(/^description:\s*(.+)$/m) || [])[1]?.trim() || "";
    const toolsStr = (yaml.match(/^tools:\s*(.+)$/m) || [])[1]?.trim() || "";

    const embTools = toolsStr.split(",").map((t) => t.trim()).filter(Boolean);
    const piTools = new Set(["read", "grep", "find", "ls"]);
    for (const t of embTools) {
      const mapped = TOOL_MAP[t];
      if (mapped) mapped.forEach((m) => piTools.add(m));
    }
    if (embTools.includes("Bash")) { piTools.add("write"); piTools.add("edit"); }

    const out = `---\nname: ${name}\ndescription: ${desc}\ntools: ${[...piTools].join(", ")}\n---\n\n${body}`;
    await writeFile(join(piAgentsDir, file), out, "utf-8");
  }
}

async function ensureSubagentSettings(cwd: string) {
  const settingsPath = join(cwd, ".pi", "settings.json");
  let settings: Record<string, unknown> = {};
  let sourceIsNew = false;
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf-8"));
  } catch {
    sourceIsNew = true;
  }

  // Only write pi-subagents to settings if it's a fresh file.
  // For existing files, packages are user-managed (pi install / install script).
  if (sourceIsNew) {
    settings.packages = ["npm:pi-subagents"];
  }

  // Ensure agent overrides exist (non-destructive: only adds missing entries)
  if (!settings.subagents) settings.subagents = {};
  const sub = settings.subagents as Record<string, unknown>;
  if (!sub.agentOverrides) sub.agentOverrides = {};
  const overrides = sub.agentOverrides as Record<string, Record<string, string | boolean>>;

  let changed = false;
  for (const [name, cfg] of Object.entries(DEFAULT_MODEL_ROUTING)) {
    if (!overrides[name]) {
      overrides[name] = {
        model: cfg.model,
        thinking: cfg.thinking,
        inheritProjectContext: false,
      };
      changed = true;
    }
  }

  if (changed || sourceIsNew) {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  }
}

function isDeclaredChip(value: unknown): boolean {
  const text = String(value || "").trim();
  return text.length > 0 && text.toLowerCase() !== "unknown";
}

function formatActiveTask(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    const item = value as { name?: unknown; title?: unknown };
    const name = String(item.name || "").trim();
    if (name) return name;
    const title = String(item.title || "").trim();
    if (title) return title;
  }
  return "";
}
function formatRecommendedCommand(r: EmbAgentResult): string {
  const raw = r.agent_protocol?.gate?.recommended_command || r.next?.command || r.action || "";
  let command = String(raw || "").trim();
  if (!command) return "";
  if (command.startsWith("/emb:")) command = command.slice("/emb:".length);
  else if (command.startsWith("/emb-")) command = command.slice("/emb-".length);
  else if (command.startsWith("/")) return "";
  command = command.replace(/^emb-agent\s+/, "").replace(/^emb:/, "").replace(/\s+--brief$/, "").trim();
  const name = command.split(/\s+/)[0] || "";
  if (name === "onboard") return "/emb-onboard";
  return name ? "/emb-next" : "";
}

function formatRecommendedReason(r: EmbAgentResult): string {
  return String(r.next?.reason || r.reason || "").trim();
}

function updateNotice(result: EmbAgentResult | null): { label: string; lines: string[] } {
  if (!result?.update_available) return { label: "", lines: [] };
  const installed = String(result.installed_version || "unknown");
  const available = String(result.latest_version || "latest");
  const command = String(result.manual_update_command || "npx emb-agent@latest update --target all --local");
  return {
    label: `update:${available}`,
    lines: [
      `Runtime update available: ${installed} → ${available}`,
      `Manual update: ${command}`,
    ],
  };
}

function renderNextLines(result: EmbAgentResult, update?: EmbAgentResult | null): string[] {
  const lines: string[] = [];
  for (const line of updateNotice(update || null).lines) lines.push(line);
  if (result.summary) lines.push(`Project: ${result.summary}`);
  const command = formatRecommendedCommand(result);
  if (command) {
    lines.push(`Next command: ${command}`);
    const reason = formatRecommendedReason(result);
    if (reason) lines.push(`  ${reason}`);
  }
  if (result.agent_protocol?.gate?.recommended_agent) {
    lines.push(`Recommended agent: ${result.agent_protocol.gate.recommended_agent}`);
  }
  if (result.reason) lines.push(`State: ${result.reason}`);
  if (result.action) lines.push(`Action: ${result.action}`);
  if (result.instructions) lines.push(`\n${result.instructions}`);
  if (result.task_candidates?.length) {
    lines.push(`Tasks: ${result.task_candidates.map((t) => t.name).join(", ")}`);
  }
  return lines;
}

function formatEmbStatus(r: EmbAgentResult, update?: EmbAgentResult | null): string {
  const parts: string[] = [];
  const notice = updateNotice(update || null);
  if (notice.label) parts.push(notice.label);
  if (r.project?.active_variant) parts.push(`var:${r.project.active_variant}`);

  // Chip info (from status --brief)
  if (isDeclaredChip(r.project?.mcu)) {
    const pkg = isDeclaredChip(r.project?.package) ? `/${r.project!.package}` : "";
    parts.push(`${r.project!.mcu}${pkg}`);
  }

  // Wiki + tasks
  if (r.tasks?.wiki_pages) parts.push(`wiki:${r.tasks.wiki_pages}`);
  if (r.tasks?.open) parts.push(`tasks:${r.tasks.open}`);
  const activeTask = formatActiveTask(r.tasks?.active);
  if (activeTask) parts.push(`▸${activeTask}`);

  // Workflow stage
  const command = formatRecommendedCommand(r);
  if (command) parts.push(command);

  return parts.length > 0 ? `emb: ${parts.join(" · ")}` : "";
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  const lastInjectedContextByCwd = new Map<string, string>();

  async function refreshStatus(ctx: {
    cwd: string;
    ui: {
      setWidget: (k: string, c: string[], o?: Record<string, unknown>) => void;
    };
  }, updateResult: EmbAgentResult | null = null) {
    const statusResult = await runEmbAgent(["status", "--brief"], ctx.cwd);
    if (!statusResult) return;
    const text = formatEmbStatus(statusResult, updateResult);
    ctx.ui.setWidget("emb-agent", text ? [text] : [], { placement: "belowEditor" });
  }

  async function injectNextContext(ctx: { cwd: string }, force = false, updateResult: EmbAgentResult | null = null) {
    const nextResult = await runEmbAgent(["next", "--brief"], ctx.cwd);
    if (!nextResult) return;

    const lines = renderNextLines(nextResult, updateResult);
    const text =
      `[emb-agent]\n${lines.join("\n")}\n\n` +
      `Read skill://emb-agent for the full CLI surface and workflow rules. Act on the state above.`;
    if (!force && lastInjectedContextByCwd.get(ctx.cwd) === text) return;
    lastInjectedContextByCwd.set(ctx.cwd, text);
    await pi.sendMessage(
      {
        customType: "emb-agent",
        content: text,
        display: true,
      },
      { deliverAs: "nextTurn" },
    );
  }

  async function onSessionEnter(ctx: {
    cwd: string;
    ui: {
      setWidget: (k: string, c: string[], o?: Record<string, unknown>) => void;
    };
  }) {
    const updateResult = await runEmbAgent(["update", "--brief"], ctx.cwd);
    await refreshStatus(ctx, updateResult);
    await injectNextContext(ctx, false, updateResult);
  }
  async function sendSteer(text: string, cwd: string) {
    const directive = languageDirective(await readProjectLanguage(cwd));
    await pi.sendUserMessage(directive ? text + "\n\n" + directive : text, { deliverAs: "steer" });
  }


  pi.on("session_start", async (_event, ctx) => {
    // Sync emb-agent subagent definitions (non-critical: failure should not block)
    try {
      await syncEmbAgentsToPi(ctx.cwd);
      await ensureSubagentSettings(ctx.cwd);
    } catch {
      // Agent sync is best-effort; status/next injection is critical.
    }
    await onSessionEnter(ctx);
  });

  // Refresh only the status widget after AI turns; do not re-inject identical
  // next-turn context after every assistant response.
  pi.on("turn_end", async (_event, ctx) => {
    await refreshStatus(ctx);
  });

  // ── Slash commands ──────────────────────────────────────────────

  pi.registerCommand("emb-next", {
    description: "Run emb-agent next and inject result into conversation",
    handler: async (_args, ctx) => {
      const result = await runEmbAgent(["next", "--brief"], ctx.cwd);
      if (!result) {
        ctx.ui.notify("emb-agent not found or not initialized", "warning");
        return;
      }
      await sendSteer(
        `[/emb-next]\n${JSON.stringify(result, null, 2)}\n\nRespond to the user from the runtime recommendation above. If the gate is prd-exploration or action is clarify, run a doc-grounded grilling loop: ask one load-bearing question at a time, challenge ambiguous terms against project truth, update PRD/req truth after confirmation, and run validate/health after truth edits. Do not create a task until the user confirms a concrete deliverable or bug and the state-machine checklist is explicit. If the gate is prd-breakdown, read docs/prd/system.md, present prd_task_candidates, create vertical child PRDs, run validate/health, and wait for explicit agreement before task add or activation; do not ask for a blank task while system PRD candidates exist. If the gate is work-selection or open task candidates exist, classify the work, draft/fill a durable agent brief, split large work into vertical tracer-bullet slices, and present existing tasks as options only after checking whether the user wants existing work or new work. Do not auto-activate a task.`,
        ctx.cwd,
      );
    },
  });

  pi.registerCommand("emb-onboard", {
    description: "Run emb-agent onboarding handoff",
    handler: async (_args, ctx) => {
      const result = await runEmbAgent(["onboard"], ctx.cwd);
      if (!result) {
        ctx.ui.notify("emb-agent onboard failed or not initialized", "warning");
        return;
      }
      await sendSteer(
        `[/emb-onboard]\n${JSON.stringify(result, null, 2)}`,
        ctx.cwd,
      );
    },
  });
}
