#!/usr/bin/env node
// emb-hook-version: {{EMB_VERSION}}

'use strict';

const fs = require('fs');
const path = require('path');
const hookDispatchHelpers = require('../lib/hook-dispatch.cjs');
const hookTrustHelpers = require('../lib/hook-trust.cjs');
const runtimeHostHelpers = require('../lib/runtime-host.cjs');
const runtime = require('../lib/runtime.cjs');
const specLoader = require('../lib/spec-loader.cjs');

const HOOK_VERSION = '{{EMB_VERSION}}';
const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);
const hookDispatch = hookDispatchHelpers.createHookDispatchHelpers({
  fs,
  path,
  process,
  runtimeHost: RUNTIME_HOST
});

const SPEC_INJECTION_BUDGET = 8000;

function resolveProjectRoot(data) {
  return data.cwd ? path.resolve(data.cwd) : process.cwd();
}

function loadHwConfig(projectRoot) {
  const hwPath = runtime.resolveProjectDataPath(projectRoot, 'hw.yaml');
  if (!fs.existsSync(hwPath)) {
    return null;
  }
  try {
    return runtime.parseSimpleYaml(hwPath);
  } catch {
    return null;
  }
}

function loadTaskConfig(projectRoot, taskName) {
  if (!taskName) {
    return null;
  }
  const taskPath = path.join(runtime.getProjectExtDir(projectRoot), 'tasks', taskName, 'task.json');
  if (!fs.existsSync(taskPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(taskPath, 'utf8'));
  } catch {
    return null;
  }
}

function loadContextManifest(projectRoot, taskName) {
  if (!taskName) {
    return null;
  }
  const manifestPath = path.join(runtime.getProjectExtDir(projectRoot), 'tasks', taskName, 'context.yaml');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(manifestPath, 'utf8');
    const lines = content.split('\n');
    const manifest = { implement: [], check: [] };
    let section = '';
    for (const line of lines) {
      const sectionMatch = line.match(/^(\w+):\s*$/);
      if (sectionMatch) {
        section = sectionMatch[1];
        continue;
      }
      const pathMatch = line.match(/^\s*-\s*path:\s*(.+)/);
      if (pathMatch && section) {
        const reasonMatch = line.match(/reason:\s*(.+)/) || [''];
        manifest[section].push({
          path: pathMatch[1].trim(),
          reason: ''
        });
      }
    }
    return manifest;
  } catch {
    return null;
  }
}

function readFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function buildSubAgentInjection(projectRoot, taskName, agentType) {
  const hwConfig = loadHwConfig(projectRoot);
  const taskConfig = loadTaskConfig(projectRoot, taskName);
  const contextManifest = loadContextManifest(projectRoot, taskName);
  const scope = (taskConfig && Array.isArray(taskConfig.scope)) ? taskConfig.scope : ['mcu'];

  const specLoaderHelpers = specLoader.createSpecLoaderHelpers({ fs, path });
  const specsDir = path.join(runtime.getProjectExtDir(projectRoot), 'specs');

  const blocks = [];

  blocks.push('<emb-agent-subagent-context>');
  blocks.push('Hardware context auto-injected from project truth files.');
  blocks.push('Use these as the source of truth for hardware decisions.');
  blocks.push('</emb-agent-subagent-context>');

  if (hwConfig && Object.keys(hwConfig).length > 0) {
    blocks.push('<hw-config>');
    for (const [key, value] of Object.entries(hwConfig)) {
      if (value) {
        blocks.push(`${key}: ${value}`);
      }
    }
    blocks.push('</hw-config>');
  }

  const manifestFiles = contextManifest
    ? (agentType === 'check' ? contextManifest.check : contextManifest.implement)
    : [];

  if (manifestFiles.length > 0) {
    blocks.push('<manifest-files>');
    for (const file of manifestFiles) {
      const absPath = path.resolve(projectRoot, file.path);
      const content = readFileIfExists(absPath);
      if (content) {
        blocks.push(`=== ${file.path} ===\n${content}`);
      }
    }
    blocks.push('</manifest-files>');
  }

  const specFiles = specLoaderHelpers.loadSpecIndex(specsDir, scope);
  const filteredSpecs = specLoaderHelpers.filterSpecsByAppliesTo(specFiles, hwConfig, scope);
  if (filteredSpecs.length > 0) {
    const specBlock = specLoaderHelpers.buildSpecInjectionBlock(filteredSpecs, SPEC_INJECTION_BUDGET);
    if (specBlock) {
      blocks.push('<spec-constraints>');
      blocks.push(specBlock);
      blocks.push('</spec-constraints>');
    }
  }

  const chipProfilePath = hwConfig && hwConfig.chip
    ? path.join(runtime.getRuntimeRoot(), 'chips', 'profiles', `${hwConfig.chip}.json`)
    : null;
  if (chipProfilePath && fs.existsSync(chipProfilePath)) {
    const profileContent = readFileIfExists(chipProfilePath);
    if (profileContent) {
      try {
        const chipProfile = JSON.parse(profileContent);
        if (chipProfile.constraints && Object.keys(chipProfile.constraints).length > 0) {
          blocks.push('<chip-constraints>');
          blocks.push(JSON.stringify(chipProfile.constraints, null, 2));
          blocks.push('</chip-constraints>');
        }
      } catch {}
    }
  }

  blocks.push('<ready>');
  blocks.push('Hardware context is injected above. Do not search for MCU/pin/peripheral information.');
  blocks.push('Use the injected hw-config, spec-constraints, and chip-constraints as authoritative.');
  blocks.push('</ready>');

  return blocks.join('\n\n');
}

function isTaskToolCall(data) {
  const toolName = String(data.tool_name || data.toolName || '').trim();
  return toolName === 'Task' || toolName === 'task';
}

function extractAgentType(data) {
  const subagentType = String(data.subagent_type || data.subagentType || '').trim().toLowerCase();
  if (subagentType.includes('check') || subagentType.includes('review')) {
    return 'check';
  }
  if (subagentType.includes('research') || subagentType.includes('scout')) {
    return 'implement';
  }
  return 'implement';
}

function extractTaskName(data) {
  const prompt = String(data.prompt || data.description || '').trim();
  const taskMatch = prompt.match(/(?:task|tasks)\/([a-z0-9-]+)/i);
  if (taskMatch) {
    return taskMatch[1];
  }
  return null;
}

function buildPreToolUsePayload(data, injection) {
  if (RUNTIME_HOST.name === 'codex') {
    return {
      suppressOutput: true,
      systemMessage: `emb-agent hardware context injected (${injection.length} chars)`,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: injection
      }
    };
  }

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: injection
    }
  };
}

function runHook(rawInput) {
  return hookDispatch.runHookWithProjectContext(rawInput, ({ data, projectRoot }) => {
    if (!isTaskToolCall(data)) {
      return '';
    }

    const taskName = extractTaskName(data);
    if (!taskName) {
      return '';
    }

    const agentType = extractAgentType(data);
    const injection = buildSubAgentInjection(projectRoot, taskName, agentType);

    if (!injection) {
      return '';
    }

    return JSON.stringify(buildPreToolUsePayload(data, injection));
  });
}

if (require.main === module) {
  hookDispatch.runHookCli(runHook);
}

module.exports = { runHook, buildSubAgentInjection, isTaskToolCall, extractAgentType, extractTaskName };
