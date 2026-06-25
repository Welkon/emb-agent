/**
 * emb-agent Pi extension
 *
 * Unified Pi surface for emb-agent: project-state injection, slash commands,
 * Pi-native tools, PDF/document ingest routing, native subagent dispatch, and session insight.
 *
 * Requires: emb-agent installed via `npx emb-agent --target pi`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { accessSync, constants } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const CONTEXT_TTL_MS = 15_000;
const FAST_TIMEOUT_MS = 30_000;
const INGEST_TIMEOUT_MS = 420_000;
const FAST_MAX_BUFFER = 1024 * 1024;
const INGEST_MAX_BUFFER = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Types and helpers
// ---------------------------------------------------------------------------

interface DelegationPolicy {
  applies_when_host_exposes_subagent_tool?: boolean;
  required_before_broad_work?: boolean;
  broad_work_triggers?: string[];
  first_step?: string;
  recommended_roles?: string[];
  prd_exploration_scope?: string;
}

interface EmbAgentResult {
  action?: string;
  status?: string;
  reason?: string;
  summary?: string;
  instructions?: string;
  next?: { command?: string; reason?: string; cli?: string };
  open_tasks?: number;
  agent_protocol?: { gate?: { recommended_command?: string; recommended_agent?: string; kind?: string; delegation_policy?: DelegationPolicy } };
  language?: string;
  task_candidates?: Array<{ name: string; title?: string; status?: string; priority?: string }>;
  prd_task_candidates?: Array<{ name: string; title?: string; status?: string; priority?: string }>;
  local_parse?: { quality?: string; tool?: string; line_count?: number; char_count?: number; status?: string };
  quality_gate?: string;
  recommended_action?: string;
  paths?: Record<string, string>;
  provider?: string;
  parsed?: boolean;
  doc_id?: string;
  update_available?: boolean;
  delegation_policy?: DelegationPolicy;
  installed_version?: string | null;
  latest_version?: string | null;
  manual_update_command?: string;
  project?: { mcu?: string; package?: string; bootstrap?: string; workflow?: string; active_variant?: string };
  tasks?: { open?: number; wiki_pages?: number; active?: string | { name?: string; title?: string } | null };
}

interface RunOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  allowNonJson?: boolean;
}

interface RunOk {
  ok: true;
  value: EmbAgentResult;
  stdout: string;
  binPath: string;
}

interface RunErr {
  ok: false;
  code: "missing_runtime" | "spawn_error" | "exit" | "bad_json";
  message: string;
  stdout?: string;
  stderr?: string;
  binPath?: string;
  candidates?: string[];
}

type RunResult = RunOk | RunErr;

interface ContextEntry {
  text: string;
  result?: EmbAgentResult;
  updatedAt: number;
  dirty: boolean;
}

interface ModelRoute {
  model?: string;
  thinking?: string;
}

interface EmbSubagentProgress {
  kind: "emb-agent-subagent-progress";
  batchId: string;
  mode: "single" | "parallel" | "chain";
  roles: SubagentRunState[];
  final: boolean;
  startedAt: number;
  updatedAt: number;
}

interface SubagentRunState {
  id: string;
  role: string;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  task: string;
  model?: string;
  thinking?: string;
  startedAt?: number;
  finishedAt?: number;
  tools: Array<{ id: string; name: string; args?: string; status: "running" | "succeeded" | "failed" }>;
  textTail: string;
  thinkingTail: string;
  stderrTail: string;
  finalText: string;
  errorMessage?: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; turns: number; ctxTokens: number; ctxLimit: number; ctxRemaining: number };
  usageMessageIds: string[];
  attempt: number;
  attemptsMax: number;
  routeHistory: string[];
}

interface KnowledgePrimingState {
  tool: string;
  query: string;
  createdAt: number;
}

interface EmbSubagentResult {
  role: string;
  status: string;
  output: string;
  model?: string;
  thinking?: string;
  error?: string;
}

type DispatchPhase = "prd-exploration" | "prd-breakdown" | "work-selection" | "task-execution" | "verification" | "debug" | "general";
type DispatchIntent = "evidence" | "implementation" | "architecture" | "system-review" | "debug" | "verification";

interface SubagentDispatchRun {
  role: string;
  intent: DispatchIntent;
  writable: boolean;
  targetTask?: string;
  prompt: string;
}

interface SubagentDispatchPlan {
  phase: DispatchPhase;
  targetTask?: string;
  mode: "single" | "parallel" | "chain";
  reason: string;
  runs: SubagentDispatchRun[];
}

interface AutoDispatchResult {
  attempted: boolean;
  batchId?: string;
  roles: string[];
  errors: string[];
}

interface DispatchGuard {
  until: number;
  reason: string;
  phase: "waiting" | "results-injected";
}

interface NativeDispatchBatch {
  cwd: string;
  prompt: string;
  result: EmbAgentResult;
  progress: EmbSubagentProgress;
  finalSent: boolean;
}

interface SessionSearchHit {
  id: string;
  platform: "pi" | "codex";
  path: string;
  updatedAt: number;
  preview: string;
  score: number;
}

function toolTextResult(text: string, details?: unknown) {
  const payload: { content: { type: "text"; text: string }[]; details?: unknown } = {
    content: [{ type: "text", text }],
  };
  if (details !== undefined) payload.details = details;
  return payload;
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

async function fileExists(path: string): Promise<boolean> {
  try { await access(path, constants.R_OK); return true; }
  catch { return false; }
}

async function resolveEmbAgentBin(cwd: string): Promise<{ binPath: string; candidates: string[] } | null> {
  const candidates = [
    join(cwd, ".pi", "emb-agent", "bin", "emb-agent.cjs"),
    join(cwd, ".pi", "agent", "emb-agent", "bin", "emb-agent.cjs"),
    join(EXTENSION_DIR, "..", "emb-agent", "bin", "emb-agent.cjs"),
  ];
  const piHome = process.env.PI_CODING_AGENT_DIR;
  if (piHome) candidates.push(join(piHome, "emb-agent", "bin", "emb-agent.cjs"));
  candidates.push(join(process.env.HOME || "", ".pi", "agent", "emb-agent", "bin", "emb-agent.cjs"));

  for (const binPath of candidates) {
    if (binPath && await fileExists(binPath)) return { binPath, candidates };
  }
  return null;
}

async function runEmbAgent(args: string[], cwd: string, options: RunOptions = {}): Promise<RunResult> {
  const resolved = await resolveEmbAgentBin(cwd);
  if (!resolved) {
    return {
      ok: false,
      code: "missing_runtime",
      message: "emb-agent runtime not found. Reinstall with `npx emb-agent@latest --target pi --local` or restart Pi after install.",
      candidates: [
        join(cwd, ".pi", "emb-agent", "bin", "emb-agent.cjs"),
        join(cwd, ".pi", "agent", "emb-agent", "bin", "emb-agent.cjs"),
        join(EXTENSION_DIR, "..", "emb-agent", "bin", "emb-agent.cjs"),
        process.env.PI_CODING_AGENT_DIR ? join(process.env.PI_CODING_AGENT_DIR, "emb-agent", "bin", "emb-agent.cjs") : "",
      ].filter(Boolean),
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync("node", [resolved.binPath, ...args], {
      cwd,
      encoding: "utf8",
      timeout: options.timeoutMs ?? FAST_TIMEOUT_MS,
      maxBuffer: options.maxBuffer ?? FAST_MAX_BUFFER,
    });
    const trimmed = stdout.trim();
    if (options.allowNonJson) {
      return { ok: true, value: { status: "ok", summary: trimmed }, stdout, binPath: resolved.binPath };
    }
    if (!trimmed) return { ok: true, value: { status: "ok" }, stdout, binPath: resolved.binPath };
    try {
      return { ok: true, value: JSON.parse(trimmed), stdout, binPath: resolved.binPath };
    } catch (error: any) {
      return { ok: false, code: "bad_json", message: `emb-agent returned non-JSON output: ${error.message}`, stdout, stderr, binPath: resolved.binPath };
    }
  } catch (error: any) {
    return {
      ok: false,
      code: error?.killed || error?.signal === "SIGTERM" ? "spawn_error" : "exit",
      message: error?.message || "emb-agent command failed",
      stdout: error?.stdout,
      stderr: error?.stderr,
      binPath: resolved.binPath,
    };
  }
}

function errorText(result: RunErr): string {
  const pieces = [`emb-agent error (${result.code}): ${result.message}`];
  if (result.stderr?.trim()) pieces.push(result.stderr.trim());
  if (result.candidates?.length) pieces.push(`Checked: ${result.candidates.join(", ")}`);
  return pieces.join("\n");
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
    return String(item.name || item.title || "").trim();
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
  if (name === "ingest" || name === "ingest-docs") return "/emb-ingest";
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
    lines: [`Runtime update available: ${installed} → ${available}`, `Manual update: ${command}`],
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
  if (result.agent_protocol?.gate?.kind) lines.push(`Gate: ${result.agent_protocol.gate.kind}`);
  if (result.agent_protocol?.gate?.recommended_agent) lines.push(`Recommended agent: ${result.agent_protocol.gate.recommended_agent}`);
  if (result.reason) lines.push(`State: ${result.reason}`);
  if (result.action) lines.push(`Action: ${result.action}`);
  if (result.instructions) lines.push(`\n${result.instructions}`);
  const taskNames = (result.task_candidates || result.prd_task_candidates || []).map((t) => t.name);
  if (taskNames.length) lines.push(`Tasks: ${taskNames.join(", ")}`);
  return lines;
}

function renderIngestLines(result: EmbAgentResult): string[] {
  const lines = [
    `Status: ${result.status || "unknown"}`,
    `Provider: ${result.provider || "unknown"}`,
    `Parsed: ${result.parsed === false ? "false" : "true"}`,
  ];
  if (result.doc_id) lines.push(`Doc ID: ${result.doc_id}`);
  if (result.local_parse) {
    const q = result.local_parse.quality || result.local_parse.status || "unknown";
    lines.push(`Local parse: ${result.local_parse.tool || "n/a"}, quality=${q}, lines=${result.local_parse.line_count ?? "?"}`);
  }
  if (result.quality_gate) lines.push(`Quality gate: ${result.quality_gate}`);
  if (result.paths?.markdown) lines.push(`Markdown: ${result.paths.markdown}`);
  if (result.paths?.metadata) lines.push(`Metadata: ${result.paths.metadata}`);
  if (result.parsed_path) lines.push(`Parsed schematic: ${result.parsed_path}`);
  if (result.visual_netlist_path) lines.push(`Visual netlist: ${result.visual_netlist_path}`);
  if (result.schematic_advice_path) lines.push(`Schematic advice: ${result.schematic_advice_path}`);
  if (result.preview_path) lines.push(`Preview: ${result.preview_path}`);
  if (result.parser_mode) lines.push(`Parser: ${result.parser_mode}`);
  if (result.recommended_action) lines.push(`Recommended action: ${result.recommended_action}`);
  if (result.next) lines.push(`Next: ${String(result.next)}`);
  return lines;
}

function yamlScalar(value: unknown): string {
  return JSON.stringify(String(value ?? ""));
}

function formatEmbStatus(r: EmbAgentResult, update?: EmbAgentResult | null): string {
  const parts: string[] = [];
  const notice = updateNotice(update || null);
  if (notice.label) parts.push(notice.label);
  if (r.project?.active_variant) parts.push(`var:${r.project.active_variant}`);
  if (isDeclaredChip(r.project?.mcu)) {
    const pkg = isDeclaredChip(r.project?.package) ? `/${r.project!.package}` : "";
    parts.push(`${r.project!.mcu}${pkg}`);
  }
  if (r.tasks?.wiki_pages) parts.push(`wiki:${r.tasks.wiki_pages}`);
  if (r.tasks?.open) parts.push(`tasks:${r.tasks.open}`);
  const activeTask = formatActiveTask(r.tasks?.active);
  if (activeTask) parts.push(`▸${activeTask}`);
  const command = formatRecommendedCommand(r);
  if (command) parts.push(command);
  return parts.length > 0 ? `emb: ${parts.join(" · ")}` : "";
}

// ---------------------------------------------------------------------------
// Native emb-agent subagent dispatch and session insight
// ---------------------------------------------------------------------------

const READ_ONLY_AGENT_NAMES = new Set(["hw-scout", "bug-hunter", "arch-reviewer", "sys-reviewer", "release-checker"]);
const WRITE_CAPABLE_AGENTS = new Set(["fw-doer", "onboard"]);
const SUPPORTED_AGENT_NAMES = new Set([...READ_ONLY_AGENT_NAMES, ...WRITE_CAPABLE_AGENTS]);
const PARENT_TOOL_BLOCK_AFTER_DISPATCH_MS = 180_000;
const RAW_SUBAGENT_OUTPUT_GUARD_MS = 60_000;
const PARENT_MUTATION_TOOLS = new Set(["write", "edit"]);
const EMB_AUTO_DISPATCH_MARKER = "[emb-agent:native-subagent-dispatch-active]";
const EMB_HIDDEN_RESULTS_MARKER = "[emb-agent:hidden-subagent-results]";
const EMB_CHILD_ENV = "EMB_AGENT_SUBAGENT_CHILD";
const MAX_SUBAGENT_OUTPUT = 50_000;
const MAX_TAIL = 4_000;
const MAX_SESSION_BYTES = 2 * 1024 * 1024;
const SUBAGENT_MODEL_RETRIES = 3;
const TUI_HEARTBEAT_MS = 200;
const KNOWLEDGE_PRIMING_TTL_MS = 10 * 60_000;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const INHERIT_MODEL_ROUTES: Record<string, ModelRoute> = {
  "hw-scout": { model: "inherit" },
  "release-checker": { model: "inherit" },
  "arch-reviewer": { model: "inherit" },
  "bug-hunter": { model: "inherit" },
  "sys-reviewer": { model: "inherit" },
  "fw-doer": { model: "inherit" },
  "onboard": { model: "inherit" },
};

const LEGACY_AUTO_AGENT_MODEL_ROUTES: Record<string, ModelRoute> = {
  "hw-scout": { model: "deepseek/deepseek-v4-flash", thinking: "off" },
  "release-checker": { model: "deepseek/deepseek-v4-flash", thinking: "off" },
  "arch-reviewer": { model: "deepseek/deepseek-v4-pro", thinking: "high" },
  "bug-hunter": { model: "deepseek/deepseek-v4-pro", thinking: "high" },
  "sys-reviewer": { model: "deepseek/deepseek-v4-pro", thinking: "high" },
  "fw-doer": { model: "custom/gpt-5.5", thinking: "xhigh" },
  "onboard": { model: "custom/gpt-5.5", thinking: "xhigh" },
};

const DEFAULT_AUTO_AGENT_MODEL_ROUTES: Record<string, ModelRoute> = INHERIT_MODEL_ROUTES;

async function syncEmbAgentsToPi(cwd: string) {
  const candidates = [
    join(cwd, ".pi", "emb-agent", "agents"),
    join(cwd, ".emb-agent", "agents"),
    join(cwd, "agents"),
  ];
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
    await writeFile(join(piAgentsDir, file), content, "utf-8");
  }
}

async function readPiSettings(cwd: string): Promise<Record<string, unknown>> {
  try { return JSON.parse(await readFile(join(cwd, ".pi", "settings.json"), "utf-8")); }
  catch { return {}; }
}

function normalizeModelRoute(value: unknown): ModelRoute | null {
  if (typeof value === "string") return value.trim() ? { model: value.trim() } : null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const route: ModelRoute = {};
  if (typeof raw.model === "string" && raw.model.trim()) route.model = raw.model.trim();
  if (typeof raw.thinking === "string" && raw.thinking.trim()) route.thinking = raw.thinking.trim();
  return route.model || route.thinking ? route : null;
}

function sameModelRoute(left: unknown, right: unknown): boolean {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function stripLegacyGeneratedModelRouteEntries(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const routes = { ...(value as Record<string, unknown>) };
  for (const [name, legacy] of Object.entries(LEGACY_AUTO_AGENT_MODEL_ROUTES)) {
    if (WRITE_CAPABLE_AGENTS.has(name)) continue;
    if (sameModelRoute(routes[name], legacy)) delete routes[name];
  }
  return routes;
}

function isLegacyGeneratedModelRoutes(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(stripLegacyGeneratedModelRouteEntries(value)).length === 0);
}

function configuredModelRoutes(settings: Record<string, unknown>): Record<string, ModelRoute> {
  const routes: Record<string, ModelRoute> = { ...DEFAULT_AUTO_AGENT_MODEL_ROUTES };
  const embAgent = settings.embAgent && typeof settings.embAgent === "object" && !Array.isArray(settings.embAgent)
    ? settings.embAgent as Record<string, unknown>
    : {};
  const rawRoutes = embAgent.subagentModelRoutes;
  const userRoutes = rawRoutes && typeof rawRoutes === "object" && !Array.isArray(rawRoutes)
    ? rawRoutes as Record<string, unknown>
    : {};
  for (const [name, value] of Object.entries(userRoutes)) {
    const normalized = normalizeModelRoute(value);
    if (normalized) routes[name] = normalized;
    else if (value === null || value === false || value === "inherit") routes[name] = { model: "inherit" };
  }
  return routes;
}

async function loadModelRoutes(cwd: string): Promise<Record<string, ModelRoute>> {
  return configuredModelRoutes(await readPiSettings(cwd));
}

async function ensureSubagentSettings(cwd: string) {
  const settingsPath = join(cwd, ".pi", "settings.json");
  let settings: Record<string, unknown> = {};
  let changed = false;
  try { settings = JSON.parse(await readFile(settingsPath, "utf-8")); }
  catch { settings = {}; changed = true; }

  if (Array.isArray(settings.packages)) {
    const legacyPackages = ["npm:pi-subagents", "npm:" + "@tintinweb/pi-subagents"];
    const filtered = settings.packages.filter((pkg) => !legacyPackages.includes(String(pkg)));
    if (JSON.stringify(filtered) !== JSON.stringify(settings.packages)) { settings.packages = filtered; changed = true; }
  } else if (settings.packages === undefined) {
    settings.packages = [];
    changed = true;
  }

  if (settings.subagents && typeof settings.subagents === "object" && !Array.isArray(settings.subagents)) {
    delete settings.subagents;
    changed = true;
  }

  if (!settings.embAgent || typeof settings.embAgent !== "object" || Array.isArray(settings.embAgent)) {
    settings.embAgent = {};
    changed = true;
  }
  const embAgent = settings.embAgent as Record<string, unknown>;
  if (!embAgent.subagentModelRoutes || typeof embAgent.subagentModelRoutes !== "object" || Array.isArray(embAgent.subagentModelRoutes)) {
    embAgent.subagentModelRoutes = DEFAULT_AUTO_AGENT_MODEL_ROUTES;
    changed = true;
  } else {
    const mergedRoutes = { ...DEFAULT_AUTO_AGENT_MODEL_ROUTES, ...(embAgent.subagentModelRoutes as Record<string, unknown>) };
    if (JSON.stringify(embAgent.subagentModelRoutes) !== JSON.stringify(mergedRoutes)) {
      embAgent.subagentModelRoutes = mergedRoutes;
      changed = true;
    }
  }
  if (!embAgent.subagents || typeof embAgent.subagents !== "object" || Array.isArray(embAgent.subagents)) {
    embAgent.subagents = {
      dispatchMode: "auto",
      runner: "native-pi",
      maxParallel: 3,
      resultVisibility: "hidden-summary",
      rawResultGuardMs: RAW_SUBAGENT_OUTPUT_GUARD_MS,
    };
    changed = true;
  }

  if (changed) {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  }
}

function isWorkSelection(result: EmbAgentResult): boolean {
  const gate = String(result.agent_protocol?.gate?.kind || "").toLowerCase();
  const action = String(result.action || "").toLowerCase();
  return gate.includes("work-selection") || action === "choose-work";
}

function isPrdExploration(result: EmbAgentResult): boolean {
  const gate = String(result.agent_protocol?.gate?.kind || "").toLowerCase();
  const action = String(result.action || "").toLowerCase();
  return gate.includes("prd") || action === "clarify" || action === "prd-exploration";
}

function subagentDispatchEnabled(result: EmbAgentResult, settings: Record<string, unknown>): boolean {
  const embAgent = settings.embAgent && typeof settings.embAgent === "object" && !Array.isArray(settings.embAgent) ? settings.embAgent as Record<string, unknown> : {};
  const subagents = embAgent.subagents && typeof embAgent.subagents === "object" && !Array.isArray(embAgent.subagents) ? embAgent.subagents as Record<string, unknown> : {};
  if (subagents.dispatchMode === "off" || subagents.dispatchMode === "inline") return false;
  const policy = result.delegation_policy || result.agent_protocol?.gate?.delegation_policy;
  return Boolean(policy?.applies_when_host_exposes_subagent_tool && (policy.required_before_broad_work || isPrdExploration(result) || isWorkSelection(result)));
}

function shouldAutoDispatchSubagents(prompt: string, result: EmbAgentResult, settings: Record<string, unknown>): boolean {
  // Backward-compatible helper name: this no longer interprets natural language.
  if (String(prompt || "").includes(EMB_AUTO_DISPATCH_MARKER)) return false;
  return subagentDispatchEnabled(result, settings);
}

function candidateTasks(result: EmbAgentResult): Array<{ name: string; title?: string; status?: string; priority?: string; order: number }> {
  return [...(result.task_candidates || []), ...(result.prd_task_candidates || [])]
    .map((task, order) => ({ ...task, order }))
    .filter((task, index, all) => task?.name && all.findIndex((item) => item.name === task.name) === index);
}

function priorityRank(priority?: string): number {
  const match = String(priority || "").match(/p(\d+)/i);
  return match ? Number(match[1]) : 99;
}

function numericTaskPrefix(name: string): number {
  const match = String(name || "").match(/^(\d+)/);
  return match ? Number(match[1]) : 999;
}

function statusRank(status?: string): number {
  const text = String(status || "").toLowerCase();
  if (/blocked|waiting|hold/.test(text)) return 50;
  if (/closed|done|resolved/.test(text)) return 100;
  return 0;
}

function taskRank(task: { name: string; status?: string; priority?: string; order?: number }): number {
  return statusRank(task.status) * 10_000 + priorityRank(task.priority) * 100 + numericTaskPrefix(task.name);
}

function selectTargetTask(result: EmbAgentResult): string | undefined {
  const tasks = candidateTasks(result).filter((task) => !/closed|done|resolved/i.test(String(task.status || "")));
  if (!tasks.length) return undefined;
  return [...tasks].sort((a, b) => taskRank(a) - taskRank(b) || (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name))[0]?.name;
}

function dispatchPhase(result: EmbAgentResult): DispatchPhase {
  const gate = String(result.agent_protocol?.gate?.kind || "").toLowerCase();
  const action = String(result.action || "").toLowerCase();
  if (gate.includes("prd-exploration") || action === "clarify") return "prd-exploration";
  if (gate.includes("prd-breakdown") || action === "prd-breakdown") return "prd-breakdown";
  if (gate.includes("work-selection") || action === "choose-work") return "work-selection";
  if (gate.includes("task-execution") || action === "do") return "task-execution";
  return "general";
}

function rolePrompt(role: string, intent: DispatchIntent, userPrompt: string, result: EmbAgentResult, targetTask?: string, previousOutput?: string): string {
  const taskLine = targetTask ? `Target task: ${targetTask}` : "Target task: none selected";
  const taskGuard = targetTask
    ? `Stay inside the target task. Read .emb-agent/tasks/${targetTask}/task.json and .emb-agent/tasks/${targetTask}/prd.md first when present. Do not broaden into unrelated tasks.`
    : "Do not invent a task target. If implementation is requested but no target task exists, report the missing selection instead of editing broadly.";
  const previous = previousOutput ? `\n\nPrevious subagent output to use as context:\n${previousOutput.slice(0, MAX_SUBAGENT_OUTPUT)}` : "";
  const directives: Record<string, string> = {
    "hw-scout": "Collect only hardware/manual/schematic evidence needed for the target work. Cite exact cached document paths, registers, pins, nets, config bits, and uncertainty. Do not edit files.",
    "fw-doer": targetTask
      ? "Implement only the target task. You MUST create or edit the required repository files for that target when implementation is requested. Make minimal source edits, preserve project conventions, and stop after the scoped implementation plus local validation evidence. Do not implement downstream dependent tasks unless explicitly targeted."
      : "Implementation was requested but no target task was selected. Do not make broad edits; report the missing target and ask for scope.",
    "arch-reviewer": "Review architecture, ISR/main-loop boundaries, timing, RAM/ROM, scheduler/event-step fit, and vertical-slice boundaries for this target work. Do not edit files.",
    "sys-reviewer": "Review behavior requirements, state-machine consistency, power/sleep/wakeup, WDT/LVD/reset behavior, and acceptance evidence. Do not edit files.",
    "bug-hunter": "Find root cause hypotheses, regression vectors, and minimal reproduction/verification steps for the target bug. Do not edit unless explicitly asked as fw-doer.",
    "release-checker": "Check whether the target task result is ready: changed files, acceptance criteria, validation gaps, rollback/user impact, and next task handoff. Do not edit files.",
  };
  return [
    taskLine,
    `Dispatch intent: ${intent}`,
    taskGuard,
    directives[role] || "Perform the delegated emb-agent task only.",
    "Use emb-agent project truth and cached knowledge. Prefer doc_lookup/doc_fetch over broad scans. Report concise evidence and residual risks.",
    "Original user request:",
    userPrompt,
    previous,
  ].join("\n");
}

function buildDispatchPlan(prompt: string, result: EmbAgentResult): SubagentDispatchPlan {
  const phase = dispatchPhase(result);
  const targetTask = selectTargetTask(result);
  if (phase === "prd-exploration") {
    return {
      phase,
      mode: "parallel",
      reason: "PRD exploration allows read-only evidence scouts/reviewers only.",
      runs: [
        { role: "hw-scout", intent: "evidence", writable: false, prompt: rolePrompt("hw-scout", "evidence", prompt, result) },
        { role: "sys-reviewer", intent: "system-review", writable: false, prompt: rolePrompt("sys-reviewer", "system-review", prompt, result) },
      ],
    };
  }
  if (phase === "prd-breakdown") {
    return {
      phase,
      mode: "parallel",
      reason: "PRD breakdown needs evidence plus architecture/system review before task creation.",
      runs: [
        { role: "hw-scout", intent: "evidence", writable: false, prompt: rolePrompt("hw-scout", "evidence", prompt, result) },
        { role: "arch-reviewer", intent: "architecture", writable: false, prompt: rolePrompt("arch-reviewer", "architecture", prompt, result) },
        { role: "sys-reviewer", intent: "system-review", writable: false, prompt: rolePrompt("sys-reviewer", "system-review", prompt, result) },
      ],
    };
  }
  if (phase === "work-selection" || phase === "task-execution") {
    const runs: SubagentDispatchRun[] = [
      { role: "fw-doer", intent: "implementation", writable: true, targetTask, prompt: rolePrompt("fw-doer", "implementation", prompt, result, targetTask) },
    ];
    return {
      phase,
      targetTask,
      mode: "single",
      reason: targetTask
        ? `Token-efficient implementation dispatch scoped to target task: ${targetTask}. Run hw-scout or release-checker separately only when the parent AI judges fresh evidence/review is needed.`
        : "Implementation request has no selected task; fw-doer must refuse broad edits and ask for scope.",
      runs,
    };
  }
  return {
    phase,
    mode: "parallel",
    reason: "Broad firmware request needs read-only reconnaissance and review before inline work.",
    runs: [
      { role: "hw-scout", intent: "evidence", writable: false, targetTask, prompt: rolePrompt("hw-scout", "evidence", prompt, result, targetTask) },
      { role: "arch-reviewer", intent: "architecture", writable: false, targetTask, prompt: rolePrompt("arch-reviewer", "architecture", prompt, result, targetTask) },
      { role: "sys-reviewer", intent: "system-review", writable: false, targetTask, prompt: rolePrompt("sys-reviewer", "system-review", prompt, result, targetTask) },
    ],
  };
}

function autoDispatchRoles(prompt: string, result: EmbAgentResult): string[] {
  return buildDispatchPlan(prompt, result).runs.map((run) => run.role);
}

function appendTail(current: string, chunk: string, limit = MAX_TAIL): string {
  const next = `${current || ""}${chunk || ""}`;
  return next.length <= limit ? next : next.slice(next.length - limit);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part && typeof part === "object") {
      const raw = part as Record<string, unknown>;
      return String(raw.text || raw.content || raw.thinking || "");
    }
    return "";
  }).filter(Boolean).join("\n");
}

function parseJsonEvent(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const start = trimmed.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function newRunState(role: string, task: string, route?: ModelRoute): SubagentRunState {
  return {
    id: `${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    role,
    status: "pending",
    task,
    model: route?.model && route.model !== "inherit" ? route.model : undefined,
    thinking: route?.thinking,
    tools: [],
    textTail: "",
    thinkingTail: "",
    stderrTail: "",
    finalText: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0, ctxTokens: 0, ctxLimit: 0, ctxRemaining: 0 },
    usageMessageIds: [],
    attempt: 0,
    attemptsMax: route?.model && route.model !== "inherit" ? SUBAGENT_MODEL_RETRIES + 1 : 1,
    routeHistory: [],
  };
}

function addUsage(state: SubagentRunState, usageValue: unknown): boolean {
  if (!usageValue || typeof usageValue !== "object" || Array.isArray(usageValue)) return false;
  const usage = usageValue as Record<string, any>;
  const cost = usage.cost && typeof usage.cost === "object" ? usage.cost as Record<string, any> : {};
  const input = Number(usage.input ?? usage.inputTokens ?? usage.promptTokens ?? 0);
  const output = Number(usage.output ?? usage.outputTokens ?? usage.completionTokens ?? 0);
  const cacheRead = Number(usage.cacheRead ?? usage.cache_read ?? usage.cachedTokens ?? 0);
  const cacheWrite = Number(usage.cacheWrite ?? usage.cache_write ?? 0);
  const totalTokens = Number(usage.totalTokens ?? usage.total_tokens ?? 0);
  const ctxLimit = Number(usage.contextLimit ?? usage.contextWindow ?? usage.maxContextTokens ?? usage.max_context_tokens ?? usage.limit ?? 0);
  const ctxRemaining = Number(usage.contextRemaining ?? usage.remainingTokens ?? usage.remaining_tokens ?? usage.tokensRemaining ?? 0);
  const totalCost = Number(cost.total ?? usage.costTotal ?? usage.totalCost ?? 0);
  const before = JSON.stringify(state.usage);
  state.usage.input += Number.isFinite(input) ? input : 0;
  state.usage.output += Number.isFinite(output) ? output : 0;
  state.usage.cacheRead += Number.isFinite(cacheRead) ? cacheRead : 0;
  state.usage.cacheWrite += Number.isFinite(cacheWrite) ? cacheWrite : 0;
  state.usage.cost += Number.isFinite(totalCost) ? totalCost : 0;
  if (Number.isFinite(totalTokens) && totalTokens > 0) state.usage.ctxTokens = totalTokens;
  else state.usage.ctxTokens = Math.max(state.usage.ctxTokens, state.usage.input + state.usage.output + state.usage.cacheRead + state.usage.cacheWrite);
  if (Number.isFinite(ctxLimit) && ctxLimit > 0) state.usage.ctxLimit = Math.max(state.usage.ctxLimit, ctxLimit);
  if (Number.isFinite(ctxRemaining) && ctxRemaining > 0) state.usage.ctxRemaining = ctxRemaining;
  else if (state.usage.ctxLimit > 0 && state.usage.ctxTokens > 0) state.usage.ctxRemaining = Math.max(0, state.usage.ctxLimit - state.usage.ctxTokens);
  return JSON.stringify(state.usage) !== before;
}

function applyAssistantMessage(state: SubagentRunState, msg: Record<string, unknown>, messageId = ""): boolean {
  if (msg.role !== "assistant") return false;
  const id = String(messageId || msg.id || msg.responseId || "");
  const alreadyCounted = Boolean(id && state.usageMessageIds.includes(id));
  if (id && !alreadyCounted) state.usageMessageIds.push(id);
  if (state.usageMessageIds.length > 100) state.usageMessageIds.splice(0, state.usageMessageIds.length - 100);
  let usageChanged = false;
  if (!alreadyCounted) {
    state.usage.turns += 1;
    usageChanged = addUsage(state, msg.usage);
  }
  const text = textFromContent(msg.content);
  const textChanged = Boolean(text);
  if (textChanged) {
    state.finalText = text;
    state.textTail = appendTail("", text);
  }
  const modelChanged = typeof msg.model === "string" && msg.model !== state.model;
  if (typeof msg.model === "string") state.model = msg.model;
  const errorChanged = typeof msg.errorMessage === "string" && msg.errorMessage !== state.errorMessage;
  if (typeof msg.errorMessage === "string") state.errorMessage = msg.errorMessage;
  return usageChanged || textChanged || modelChanged || errorChanged;
}

function applyPiEvent(state: SubagentRunState, evt: Record<string, unknown>): boolean {
  const type = String(evt.type || "");
  const topLevelUsageChanged = addUsage(state, evt.usage);
  if (type === "agent_start" || type === "turn_start") {
    state.status = "running";
    state.startedAt ??= Date.now();
    return true;
  }
  if (type === "message_update") {
    const assistantEvent = evt.assistantMessageEvent && typeof evt.assistantMessageEvent === "object" ? evt.assistantMessageEvent as Record<string, unknown> : null;
    const delta = String(assistantEvent?.delta || "");
    if (!delta) return false;
    if (assistantEvent?.type === "thinking_delta") state.thinkingTail = appendTail(state.thinkingTail, delta);
    else if (assistantEvent?.type === "text_delta") state.textTail = appendTail(state.textTail, delta);
    else return false;
    return true;
  }
  if ((type === "message_end" || type === "message") && evt.message && typeof evt.message === "object") {
    return applyAssistantMessage(state, evt.message as Record<string, unknown>, String(evt.id || evt.messageId || "")) || topLevelUsageChanged;
  }
  if (type === "tool_execution_start") {
    const id = String(evt.toolCallId || `${Date.now()}`);
    const name = String(evt.toolName || "tool");
    const args = typeof evt.args === "string" ? evt.args : JSON.stringify(evt.args || {});
    const existing = state.tools.find((tool) => tool.id === id);
    if (existing) Object.assign(existing, { name, args, status: "running" });
    else state.tools.push({ id, name, args: args.length > 160 ? `${args.slice(0, 160)}…` : args, status: "running" });
    if (state.tools.length > 16) state.tools.splice(0, state.tools.length - 16);
    return true;
  }
  if (type === "tool_execution_end") {
    const id = String(evt.toolCallId || "");
    const item = state.tools.find((tool) => tool.id === id);
    if (item) item.status = evt.isError ? "failed" : "succeeded";
    return Boolean(item);
  }
  if (type === "agent_end") {
    state.finishedAt = Date.now();
    if (state.status === "running" || state.status === "pending") state.status = "succeeded";
    return true;
  }
  return topLevelUsageChanged;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  if (currentScript && !currentScript.startsWith("/$bunfs/root/") && requireExists(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = process.execPath.split(/[\\/]/).pop()?.toLowerCase() || "";
  if (!/^(node|bun)(\.exe)?$/.test(execName)) return { command: process.execPath, args };
  return { command: "pi", args };
}

function requireExists(path: string): boolean {
  try { accessSync(path, constants.R_OK); return true; }
  catch { return false; }
}

function buildSubagentPrompt(role: string, userPrompt: string, result?: EmbAgentResult): string {
  const nextLines = result ? renderNextLines(result) : [];
  const focus: Record<string, string> = {
    "hw-scout": "Locate hardware/register/manual/schematic/pin-map facts. Return evidence paths, exact constraints, gaps, and firmware risks.",
    "fw-doer": "Implement focused firmware changes in the repository. Keep edits scoped, preserve project conventions, and report changed files plus validation evidence.",
    "arch-reviewer": "Review architecture/framework boundaries, scheduler/timing implications, ISR boundaries, RAM/ROM risk, and safe vertical slices.",
    "sys-reviewer": "Review requirements, concurrency, power/sleep/wakeup behavior, verification order, and system-level failure modes.",
    "bug-hunter": "Find likely root causes, risky assumptions, regression vectors, and minimal validation steps.",
    "release-checker": "Check readiness risks, missing validation, changelog/user-impact concerns, and rollback notes.",
  };
  return [
    "You are an emb-agent firmware subagent running in an isolated Pi session.",
    `Role: ${role}`,
    `Focus: ${focus[role] || "Perform focused firmware analysis."}`,
    "Work from repository files and emb-agent project truth. Do not rely on parent chat memory.",
    READ_ONLY_AGENT_NAMES.has(role) ? "Do not modify files; this pass is read-only reconnaissance/review." : "Keep edits minimal and scoped to the delegated task.",
    `Do not spawn additional emb-agent subagents. ${EMB_CHILD_ENV}=1 is set for recursion prevention.`,
    "Return concise, evidence-backed findings. Include file paths and concrete risks; avoid raw large snippets.",
    "Follow the user's/project's response language.",
    "",
    "emb-agent project state:",
    nextLines.join("\n") || "(no emb-agent next context)",
    "",
    "User request:",
    userPrompt,
  ].join("\n");
}

function buildPiSubagentArgs(prompt: string, role: string, route: ModelRoute | undefined): string[] {
  const args = ["--mode", "json", "-p", "--no-session"];
  if (route?.model && route.model !== "inherit") args.push("--model", route.model);
  if (route?.thinking) args.push("--thinking", route.thinking);
  const tools = READ_ONLY_AGENT_NAMES.has(role)
    ? "read,grep,find,ls,doc_lookup,doc_fetch,knowledge_search,knowledge_diagnose,knowledge_graph_query"
    : "read,grep,find,ls,bash,edit,write,doc_lookup,doc_fetch,knowledge_search,knowledge_diagnose,knowledge_graph_query";
  args.push("--tools", tools);
  args.push(prompt);
  return args;
}

function shouldRetrySubagentFailure(state: SubagentRunState): boolean {
  if (state.status === "cancelled") return false;
  if (state.finalText || state.textTail || state.tools.length > 0) return false;
  const text = `${state.errorMessage || ""}\n${state.stderrTail || ""}`.toLowerCase();
  if (/model|provider|auth|unauthori[sz]ed|not found|unavailable|invalid|404|429|rate limit|quota|api key|spawn|exit/.test(text)) return true;
  return true;
}

async function runPiSubagentOnce(cwd: string, role: string, prompt: string, route: ModelRoute | undefined, state: SubagentRunState, emit: () => void, signal?: AbortSignal): Promise<EmbSubagentResult> {
  const args = buildPiSubagentArgs(prompt, role, route);
  state.model = route?.model && route.model !== "inherit" ? route.model : undefined;
  state.thinking = route?.thinking;
  state.routeHistory.push(route?.model && route.model !== "inherit" ? route.model : "inherit");
  state.status = "running";
  state.startedAt = Date.now();
  emit();

  return new Promise((resolve) => {
    const inv = getPiInvocation(args);
    const child = spawn(inv.command, inv.args, {
      cwd,
      env: { ...process.env, [EMB_CHILD_ENV]: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let buffer = "";
    let stdout = "";
    let settled = false;
    const done = (result: EmbSubagentResult) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      emit();
      resolve(result);
    };
    const abort = () => {
      state.status = "cancelled";
      state.errorMessage = "cancelled";
      state.finishedAt = Date.now();
      child.kill();
      done({ role, status: state.status, output: state.finalText || "cancelled", model: state.model, thinking: state.thinking, error: "cancelled" });
    };
    signal?.addEventListener("abort", abort, { once: true });
    const processLine = (line: string) => {
      const evt = parseJsonEvent(line);
      if (evt && applyPiEvent(state, evt)) emit();
    };
    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString("utf8");
      stdout = appendTail(stdout, chunk, MAX_SUBAGENT_OUTPUT);
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    });
    child.stderr?.on("data", (data: Buffer) => {
      state.stderrTail = appendTail(state.stderrTail, data.toString("utf8"));
      emit();
    });
    child.on("error", (error) => {
      state.status = "failed";
      state.errorMessage = error instanceof Error ? error.message : String(error);
      state.finishedAt = Date.now();
      done({ role, status: state.status, output: state.finalText || state.errorMessage, model: state.model, thinking: state.thinking, error: state.errorMessage });
    });
    child.on("close", (code) => {
      if (buffer.trim()) processLine(buffer);
      state.finishedAt = Date.now();
      if (state.status === "cancelled") return;
      if (code === 0) {
        if (state.status === "pending" || state.status === "running") state.status = "succeeded";
      } else {
        state.status = "failed";
        state.errorMessage = state.stderrTail || `pi exited with ${code ?? "unknown"}`;
      }
      const output = state.finalText || stdout || state.stderrTail || state.errorMessage || "(no output)";
      done({ role, status: state.status, output, model: state.model, thinking: state.thinking, error: state.errorMessage });
    });
  });
}

async function runPiSubagent(cwd: string, role: string, prompt: string, route: ModelRoute | undefined, state: SubagentRunState, emit: () => void, signal?: AbortSignal): Promise<EmbSubagentResult> {
  const explicitModel = route?.model && route.model !== "inherit";
  const routes: ModelRoute[] = explicitModel
    ? [...Array(SUBAGENT_MODEL_RETRIES).fill(route), { model: "inherit" }]
    : [route || { model: "inherit" }];
  state.attemptsMax = routes.length;
  let last: EmbSubagentResult | null = null;
  for (let i = 0; i < routes.length; i++) {
    state.attempt = i + 1;
    state.errorMessage = undefined;
    state.stderrTail = "";
    last = await runPiSubagentOnce(cwd, role, prompt, routes[i], state, emit, signal);
    if (last.status === "succeeded" || last.status === "cancelled") return last;
    if (i >= routes.length - 1 || !shouldRetrySubagentFailure(state)) return last;
    state.status = "pending";
    state.errorMessage = `retrying after ${last.error || last.status}`;
    emit();
  }
  return last || { role, status: "failed", output: "subagent failed before start", model: state.model, thinking: state.thinking, error: "subagent failed before start" };
}

async function runEmbSubagentBatch(cwd: string, userPrompt: string, planOrRoles: SubagentDispatchPlan | string[], result: EmbAgentResult | undefined, signal: AbortSignal | undefined, onUpdate?: (r: any) => void): Promise<{ output: string; details: EmbSubagentProgress; failed: boolean; results: EmbSubagentResult[]; plan: SubagentDispatchPlan }> {
  const plan: SubagentDispatchPlan = Array.isArray(planOrRoles)
    ? {
        phase: result ? dispatchPhase(result) : "general",
        mode: planOrRoles.length > 1 ? "parallel" : "single",
        reason: "Manual role list dispatch.",
        runs: planOrRoles.map((role) => ({ role, intent: READ_ONLY_AGENT_NAMES.has(role) ? "evidence" : "implementation", writable: !READ_ONLY_AGENT_NAMES.has(role), prompt: rolePrompt(role, READ_ONLY_AGENT_NAMES.has(role) ? "evidence" : "implementation", userPrompt, result || {}) })),
      }
    : planOrRoles;
  const runs = plan.runs.filter((run) => SUPPORTED_AGENT_NAMES.has(run.role));
  const routes = await loadModelRoutes(cwd);
  const startedAt = Date.now();
  const details: EmbSubagentProgress = { kind: "emb-agent-subagent-progress", batchId: randomUUID(), mode: plan.mode, roles: [], final: false, startedAt, updatedAt: startedAt };
  let lastKey = "";
  const emit = (force = false) => {
    details.updatedAt = Date.now();
    const key = JSON.stringify(details.roles.map((r) => [r.role, r.status, r.tools.length, r.textTail, r.stderrTail, r.usage]));
    if (!force && key === lastKey) return;
    lastKey = key;
    onUpdate?.({ content: [{ type: "text", text: renderSubagentProgress(details, false) }], details: clone(details) });
  };
  details.roles = runs.map((run) => newRunState(run.role, run.prompt, routes[run.role]));
  emit(true);
  const heartbeat = setInterval(() => emit(true), TUI_HEARTBEAT_MS);
  const runOne = (run: SubagentDispatchRun, state: SubagentRunState, previousOutput?: string) => {
    const delegatedPrompt = previousOutput ? rolePrompt(run.role, run.intent, userPrompt, result || {}, run.targetTask || plan.targetTask, previousOutput) : run.prompt;
    return runPiSubagent(cwd, run.role, buildSubagentPrompt(run.role, delegatedPrompt, result), routes[run.role], state, () => emit(), signal);
  };
  let results: EmbSubagentResult[] = [];
  try {
    if (plan.mode === "chain") {
      let previous = "";
      for (let i = 0; i < runs.length; i++) {
        const item = await runOne(runs[i]!, details.roles[i]!, previous);
        results.push(item);
        previous = [previous, `## ${item.role} (${item.status})\n${item.output}`].filter(Boolean).join("\n\n---\n\n");
        if (item.status !== "succeeded") break;
      }
    } else {
      results = await Promise.all(runs.map((run, index) => runOne(run, details.roles[index]!)));
    }
  } finally {
    clearInterval(heartbeat);
  }
  details.final = true;
  details.updatedAt = Date.now();
  emit(true);
  const header = [`Dispatch phase: ${plan.phase}`, plan.targetTask ? `Target task: ${plan.targetTask}` : "Target task: none", `Mode: ${plan.mode}`, `Reason: ${plan.reason}`].join("\n");
  const output = `${header}\n\n` + results.map((item) => `## ${item.role} (${item.status})\n${item.output.slice(0, MAX_SUBAGENT_OUTPUT)}`).join("\n\n---\n\n");
  return { output, details: clone(details), failed: results.some((r) => r.status !== "succeeded"), results, plan };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function formatTokenCount(value: number): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function contextTokensUsed(usage: SubagentRunState["usage"]): number {
  return Number(usage.ctxTokens || 0) || (Number(usage.input || 0) + Number(usage.output || 0) + Number(usage.cacheRead || 0) + Number(usage.cacheWrite || 0));
}

function formatContextUsage(usage: SubagentRunState["usage"]): string {
  const used = contextTokensUsed(usage);
  if (!used && !usage.ctxLimit) return "";
  const limit = Number(usage.ctxLimit || 0);
  const remaining = Number(usage.ctxRemaining || 0) || (limit > 0 ? Math.max(0, limit - used) : 0);
  if (limit > 0) return `ctx ${formatTokenCount(used)}/${formatTokenCount(limit)} · left ${formatTokenCount(remaining)}`;
  return `ctx ${formatTokenCount(used)} used`;
}

function aggregateUsage(roles: SubagentRunState[]): SubagentRunState["usage"] {
  return roles.reduce((acc, role) => {
    acc.input += Number(role.usage?.input || 0);
    acc.output += Number(role.usage?.output || 0);
    acc.cacheRead += Number(role.usage?.cacheRead || 0);
    acc.cacheWrite += Number(role.usage?.cacheWrite || 0);
    acc.cost += Number(role.usage?.cost || 0);
    acc.turns += Number(role.usage?.turns || 0);
    acc.ctxTokens += contextTokensUsed(role.usage);
    if (role.usage?.ctxLimit) acc.ctxLimit += Number(role.usage.ctxLimit || 0);
    if (role.usage?.ctxRemaining) acc.ctxRemaining += Number(role.usage.ctxRemaining || 0);
    return acc;
  }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0, ctxTokens: 0, ctxLimit: 0, ctxRemaining: 0 });
}

function renderSubagentProgress(details: EmbSubagentProgress, includeOutput = true): string {
  const totalUsage = aggregateUsage(details.roles);
  const usageSummary = formatContextUsage(totalUsage);
  const lines = [`emb-agent native subagents · ${details.final ? "done" : "running"}${usageSummary ? ` · total ${usageSummary}` : ""}`];
  for (const role of details.roles) {
    const running = role.status === "running" || role.status === "pending";
    const frame = SPINNER_FRAMES[Math.floor((Date.now() - details.startedAt) / TUI_HEARTBEAT_MS) % SPINNER_FRAMES.length] || "⠸";
    const icon = role.status === "succeeded" ? "✓" : role.status === "failed" ? "✗" : role.status === "cancelled" ? "!" : running ? frame : "⠸";
    const roleUsage = formatContextUsage(role.usage);
    const attempt = role.attempt ? `try ${role.attempt}/${role.attemptsMax || 1}` : null;
    const route = role.routeHistory.length > 1 ? `route ${role.routeHistory.join("→")}` : null;
    const stats = [attempt, role.tools.length ? `${role.tools.length} tools` : null, role.model || null, route, role.thinking ? `thinking=${role.thinking}` : null, roleUsage || null].filter(Boolean).join(" · ");
    lines.push(`${icon} ${role.role} ${role.status}${stats ? ` · ${stats}` : ""}`);
    if (includeOutput && role.textTail) lines.push(`  ${role.textTail.slice(-300).replace(/\s+/g, " ")}`);
    if (role.errorMessage) lines.push(`  error: ${role.errorMessage}`);
  }
  return lines.join("\n");
}

async function autoDispatchSubagents(cwd: string, userPrompt: string, result: EmbAgentResult, signal: AbortSignal | undefined, onUpdate?: (r: any) => void): Promise<AutoDispatchResult & { output?: string; details?: EmbSubagentProgress }> {
  const settings = await readPiSettings(cwd);
  if (!shouldAutoDispatchSubagents(userPrompt, result, settings)) return { attempted: false, roles: [], errors: [] };
  const plan = buildDispatchPlan(userPrompt, result);
  const roles = plan.runs.map((run) => run.role).filter((role) => SUPPORTED_AGENT_NAMES.has(role));
  try {
    const batch = await runEmbSubagentBatch(cwd, userPrompt, plan, result, signal, onUpdate);
    return { attempted: true, batchId: batch.details.batchId, roles, errors: batch.failed ? ["one or more subagents failed"] : [], output: batch.output, details: batch.details };
  } catch (error: any) {
    return { attempted: true, roles, errors: [error?.message || String(error)] };
  }
}

function shouldPauseParent(dispatch: AutoDispatchResult | null): boolean {
  return Boolean(dispatch?.attempted && dispatch.roles.length > 0);
}

function renderAutoDispatch(dispatch: AutoDispatchResult | null): string {
  if (!dispatch?.attempted) return "";
  const lines = ["\n## emb-agent Native Subagent Dispatch"];
  if (dispatch.roles.length) lines.push(`Launched native Pi subagents: ${dispatch.roles.join(", ")}.`);
  if (dispatch.errors.length) lines.push(`Warnings: ${dispatch.errors.join("; ")}`);
  lines.push("Parent agent must wait for hidden subagent results before inline file/code exploration.");
  return lines.join("\n");
}

async function listSessionFiles(root: string, platform: "pi" | "codex", max = 400): Promise<SessionSearchHit[]> {
  const out: SessionSearchHit[] = [];
  async function walk(dir: string) {
    let entries: any[];
    try { entries = await readdir(dir, { withFileTypes: true } as any); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory?.()) await walk(path);
      else if (entry.isFile?.() && entry.name.endsWith(".jsonl")) out.push({ id: entry.name.replace(/\.jsonl$/, ""), platform, path, updatedAt: 0, preview: "", score: 0 });
      if (out.length >= max) return;
    }
  }
  await walk(root);
  return out;
}

async function discoverSessionFiles(cwd: string): Promise<SessionSearchHit[]> {
  const home = process.env.HOME || "";
  const roots: Array<[string, "pi" | "codex"]> = [
    [process.env.PI_CODING_AGENT_SESSION_DIR || join(home, ".pi", "agent", "sessions"), "pi"],
    [join(home, ".codex", "sessions"), "codex"],
  ];
  const all = (await Promise.all(roots.map(([root, platform]) => listSessionFiles(root, platform)))).flat();
  return all.filter((item) => item.path.includes(cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "") || item.platform === "codex" || item.platform === "pi");
}

function extractSessionText(line: string): string {
  const evt = parseJsonEvent(line);
  if (!evt) return "";
  const direct = textFromContent((evt as any).content || (evt as any).message?.content || (evt as any).delta);
  if (direct) return direct;
  if ((evt as any).type === "user_message" || (evt as any).type === "agent_message") return String((evt as any).text || "");
  return "";
}

async function readSessionDialogue(path: string, phase: "all" | "brainstorm" | "implement" = "all"): Promise<string> {
  const raw = await readFile(path, "utf-8");
  const slice = raw.length > MAX_SESSION_BYTES ? raw.slice(raw.length - MAX_SESSION_BYTES) : raw;
  const lines = slice.split(/\r?\n/);
  const turns = lines.map(extractSessionText).filter(Boolean);
  const text = turns.join("\n\n");
  if (phase === "all") return text;
  const createIdx = text.search(/\b(emb-agent|task\.py)\s+(task\s+)?(add|create)\b|PRD|需求探索|brainstorm/i);
  const startIdx = text.search(/\b(emb-agent|task\.py)\s+(task\s+)?(activate|start)\b|开始实现|implementation/i);
  if (phase === "brainstorm") return createIdx >= 0 && startIdx > createIdx ? text.slice(createIdx, startIdx) : text;
  if (phase === "implement") return startIdx >= 0 ? text.slice(startIdx) : "";
  return text;
}

async function searchSessions(cwd: string, query: string, limit = 8): Promise<SessionSearchHit[]> {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const files = await discoverSessionFiles(cwd);
  const hits: SessionSearchHit[] = [];
  for (const file of files) {
    let text = "";
    try { text = await readSessionDialogue(file.path, "all"); } catch { continue; }
    const lower = text.toLowerCase();
    const score = tokens.reduce((sum, token) => sum + (lower.includes(token) ? 1 : 0), 0);
    if (score === 0) continue;
    file.score = score;
    file.preview = text.slice(Math.max(0, lower.indexOf(tokens[0] || "") - 120), Math.max(300, lower.indexOf(tokens[0] || "") + 300)).replace(/\s+/g, " ").trim();
    hits.push(file);
  }
  return hits.sort((a, b) => b.score - a.score || b.path.localeCompare(a.path)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// CLI argument builders
// ---------------------------------------------------------------------------

function shellSplit(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && i + 1 < input.length) current += input[++i];
      else current += ch;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (/\s/.test(ch)) { if (current) { out.push(current); current = ""; } }
    else current += ch;
  }
  if (current) out.push(current);
  return out;
}

function optionValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function boolArg(args: string[], name: string): boolean {
  return args.includes(name);
}

function isSchematicPath(path: string): boolean {
  return /\.(?:schdoc|sch|dsn|kicad_sch)(?:$|[?#])/i.test(String(path || ""));
}

function isSchematicKind(kind: string): boolean {
  return /^(schematic|sch|circuit|netlist)$/i.test(String(kind || "").trim());
}

function buildIngestDocArgs(params: Record<string, unknown>): string[] {
  const file = String(params.file || "").trim();
  if (!file) throw new Error("ingest_doc requires file");
  const kind = String(params.kind || "datasheet").trim();
  if (isSchematicKind(kind) || isSchematicPath(file)) {
    const args = ["ingest", "schematic", "--file", file];
    const format = String(params.format || "").trim();
    if (format) args.push("--format", format);
    return args;
  }
  const args = ["ingest", "doc", "--file", file];
  const provider = String(params.provider || "auto").trim();
  if (provider) args.push("--provider", provider);
  if (kind) args.push("--kind", kind);
  const to = String(params.to || params.intendedTo || "hardware").trim();
  if (to) args.push("--to", to);
  const mapping: Array<[string, string]> = [["title", "--title"], ["language", "--language"], ["pages", "--pages"], ["modelVersion", "--model-version"]];
  for (const [key, flag] of mapping) {
    const value = String(params[key] || "").trim();
    if (value) args.push(flag, value);
  }
  if (params.force) args.push("--force");
  if (params.isOcr) args.push("--ocr");
  if (params.enableTable === false) args.push("--no-table");
  if (params.enableFormula === false) args.push("--no-formula");
  const timeoutMs = Number(params.timeoutMs || 0);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) args.push("--timeout-ms", String(timeoutMs));
  return args;
}

function parseEmbIngestArgs(raw: string): Record<string, unknown> | null {
  const args = shellSplit(raw);
  const sub = args[0] === "doc" || args[0] === "schematic" ? args.shift() : "doc";
  const file = optionValue(args, "--file") || args[0];
  if (!file) return null;
  if (sub === "schematic") {
    return {
      file,
      kind: "schematic",
      format: optionValue(args, "--format"),
      timeoutMs: Number(optionValue(args, "--timeout-ms") || 0) || undefined,
    };
  }
  return {
    file,
    provider: optionValue(args, "--provider") || "auto",
    kind: optionValue(args, "--kind") || "datasheet",
    to: optionValue(args, "--to") || "hardware",
    title: optionValue(args, "--title"),
    language: optionValue(args, "--language"),
    pages: optionValue(args, "--pages"),
    modelVersion: optionValue(args, "--model-version"),
    force: boolArg(args, "--force"),
    isOcr: boolArg(args, "--ocr") || boolArg(args, "--is-ocr"),
    enableTable: !boolArg(args, "--no-table"),
    enableFormula: !boolArg(args, "--no-formula"),
    timeoutMs: Number(optionValue(args, "--timeout-ms") || 0) || undefined,
  };
}

function isPdfPath(path: string): boolean {
  return /\.pdf(?:$|[?#])/i.test(String(path || ""));
}

function isRawPdfShellCommand(command: string): boolean {
  const c = String(command || "");
  if (!isPdfPath(c)) return false;
  if (/emb-agent\.cjs\s+ingest\s+doc\b/.test(c) || /\bingest\s+doc\b/.test(c)) return false;
  return /(^|[;&|\s])(cat|head|tail|less|more|xxd|od|strings|pdftotext|mutool|python3?\s+-c)\b/.test(c);
}

function stripBenignShellRedirections(command: string): string {
  return String(command || "")
    .replace(/\s*\d?>\s*\/dev\/null\b/g, "")
    .replace(/\s*\d?>>\s*\/dev\/null\b/g, "")
    .replace(/\s*\d?>&\d\b/g, "");
}

function isLikelyMutationShellCommand(command: string): boolean {
  const c = stripBenignShellRedirections(String(command || "").toLowerCase()).replace(/\s+/g, " ");
  const mutationCommand = /(^|[;&|\s])(cat\s+>\s*|tee\b|mkdir\b|touch\b|rm\b|mv\b|cp\b|perl\s+-pi\b|sed\s+-i\b)/.test(c);
  const scriptWrite = /\bpython(?:3)?\b.*\b(open\s*\(|write_text\s*\(|write\s*\()|\bnode\b.*\bwritefilesync\b/.test(c);
  const outputRedirect = /(^|\s)\d?>>?\s*(?!&)[^\s]/.test(c);
  return mutationCommand || scriptWrite || outputRedirect;
}

function dispatchRequiresKnowledgePriming(plan?: SubagentDispatchPlan): boolean {
  return Boolean(
    plan &&
    (plan.phase === "work-selection" || plan.phase === "task-execution") &&
    plan.runs.some((run) => run.role === "fw-doer" || run.writable || run.intent === "implementation")
  );
}

function hasFreshKnowledgePriming(cwd: string, pending?: { createdAt: number }, priming?: Map<string, KnowledgePrimingState>): boolean {
  const state = priming?.get(cwd);
  if (!state) return false;
  if (Date.now() - state.createdAt > KNOWLEDGE_PRIMING_TTL_MS) return false;
  if (pending && state.createdAt + 5_000 < pending.createdAt) return false;
  return true;
}

function knowledgePrimingRequiredReason(targetTask?: string | null): string {
  return [
    "Before implementation dispatch or broad source inspection, call knowledge_search once for the target task first.",
    targetTask ? `Target task: ${targetTask}.` : "Target task: unknown.",
    "Search project knowledge for PRD/task context, prior notes, manual/register evidence, and known traps; then continue with emb_subagent or source reads.",
    "This guard is structured by emb-agent task-execution/work-selection state, not natural-language keyword guessing.",
  ].join(" ");
}

function isSourceInspectionPath(path: string): boolean {
  const p = String(path || "").replace(/\\/g, "/");
  if (!p || p.includes("/.emb-agent/") || p.includes("/docs/") || /(^|\/)README\.md$/i.test(p)) return false;
  return Boolean(
    /(^|\/)firmware\//i.test(p) ||
    /(^|\/)(src|include|drivers?|app|hal|bsp)\/.*\.(c|h|cc|cpp|hpp|s|asm|inc)$/i.test(p) ||
    /\.(c|h|cc|cpp|hpp|s|asm|inc|scw|mcw|uvprojx?|ioc|ld|lds|mk)$/i.test(p) ||
    /(^|\/)(Makefile|CMakeLists\.txt)$/i.test(p)
  );
}

function isSourceInspectionShellCommand(command: string): boolean {
  const c = stripBenignShellRedirections(String(command || "")).replace(/\\/g, "/");
  if (!/(^|[;&|\s])(find|rg|grep|cat|head|tail|sed\s+-n|awk|ls)\b/i.test(c)) return false;
  return Boolean(
    /(^|[\s'\"])(firmware|src|include|drivers?|app|hal|bsp)(\/|[\s'\"]|$)/i.test(c) ||
    /\.(c|h|cc|cpp|hpp|s|asm|inc|scw|mcw|uvprojx?|ioc|ld|lds|mk)\b/i.test(c) ||
    /\b(Makefile|CMakeLists\.txt)\b/i.test(c)
  );
}

function isParentClosureDocPath(path: string): boolean {
  const p = String(path || "").replace(/\\/g, "/");
  return Boolean(
    /(^|\/)\.emb-agent\/tasks\/[^/]+\/(aar\.md|task\.json|review.*\.md|validation.*\.md)$/i.test(p) ||
    /(^|\/)\.emb-agent\/(attention\.md|architecture\/.*\.md|compound\/.*\.md|wiki\/.*\.md|reference\/.*\.md|memory\/.*\.md|audits\/.*\.md|sessions\/.*\.md)$/i.test(p) ||
    /(^|\/)docs\/.*\.md$/i.test(p) ||
    /(^|\/)(README|CHANGELOG|NOTES)\.md$/i.test(p)
  );
}

function shellCommandOnlyWritesClosureDocs(command: string): boolean {
  const c = String(command || "").replace(/\\/g, "/");
  if (!isLikelyMutationShellCommand(c)) return false;
  if (/(^|[;&|\s])(rm\b|mv\b|cp\b|mkdir\b|touch\b|sed\s+-i\b|perl\s+-pi\b)/i.test(c)) return false;
  const pathMatches = c.match(/(?:^|[\s'\"])([^\s'\"]*(?:\.emb-agent\/[^\s'\"]+|docs\/[^\s'\"]+|README\.md|CHANGELOG\.md|NOTES\.md))/gi) || [];
  const paths = pathMatches.map((m) => m.trim().replace(/^['\"]|['\"]$/g, ""));
  return paths.length > 0 && paths.every(isParentClosureDocPath);
}

// ---------------------------------------------------------------------------
// ask_user_question UI
// ---------------------------------------------------------------------------

interface QuestionOption { label: string; description?: string }
interface QuestionDef { question: string; header?: string; multiSelect?: boolean; allowCustom?: boolean; options: QuestionOption[] }
interface QuestionnaireAnswer { question: string; selected: string[]; custom?: string[] }
interface QuestionnaireResult { answers: QuestionnaireAnswer[]; cancelled: boolean }

function questionSummary(q: QuestionDef): string {
  const options = (q.options || []).map((o, i) => `${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}`).join("\n");
  return `${q.header || q.question}\n${options}\n0. Type custom answer`;
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  const contexts = new Map<string, ContextEntry>();
  const dispatchGuards = new Map<string, DispatchGuard>();
  const pendingNativeDispatch = new Map<string, { prompt: string; result: EmbAgentResult; plan: SubagentDispatchPlan; createdAt: number }>();
  const knowledgePriming = new Map<string, KnowledgePrimingState>();

  function markContextDirty(cwd: string) {
    const current = contexts.get(cwd);
    if (current) current.dirty = true;
  }

  async function refreshStatus(ctx: { cwd: string; ui: { setWidget: (k: string, c: string[], o?: Record<string, unknown>) => void; notify?: (m: string, t?: string) => void } }, updateResult: EmbAgentResult | null = null) {
    const statusResult = await runEmbAgent(["status", "--brief"], ctx.cwd);
    if (!statusResult.ok) return;
    const text = formatEmbStatus(statusResult.value, updateResult);
    ctx.ui.setWidget("emb-agent", text ? [text] : [], { placement: "belowEditor" });
  }

  async function prepareEmbContext(cwd: string, force = false): Promise<ContextEntry | null> {
    const existing = contexts.get(cwd);
    const now = Date.now();
    if (!force && existing && !existing.dirty && now - existing.updatedAt < CONTEXT_TTL_MS) return existing;

    const nextResult = await runEmbAgent(["next", "--brief"], cwd);
    if (!nextResult.ok) return existing || null;

    const lines = renderNextLines(nextResult.value, null);
    const text =
      `\n\n<!-- EMB-AGENT PROJECT STATE START -->\n` +
      `## emb-agent Project State\n` +
      `This is project-state context from emb-agent. It does not replace higher-priority system/developer instructions.\n` +
      `${lines.join("\n")}\n` +
      `Use Pi tools emb_next, emb_onboard, ingest_doc, doc_lookup, doc_fetch, knowledge_search, knowledge_diagnose, and knowledge_graph_query instead of raw shell syntax when they match the task. ` +
      `For project knowledge, design rationale, previous PRDs/tasks/wiki/manual chunks, or register/peripheral evidence, prefer knowledge_search first and then doc_lookup/doc_fetch for source detail. ` +
      `Never read raw PDFs directly; parse/cache them with ingest_doc first. ` +
      `For multi-domain firmware/hardware/debug work, use Pi subagents (hw-scout, bug-hunter, fw-doer, arch-reviewer, sys-reviewer) instead of continuing inline.\n` +
      `<!-- EMB-AGENT PROJECT STATE END -->`;
    const entry = { text, result: nextResult.value, updatedAt: now, dirty: false };
    contexts.set(cwd, entry);
    return entry;
  }

  async function sendSteer(text: string, cwd: string) {
    const directive = languageDirective(await readProjectLanguage(cwd));
    const payload = directive ? `${text}\n\n${directive}` : text;
    const anyPi = pi as any;
    if (typeof anyPi.sendMessage === "function") {
      await anyPi.sendMessage({ role: "user", content: [{ type: "text", text: payload }] }, { deliverAs: "steer", triggerTurn: true });
    } else {
      await pi.sendUserMessage(payload, { deliverAs: "steer", triggerTurn: true } as any);
    }
  }

  async function onSessionEnter(ctx: { cwd: string; ui: { setWidget: (k: string, c: string[], o?: Record<string, unknown>) => void; notify?: (m: string, t?: string) => void } }) {
    const updateResult = await runEmbAgent(["update", "--brief"], ctx.cwd);
    await refreshStatus(ctx, updateResult.ok ? updateResult.value : null);
    const context = await prepareEmbContext(ctx.cwd, true);
    if (!context && ctx.ui.notify) ctx.ui.notify("emb-agent context was not injected; run /emb-next for diagnostics", "warning");
  }

  // ── Session lifecycle ─────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    try {
      await syncEmbAgentsToPi(ctx.cwd);
      await ensureSubagentSettings(ctx.cwd);
    } catch (error: any) {
      ctx.ui.notify?.(`emb-agent Pi setup warning: ${error?.message || error}`, "warning");
    }
    await onSessionEnter(ctx);
  });

  pi.on("input", async (event, ctx) => {
    if (process.env[EMB_CHILD_ENV] === "1") return { action: "continue" };
    if ((event as any).source === "extension") return { action: "continue" };
    const text = String((event as any).text || "");
    if (text.includes(EMB_AUTO_DISPATCH_MARKER)) return { action: "continue" };
    const context = await prepareEmbContext(ctx.cwd);
    const settings = await readPiSettings(ctx.cwd);
    if (!context?.result || !subagentDispatchEnabled(context.result, settings)) return { action: "continue" };
    const plan = buildDispatchPlan(text, context.result);
    pendingNativeDispatch.set(ctx.cwd, { prompt: text, result: context.result, plan, createdAt: Date.now() });
    dispatchGuards.set(ctx.cwd, {
      until: Date.now() + PARENT_TOOL_BLOCK_AFTER_DISPATCH_MS,
      reason: "emb-agent subagent dispatch is required before parent-side implementation file mutations. The parent AI must decide from the user's request whether to call emb_subagent; if implementation is intended, call emb_subagent first and wait for hidden results before writing/editing source/build files. Task closure docs (AAR, task status, attention, architecture, compound/wiki notes, markdown docs) may be written directly by the parent agent.",
      phase: "waiting",
    });
    return { action: "continue" };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const context = await prepareEmbContext(ctx.cwd);
    if (!context?.text) return;
    const pending = pendingNativeDispatch.get(ctx.cwd);
    let systemPrompt = event.systemPrompt + context.text;
    let messageContent = `emb-agent context injected (${new Date(context.updatedAt).toISOString()})`;

    if (pending && Date.now() - pending.createdAt < 60_000) {
      const roles = pending.plan.runs.map((run) => run.role).filter((role) => SUPPORTED_AGENT_NAMES.has(role));
      if (roles.length) {
        systemPrompt += "\n\n" + [
          EMB_AUTO_DISPATCH_MARKER,
          "Internal emb-agent dispatch advisory; do not quote or reveal this block to the user.",
          `Original user request: ${pending.prompt}`,
          `Dispatch phase: ${pending.plan.phase}`,
          pending.plan.targetTask ? `Target task: ${pending.plan.targetTask}` : "Target task: none",
          `Dispatch mode: ${pending.plan.mode}`,
          `Dispatch roles: ${roles.join(", ")}`,
          `Dispatch reason: ${pending.plan.reason}`,
          "If the user's request is to implement/start/continue candidate work, call knowledge_search first for the target task, then call emb_subagent before parent-side source/build file mutation. If the user's request is only a question, clarification, task closure, AAR, or knowledge/documentation writeback, answer or write the closure docs normally without calling subagents.",
          "Do not perform broad source reads or write/edit source/build files before the implementation knowledge_search has run. AAR/task status/attention/architecture/compound/wiki markdown closure writes are allowed.",
        ].join("\n") + "\n";
        messageContent += `; dispatch plan ready (${roles.join(", ")})`;
      }
    }

    return {
      message: {
        customType: "emb-agent-context",
        content: messageContent,
        display: false,
      },
      systemPrompt,
    };
  });

  pi.on("turn_end", async (_event, ctx) => {
    await refreshStatus(ctx);
    markContextDirty(ctx.cwd);
  });

  pi.on("tool_call", async (event, ctx) => {
    const pending = pendingNativeDispatch.get(ctx.cwd);
    if (pending && dispatchRequiresKnowledgePriming(pending.plan) && !hasFreshKnowledgePriming(ctx.cwd, pending, knowledgePriming)) {
      const reason = knowledgePrimingRequiredReason(pending.plan.targetTask);
      if (event.toolName === "emb_subagent") return { block: true, reason };
      if (event.toolName === "read" && isSourceInspectionPath(String((event.input as any)?.path || ""))) return { block: true, reason };
      if (event.toolName === "bash" && isSourceInspectionShellCommand(String((event.input as any)?.command || ""))) return { block: true, reason };
    }
    const guard = dispatchGuards.get(ctx.cwd);
    if (guard && Date.now() >= guard.until) dispatchGuards.delete(ctx.cwd);
    if (guard && Date.now() < guard.until && guard.phase === "waiting") {
      if (PARENT_MUTATION_TOOLS.has(event.toolName)) {
        const path = String((event.input as any)?.path || "");
        if (!isParentClosureDocPath(path)) return { block: true, reason: guard.reason };
      }
      if (event.toolName === "bash") {
        const command = String((event.input as any)?.command || "");
        if (isLikelyMutationShellCommand(command) && !shellCommandOnlyWritesClosureDocs(command)) return { block: true, reason: guard.reason };
      }
    }
    if (guard && Date.now() < guard.until && guard.phase === "results-injected") {
      const path = String((event.input as any)?.path || "");
      const command = String((event.input as any)?.command || "");
      if (event.toolName === "read" && path.includes("emb-agent-subagent")) return { block: true, reason: "Do not read raw emb-agent subagent output into the visible transcript; use the hidden injected results." };
      if (event.toolName === "bash" && command.includes("emb-agent-subagent")) return { block: true, reason: "Do not cat/read raw emb-agent subagent output into the visible transcript; use the hidden injected results." };
    }

    if (event.toolName === "read" && isPdfPath(String((event.input as any)?.path || ""))) {
      return { block: true, reason: "Do not read raw PDFs directly. Use the ingest_doc Pi tool or /emb-ingest doc --file <path> so emb-agent parses and caches the document first." };
    }
    if (event.toolName === "bash" && isRawPdfShellCommand(String((event.input as any)?.command || ""))) {
      return { block: true, reason: "Do not inspect raw PDFs with shell tools. Use ingest_doc or /emb-ingest doc --file <path> first, then doc_fetch/doc_lookup on cached markdown." };
    }
  });

  // ── Slash commands ──────────────────────────────────────────────

  pi.registerCommand("emb-next", {
    description: "Run emb-agent next and inject result into conversation",
    handler: async (_args, ctx) => {
      const result = await runEmbAgent(["next", "--brief"], ctx.cwd);
      if (!result.ok) { ctx.ui.notify(errorText(result), "warning"); return; }
      contexts.set(ctx.cwd, { text: "", updatedAt: 0, dirty: true });
      await prepareEmbContext(ctx.cwd, true);
      const lines = renderNextLines(result.value);
      await sendSteer(
        `[/emb-next]\n${lines.length ? lines.join("\n") : JSON.stringify(result.value, null, 2)}\n\nRespond to the user from the runtime recommendation above. Follow agent_protocol.gate allowed/forbidden actions exactly. Use Pi tools for emb-agent actions; use ingest_doc for PDFs/manuals and schematic files (it auto-routes SchDoc to ingest schematic). Do not auto-activate a task without user confirmation.`,
        ctx.cwd,
      );
    },
  });

  pi.registerCommand("emb-onboard", {
    description: "Run emb-agent onboarding handoff",
    handler: async (_args, ctx) => {
      const result = await runEmbAgent(["onboard"], ctx.cwd);
      if (!result.ok) { ctx.ui.notify(errorText(result), "warning"); return; }
      markContextDirty(ctx.cwd);
      const lines = renderNextLines(result.value);
      await sendSteer(`[/emb-onboard]\n${lines.length ? lines.join("\n") : JSON.stringify(result.value, null, 2)}\n\nAct on the onboarding handoff above.`, ctx.cwd);
    },
  });

  pi.registerCommand("emb-ingest", {
    description: "Parse/cache documents or schematics with emb-agent (usage: /emb-ingest doc --file <path> or /emb-ingest schematic --file <path>)",
    handler: async (args, ctx) => {
      const params = parseEmbIngestArgs(args || "");
      if (!params) {
        await sendSteer("[/emb-ingest]\nUsage: /emb-ingest doc --file <path> [--provider auto|local|mineru] [--kind datasheet] [--to hardware]\n       /emb-ingest schematic --file <path>", ctx.cwd);
        return;
      }
      let cliArgs: string[];
      try { cliArgs = buildIngestDocArgs(params); }
      catch (error: any) { ctx.ui.notify(error?.message || String(error), "warning"); return; }
      const result = await runEmbAgent(cliArgs, ctx.cwd, { timeoutMs: Number(params.timeoutMs || 0) || INGEST_TIMEOUT_MS, maxBuffer: INGEST_MAX_BUFFER });
      if (!result.ok) { ctx.ui.notify(errorText(result), "warning"); return; }
      markContextDirty(ctx.cwd);
      await sendSteer(`[/emb-ingest]\n${renderIngestLines(result.value).join("\n")}\n\nUse cached artifacts from the result. For documents, use doc_fetch/doc_lookup; for schematics, inspect parsed.json/advice/preview and rerun /emb-next.`, ctx.cwd);
    },
  });

  // ── Pi-native tools ────────────────────────────────────────────

  pi.registerTool({
    name: "emb_next",
    label: "emb next",
    description: "Run emb-agent next --brief and return the current routing gate/project state.",
    promptSnippet: "Run emb-agent next --brief and return routing gate/project state",
    promptGuidelines: ["Use emb_next before broad firmware work, task routing, or when emb-agent project state may be stale."],
    parameters: { type: "object", properties: {}, additionalProperties: false } as Record<string, unknown>,
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const result = await runEmbAgent(["next", "--brief"], ctx.cwd);
      if (!result.ok) return toolTextResult(errorText(result), result);
      markContextDirty(ctx.cwd);
      return toolTextResult(renderNextLines(result.value).join("\n") || JSON.stringify(result.value, null, 2), result.value);
    },
  });

  pi.registerTool({
    name: "emb_onboard",
    label: "emb onboard",
    description: "Run emb-agent onboarding handoff for uninitialized or migrated firmware projects.",
    promptSnippet: "Run emb-agent onboarding handoff",
    parameters: { type: "object", properties: {}, additionalProperties: false } as Record<string, unknown>,
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const result = await runEmbAgent(["onboard"], ctx.cwd);
      if (!result.ok) return toolTextResult(errorText(result), result);
      markContextDirty(ctx.cwd);
      return toolTextResult(renderNextLines(result.value).join("\n") || JSON.stringify(result.value, null, 2), result.value);
    },
  });

  pi.registerTool({
    name: "emb_subagent",
    label: "emb subagent",
    description: "Run emb-agent native firmware subagents in isolated headless Pi sessions. Use before broad firmware/system-framework work.",
    promptSnippet: "Run emb-agent native firmware subagents before broad work",
    promptGuidelines: ["Use emb_subagent before broad firmware work that spans hardware, architecture, power, drivers, framework, or verification."],
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Original user request or focused delegated task" },
        roles: { type: "array", items: { type: "string", enum: ["hw-scout", "fw-doer", "arch-reviewer", "sys-reviewer", "bug-hunter", "release-checker"] } },
      },
      additionalProperties: false,
    } as Record<string, unknown>,
    renderCall(args: Record<string, unknown>, theme: any) {
      const roles = Array.isArray(args.roles) ? args.roles.join(", ") : "auto";
      return new Text(`${theme.bold("emb_subagent")} ${theme.fg("dim", roles)}`, 0, 0);
    },
    renderResult(result: any, { isPartial }: any, theme: any) {
      const details = result?.details as EmbSubagentProgress | undefined;
      if (details?.kind === "emb-agent-subagent-progress") {
        return new Text(renderSubagentProgress(details, !isPartial), 0, 0);
      }
      const text = result?.content?.[0]?.text || "emb-agent subagents complete";
      return new Text(theme.fg("muted", String(text)), 0, 0);
    },
    async execute(_toolCallId, params: Record<string, unknown>, signal, onUpdate, ctx) {
      const pending = pendingNativeDispatch.get(ctx.cwd);
      if (pending && dispatchRequiresKnowledgePriming(pending.plan) && !hasFreshKnowledgePriming(ctx.cwd, pending, knowledgePriming)) {
        return toolTextResult(`emb_subagent blocked: ${knowledgePrimingRequiredReason(pending.plan.targetTask)}`, { status: "blocked", reason: "knowledge_search_required" });
      }
      const context = await prepareEmbContext(ctx.cwd);
      const prompt = String(params.prompt || pending?.prompt || "").trim();
      if (!prompt) return toolTextResult("emb_subagent error: missing prompt", { status: "error" });
      const requestedRoles = Array.isArray(params.roles) ? params.roles.map(String).filter((role) => SUPPORTED_AGENT_NAMES.has(role)) : undefined;
      const basePlan = pending?.plan || buildDispatchPlan(prompt, context?.result || pending?.result || {});
      const dispatch: SubagentDispatchPlan = requestedRoles && requestedRoles.length
        ? {
            ...basePlan,
            mode: requestedRoles.length > 1 ? basePlan.mode : "single",
            reason: `${basePlan.reason} Manual roles preserved with target-task scoped prompts.`,
            runs: requestedRoles.map((role) => ({
              role,
              intent: READ_ONLY_AGENT_NAMES.has(role) ? (role === "release-checker" ? "verification" : "evidence") : "implementation",
              writable: !READ_ONLY_AGENT_NAMES.has(role),
              targetTask: basePlan.targetTask,
              prompt: rolePrompt(role, READ_ONLY_AGENT_NAMES.has(role) ? (role === "release-checker" ? "verification" : "evidence") : "implementation", prompt, context?.result || pending?.result || {}, basePlan.targetTask),
            })),
          }
        : basePlan;
      const roles = dispatch.runs.map((run) => run.role).filter((role) => SUPPORTED_AGENT_NAMES.has(role));
      if (!roles.length) return toolTextResult("emb_subagent error: no supported roles", { status: "error" });
      const batch = await runEmbSubagentBatch(ctx.cwd, prompt, dispatch, context?.result || pending?.result, signal, onUpdate);
      pendingNativeDispatch.delete(ctx.cwd);
      const guard = dispatchGuards.get(ctx.cwd);
      if (guard) {
        guard.phase = "results-injected";
        guard.until = Date.now() + RAW_SUBAGENT_OUTPUT_GUARD_MS;
        guard.reason = "emb-agent native subagent results have been injected as hidden context. Synthesize the final answer; do not retrieve or print raw subagent output.";
      }
      await pi.sendMessage({
        customType: "emb-agent-subagent-results",
        content:
          `${EMB_HIDDEN_RESULTS_MARKER}\n` +
          `Original user request: ${prompt}\n\n` +
          "The following native emb-agent subagent results are hidden from the user but available to the main agent. Synthesize the final user-facing answer now. Do not paste raw reports. If implementation appears complete, remind the user that task closure is a parent-agent step: AAR, task status, attention/architecture/compound/wiki notes can be written directly without launching more subagents unless the user asks for extra review.\n\n" +
          batch.output,
        display: false,
      } as any, { deliverAs: "followUp", triggerTurn: true } as any);
      const summary = batch.results.map((r) => `${r.role}:${r.status}`).join(", ");
      return toolTextResult(`Native emb-agent subagents finished (${summary}). Results were injected as hidden context for synthesis.`, batch.details);
    },
  });

  pi.registerTool({
    name: "knowledge_search",
    label: "knowledge search",
    description: "Search emb-agent native project knowledge index across truth files, PRDs, tasks, wiki, compound notes, and parsed document chunks. The tool auto-diagnoses and refreshes stale/missing native indexes before searching. Prefer this before broad manual/file searches.",
    promptSnippet: "Search emb-agent native project knowledge",
    promptGuidelines: ["Use knowledge_search for project knowledge, design rationale, PRD/task context, register/peripheral/manual evidence, and wiki-backed answers before broad file scans."],
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", default: 8 },
        rerank: { type: "boolean", default: true },
        refresh: { type: "boolean", default: false },
      },
      required: ["query"],
      additionalProperties: false,
    } as Record<string, unknown>,
    async execute(_toolCallId, params: Record<string, unknown>, _signal, _onUpdate, ctx) {
      const args = ["knowledge", "search", "--query", String(params.query || ""), "--limit", String(Number(params.limit || 8))];
      if (params.rerank !== false) args.push("--rerank");
      const diagnose = await runEmbAgent(["knowledge", "diagnose"], ctx.cwd, { timeoutMs: FAST_TIMEOUT_MS, maxBuffer: FAST_MAX_BUFFER });
      const diag = diagnose.ok ? (diagnose.value as any) : undefined;
      const shouldRefresh = Boolean(params.refresh) || !diagnose.ok || diag?.status === "missing" || diag?.status === "stale" || diag?.stale === true || Number(diag?.chunks || 0) === 0 || Number(diag?.sources || 0) === 0;
      if (shouldRefresh) args.push("--refresh");
      const result = await runEmbAgent(args, ctx.cwd, { timeoutMs: INGEST_TIMEOUT_MS, maxBuffer: INGEST_MAX_BUFFER });
      if (!result.ok) return toolTextResult(errorText(result), result);
      const graphReport = await runEmbAgent(["knowledge", "graph", "report"], ctx.cwd, { timeoutMs: FAST_TIMEOUT_MS, maxBuffer: FAST_MAX_BUFFER, allowNonJson: true });
      const graphReportText = graphReport.ok ? graphReport.stdout : `${graphReport.message}\n${graphReport.stdout || ""}\n${graphReport.stderr || ""}`;
      const graphNeedsRefresh = !graphReport.ok || /stale\s*[:=]\s*true|graph-stale|graph\.json not found|Trigger .*graph refresh/i.test(graphReportText);
      let graphRefreshed = false;
      if (shouldRefresh || graphNeedsRefresh) {
        const graph = await runEmbAgent(["knowledge", "graph", "refresh"], ctx.cwd, { timeoutMs: INGEST_TIMEOUT_MS, maxBuffer: FAST_MAX_BUFFER });
        graphRefreshed = graph.ok;
      }
      knowledgePriming.set(ctx.cwd, { tool: "knowledge_search", query: String(params.query || ""), createdAt: Date.now() });
      const prefix = shouldRefresh || graphNeedsRefresh
        ? `[knowledge ${shouldRefresh ? "index refreshed" : "index current"}; graph ${graphRefreshed ? "refreshed" : "refresh skipped/failed"} before search]\n`
        : "";
      return toolTextResult(prefix + result.stdout.trim(), result.value);
    },
  });

  pi.registerTool({
    name: "knowledge_diagnose",
    label: "knowledge diagnose",
    description: "Report emb-agent native knowledge index/manifest/cache status and stale sources.",
    promptSnippet: "Diagnose emb-agent native knowledge index",
    parameters: { type: "object", properties: {}, additionalProperties: false } as Record<string, unknown>,
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const result = await runEmbAgent(["knowledge", "diagnose"], ctx.cwd, { timeoutMs: FAST_TIMEOUT_MS, maxBuffer: FAST_MAX_BUFFER });
      if (!result.ok) return toolTextResult(errorText(result), result);
      return toolTextResult(result.stdout.trim(), result.value);
    },
  });

  pi.registerTool({
    name: "knowledge_graph_query",
    label: "knowledge graph query",
    description: "Query emb-agent native knowledge graph relationships for chips, registers, parsed docs, truth, tasks, wiki, and formulas.",
    promptSnippet: "Query emb-agent native knowledge graph",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, explain: { type: "boolean", default: false } },
      required: ["query"],
      additionalProperties: false,
    } as Record<string, unknown>,
    async execute(_toolCallId, params: Record<string, unknown>, _signal, _onUpdate, ctx) {
      const sub = params.explain ? "explain" : "query";
      const refresh = await runEmbAgent(["knowledge", "graph", "refresh"], ctx.cwd, { timeoutMs: INGEST_TIMEOUT_MS, maxBuffer: FAST_MAX_BUFFER });
      if (!refresh.ok) return toolTextResult(errorText(refresh), refresh);
      const result = await runEmbAgent(["knowledge", "graph", sub, String(params.query || "")], ctx.cwd, { timeoutMs: FAST_TIMEOUT_MS, maxBuffer: FAST_MAX_BUFFER });
      if (!result.ok) return toolTextResult(errorText(result), result);
      return toolTextResult("[knowledge graph refreshed before query]\n" + result.stdout.trim(), result.value);
    },
  });
  pi.registerTool({
    name: "emb_session_search",
    label: "emb session search",
    description: "Search local Pi/Codex session transcripts for cross-session emb-agent memory without external runtime dependencies.",
    promptSnippet: "Search local Pi/Codex sessions for previous context",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", default: 8 },
      },
      required: ["query"],
      additionalProperties: false,
    } as Record<string, unknown>,
    async execute(_toolCallId, params: Record<string, unknown>, _signal, _onUpdate, ctx) {
      const limit = String(Number(params.limit || 8));
      const result = await runEmbAgent(["mem", "search", "--query", String(params.query || ""), "--limit", limit], ctx.cwd, { timeoutMs: FAST_TIMEOUT_MS, maxBuffer: FAST_MAX_BUFFER });
      if (!result.ok) return toolTextResult(errorText(result), result);
      const hits = Array.isArray((result.value as any).hits) ? (result.value as any).hits : [];
      if (!hits.length) return toolTextResult("No matching local Claude/Codex/Pi sessions found.", { hits: [] });
      const text = hits.map((hit: any, index: number) => `${index + 1}. ${hit.session?.platform || "session"} ${hit.session?.id || ""}\n   ${hit.session?.path || ""}\n   ${(hit.preview || "").slice(0, 500)}`).join("\n");
      return toolTextResult(text, { hits, source: "emb-agent-rs mem search" });
    },
  });

  pi.registerTool({
    name: "emb_session_extract",
    label: "emb session extract",
    description: "Extract cleaned local Pi/Codex session dialogue by path or id, optionally sliced by phase.",
    promptSnippet: "Extract local session dialogue for session insight",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        id: { type: "string" },
        phase: { type: "string", enum: ["all", "brainstorm", "implement"], default: "all" },
      },
      additionalProperties: false,
    } as Record<string, unknown>,
    async execute(_toolCallId, params: Record<string, unknown>, _signal, _onUpdate, ctx) {
      const phase = (["all", "brainstorm", "implement"].includes(String(params.phase)) ? String(params.phase) : "all") as "all" | "brainstorm" | "implement";
      const args = ["mem", "extract", "--phase", phase];
      const id = String(params.id || params.path || "").trim();
      if (id) args.push(id);
      const result = await runEmbAgent(args, ctx.cwd, { timeoutMs: FAST_TIMEOUT_MS, maxBuffer: FAST_MAX_BUFFER, allowNonJson: true });
      if (!result.ok) return toolTextResult(errorText(result), result);
      const dialogue = (result.stdout || String((result.value as any).summary || "")).slice(0, MAX_SUBAGENT_OUTPUT);
      return toolTextResult(dialogue || "(empty session slice)", { phase, source: "emb-agent-rs mem extract", id });
    },
  });

  pi.registerTool({
    name: "ingest_doc",
    label: "ingest doc",
    description: "Parse/cache a PDF/manual/datasheet/document, or route schematic files to emb-agent ingest schematic. Use this instead of reading raw PDFs or binary SchDoc files.",
    promptSnippet: "Parse/cache a PDF/manual/datasheet/document or schematic through emb-agent ingest",
    promptGuidelines: ["Use ingest_doc for PDFs, datasheets, manuals, DOC/PPT/XLS files, and document evidence before reading cached markdown.", "If file is .SchDoc/.sch/.kicad_sch or kind=schematic, this tool routes to ingest schematic; do not send schematic files to MinerU."],
    parameters: {
      type: "object",
      properties: {
        file: { type: "string", description: "Document path relative to the project root" },
        provider: { type: "string", enum: ["auto", "local", "mineru"], default: "auto" },
        kind: { type: "string", default: "datasheet", description: "Use 'schematic' for .SchDoc/.sch/.kicad_sch files; those are routed to ingest schematic." },
        to: { type: "string", default: "hardware" },
        title: { type: "string" },
        language: { type: "string" },
        pages: { type: "string" },
        modelVersion: { type: "string" },
        force: { type: "boolean" },
        isOcr: { type: "boolean" },
        enableTable: { type: "boolean" },
        enableFormula: { type: "boolean" },
        timeoutMs: { type: "number" },
        format: { type: "string", description: "Optional schematic format override, e.g. altium-raw, altium-json, bom-csv, netlist" },
      },
      required: ["file"],
    } as Record<string, unknown>,
    async execute(_toolCallId, params: Record<string, unknown>, _signal, onUpdate, ctx) {
      let cliArgs: string[];
      try { cliArgs = buildIngestDocArgs(params); }
      catch (error: any) { return toolTextResult(error?.message || String(error), { status: "error" }); }
      onUpdate?.(toolTextResult(`Running emb-agent ${cliArgs.join(" ")}`));
      const timeoutMs = Number(params.timeoutMs || 0) || INGEST_TIMEOUT_MS;
      const result = await runEmbAgent(cliArgs, ctx.cwd, { timeoutMs, maxBuffer: INGEST_MAX_BUFFER });
      if (!result.ok) return toolTextResult(errorText(result), result);
      markContextDirty(ctx.cwd);
      return toolTextResult(renderIngestLines(result.value).join("\n"), result.value);
    },
  });

  pi.registerTool({
    name: "doc_lookup",
    label: "doc lookup",
    description: "Search parsed emb-agent document/manual cache by keyword.",
    promptSnippet: "Search parsed emb-agent document/manual cache by keyword",
    parameters: {
      type: "object",
      properties: { keyword: { type: "string" }, chip: { type: "string" } },
      required: ["keyword"],
    } as Record<string, unknown>,
    async execute(_toolCallId, params: Record<string, unknown>, _signal, _onUpdate, ctx) {
      const args = ["doc", "lookup", "--keyword", String(params.keyword || "")];
      if (params.chip) args.push("--chip", String(params.chip));
      const result = await runEmbAgent(args, ctx.cwd, { timeoutMs: FAST_TIMEOUT_MS, maxBuffer: INGEST_MAX_BUFFER });
      if (!result.ok) return toolTextResult(errorText(result), result);
      return toolTextResult(result.stdout.trim(), result.value);
    },
  });

  pi.registerTool({
    name: "doc_fetch",
    label: "doc fetch",
    description: "Fetch cached parsed markdown for a document path, or cached parsed schematic JSON for SchDoc/schematic paths. Use after ingest_doc/ingest schematic, not on raw PDFs before ingest.",
    promptSnippet: "Fetch cached parsed markdown or schematic parse for a source path",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } as Record<string, unknown>,
    async execute(_toolCallId, params: Record<string, unknown>, _signal, _onUpdate, ctx) {
      const result = await runEmbAgent(["doc", "fetch", "--path", String(params.path || "")], ctx.cwd, { timeoutMs: FAST_TIMEOUT_MS, maxBuffer: INGEST_MAX_BUFFER, allowNonJson: true });
      if (!result.ok) return toolTextResult(errorText(result), result);
      return toolTextResult(result.stdout.trim(), { path: params.path });
    },
  });

  pi.registerTool({
    name: "ask_user_question",
    label: "Ask User Question",
    description: "Ask the user structured questions before making ambiguous product, hardware, or migration decisions. Supports option lists and custom answers.",
    promptSnippet: "Ask the user structured questions before making ambiguous decisions",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              header: { type: "string" },
              multiSelect: { type: "boolean" },
              allowCustom: { type: "boolean" },
              options: { type: "array", items: { type: "object", properties: { label: { type: "string" }, description: { type: "string" } }, required: ["label"] } },
            },
            required: ["question", "options"],
          },
        },
      },
      required: ["questions"],
    } as Record<string, unknown>,
    async execute(_toolCallId, params: Record<string, unknown>, _signal, _onUpdate, ctx) {
      const questions = (params.questions as QuestionDef[]) || [];
      if (!questions.length) return toolTextResult("Error: no questions provided", { status: "error" });
      const hasInteractiveUi = (ctx as any).hasUI !== false && !!ctx.ui?.select && !!ctx.ui?.input;
      if (!hasInteractiveUi) return toolTextResult(`UI not available. Ask these questions in chat:\n${questions.map(questionSummary).join("\n\n")}`, { status: "needs_chat_fallback", questions });

      const answers: QuestionnaireAnswer[] = [];
      for (const q of questions) {
        const options = [...(q.options || []).map((o) => o.label), ...(q.allowCustom === false ? [] : ["Type custom answer"]), "Cancel"];
        const selected = await ctx.ui.select(questionSummary(q), options);
        if (!selected || selected === "Cancel") return toolTextResult("Cancelled by user", { cancelled: true, answers });
        if (selected === "Type custom answer") {
          const custom = await ctx.ui.input(q.question, "Type answer...");
          answers.push({ question: q.question, selected: [], custom: custom ? [custom] : [] });
        } else {
          answers.push({ question: q.question, selected: [selected] });
        }
      }
      const result: QuestionnaireResult = { answers, cancelled: false };
      return toolTextResult(JSON.stringify(result), result);
    },
  });
}
