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

  store.clearHandoff();
  assert.equal(store.loadHandoff(), null);
});
