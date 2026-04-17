'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runtime = require(path.join(__dirname, '..', 'runtime', 'lib', 'runtime.cjs'));
const storeHelpers = require(path.join(__dirname, '..', 'runtime', 'lib', 'project-state-store.cjs'));

test('project state store initializes session and persists session/handoff updates', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-store-root-'));
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-store-proj-'));
  const runtimeConfig = {
    project_state_dir: 'state/projects',
    legacy_project_state_dir: 'state/legacy-projects',
    lock_timeout_ms: 200,
    lock_stale_ms: 200,
    max_last_files: 12
  };

  const store = storeHelpers.createProjectStateStoreHelpers({
    fs,
    path,
    runtime,
    RUNTIME_CONFIG: runtimeConfig,
    getProjectStatePaths() {
      return runtime.getProjectStatePaths(tempRoot, tempProject, runtimeConfig);
    },
    normalizeSession(session, paths) {
      return {
        session_version: 1,
        project_root: paths.projectRoot,
        project_key: paths.projectKey,
        project_name: path.basename(paths.projectRoot),
        project_profile: session.project_profile || 'baremetal-8bit',
        active_packs: session.active_packs || ['sensor-node'],
        preferences: session.preferences || {},
        focus: session.focus || '',
        last_files: session.last_files || [],
        open_questions: session.open_questions || [],
        known_risks: session.known_risks || [],
        last_command: session.last_command || '',
        paused_at: session.paused_at || '',
        last_resumed_at: session.last_resumed_at || '',
        created_at: session.created_at || new Date().toISOString(),
        updated_at: session.updated_at || new Date().toISOString()
      };
    },
    readDefaultSession(paths) {
      return {
        session_version: 1,
        project_root: paths.projectRoot,
        project_key: paths.projectKey,
        project_name: path.basename(paths.projectRoot),
        project_profile: 'baremetal-8bit',
        active_packs: ['sensor-node'],
        preferences: {},
        focus: '',
        last_files: [],
        open_questions: [],
        known_risks: [],
        last_command: '',
        paused_at: '',
        last_resumed_at: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    }
  });

  const initial = store.loadSession();
  assert.equal(initial.project_root, tempProject);
  assert.equal(fs.existsSync(runtime.getProjectStatePaths(tempRoot, tempProject, runtimeConfig).sessionPath), true);

  const updated = store.updateSession(current => {
    current.last_command = 'plan';
    current.last_files = ['main.c'];
  });
  assert.equal(updated.last_command, 'plan');
  assert.deepEqual(updated.last_files, ['main.c']);

  store.saveHandoff({
    version: '1.0',
    timestamp: new Date().toISOString(),
    status: 'paused',
    focus: 'timer drift',
    profile: 'baremetal-8bit',
    packs: ['sensor-node'],
    last_command: 'pause',
    suggested_flow: 'scan -> debug',
    next_action: 'resume timer drift',
    context_notes: 'capture timer drift before bench retest',
    human_actions_pending: [],
    last_files: ['main.c'],
    open_questions: ['why drift grows'],
    known_risks: ['divider restore may fail']
  });

  const handoff = store.loadHandoff();
  assert.equal(handoff.next_action, 'resume timer drift');
  assert.deepEqual(handoff.last_files, ['main.c']);

  store.saveContextSummary({
    version: '1.0',
    generated_at: new Date().toISOString(),
    source: 'pause',
    focus: 'timer drift',
    profile: 'baremetal-8bit',
    packs: ['sensor-node'],
    last_command: 'pause',
    suggested_flow: 'scan -> debug',
    next_action: 'resume timer drift',
    context_notes: 'capture timer drift before bench retest',
    last_files: ['main.c'],
    open_questions: ['why drift grows'],
    known_risks: ['divider restore may fail'],
    active_task: {
      name: 'timer-drift',
      title: 'Investigate timer drift',
      status: 'active',
      path: '.emb-agent/tasks/timer-drift.json'
    },
    diagnostics: {
      latest_forensics: {
        report_file: '.emb-agent/reports/forensics/drift.md',
        highest_severity: 'high',
        problem: 'timer drift grows after resume'
      },
      latest_executor: {
        name: 'bench',
        status: 'failed',
        risk: 'high',
        exit_code: 7,
        stderr_preview: 'device handshake timeout',
        stdout_preview: 'resume bench started'
      }
    }
  });

  const contextSummary = store.loadContextSummary();
  assert.equal(contextSummary.next_action, 'resume timer drift');
  assert.equal(contextSummary.active_task.name, 'timer-drift');
  assert.equal(contextSummary.diagnostics.latest_executor.name, 'bench');

  store.clearHandoff();
  assert.equal(store.loadHandoff(), null);
  store.clearContextSummary();
  assert.equal(store.loadContextSummary(), null);
});

