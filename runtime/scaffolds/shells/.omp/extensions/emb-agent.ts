/**
 * emb-agent OMP extension
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

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

interface QuestionOption {
  label: string;
  description?: string;
}

interface QuestionDef {
  question: string;
  header?: string;
  multiSelect?: boolean;
  allowCustom?: boolean;
  options: QuestionOption[];
}

interface QuestionnaireAnswer {
  question: string;
  selected: string[];
  custom?: string[];
}

interface QuestionnaireResult {
  answers: QuestionnaireAnswer[];
  cancelled: boolean;
}

class Questionnaire {
  questions: QuestionDef[];
  qIndex = 0;
  selected = 0;
  answers: Map<number, number[]> = new Map();
  customAnswers: Map<number, string> = new Map();
  inputMode = false;
  inputBuffer = "";
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

    const title = " Question " + (this.qIndex + 1) + "/" + this.questions.length + " ";
    const header = q.header || q.question;
    lines.push(c("accent", "\u256D\u2500\u2500") + c("accent", title) + c("muted", "\u2500".repeat(Math.max(1, w - visibleLen(title) - 6))));
    const tabLines = this.renderTabs(w);
    for (const line of tabLines) lines.push(line);

    lines.push(c("muted", "\u2502 ") + c("muted", "\u2500".repeat(Math.max(0, w - 4))));
    lines.push(c("accent", "\u2502 ") + header);
    if (q.question !== header) lines.push(c("muted", "\u2502 ") + clip(q.question, w - 4));
    lines.push(c("muted", "\u2502 ") + c("muted", "\u2500".repeat(Math.max(0, w - 4))));
    const currentAnswers = this.answers.get(this.qIndex) || [];
    const multi = q.multiSelect || false;
    const count = this.optionCount(q);
    for (let i = 0; i < count; i++) {
      const opt = q.options[i];
      const isSel = i === this.selected;
      const isChecked = currentAnswers.includes(i);
      const marker = multi
        ? (isChecked ? c("success", "[x]") : c("muted", "[ ]"))
        : (isChecked ? c("success", "\u25CF") : (isSel ? c("accent", "\u25CB") : c("muted", "\u25CB")));
      const prefix = marker + " ";
      const label = isSel ? c("accent", opt.label) : opt.label;
      const desc = opt.description ? c("muted", " \u2014 " + opt.description) : "";
      lines.push(c("muted", "\u2502 ") + prefix + label + desc);
    }

    if (this.customAllowed(q)) {
      const customIndex = q.options.length;
      const customChecked = currentAnswers.includes(customIndex);
      const marker = multi
        ? (customChecked ? c("success", "[x]") : c("muted", "[ ]"))
        : (customChecked ? c("success", "\u25CF") : c("muted", "\u25CB"));
      const rawText = this.inputMode ? this.inputBuffer : (this.customAnswers.get(this.qIndex) || "");
      const value = rawText ? rawText + (this.inputMode ? "_" : "") : c("dim", "type your answer if none fit");
      lines.push(c("muted", "\u2502 ") + marker + " " + c("accent", "Your answer: ") + clip(value, Math.max(10, w - 22)));
    }

    lines.push(c("muted", "\u2502 " + "\u2500".repeat(Math.max(0, w - 4))));
    const hint = multi ? "Type below if needed  Space/Enter=toggle  Tab/→=next  Backspace/←=back  Esc=cancel" : "Type below if needed  Space=mark  Enter=confirm  Tab/→=skip  Backspace/←=back  Esc=cancel";
    lines.push(c("muted", "\u2502 ") + c("dim", hint));
    lines.push(c("muted", "\u2570" + "\u2500".repeat(w - 2)));

    return lines;
  }

  handleInput(data: string): void {
    const q = this.questions[this.qIndex];
    if (!q) return;
    if (this.inputMode) {
      this.handleCustomInput(data);
      return;
    }

    const multi = q.multiSelect || false;
    if (this.customAllowed(q) && this.beginCustomInputFrom(data)) return;
    const count = this.optionCount(q);

    if (data === "\x1b[A") {
      if (count > 0) this.selected = this.selected === 0 ? count - 1 : this.selected - 1;
    } else if (data === "\x1b[B") {
      if (count > 0) this.selected = this.selected === count - 1 ? 0 : this.selected + 1;
    } else if (data === "\x1b[D") {
      this.previousQuestion();
    } else if (data === "\x1b[C") {
      this.nextQuestion();
    } else if (data === "\r" || data === "\n") {
      if (count === 0) {
        if ((this.answers.get(this.qIndex) || []).includes(q.options.length)) this.nextOrFinish();
      } else if (multi) {
        this.toggleOption(this.qIndex, this.selected);
      } else {
        if (this.answers.get(this.qIndex)?.includes(this.selected)) this.nextOrFinish();
      }
    } else if (data === " ") {
      if (count > 0) {
        if (multi) this.toggleOption(this.qIndex, this.selected);
        else this.answers.set(this.qIndex, [this.selected]);
      }
    } else if (data === "\x7f" || data === "\b" || data === "\x08") {
      this.previousQuestion();
    } else if (data === "\t") {
      if (!multi) this.answers.delete(this.qIndex);
      this.nextOrFinish();
    }
  }

  private renderTabs(width: number): string[] {
    const lines: string[] = [];
    const left = c("accent", "\u2502 ");
    const max = Math.min(this.questions.length, 6);
    const tabs: string[] = [];
    for (let i = 0; i < max; i++) {
      const q = this.questions[i];
      const answered = (this.answers.get(i) || []).length > 0;
      const label = String(i + 1) + ":" + clip(q.header || q.question, 18);
      if (i === this.qIndex) tabs.push(c("accent", "[" + label + "]"));
      else if (answered) tabs.push(c("success", " " + label + " "));
      else tabs.push(c("muted", " " + label + " "));
    }
    if (this.questions.length > max) tabs.push(c("muted", " +" + (this.questions.length - max) + " more"));
    lines.push(left + clip(tabs.join(" "), Math.max(10, width - 4)));
    return lines;
  }

  private customAllowed(q: QuestionDef): boolean {
    return q.allowCustom !== false;
  }

  private optionCount(q: QuestionDef): number {
    return q.options.length;
  }

  private isCustomOption(q: QuestionDef, optIdx: number): boolean {
    return this.customAllowed(q) && optIdx === q.options.length;
  }

  private beginCustomInputFrom(data: string): boolean {
    if (data === " " || data === "\r" || data === "\n" || data === "\t") return false;
    if (data === "\x7f" || data === "\b" || data === "\x08" || data.startsWith("\x1b")) return false;
    let text = "";
    for (const ch of data) {
      if (ch >= " " && ch !== "\x7f") text += ch;
    }
    if (!text) return false;
    this.inputMode = true;
    this.inputBuffer = (this.customAnswers.get(this.qIndex) || "") + text;
    return true;
  }

  private handleCustomInput(data: string): void {
    if (data === "\x1b") {
      this.inputMode = false;
      this.inputBuffer = this.customAnswers.get(this.qIndex) || "";
      return;
    }
    if (data.startsWith("\x1b[")) return;
    if (data === "\r" || data === "\n") {
      this.finishCustomInput();
      return;
    }
    if (data === "\x7f" || data === "\b" || data === "\x08") {
      if (this.inputBuffer.length > 0) this.inputBuffer = this.inputBuffer.slice(0, -1);
      else this.previousQuestion();
      return;
    }
    if (data === "\x15") {
      this.inputBuffer = "";
      return;
    }
    for (const ch of data) {
      if (ch >= " " && ch !== "\x7f") this.inputBuffer += ch;
    }
  }

  private finishCustomInput(): void {
    const text = this.inputBuffer.trim();
    const q = this.questions[this.qIndex];
    if (!q) return;
    const customIndex = q.options.length;
    if (!text) {
      this.customAnswers.delete(this.qIndex);
      const kept = (this.answers.get(this.qIndex) || []).filter((idx) => idx !== customIndex);
      if (kept.length) this.answers.set(this.qIndex, kept);
      else this.answers.delete(this.qIndex);
      this.inputMode = false;
      this.inputBuffer = "";
      return;
    }
    this.customAnswers.set(this.qIndex, text);
    const current = this.answers.get(this.qIndex) || [];
    if (!current.includes(customIndex)) current.push(customIndex);
    this.answers.set(this.qIndex, q.multiSelect ? current : [customIndex]);
    this.inputMode = false;
    this.inputBuffer = "";
    this.nextOrFinish();
  }

  private previousQuestion(): void {
    this.inputMode = false;
    this.inputBuffer = "";
    if (this.qIndex > 0) {
      this.qIndex--;
      this.selected = this.firstSelectedOrZero(this.qIndex);
    }
  }

  private nextQuestion(): void {
    this.inputMode = false;
    this.inputBuffer = "";
    if (this.qIndex < this.questions.length - 1) {
      this.qIndex++;
      this.selected = this.firstSelectedOrZero(this.qIndex);
    }
  }

  private firstSelectedOrZero(qIdx: number): number {
    const q = this.questions[qIdx];
    if (!q) return 0;
    const first = this.answers.get(qIdx)?.[0] ?? 0;
    const count = this.optionCount(q);
    return first >= 0 && first < count ? first : 0;
  }

  private toggleOption(qIdx: number, optIdx: number): void {
    const current = this.answers.get(qIdx) || [];
    const pos = current.indexOf(optIdx);
    if (pos >= 0) { current.splice(pos, 1); }
    else { current.push(optIdx); }
    this.answers.set(qIdx, current);
  }

  private nextOrFinish(): void {
    this.inputMode = false;
    this.inputBuffer = "";
    if (this.qIndex < this.questions.length - 1) {
      this.nextQuestion();
    } else {
      const ans: QuestionnaireAnswer[] = [];
      for (let i = 0; i < this.questions.length; i++) {
        const q = this.questions[i];
        const sel = this.answers.get(i) || [];
        const selected: string[] = [];
        const custom: string[] = [];
        for (const j of sel) {
          if (this.isCustomOption(q, j)) {
            const text = (this.customAnswers.get(i) || "").trim();
            if (text) {
              selected.push(text);
              custom.push(text);
            }
          } else if (q.options[j]) {
            selected.push(q.options[j].label);
          }
        }
        const answer: QuestionnaireAnswer = { question: q.question, selected };
        if (custom.length) answer.custom = custom;
        ans.push(answer);
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
  language?: string;
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
  if (isDeclaredChip(r.project?.mcu)) {
    const pkg = isDeclaredChip(r.project?.package) ? "/" + r.project!.package : "";
    parts.push(String(r.project!.mcu) + pkg);
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


  async function promptAgent(text: string, cwd?: string) {
    const directive = cwd ? languageDirective(await readProjectLanguage(cwd)) : "";
    await pi.sendMessage(
      {
        role: "user",
        content: [{ type: "text", text: directive ? text + "\n\n" + directive : text }],
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
      await promptAgent("[/emb-next]\n" + (lines.length ? lines.join("\n") : JSON.stringify(result, null, 2)) + "\n\nAct on the above.", ctx.cwd);
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
        : "Activation failed: " + taskName + "."),
      ctx.cwd,
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
    await promptAgent("[/emb-onboard]\n" + (lines.length ? lines.join("\n") : JSON.stringify(result, null, 2)) + "\n\nAct on the above.", ctx.cwd);
  }

  pi.registerCommand("emb-onboard", {
    description: "Run emb-agent onboarding handoff",
    handler: handleOnboardCommand,
  });

  function toolTextResult(text: string, details?: unknown) {
    const payload: { content: { type: "text"; text: string }[]; details?: unknown } = {
      content: [{ type: "text", text }],
    };
    if (details !== undefined) payload.details = details;
    return payload;
  }

  // ── Tool: ask_user_question ────────────────────────────────────

  pi.registerTool({
    name: "ask_user_question",
    label: "Ask User Question",
    description: "Ask the user structured questions. Use when requirements are ambiguous and you need concrete decisions before proceeding. Questions show the provided options plus an inline text input under them so users can type their own answer when no option fits. Supports multi-select.",
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
              allowCustom: { type: "boolean", description: "Show an inline text input under the provided options. Defaults to true." },
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
      if (!ctx.hasUI) return toolTextResult("Error: UI not available", { status: "error" });
      const questions = (params.questions as QuestionDef[]) || [];
      if (!questions.length) return toolTextResult("Error: no questions provided", { status: "error" });

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

      if (!result || result.cancelled) return toolTextResult("Cancelled by user", { cancelled: true });
      return toolTextResult(JSON.stringify(result), result);
    },
  });
}
