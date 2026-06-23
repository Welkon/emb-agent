/**
 * emb-agent Pi extension
 *
 * Unified Pi surface for emb-agent: project-state injection, slash commands,
 * Pi-native tools, PDF/document ingest routing, and Tintinweb Agent subagent sync.
 *
 * Requires: emb-agent installed via `npx emb-agent --target pi`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
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
  task_candidates?: Array<{ name: string }>;
  prd_task_candidates?: Array<{ name: string }>;
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

interface SubagentsRpcReply<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ModelRoute {
  model?: string;
  thinking?: string;
}

interface AutoDispatchResult {
  attempted: boolean;
  launched: Array<{ type: string; id?: string; description: string; model?: string; thinking?: string; fallback?: boolean }>;
  errors: string[];
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
  if (result.recommended_action) lines.push(`Recommended action: ${result.recommended_action}`);
  if (result.next) lines.push(`Next: ${String(result.next)}`);
  return lines;
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
// Tintinweb Agent subagent sync and auto-dispatch
// ---------------------------------------------------------------------------

const TINTINWEB_SUBAGENTS_PACKAGE = "npm:@tintinweb/pi-subagents";
const LEGACY_SUBAGENTS_PACKAGE = "npm:pi-subagents";

const TOOL_MAP: Record<string, string[]> = {
  Read: ["read"],
  Bash: ["bash"],
  Grep: ["grep"],
  Glob: ["find", "ls"],
};

const WRITE_CAPABLE_AGENTS = new Set(["fw-doer", "onboard"]);
const READ_ONLY_AGENT_NAMES = new Set(["hw-scout", "bug-hunter", "arch-reviewer", "sys-reviewer", "release-checker"]);
const DEFAULT_BACKGROUND_AGENT_NAMES = new Set(["hw-scout", "arch-reviewer", "sys-reviewer"]);

const DEFAULT_AUTO_AGENT_MODEL_ROUTES: Record<string, ModelRoute> = {
  "hw-scout": { model: "deepseek/deepseek-v4-flash", thinking: "off" },
  "release-checker": { model: "deepseek/deepseek-v4-flash", thinking: "off" },
  "Explore": { model: "deepseek/deepseek-v4-flash", thinking: "off" },
  "arch-reviewer": { model: "deepseek/deepseek-v4-pro", thinking: "high" },
  "bug-hunter": { model: "deepseek/deepseek-v4-pro", thinking: "high" },
  "sys-reviewer": { model: "deepseek/deepseek-v4-pro", thinking: "high" },
  "Plan": { model: "deepseek/deepseek-v4-pro", thinking: "high" },
  "fw-doer": { model: "custom/gpt-5.5", thinking: "xhigh" },
  "onboard": { model: "custom/gpt-5.5", thinking: "xhigh" },
};

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

  const routes = await loadModelRoutes(cwd);
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
    if (WRITE_CAPABLE_AGENTS.has(name)) { piTools.add("write"); piTools.add("edit"); }
    const runInBackground = DEFAULT_BACKGROUND_AGENT_NAMES.has(name) ? "\nrun_in_background: true" : "";
    const maxTurns = WRITE_CAPABLE_AGENTS.has(name) ? 40 : 25;
    const promptMode = WRITE_CAPABLE_AGENTS.has(name) ? "append" : "replace";

    const route = routes[name] || { model: "inherit", thinking: "high" };
    const modelLine = route.model ? `\nmodel: ${route.model}` : "";
    const thinkingLine = route.thinking ? `\nthinking: ${route.thinking}` : "";
    const out = `---\nname: ${name}\ndescription: ${desc}\ntools: ${[...piTools].join(", ")}\nextensions: false\nskills: false${modelLine}${thinkingLine}\nmax_turns: ${maxTurns}\nprompt_mode: ${promptMode}${runInBackground}\n---\n\n${body}`;
    await writeFile(join(piAgentsDir, file), out, "utf-8");
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

function configuredModelRoutes(settings: Record<string, unknown>): Record<string, ModelRoute> {
  const routes: Record<string, ModelRoute> = { ...DEFAULT_AUTO_AGENT_MODEL_ROUTES };
  const embAgent = settings.embAgent && typeof settings.embAgent === "object" && !Array.isArray(settings.embAgent)
    ? settings.embAgent as Record<string, unknown>
    : {};
  const userRoutes = embAgent.subagentModelRoutes && typeof embAgent.subagentModelRoutes === "object" && !Array.isArray(embAgent.subagentModelRoutes)
    ? embAgent.subagentModelRoutes as Record<string, unknown>
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

  const existingPackages = settings.packages;
  if (Array.isArray(existingPackages)) {
    const filtered = existingPackages.filter((pkg) => pkg !== LEGACY_SUBAGENTS_PACKAGE);
    if (!filtered.includes(TINTINWEB_SUBAGENTS_PACKAGE)) filtered.push(TINTINWEB_SUBAGENTS_PACKAGE);
    if (JSON.stringify(filtered) !== JSON.stringify(existingPackages)) {
      settings.packages = filtered;
      changed = true;
    }
  } else if (existingPackages === undefined) {
    settings.packages = [TINTINWEB_SUBAGENTS_PACKAGE];
    changed = true;
  } else {
    settings["embAgentWarning"] = `settings.packages is not an array; emb-agent could not auto-merge ${TINTINWEB_SUBAGENTS_PACKAGE}.`;
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
  }

  if (changed) {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  }
}

function onceEvent<T>(pi: ExtensionAPI, channel: string, timeoutMs = 1_500): Promise<SubagentsRpcReply<T>> {
  return new Promise((resolve) => {
    let settled = false;
    let off: unknown;
    const finish = (reply: SubagentsRpcReply<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof off === "function") (off as () => void)();
      resolve(reply);
    };
    const timer = setTimeout(() => finish({ success: false, error: `timeout waiting for ${channel}` }), timeoutMs);
    off = (pi.events as any).on(channel, (reply: SubagentsRpcReply<T>) => finish(reply));
  });
}

async function subagentsRpc<T>(pi: ExtensionAPI, name: "ping" | "spawn", payload: Record<string, unknown> = {}, timeoutMs = 1_500): Promise<SubagentsRpcReply<T>> {
  const requestId = randomUUID();
  const reply = onceEvent<T>(pi, `subagents:rpc:${name}:reply:${requestId}`, timeoutMs);
  pi.events.emit(`subagents:rpc:${name}`, { requestId, ...payload });
  return reply;
}

function promptLooksBroadFirmwareWork(prompt: string): boolean {
  const text = String(prompt || "").toLowerCase();
  return /系统框架|框架|架构|重构|整体|全局|梳理|迁移|移植|sdk|toolchain|工具链|bsp|hal|驱动|外设|多个|多路|睡眠|唤醒|低功耗|watchdog|看门狗|lvd|brownout|bootloader|升级|调度|scheduler|framework|architecture|refactor|migration|porting|peripheral|power|sleep|wake|timer|pwm|adc|uart|i2c|spi/.test(text);
}

function isPrdExploration(result: EmbAgentResult): boolean {
  const gate = String(result.agent_protocol?.gate?.kind || "").toLowerCase();
  const action = String(result.action || "").toLowerCase();
  return gate.includes("prd") || action === "clarify" || action === "prd-exploration";
}

function shouldAutoDispatchSubagents(prompt: string, result: EmbAgentResult): boolean {
  const policy = result.delegation_policy || result.agent_protocol?.gate?.delegation_policy;
  if (!policy?.applies_when_host_exposes_subagent_tool) return false;
  if (!promptLooksBroadFirmwareWork(prompt)) return false;
  return Boolean(policy.required_before_broad_work || isPrdExploration(result));
}

function rolePrompt(role: string, userPrompt: string, nextLines: string[]): string {
  const common = [
    "You are an emb-agent firmware subagent spawned automatically by the Pi integration.",
    "Work from the real repository files, not from parent chat memory. Keep output concise and evidence-backed.",
    "Do not modify files. This automatic pass is read-only reconnaissance/review before the parent agent edits.",
    "If the scope is unclear, report the missing evidence/questions instead of guessing.",
    "",
    "emb-agent runtime state:",
    nextLines.join("\n") || "(no emb-agent next lines)",
    "",
    "User request:",
    userPrompt,
  ].join("\n");
  if (role === "hw-scout") {
    return `${common}\n\nRole focus: locate hardware/register/manual/schematic/pin-map facts relevant to this broad work. Return source paths, exact facts, gaps, and risks that must constrain implementation.`;
  }
  if (role === "arch-reviewer") {
    return `${common}\n\nRole focus: review architecture/framework boundaries, scheduler/timing implications, ROM/RAM/ISR risks, and split the work into safe vertical slices. Return a practical plan and blockers.`;
  }
  return `${common}\n\nRole focus: system-level review across firmware, requirements, concurrency, power, and verification. Return concrete findings, validation routes, and risks before implementation.`;
}

function fallbackAgentType(role: string): string {
  if (role === "hw-scout") return "Explore";
  return "Plan";
}

function spawnOptions(description: string, cwd: string, route?: ModelRoute): Record<string, unknown> {
  const options: Record<string, unknown> = { description, run_in_background: true, cwd };
  if (route?.model && route.model !== "inherit") options.model = route.model;
  if (route?.thinking) options.thinking = route.thinking;
  return options;
}

async function spawnAutoSubagent(pi: ExtensionAPI, type: string, cwd: string, prompt: string, description: string, route?: ModelRoute): Promise<SubagentsRpcReply<{ id?: string }>> {
  return subagentsRpc<{ id?: string }>(pi, "spawn", {
    type,
    prompt,
    options: spawnOptions(description, cwd, route),
  }, 2_500);
}

async function autoDispatchSubagents(pi: ExtensionAPI, cwd: string, userPrompt: string, result: EmbAgentResult): Promise<AutoDispatchResult> {
  if (!shouldAutoDispatchSubagents(userPrompt, result)) return { attempted: false, launched: [], errors: [] };

  const ping = await subagentsRpc<{ version?: string }>(pi, "ping", {}, 1_000);
  if (!ping.success) return { attempted: true, launched: [], errors: [`Tintinweb subagents RPC unavailable: ${ping.error || "no reply"}`] };

  const routes = await loadModelRoutes(cwd);
  const nextLines = renderNextLines(result);
  const roles = isPrdExploration(result) ? ["hw-scout", "sys-reviewer"] : ["hw-scout", "arch-reviewer", "sys-reviewer"];
  const launched: Array<{ type: string; id?: string; description: string; model?: string; thinking?: string; fallback?: boolean }> = [];
  const errors: string[] = [];
  for (const type of roles) {
    if (!READ_ONLY_AGENT_NAMES.has(type)) continue;
    const description = `${type} broad preflight`;
    const prompt = rolePrompt(type, userPrompt, nextLines);
    const route = routes[type];
    let reply = await spawnAutoSubagent(pi, type, cwd, prompt, description, route);
    let launchedType = type;
    let launchedRoute = route;
    let usedFallback = false;
    if (!reply.success) {
      const fallback = fallbackAgentType(type);
      launchedRoute = routes[fallback] || route;
      reply = await spawnAutoSubagent(pi, fallback, cwd, prompt, `${description} (${fallback} fallback)`, launchedRoute);
      launchedType = fallback;
      usedFallback = true;
    }
    if (!reply.success && (launchedRoute?.model || launchedRoute?.thinking)) {
      reply = await spawnAutoSubagent(pi, launchedType, cwd, prompt, `${description} (inherit-model fallback)`, { model: "inherit" });
      launchedRoute = { model: "inherit" };
      usedFallback = true;
    }
    if (reply.success) launched.push({ type: launchedType, id: reply.data?.id, description, model: launchedRoute?.model, thinking: launchedRoute?.thinking, fallback: usedFallback });
    else errors.push(`${type}: ${reply.error || "spawn failed"}`);
  }
  return { attempted: true, launched, errors };
}

function renderAutoDispatch(dispatch: AutoDispatchResult | null): string {
  if (!dispatch?.attempted) return "";
  const lines = ["\n## emb-agent Automatic Subagent Dispatch"];
  if (dispatch.launched.length) {
    lines.push("Launched read-only Tintinweb Agent subagents before broad firmware work:");
    for (const item of dispatch.launched) {
      const model = item.model && item.model !== "inherit" ? ` model=${item.model}${item.thinking ? `:${item.thinking}` : ""}` : " model=inherit";
      lines.push(`- ${item.type}${item.id ? ` (${item.id})` : ""}: ${item.description}${model}${item.fallback ? " fallback=true" : ""}`);
    }
  }
  if (dispatch.errors.length) {
    lines.push("Subagent dispatch warnings:");
    for (const error of dispatch.errors) lines.push(`- ${error}`);
    lines.push(`If needed, install with: pi install ${TINTINWEB_SUBAGENTS_PACKAGE}`);
  }
  if (dispatch.launched.length) lines.push("Continue only with safe read-only parent work until subagent results arrive; use their findings before implementation.");
  return lines.join("\n");
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

function buildIngestDocArgs(params: Record<string, unknown>): string[] {
  const file = String(params.file || "").trim();
  if (!file) throw new Error("ingest_doc requires file");
  const args = ["ingest", "doc", "--file", file];
  const provider = String(params.provider || "auto").trim();
  if (provider) args.push("--provider", provider);
  const kind = String(params.kind || "datasheet").trim();
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
  const sub = args[0] === "doc" ? args.shift() : "doc";
  if (sub !== "doc") return null;
  const file = optionValue(args, "--file") || args[0];
  if (!file) return null;
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
      `Use Pi tools emb_next, emb_onboard, ingest_doc, doc_lookup, and doc_fetch instead of raw shell syntax when they match the task. ` +
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

  pi.on("before_agent_start", async (event, ctx) => {
    const context = await prepareEmbContext(ctx.cwd);
    if (!context?.text) return;
    const dispatch = context.result ? await autoDispatchSubagents(pi, ctx.cwd, String((event as any).prompt || ""), context.result) : null;
    const dispatchText = renderAutoDispatch(dispatch);
    return {
      message: {
        customType: "emb-agent-context",
        content: `emb-agent context injected (${new Date(context.updatedAt).toISOString()})${dispatchText}`,
        display: false,
      },
      systemPrompt: event.systemPrompt + context.text + (dispatchText ? `\n${dispatchText}` : ""),
    };
  });

  pi.on("turn_end", async (_event, ctx) => {
    await refreshStatus(ctx);
    markContextDirty(ctx.cwd);
  });

  pi.on("tool_call", async (event) => {
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
        `[/emb-next]\n${lines.length ? lines.join("\n") : JSON.stringify(result.value, null, 2)}\n\nRespond to the user from the runtime recommendation above. Follow agent_protocol.gate allowed/forbidden actions exactly. Use Pi tools for emb-agent actions; use ingest_doc for PDFs/manuals. Do not auto-activate a task without user confirmation.`,
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
    description: "Parse/cache documents with emb-agent (usage: /emb-ingest doc --file <path> [--provider auto|local|mineru])",
    handler: async (args, ctx) => {
      const params = parseEmbIngestArgs(args || "");
      if (!params) {
        await sendSteer("[/emb-ingest]\nUsage: /emb-ingest doc --file <path> [--provider auto|local|mineru] [--kind datasheet] [--to hardware]", ctx.cwd);
        return;
      }
      let cliArgs: string[];
      try { cliArgs = buildIngestDocArgs(params); }
      catch (error: any) { ctx.ui.notify(error?.message || String(error), "warning"); return; }
      const result = await runEmbAgent(cliArgs, ctx.cwd, { timeoutMs: Number(params.timeoutMs || 0) || INGEST_TIMEOUT_MS, maxBuffer: INGEST_MAX_BUFFER });
      if (!result.ok) { ctx.ui.notify(errorText(result), "warning"); return; }
      markContextDirty(ctx.cwd);
      await sendSteer(`[/emb-ingest]\n${renderIngestLines(result.value).join("\n")}\n\nUse doc_fetch/doc_lookup on the cached artifact, inspect sparse local parses, then rerun /emb-next.`, ctx.cwd);
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
    name: "ingest_doc",
    label: "ingest doc",
    description: "Parse/cache a PDF/manual/datasheet/document through emb-agent ingest doc. Use this instead of reading raw PDFs.",
    promptSnippet: "Parse/cache a PDF/manual/datasheet/document through emb-agent ingest doc",
    promptGuidelines: ["Use ingest_doc for PDFs, datasheets, manuals, DOC/PPT/XLS files, and document evidence before reading cached markdown."],
    parameters: {
      type: "object",
      properties: {
        file: { type: "string", description: "Document path relative to the project root" },
        provider: { type: "string", enum: ["auto", "local", "mineru"], default: "auto" },
        kind: { type: "string", default: "datasheet" },
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
    description: "Fetch cached parsed markdown for a document path. Use after ingest_doc, not on raw PDFs.",
    promptSnippet: "Fetch cached parsed markdown for a document path",
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