test('project state store falls back to readonly session mode when lock file cannot be created', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-store-ro-root-'));
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-store-ro-proj-'));
  const runtimeConfig = {
    project_state_dir: 'state/projects',
    legacy_project_state_dir: 'state/legacy-projects',
    lock_timeout_ms: 200,
    lock_stale_ms: 200,
    max_last_files: 12
  };
  const realFs = fs;
  const readonlyFs = {
    ...realFs,
    openSync(filePath, flags, mode) {
      if (String(filePath).endsWith('.lock') && flags === 'wx') {
        const error = new Error('read-only state');
        error.code = 'EROFS';
        throw error;
      }
      return realFs.openSync(filePath, flags, mode);
    }
  };

  const store = storeHelpers.createProjectStateStoreHelpers({
    fs: readonlyFs,
    path,
    runtime,
    RUNTIME_CONFIG: runtimeConfig,
    getProjectStatePaths() {
      return runtime.getProjectStatePaths(tempRoot, tempProject, runtimeConfig);
    },
    normalizeSession(session, paths) {
      return {
        session_version: 1,
        project_root: paths.projectRoot,
        project_key: paths.projectKey,
        project_name: path.basename(paths.projectRoot),
        project_profile: session.project_profile || '',
        active_packs: session.active_packs || [],
        preferences: session.preferences || {},
        focus: session.focus || '',
        last_files: session.last_files || [],
        open_questions: session.open_questions || [],
        known_risks: session.known_risks || [],
        last_command: session.last_command || '',
        paused_at: session.paused_at || '',
        last_resumed_at: session.last_resumed_at || '',
        created_at: session.created_at || new Date().toISOString(),
        updated_at: session.updated_at || new Date().toISOString()
      };
    },
    readDefaultSession(paths) {
      return {
        session_version: 1,
        project_root: paths.projectRoot,
        project_key: paths.projectKey,
        project_name: path.basename(paths.projectRoot),
        project_profile: '',
        active_packs: [],
        preferences: {},
        focus: '',
        last_files: [],
        open_questions: [],
        known_risks: [],
        last_command: '',
        paused_at: '',
        last_resumed_at: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    }
  });

  const updated = store.updateSession(current => {
    current.last_command = 'init';
    current.last_files = ['main.c'];
  });

  assert.equal(updated.last_command, 'init');
  assert.deepEqual(updated.last_files, ['main.c']);
  assert.equal(fs.existsSync(runtime.getProjectStatePaths(tempRoot, tempProject, runtimeConfig).lockPath), false);
});

