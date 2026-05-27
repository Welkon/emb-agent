/**
 * emb-agent OMP extension
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Minimal ANSI helpers (no pi-tui dependency)
// ---------------------------------------------------------------------------

const A = {
  R: "\x1b[0m",
  accent: "\x1b[38;5;75m",
  muted: "\x1b[38;5;240m",
  error: "\x1b[38;5;196m",
  warning: "\x1b[38;5;214m",
  success: "\x1b[38;5;40m",
  dim: "\x1b[2m",
};

function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function pad(n: number): string {
  return n > 0 ? " ".repeat(n) : "";
}

function clip(s: string, w: number): string {
  if (visibleLen(s) <= w) return s;
  let out = "";
  let v = 0;
  let i = 0;
  while (i < s.length && v < w - 1) {
    if (s[i] === "\x1b") {
      while (i < s.length && s[i] !== "m") { out += s[i]; i++; }
      if (i < s.length) { out += s[i]; i++; }
    } else {
      out += s[i];
      v++;
      i++;
    }
  }
  return out + "\u2026";
}

function c(color: keyof typeof A, text: string): string {
  return A[color] + text + A.R;
}

// ---------------------------------------------------------------------------
// TaskPicker — custom TUI with left/right split
// ---------------------------------------------------------------------------

interface TaskItem {
  name: string;
  priority?: string;
  title?: string;
  status?: string;
  bootstrap?: boolean;
}

class TaskPicker {
  items: TaskItem[];
  selected = 0;
  onSelect: (item: TaskItem) => void;
  onCancel: () => void;

  constructor(
    items: TaskItem[],
    onSelect: (item: TaskItem) => void,
    onCancel: () => void,
  ) {
    this.items = items;
    this.onSelect = onSelect;
    this.onCancel = onCancel;
  }

  render(width: number): string[] {
    const w = Math.max(70, width);
    const listW = Math.floor(w * 0.40);
    const detailW = w - listW - 4;
    const lines: string[] = [];
    const sel = this.items[this.selected];

    // Title bar
    const title = "Task Picker";
    lines.push(c("accent", "\u256D\u2500\u2500 ") + title + pad(w - visibleLen(title) - 6) + c("accent", " \u2500\u2500\u256E"));
    lines.push(c("accent", "\u2570") + c("muted", "\u2500".repeat(w - 2)) + c("accent", "\u256F"));

    // Detail card
    const detail: string[] = [];
    if (sel) {
      detail.push(c("accent", "\u250C\u2500 " + sel.name + " ") + c("muted", "\u2500".repeat(Math.max(0, detailW - visibleLen(sel.name) - 6))));
      detail.push(c("muted", "\u2502 ") + (sel.title || sel.name));
      detail.push(c("muted", "\u2502"));
      detail.push(c("muted", "\u2502 ") + priColor(sel.priority) + c("muted", "  " + stColor(sel.status)));
      if (sel.bootstrap) detail.push(c("muted", "\u2502 ") + c("muted", "bootstrap task"));
      if (sel.prdPath) detail.push(c("muted", "\u2502 ") + c("muted", sel.prdPath));
      detail.push(c("muted", "\u2502 ") + c("muted", ".emb-agent/tasks/" + sel.name + "/task.json"));
      detail.push(c("muted", "\u2514" + "\u2500".repeat(Math.min(detailW - 2, 30))));
    }

    // Rows
    const maxRows = Math.max(this.items.length, detail.length);
    for (let i = 0; i < maxRows; i++) {
      const item = this.items[i];
      let left = "";
      if (item) {
        const isSel = i === this.selected;
        const cur = isSel ? c("accent", "\u25B6 ") : "  ";
        const name = clip(item.name, 24);
        const namePad = pad(Math.max(1, 26 - visibleLen(name)));
        const pc = priColor(item.priority);
        left = cur + (isSel ? c("accent", name) : name) + namePad + " " + pc;
      }
      const leftPad = pad(Math.max(0, listW - visibleLen(left)));
      const right = detail[i] || "";
      lines.push(left + leftPad + "  " + c("muted", "\u2502") + "  " + clip(right, detailW));
    }

    // Footer
    const cnt = (this.selected + 1) + "/" + this.items.length;
    lines.push(c("muted", "\u2500".repeat(w)));
    lines.push("  Enter=activate  Esc=cancel  " + cnt);

    return lines;
  }

  handleInput(data: string): void {
    if (data === "\x1b[A") {
      this.selected = this.selected === 0 ? this.items.length - 1 : this.selected - 1;
    } else if (data === "\x1b[B") {
      this.selected = this.selected === this.items.length - 1 ? 0 : this.selected + 1;
    } else if (data === "\r" || data === "\n") {
      this.onSelect(this.items[this.selected]);
    } else if (data === "\x1b" || data.startsWith("\x1b") && !data.startsWith("\x1b[")) {
      this.onCancel();
    }
  }

  invalidate(): void {}
}

function priColor(p: string | undefined): string {
  const v = "[" + (p || "-") + "]";
  if (p === "P0") return c("error", v);
  if (p === "P1") return c("warning", v);
  return c("muted", v);
}

function stColor(s: string | undefined): string {
  const v = s || "planning";
  if (v === "in_progress") return c("success", v);
  if (v === "review") return c("warning", v);
  if (v === "completed") return c("accent", v);
  if (v === "rejected") return c("error", v);
  return c("muted", v);
}
// ---------------------------------------------------------------------------
// Questionnaire — structured ask-user-questions TUI
// ---------------------------------------------------------------------------

interface QuestionDef {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

interface QuestionnaireResult {
  answers: { question: string; selected: string[] }[];
  cancelled: boolean;
}

class Questionnaire {
  questions: QuestionDef[];
  qIndex = 0;
  selected = 0;
  answers: Map<number, number[]> = new Map();
  done: (r: QuestionnaireResult) => void;

  constructor(questions: QuestionDef[], done: (r: QuestionnaireResult) => void) {
    this.questions = questions;
    this.done = done;
  }

  render(width: number): string[] {
    const w = Math.max(50, width);
    const lines: string[] = [];
    const q = this.questions[this.qIndex];
    if (!q) return lines;

    const idx = "[" + (this.qIndex + 1) + "/" + this.questions.length + "]";
    const header = q.header || q.question;

    const title = " " + idx + " Question ";
    lines.push(c("accent", "\u256D\u2500\u2500") + c("accent", title) + c("muted", "\u2500".repeat(Math.max(1, w - visibleLen(title) - 6))));
    lines.push(c("accent", "\u2502 ") + header);
    lines.push(c("muted", "\u2502 ") + c("muted", "\u2500".repeat(Math.max(0, w - 4))));

    const currentAnswers = this.answers.get(this.qIndex) || [];
    const multi = q.multiSelect || false;
    for (let i = 0; i < q.options.length; i++) {
      const opt = q.options[i];
      const isSel = i === this.selected;
      const isChecked = currentAnswers.includes(i);
      const marker = multi
        ? (isChecked ? c("success", "[x]") : c("muted", "[ ]"))
        : (isSel ? c("accent", "\u25B6") : " ");
      const prefix = marker + " ";
      const label = isSel ? c("accent", opt.label) : opt.label;
      const desc = opt.description ? c("muted", " \u2014 " + opt.description) : "";
      lines.push(c("muted", "\u2502 ") + prefix + label + desc);
    }

    lines.push(c("muted", "\u2502 " + "\u2500".repeat(Math.max(0, w - 4))));
    const hint = multi ? "Space=toggle  Tab=next  Esc=cancel" : "Enter=select  Tab=skip  Esc=cancel";
    lines.push(c("muted", "\u2502 ") + c("dim", hint));
    lines.push(c("muted", "\u2570" + "\u2500".repeat(w - 2)));

    return lines;
  }

  handleInput(data: string): void {
    const q = this.questions[this.qIndex];
    if (!q) return;
    const multi = q.multiSelect || false;

    if (data === "\x1b[A") {
      this.selected = this.selected === 0 ? q.options.length - 1 : this.selected - 1;
    } else if (data === "\x1b[B") {
      this.selected = this.selected === q.options.length - 1 ? 0 : this.selected + 1;
    } else if (data === "\r" || data === "\n") {
      if (multi) {
        this.toggleOption(this.qIndex, this.selected);
      } else {
        this.answers.set(this.qIndex, [this.selected]);
        this.nextOrFinish();
      }
    } else if (data === " ") {
      if (multi) this.toggleOption(this.qIndex, this.selected);
    } else if (data === "\t") {
      this.answers.delete(this.qIndex);
      this.nextOrFinish();
    }
  }

  private toggleOption(qIdx: number, optIdx: number): void {
    const current = this.answers.get(qIdx) || [];
    const pos = current.indexOf(optIdx);
    if (pos >= 0) { current.splice(pos, 1); }
    else { current.push(optIdx); }
    this.answers.set(qIdx, current);
  }

  private nextOrFinish(): void {
    if (this.qIndex < this.questions.length - 1) {
      this.qIndex++;
      this.selected = 0;
    } else {
      const ans: { question: string; selected: string[] }[] = [];
      for (let i = 0; i < this.questions.length; i++) {
        const q = this.questions[i];
        const sel = this.answers.get(i) || [];
        ans.push({
          question: q.question,
          selected: sel.map((j) => q.options[j].label),
        });
      }
      this.done({ answers: ans, cancelled: false });
    }
  }

  invalidate(): void {}
}

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
  agent_protocol?: { gate?: { recommended_command?: string; recommended_agent?: string } };
  open_tasks?: number;
  task_candidates?: Array<{
    name: string;
    title?: string;
    priority?: string;
    status?: string;
  }>;
  project?: { mcu?: string; package?: string; bootstrap?: string; workflow?: string; active_variant?: string };
  tasks?: { open?: number; wiki_pages?: number; active?: string | null };
}

async function runEmbAgent(
  args: string[],
  cwd: string,
): Promise<EmbAgentResult | null> {
  const binPath = join(cwd, ".omp", "emb-agent", "bin", "emb-agent.cjs");
  if (!(await Bun.file(binPath).exists())) return null;
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
  if (command.startsWith("/emb:")) return "/emb-" + command.slice("/emb:".length);
  if (command.startsWith("/")) return command;
  const normalized = command.replace(/^emb-agent\s+/, "").replace(/^emb:/, "").replace(/\s+--brief$/, "").trim();
  return normalized ? "/emb-" + normalized : "";
}

function formatRecommendedReason(r: EmbAgentResult): string {
  return String(r.next?.reason || r.reason || "").trim();
}

function formatEmbStatus(r: EmbAgentResult): string {
  const parts: string[] = [];
  if (r.project?.active_variant) parts.push("var:" + r.project.active_variant);
  if (r.project?.mcu) {
    const pkg = r.project.package ? "/" + r.project.package : "";
    parts.push(r.project.mcu + pkg);
  }
  if (r.tasks?.wiki_pages) parts.push("wiki:" + r.tasks.wiki_pages);
  if (r.tasks?.open) parts.push("tasks:" + r.tasks.open);
  if (r.tasks?.active) parts.push("▸" + r.tasks.active);
  const command = formatRecommendedCommand(r);
  if (command) parts.push(command);
  return parts.length > 0 ? "emb: " + parts.join(" · ") : "";
}

function renderNextLines(result: EmbAgentResult): string[] {
  const lines: string[] = [];
  if (result.summary) lines.push("Project: " + result.summary);
  const command = formatRecommendedCommand(result);
  if (command) {
    lines.push("Next command: " + command);
    const reason = formatRecommendedReason(result);
    if (reason) lines.push("  " + reason);
  }
  if (result.agent_protocol?.gate?.recommended_agent) {
    lines.push("Recommended agent: " + result.agent_protocol.gate.recommended_agent);
  }
  if (result.reason) lines.push("State: " + result.reason);
  if (result.action) lines.push("Action: " + result.action);
  if (result.instructions) lines.push("\n" + result.instructions);
  if (result.task_candidates?.length) {
    lines.push("Tasks:");
    for (const t of result.task_candidates) {
      lines.push("  - " + t.name + " [" + (t.priority || "-") + "] " + (t.title || t.name) + " (" + (t.status || "-") + ")");
    }
  }
  return lines;
}


// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  async function onSessionEnter(ctx: {
    cwd: string;
    ui: { setWidget: (k: string, c: string[], o?: Record<string, unknown>) => void };
  }) {
    const [statusResult, nextResult] = await Promise.all([
      runEmbAgent(["status", "--brief"], ctx.cwd),
      runEmbAgent(["next", "--brief"], ctx.cwd),
    ]);
    if (statusResult) {
      const text = formatEmbStatus(statusResult);
      ctx.ui.setWidget("emb-agent", text ? [text] : [], { placement: "belowEditor" });
    }
    if (!nextResult) return;
    const lines = renderNextLines(nextResult);
    if (lines.length > 0) {
      await pi.sendMessage(
        {
          role: "user",
          content: [{ type: "text", text: "[emb-agent]\n" + lines.join("\n") + "\n\nAct on the above." }],
        },
        { deliverAs: "nextTurn" },
      );
    }
  }


  async function promptAgent(text: string) {
    await pi.sendMessage(
      {
        role: "user",
        content: [{ type: "text", text }],
      },
      { deliverAs: "steer", triggerTurn: true },
    );
  }

  pi.on("session_start", async (_event: unknown, ctx: { cwd: string; ui: { setWidget: (k: string, c: string[], o?: Record<string, unknown>) => void } }) => {
    await onSessionEnter(ctx);
  });
  pi.on("turn_end", async (_event: unknown, ctx: { cwd: string; ui: { setWidget: (k: string, c: string[], o?: Record<string, unknown>) => void } }) => {
    await onSessionEnter(ctx);
  });

  // ── Slash commands ──────────────────────────────────────────────

  async function handleNextCommand(_args: string, ctx: { cwd: string; ui: { notify: (m: string, t?: string) => void; custom: <T>(f: Function, o?: Record<string, unknown>) => Promise<T> } }) {
    const result = await runEmbAgent(["next", "--brief"], ctx.cwd);
    if (!result) {
      ctx.ui.notify("emb-agent not found or not initialized", "warning");
      return;
    }
    const tasks = result.task_candidates;
    if (!tasks?.length) {
      const lines = renderNextLines(result);
      await promptAgent("[/emb-next]\n" + (lines.length ? lines.join("\n") : JSON.stringify(result, null, 2)) + "\n\nAct on the above.");
      return;
    }

    const taskName = await ctx.ui.custom<string | undefined>(
      (_tui: unknown, _theme: unknown, keybindings: { matches: (d: string, n: string) => boolean }, done: (v: string | undefined) => void) => {
        const picker = new TaskPicker(
          tasks.map((t) => ({
            name: t.name,
            priority: t.priority,
            title: t.title,
            status: t.status,
            bootstrap: t.name.startsWith("00-"),
            prdPath: "docs/prd/tasks/" + t.name + ".md",
          })),
          (item) => done(item.name),
          () => done(undefined),
        );
        return {
          render: (w: number) => picker.render(w),
          handleInput: (data: string) => {
            if (data === "\x1b" || keybindings.matches(data, "interrupt") || keybindings.matches(data, "tui.select.cancel")) { done(undefined); return; }
            picker.handleInput(data);
          },
          invalidate: () => picker.invalidate(),
        };
      },
    );

    if (!taskName) return;
    const r = await runEmbAgent(["task", "activate", taskName], ctx.cwd);
    const title = tasks.find((t) => t.name === taskName)?.title || taskName;
    await promptAgent(
      (r
        ? "Activated: " + taskName + " — " + title + ". Confirm and suggest next step."
        : "Activation failed: " + taskName + ".")
    );
  }

  pi.registerCommand("emb-next", {
    description: "Show task candidates or the recommended next command",
    handler: handleNextCommand,
  });

  async function handleOnboardCommand(_args: string, ctx: { cwd: string; ui: { notify: (m: string, t?: string) => void } }) {
    const result = await runEmbAgent(["onboard"], ctx.cwd);
    if (!result) {
      ctx.ui.notify("emb-agent onboard failed or not initialized", "warning");
      return;
    }
    const lines = renderNextLines(result);
    await promptAgent("[/emb-onboard]\n" + (lines.length ? lines.join("\n") : JSON.stringify(result, null, 2)) + "\n\nAct on the above.");
  }

  pi.registerCommand("emb-onboard", {
    description: "Run emb-agent onboarding handoff",
    handler: handleOnboardCommand,
  });

  // ── Tool: ask_user_question ────────────────────────────────────

  pi.registerTool({
    name: "ask_user_question",
    label: "Ask User Question",
    description: "Ask the user structured questions. Use when requirements are ambiguous and you need concrete decisions before proceeding. Each question has a label and options. Supports multi-select.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string", description: "The question text" },
              header: { type: "string", description: "Optional short header" },
              multiSelect: { type: "boolean", description: "Allow multiple selection" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", description: "Option label (1-5 words)" },
                    description: { type: "string", description: "What this choice means / trade-offs" },
                  },
                  required: ["label"],
                },
              },
            },
            required: ["question", "options"],
          },
        },
      },
      required: ["questions"],
    } as Record<string, unknown>,
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      _signal: unknown,
      _onUpdate: unknown,
      ctx: { cwd: string; hasUI: boolean; ui: { notify: (m: string, t?: string) => void; custom: <T>(f: Function) => Promise<T> } },
    ) {
      if (!ctx.hasUI) return "Error: UI not available";
      const questions = (params.questions as QuestionDef[]) || [];
      if (!questions.length) return "Error: no questions provided";

      const result = await ctx.ui.custom<QuestionnaireResult | undefined>(
        (_tui: unknown, _theme: unknown, keybindings: { matches: (d: string, n: string) => boolean }, done: (v: QuestionnaireResult | undefined) => void) => {
          const q = new Questionnaire(questions, (r) => done(r));
          return {
            render: (w: number) => q.render(w),
            handleInput: (data: string) => {
              if (data === "\x1b" || keybindings.matches(data, "interrupt") || keybindings.matches(data, "tui.select.cancel")) {
                done({ answers: [], cancelled: true });
                return;
              }
              q.handleInput(data);
            },
            invalidate: () => q.invalidate(),
          };
        },
      );

      if (!result || result.cancelled) return "Cancelled by user";
      return JSON.stringify(result);
    },
  });
}
