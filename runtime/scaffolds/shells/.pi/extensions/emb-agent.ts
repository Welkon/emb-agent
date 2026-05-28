/**
 * emb-agent Pi extension
 *
 * Hooks session_start / session_switch to surface emb-agent project state
 * in the status bar, injects context on next user turn, and registers
 * slash commands.
 *
 * Requires: emb-agent installed via `npx emb-agent --target pi`
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

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
}

async function runEmbAgent(
  args: string[],
  cwd: string,
): Promise<EmbAgentResult | null> {
  const binPath = join(cwd, ".pi", "emb-agent", "bin", "emb-agent.cjs");
  const file = Bun.file(binPath);
  if (!(await file.exists())) return null;

  try {
    const proc = Bun.spawn({
      cmd: ["node", binPath, ...args],
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
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

function renderNextLines(result: EmbAgentResult): string[] {
  const lines: string[] = [];
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

function formatEmbStatus(r: EmbAgentResult): string {
  const parts: string[] = [];
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
  async function onSessionEnter(ctx: {
    cwd: string;
    ui: {
      setWidget: (k: string, c: string[], o?: Record<string, unknown>) => void;
    };
  }) {
    // Fetch both status (widget) and next (context) in parallel
    const [statusResult, nextResult] = await Promise.all([
      runEmbAgent(["status", "--brief"], ctx.cwd),
      runEmbAgent(["next", "--brief"], ctx.cwd),
    ]);

    // Widget: rich project status
    if (statusResult) {
      const text = formatEmbStatus(statusResult);
      ctx.ui.setWidget("emb-agent", text ? [text] : [], { placement: "belowEditor" });
    }

    // Context injection from next --brief
    if (!nextResult) return;

    const lines = renderNextLines(nextResult);
    if (lines.length > 0) {
      await pi.sendMessage(
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `[emb-agent]\n${lines.join("\n")}\n\n` +
                `Read skill://emb-agent for the full CLI surface and workflow rules. Act on the state above.`,
            },
          ],
        },
        { deliverAs: "nextTurn" },
      );
    }
  }
  async function sendSteer(text: string, cwd: string) {
    const directive = languageDirective(await readProjectLanguage(cwd));
    await pi.sendUserMessage(directive ? text + "\n\n" + directive : text, { deliverAs: "steer" });
  }


  pi.on("session_start", async (_event, ctx) => {
    await onSessionEnter(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    await onSessionEnter(ctx);
  });
  // Refresh status after each AI turn so the bar stays current
  pi.on("turn_end", async (_event, ctx) => {
    await onSessionEnter(ctx);
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
        `[/emb-next]\n${JSON.stringify(result, null, 2)}`,
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