test('project state store falls back to writable temp state dir when primary state storage is readonly', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-store-fb-root-'));
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-store-fb-proj-'));
  const fallbackStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-store-fb-state-'));
  const runtimeConfig = {
    project_state_dir: 'state/projects',
    legacy_project_state_dir: 'state/legacy-projects',
    lock_timeout_ms: 200,
    lock_stale_ms: 200,
    max_last_files: 12
  };
  const previousFallbackDir = process.env.EMB_AGENT_PROJECT_STATE_FALLBACK_DIR;
  const realMkdirSync = fs.mkdirSync;
  const realWriteFileSync = fs.writeFileSync;
  const realOpenSync = fs.openSync;

  process.env.EMB_AGENT_PROJECT_STATE_FALLBACK_DIR = fallbackStateDir;

  const expectedPaths = runtime.getProjectStatePaths(tempRoot, tempProject, runtimeConfig);
  const readonlyPrefix = `${path.resolve(expectedPaths.primaryStateDir)}${path.sep}`;

  function isReadonlyPrimaryPath(filePath) {
    const normalized = path.resolve(String(filePath));
    return normalized === path.resolve(expectedPaths.primaryStateDir) || normalized.startsWith(readonlyPrefix);
  }

  fs.mkdirSync = function patchedMkdirSync(filePath, options) {
    if (isReadonlyPrimaryPath(filePath)) {
      const error = new Error('read-only primary state dir');
      error.code = 'EROFS';
      throw error;
    }
    return realMkdirSync.call(this, filePath, options);
  };

  fs.writeFileSync = function patchedWriteFileSync(filePath, data, options) {
    if (isReadonlyPrimaryPath(filePath)) {
      const error = new Error('read-only primary state dir');
      error.code = 'EROFS';
      throw error;
    }
    return realWriteFileSync.call(this, filePath, data, options);
  };

  fs.openSync = function patchedOpenSync(filePath, flags, mode) {
    if (isReadonlyPrimaryPath(filePath)) {
      const error = new Error('read-only primary state dir');
      error.code = 'EROFS';
      throw error;
    }
    return realOpenSync.call(this, filePath, flags, mode);
  };

  try {
    const store = storeHelpers.createProjectStateStoreHelpers({
      fs,
      path,
      runtime,
      RUNTIME_CONFIG: runtimeConfig,
      getProjectStatePaths() {
        return runtime.getProjectStatePaths(tempRoot, tempProject, runtimeConfig);
      },
      normalizeSession(session, paths) {
        return {
          session_version: 1,
          project_root: paths.projectRoot,
          project_key: paths.projectKey,
          project_name: path.basename(paths.projectRoot),
          project_profile: session.project_profile || '',
          active_packs: session.active_packs || [],
          preferences: session.preferences || {},
          focus: session.focus || '',
          last_files: session.last_files || [],
          open_questions: session.open_questions || [],
          known_risks: session.known_risks || [],
          last_command: session.last_command || '',
          paused_at: session.paused_at || '',
          last_resumed_at: session.last_resumed_at || '',
          created_at: session.created_at || new Date().toISOString(),
          updated_at: session.updated_at || new Date().toISOString()
        };
      },
      readDefaultSession(paths) {
        return {
          session_version: 1,
          project_root: paths.projectRoot,
          project_key: paths.projectKey,
          project_name: path.basename(paths.projectRoot),
          project_profile: '',
          active_packs: [],
          preferences: {},
          focus: '',
          last_files: [],
          open_questions: [],
          known_risks: [],
          last_command: '',
          paused_at: '',
          last_resumed_at: '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      }
    });

    const updated = store.updateSession(current => {
      current.last_command = 'prefs set';
      current.preferences = { truth_source_mode: 'hardware_first' };
    });

    assert.equal(updated.last_command, 'prefs set');
    assert.deepEqual(updated.preferences, { truth_source_mode: 'hardware_first' });
    assert.equal(fs.existsSync(expectedPaths.primarySessionPath), false);
    assert.equal(fs.existsSync(expectedPaths.fallbackSessionPath), true);

    const reloaded = store.loadSession();
    assert.equal(reloaded.last_command, 'prefs set');
    assert.deepEqual(reloaded.preferences, { truth_source_mode: 'hardware_first' });
  } finally {
    fs.mkdirSync = realMkdirSync;
    fs.writeFileSync = realWriteFileSync;
    fs.openSync = realOpenSync;
    if (previousFallbackDir === undefined) {
      delete process.env.EMB_AGENT_PROJECT_STATE_FALLBACK_DIR;
    } else {
      process.env.EMB_AGENT_PROJECT_STATE_FALLBACK_DIR = previousFallbackDir;
    }
  }
});
