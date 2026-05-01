'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const {
  createContextProtocolRuntime
} = require(path.join(repoRoot, 'runtime', 'lib', 'context-protocol-runtime.cjs'));

function createDeps(options = {}) {
  let initialized = options.initialized === true;
  const calls = {
    runInitCommand: [],
    buildDispatchContext: []
  };

  const runtimeHost = { cliCommand: 'emb-agent' };

  const deps = {
    fs: {
      existsSync(filePath) {
        return filePath.endsWith('.emb-agent/project.json') ? initialized : false;
      }
    },
    runtime: {
      resolveProjectDataPath(projectRoot, name) {
        return path.join(projectRoot, '.emb-agent', name);
      }
    },
    runtimeEventHelpers: {
      appendRuntimeEvent(payload, event) {
        return {
          ...payload,
          runtime_events: {
            latest: event
          }
        };
      }
    },
    externalAgent: {
      buildStartProtocol(host, payload) {
        return { entrypoint: 'start', host, payload };
      },
      buildNextProtocol(host, payload) {
        return { entrypoint: 'next', host, payload };
      },
      buildStatusProtocol(host, payload) {
        return { entrypoint: 'status', host, payload };
      },
      buildHealthProtocol(host, payload) {
        return { entrypoint: 'health', host, payload };
      },
      buildDispatchNextProtocol(host, payload) {
        return { entrypoint: 'dispatch-next', host, payload };
      },
      buildInitProtocol(host, payload) {
        return { entrypoint: 'init', host, payload };
      }
    },
    boardEvidence: {
      summarizeBoardEvidence() {
        return { state: 'missing' };
      }
    },
    resolveProjectRoot() {
      return '/project';
    },
    getRuntimeHost() {
      return runtimeHost;
    },
    resolveSession() {
      return {
        session: {
          default_package: '',
          active_package: ''
        }
      };
    },
    buildCurrentSessionView() {
      return {
        session_state: { last_command: 'status' },
        handoff: null,
        reports: { reports: [] },
        latest_report: null,
        continuity: null
      };
    },
    buildStatus() {
      return {
        active_task: null
      };
    },
    buildNextContext() {
      return {
        next: {
          command: 'scan',
          reason: 'Need scan',
          cli: 'emb-agent capability run scan'
        },
        workflow_stage: {
          name: 'selection'
        }
      };
    },
    buildBootstrapReport() {
      return {
        quickstart: null,
        next_stage: null,
        action_card: null
      };
    },
    buildHealthReport() {
      return {
        command: 'health'
      };
    },
    loadContextSummary() {
      return {
        source: 'test'
      };
    },
    runInitCommand(tokens, aliasUsed) {
      calls.runInitCommand.push({ tokens, aliasUsed });
      initialized = true;
      return {
        initialized: true,
        init_alias: aliasUsed
      };
    },
    buildInitGuidance() {
      return {
        selected_identity: {
          model: 'PMS150G'
        }
      };
    },
    buildBootstrapSummary() {
      return {
        status: 'ready-for-next',
        command: 'next',
        summary: 'Ready'
      };
    },
    buildResumeContext() {
      return null;
    },
    getActiveTask() {
      return null;
    },
    loadHandoff() {
      return null;
    },
    buildTaskIntake() {
      return {
        modes: []
      };
    },
    buildStartWorkflow() {
      return [
        {
          id: 'scan'
        }
      ];
    },
    buildDispatchContext(command) {
      calls.buildDispatchContext.push(command);
      return {
        command
      };
    }
  };

  return { deps, calls };
}

test('context protocol start initializes project before building start context', () => {
  const { deps, calls } = createDeps({ initialized: false });
  const runtime = createContextProtocolRuntime(deps);

  const start = runtime.buildStartContext();

  assert.deepEqual(calls.runInitCommand, [
    {
      tokens: [],
      aliasUsed: 'start'
    }
  ]);
  assert.equal(start.entry, 'start');
  assert.equal(start.summary.initialized, true);
  assert.equal(start.immediate.command, 'task add <summary>');
  assert.equal(start.immediate.cli, 'emb-agent task add <summary>');
  assert.equal(start.runtime_events.latest.type, 'workflow-start');
});

test('context protocol wraps external protocols with runtime host and live contexts', () => {
  const { deps, calls } = createDeps({ initialized: true });
  const runtime = createContextProtocolRuntime(deps);

  const start = runtime.buildExternalStartProtocol();
  const next = runtime.buildExternalNextProtocol();
  const status = runtime.buildExternalStatusProtocol();
  const health = runtime.buildExternalHealthProtocol();
  const dispatchNext = runtime.buildExternalDispatchNextProtocol();
  const initialized = runtime.buildExternalInitProtocol(['--user', 'welkon'], 'init');

  assert.equal(start.entrypoint, 'start');
  assert.equal(start.host.cliCommand, 'emb-agent');
  assert.equal(start.payload.entry, 'start');
  assert.equal(next.entrypoint, 'next');
  assert.equal(next.payload.next.command, 'scan');
  assert.equal(status.entrypoint, 'status');
  assert.equal(status.payload.active_task, null);
  assert.equal(health.entrypoint, 'health');
  assert.equal(health.payload.command, 'health');
  assert.equal(dispatchNext.entrypoint, 'dispatch-next');
  assert.deepEqual(dispatchNext.payload, { command: 'next' });
  assert.deepEqual(calls.buildDispatchContext, ['next']);
  assert.equal(initialized.entrypoint, 'init');
  assert.equal(initialized.payload.init_alias, 'init');
});
