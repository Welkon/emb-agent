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
  task_candidates?: Array<{ name: string }>;
  // From status --brief
  project?: { mcu?: string; package?: string; bootstrap?: string; workflow?: string; active_variant?: string };
  tasks?: { open?: number; wiki_pages?: number; active?: string | null };
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

function formatRecommendedCommand(r: EmbAgentResult): string {
  const raw = r.agent_protocol?.gate?.recommended_command || r.next?.command || r.action || "";
  const command = String(raw || "").trim();
  if (!command) return "";
  if (command.startsWith("/emb:")) return "/emb-" + command.slice("/emb:".length);
  if (command.startsWith("/")) return command;
  const normalized = command.replace(/^emb-agent\s+/, "").replace(/^emb:/, "").replace(/\s+--brief$/, "").trim();
  return normalized ? "/emb-" + normalized : "";
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
  if (r.project?.mcu) {
    const pkg = r.project.package ? `/${r.project.package}` : "";
    parts.push(`${r.project.mcu}${pkg}`);
  }

  // Wiki + tasks
  if (r.tasks?.wiki_pages) parts.push(`wiki:${r.tasks.wiki_pages}`);
  if (r.tasks?.open) parts.push(`tasks:${r.tasks.open}`);
  if (r.tasks?.active) parts.push(`▸${r.tasks.active}`);

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
      await pi.sendUserMessage(
        `[/emb-next]\n${JSON.stringify(result, null, 2)}`,
        { deliverAs: "steer" },
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
      await pi.sendUserMessage(
        `[/emb-onboard]\n${JSON.stringify(result, null, 2)}`,
        { deliverAs: "steer" },
      );
    },
  });
}
