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
  task_candidates?: Array<{ name: string }>;
  // From status --brief
  project?: { mcu?: string; package?: string; bootstrap?: string; workflow?: string };
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

function formatEmbStatus(r: EmbAgentResult): string {
  const parts: string[] = [];

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
  if (r.next?.command) parts.push(r.next.command);
  else if (r.action) parts.push(r.action);

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

    const lines: string[] = [];
    if (nextResult.summary) lines.push(`Project: ${nextResult.summary}`);
    if (nextResult.next?.command) {
      lines.push(`Next: emb-agent ${nextResult.next.command}`);
      if (nextResult.next.reason) lines.push(`  ${nextResult.next.reason}`);
    }
    if (nextResult.reason) lines.push(`State: ${nextResult.reason}`);
    if (nextResult.action) lines.push(`Action: ${nextResult.action}`);
    if (nextResult.instructions) lines.push(`\n${nextResult.instructions}`);
    if (nextResult.task_candidates?.length) {
      lines.push(`Tasks: ${nextResult.task_candidates.map((t) => t.name).join(", ")}`);
    }
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
      // Inject via sendUserMessage — works reliably from slash commands
      await pi.sendUserMessage(
        `[/emb-next]\n${JSON.stringify(result, null, 2)}`,
        { deliverAs: "steer" },
      );
    },
  });

  pi.registerCommand("emb-status", {
    description: "Show emb-agent project status",
    handler: async (_args, ctx) => {
      const result = await runEmbAgent(["status", "--brief"], ctx.cwd);
      if (!result) {
        ctx.ui.notify("emb-agent not found or not initialized", "warning");
        return;
      }
      await pi.sendUserMessage(
        `[/emb-status]\n${JSON.stringify(result, null, 2)}`,
        { deliverAs: "steer" },
      );
    },
  });

  pi.registerCommand("emb-scan", {
    description: "Run emb-agent scan",
    handler: async (_args, ctx) => {
      const result = await runEmbAgent(["capability", "run", "scan"], ctx.cwd);
      if (!result) {
        ctx.ui.notify("emb-agent scan failed or not initialized", "warning");
        return;
      }
      await pi.sendUserMessage(
        `[/emb-scan]\n${JSON.stringify(result, null, 2)}`,
        { deliverAs: "steer" },
      );
    },
  });

  pi.registerCommand("emb-init", {
    description: "Initialize emb-agent for the current project",
    handler: async (_args, ctx) => {
      const result = await runEmbAgent(["init"], ctx.cwd);
      if (!result) {
        ctx.ui.notify(
          "Failed to init emb-agent. Run: npx emb-agent --target pi",
          "warning",
        );
        return;
      }
      ctx.ui.notify("emb-agent initialized", "info");
    },
  });
}
