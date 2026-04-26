'use strict';

const runtime = require('./runtime.cjs');

function createLifecycleHookHelpers(deps) {
  const { fs, path, process: proc } = deps;

  const VALID_EVENTS = ['after_create', 'after_start', 'after_finish', 'after_archive'];

  function getLifecycleHooks(projectConfig) {
    if (!projectConfig || typeof projectConfig !== 'object') {
      return {};
    }
    const hooks = projectConfig.lifecycle_hooks;
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
      return {};
    }
    const result = {};
    for (const event of VALID_EVENTS) {
      if (Array.isArray(hooks[event])) {
        result[event] = hooks[event].filter(item => typeof item === 'string' && item.trim());
      }
    }
    return result;
  }

  function getHooksForEvent(projectConfig, event) {
    const hooks = getLifecycleHooks(projectConfig);
    return hooks[event] || [];
  }

  function executeHook(projectRoot, hookName, taskName) {
    const extDir = runtime.getProjectExtDir(projectRoot);
    const projectConfigPath = runtime.resolveProjectDataPath(projectRoot, 'project.json');

    let projectConfig = {};
    if (fs.existsSync(projectConfigPath)) {
      try {
        projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
      } catch {}
    }

    const executors = (projectConfig.executors || {});
    const skills = (projectConfig.quality_gates || {}).required_skills || [];

    if (executors[hookName]) {
      const executor = executors[hookName];
      return {
        type: 'executor',
        name: hookName,
        command: executor.command || `executor run ${hookName}`,
        note: `Lifecycle hook executor: ${hookName}`
      };
    }

    if (skills.includes(hookName)) {
      return {
        type: 'skill',
        name: hookName,
        command: `skills run ${hookName}`,
        note: `Lifecycle hook skill: ${hookName}`
      };
    }

    if (hookName === 'scope-capture') {
      return {
        type: 'builtin',
        name: 'scope-capture',
        command: `task scope infer ${taskName || '<task>'}`,
        note: 'Auto-infer task scope from hw.yaml and req.yaml'
      };
    }

    if (hookName === 'board-bench') {
      return {
        type: 'builtin',
        name: 'board-bench',
        command: 'verify confirm board-bench',
        note: 'Board-bench signoff required. Run verify to see the template.'
      };
    }

    if (hookName === 'rom-ram-check') {
      return {
        type: 'builtin',
        name: 'rom-ram-check',
        command: 'skills run xc8-build --verify-against specs/mcu/rom-ram-budget.md',
        note: 'Build and check ROM/RAM against budget'
      };
    }

    return {
      type: 'unknown',
      name: hookName,
      command: `skills run ${hookName}`,
      note: `Unknown lifecycle hook: ${hookName}. Install the skill or register an executor.`
    };
  }

  function buildLifecycleTriggerLines(projectConfig, event, taskName) {
    const hooks = getHooksForEvent(projectConfig, event);
    if (hooks.length === 0) {
      return [];
    }

    const lines = [
      `Lifecycle hooks for ${event}:`,
      ...hooks.map(h => {
        const resolved = executeHook(null, h, taskName);
        return `  - ${h} (${resolved.type}): ${resolved.command}`;
      })
    ];

    return lines;
  }

  return {
    getLifecycleHooks,
    getHooksForEvent,
    executeHook,
    buildLifecycleTriggerLines,
    VALID_EVENTS
  };
}

module.exports = { createLifecycleHookHelpers };
