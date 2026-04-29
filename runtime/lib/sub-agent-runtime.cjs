'use strict';

function createSubAgentRuntimeHelpers(deps) {
  const {
    fs,
    path,
    process,
    childProcess,
    runtimeHost,
    runtime,
    resolveSession,
    loadMarkdown,
    AGENTS_DIR,
    getProjectStatePaths
  } = deps;

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function getRuntimeHost() {
    return typeof runtimeHost === 'function' ? runtimeHost() : runtimeHost;
  }

  const MANUAL_WORKER_SYNTHESIS_STATUS = 'manual-workers-required';

  function toStringArray(value) {
    return Array.isArray(value) ? value.map(item => String(item)) : [];
  }

  function normalizeStringList(value, fallback) {
    const items = toStringArray(value).map(item => item.trim()).filter(Boolean);
    return items.length > 0 ? items : fallback.slice();
  }

  function getDelegationJobsState() {
    const paths = typeof getProjectStatePaths === 'function'
      ? getProjectStatePaths()
      : null;
    if (!paths || !paths.stateDir || !paths.projectKey) {
      throw new Error('Project state paths are required for delegation jobs');
    }

    runtime.ensureDir(paths.stateDir);
    const jobsDir = path.join(paths.stateDir, 'delegation-jobs', paths.projectKey);
    runtime.ensureDir(jobsDir);

    return {
      paths,
      jobsDir
    };
  }

  function buildJobId(agent, phase) {
    const agentSlug = String(agent || 'worker')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'worker';
    const phaseSlug = String(phase || 'research')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 16) || 'research';
    const random = Math.random().toString(36).slice(2, 8);

    return `deleg-${Date.now().toString(36)}-${agentSlug}-${phaseSlug}-${random}`;
  }

  function getJobFilePath(jobsDir, jobId) {
    return path.join(jobsDir, `${jobId}.json`);
  }

  function readJobFile(filePath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return isObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeJobFile(filePath, value) {
    runtime.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  }

  function buildJobSummary(job) {
    const source = isObject(job) ? job : {};
    const workerResult = isObject(source.worker_result) ? source.worker_result : {};
    return {
      id: source.id || '',
      agent: source.agent || workerResult.agent || '',
      phase: source.phase || workerResult.phase || '',
      status: source.status || '',
      fresh_context: Boolean(
        source.fresh_context_required === true ||
        workerResult.fresh_context === true
      ),
      launched_at: source.launched_at || '',
      updated_at: source.updated_at || '',
      job_file: source.job_file ? path.relative(process.cwd(), source.job_file) : ''
    };
  }

  function summarizeBridgeForOutput(bridge, overrideStatus) {
    const source = isObject(bridge) ? bridge : {};
    return {
      available: Boolean(source.available),
      invoked: source.invoked === undefined ? false : Boolean(source.invoked),
      mode: source.mode || '',
      source: source.source || '',
      command: source.command || '',
      status: overrideStatus || source.status || ''
    };
  }

  function getDispatchContract(context) {
    if (isObject(context) && isObject(context.dispatch_contract)) {
      return context.dispatch_contract;
    }
    if (isObject(context) && isObject(context.agent_execution) && isObject(context.agent_execution.dispatch_contract)) {
      return context.agent_execution.dispatch_contract;
    }
    return null;
  }

  function getAgentExecution(context) {
    if (isObject(context) && isObject(context.agent_execution)) {
      return context.agent_execution;
    }
    if (getDispatchContract(context)) {
      return {
        available: true,
        recommended: true,
        mode: context && context.workflow && context.workflow.strategy
          ? String(context.workflow.strategy)
          : 'primary-first'
      };
    }
    return { available: false, recommended: false, mode: 'inline-preferred' };
  }

  function loadAgentInstructions(agentName) {
    try {
      return loadMarkdown(AGENTS_DIR, agentName, 'Agent');
    } catch {
      return {
        name: agentName,
        path: '',
        content: ''
      };
    }
  }

  function selectLaunchRequests(context) {
    const contract = getDispatchContract(context);
    const execution = getAgentExecution(context);
    if (!contract || !execution.available || !execution.recommended) {
      return [];
    }

    const requests = [];
    if (isObject(contract.primary)) {
      requests.push(contract.primary);
    }

    const strategy = String(
      (context && context.workflow && context.workflow.strategy) ||
      (contract.primary_first === false ? 'primary-plus-parallel' : 'primary-first')
    ).trim();
    const shouldLaunchSupporting = ['primary-plus-parallel', 'primary-plus-supporting'].includes(strategy);

    if (shouldLaunchSupporting && Array.isArray(contract.supporting)) {
      contract.supporting.forEach(item => {
        if (isObject(item)) {
          requests.push(item);
        }
      });
    }

    return requests;
  }

  function normalizeWorkerContract(request) {
    const call = isObject(request) ? request : {};
    const source = isObject(call.worker_contract) ? call.worker_contract : {};
    const toolScope = isObject(call.tool_scope) ? call.tool_scope : {};
    const readOnlyOutputs = [
      'stdout: compact worker_result JSON only',
      'Optional files_considered array with repo-relative paths'
    ];
    const writeOutputs = [
      'Only the exact repo files named by the synthesized specification in this prompt',
      'stdout: compact worker_result JSON summarizing the change'
    ];

    return {
      goal: String(source.goal || call.purpose || 'Execute the assigned worker task').trim(),
      inputs: normalizeStringList(source.inputs, [
        'Context Bundle entries explicitly listed in this prompt',
        'Agent instructions loaded from agents show <agent>'
      ]),
      outputs: normalizeStringList(source.outputs, toolScope.allows_write === true ? writeOutputs : readOnlyOutputs),
      forbidden_zones: normalizeStringList(source.forbidden_zones, [
        'Any file or side effect outside the declared Outputs',
        'Recursive delegation, hidden sub-teams, or orchestration-state mutations',
        toolScope.allows_write === true
          ? 'Any repository mutation outside the declared Outputs'
          : 'Any repository file write or mutation'
      ]),
      acceptance_criteria: normalizeStringList(source.acceptance_criteria, [
        'Return a compact JSON object matching the Output Contract in this prompt',
        'Keep status within ok | failed | blocked and keep findings as an array',
        toolScope.allows_write === true
          ? 'If repository files are modified, keep every changed path inside Outputs and report them in files_considered'
          : 'Do not modify repository files; Outputs must remain stdout-only'
      ])
    };
  }

  function buildWorkerPrompt(context, request, instructions) {
    const resolved = resolveSession();
    const call = isObject(request) ? request : {};
    const session = resolved && resolved.session ? resolved.session : {};
    const contract = getDispatchContract(context) || {};
    const synthesis = isObject(contract.synthesis_contract) ? contract.synthesis_contract : {};
    const contextBundle = isObject(call.context_bundle) ? call.context_bundle : {};
    const toolScope = isObject(call.tool_scope) ? call.tool_scope : {};
    const workerContract = normalizeWorkerContract(call);
    const lines = [
      `# emb-agent worker launch`,
      '',
      `agent: ${call.agent || ''}`,
      `role: ${call.role || ''}`,
      `phase: ${call.delegation_phase || ''}`,
      `context_mode: ${call.context_mode || ''}`,
      `requested_action: ${context.requested_action || ''}`,
      `resolved_action: ${context.resolved_action || ''}`,
      `project_root: ${session.project_root || process.cwd()}`,
      `focus: ${session.focus || ''}`,
      '',
      '## Purpose',
      call.purpose || '(none)',
      '',
      '## Ownership',
      call.ownership || '(none)',
      '',
      '## Worker Contract',
      '### Goal',
      workerContract.goal || '(none)',
      '',
      '### Inputs',
      ...workerContract.inputs.map(item => `- ${item}`),
      '',
      '### Outputs',
      ...workerContract.outputs.map(item => `- ${item}`),
      '',
      '### Forbidden Zones',
      ...workerContract.forbidden_zones.map(item => `- ${item}`),
      '',
      '### Acceptance Criteria',
      ...workerContract.acceptance_criteria.map(item => `- ${item}`),
      '',
      '## Agent Instructions',
      instructions && instructions.content ? instructions.content.trim() : '(missing)',
      '',
      '## Context Bundle',
      JSON.stringify(contextBundle, null, 2),
      '',
      '## Tool Scope',
      JSON.stringify({
        role_profile: toolScope.role_profile || '',
        allows_write: Boolean(toolScope.allows_write),
        allows_delegate: Boolean(toolScope.allows_delegate),
        allows_background_work: Boolean(toolScope.allows_background_work),
        preferred_tools: toStringArray(toolScope.preferred_tools),
        disallowed_tools: toStringArray(toolScope.disallowed_tools)
      }, null, 2),
      '',
      '## Expected Output',
      ...(toStringArray(call.expected_output).length > 0
        ? toStringArray(call.expected_output).map(item => `- ${item}`)
        : ['- (none)']),
      '',
      '## Synthesis Constraint',
      synthesis.rule || 'Synthesize, do not delegate understanding',
      '',
      '## Output Contract',
      'Return a compact JSON object with:',
      '- status: ok | failed | blocked',
      '- summary: concise result summary',
      '- output_kind: research | implementation | verification | review',
      '- findings: array of concise facts or conclusions',
      '- recommended_next_step: concise next step for the main thread',
      '- files_considered: optional array of repo-relative paths',
      '',
      '## Critical Rules',
      '- Work from this prompt only; do not assume hidden prior conversation.',
      '- Do not change the worker contract. If it is wrong, fail fast instead of rewriting it.',
      '- Do not spawn or delegate further work.',
      '- Keep conclusions explicit and separate facts from inference.',
      '- If this is verification or fresh-self-contained work, preserve independence from implementation assumptions.'
    ];

    return lines.join('\n');
  }

  function buildLaunchEnvelope(context, request) {
    const call = isObject(request) ? request : {};
    const instructions = loadAgentInstructions(call.agent || '');
    const freshContextRequired =
      call.context_mode === 'fresh-self-contained' ||
      (getDispatchContract(context) &&
        getDispatchContract(context).pattern_constraints &&
        getDispatchContract(context).pattern_constraints.verification_requires_fresh_context === true &&
        call.delegation_phase === 'verification');

    return {
      worker: {
        agent: call.agent || '',
        role: call.role || '',
        phase: call.delegation_phase || '',
        blocking: call.blocking !== false,
        context_mode: call.context_mode || '',
        continue_vs_spawn: freshContextRequired ? 'spawn-fresh' : 'continue-when-context-overlaps',
        fresh_context_required: freshContextRequired,
        purpose: call.purpose || '',
        ownership: call.ownership || '',
        expected_output: toStringArray(call.expected_output),
        tool_scope: isObject(call.tool_scope) ? call.tool_scope : {},
        worker_contract: normalizeWorkerContract(call)
      },
      instructions: {
        name: instructions.name || call.agent || '',
        path: instructions.path || '',
        content: instructions.content || ''
      },
      prompt: buildWorkerPrompt(context, call, instructions),
      contract: getDispatchContract(context)
    };
  }

  function buildBridgePayload(context, launchEnvelope, executionMeta) {
    const resolved = resolveSession();
    const session = resolved && resolved.session ? resolved.session : {};
    return {
      version: '1.0',
      host: {
        name: getRuntimeHost().name,
        label: getRuntimeHost().label,
        subagent_bridge: getRuntimeHost().subagentBridge || {}
      },
      session: {
        project_root: session.project_root || process.cwd(),
        project_profile: session.project_profile || '',
        active_specs: toStringArray(session.active_specs),
        focus: session.focus || ''
      },
      orchestration: {
        source: context.source || '',
        requested_action: executionMeta.requested_action || context.requested_action || '',
        resolved_action: executionMeta.resolved_action || context.resolved_action || '',
        entered_via: executionMeta.entered_via || '',
        execution_kind: executionMeta.kind || '',
        workflow: isObject(context.workflow) ? context.workflow : null,
        dispatch_contract: getDispatchContract(context)
      },
      launch: launchEnvelope
    };
  }

  function normalizeWorkerResult(launchEnvelope, bridgeResponse, bridgeError) {
    const response = isObject(bridgeResponse) ? bridgeResponse : {};
    const worker = response.worker_result && isObject(response.worker_result)
      ? response.worker_result
      : {};
    const envelopeWorker = launchEnvelope.worker || {};
    const status = bridgeError
      ? 'bridge-error'
      : (worker.status || response.status || 'ok');

    return {
      agent: worker.agent || envelopeWorker.agent || '',
      phase: worker.phase || envelopeWorker.phase || '',
      status,
      summary: worker.summary || response.summary || bridgeError || '',
      output_kind: worker.output_kind || response.output_kind || 'research',
      fresh_context: worker.fresh_context === undefined
        ? Boolean(envelopeWorker.fresh_context_required)
        : Boolean(worker.fresh_context),
      updated_at: worker.updated_at || new Date().toISOString()
    };
  }

  function terminalJobStatus(workerResult, bridge) {
    const status = String(workerResult && workerResult.status ? workerResult.status : '').trim();
    const bridgeStatus = String(bridge && bridge.status ? bridge.status : '').trim();
    if (status === 'ok') {
      return 'completed';
    }
    if (bridgeStatus === 'bridge-unavailable' || status === 'blocked') {
      return 'blocked';
    }
    return 'failed';
  }

  function invokeBridgePayload(payload, launchEnvelope) {
    const bridge = (getRuntimeHost().subagentBridge) || { available: false };
    const bridgeArgv = Array.isArray(bridge.command_argv) ? bridge.command_argv : [];
    if (!bridge.available || !bridge.command || bridgeArgv.length === 0) {
      if (bridge.available && bridge.mode === 'mock') {
        return {
          bridge: {
            available: true,
            invoked: true,
            source: bridge.source || 'env',
            command: bridge.command,
            status: 'ok'
          },
          worker_result: normalizeWorkerResult(launchEnvelope, {
            status: 'ok',
            worker_result: {
              agent: launchEnvelope.worker.agent,
              phase: launchEnvelope.worker.phase,
              status: 'ok',
              summary: `${launchEnvelope.worker.agent} completed ${launchEnvelope.worker.phase || 'research'}`,
              output_kind: launchEnvelope.worker.phase === 'verification' ? 'verification' : 'research',
              fresh_context: Boolean(launchEnvelope.worker.fresh_context_required),
              updated_at: new Date().toISOString()
            }
          })
        };
      }
      return {
        bridge: {
          available: false,
          invoked: false,
          source: bridge.source || 'none',
          command: '',
          status: 'bridge-unavailable'
        },
        worker_result: normalizeWorkerResult(launchEnvelope, {
          status: 'bridge-unavailable',
          summary: 'Host sub-agent bridge is not configured'
        })
      };
    }

    const result = childProcess.spawnSync(bridgeArgv[0], bridgeArgv.slice(1), {
      cwd: payload.session.project_root || process.cwd(),
      input: JSON.stringify(payload, null, 2),
      encoding: 'utf8',
      timeout: bridge.timeout_ms || 15000,
      env: {
        ...process.env,
        EMB_AGENT_WORKER_AGENT: String(payload.launch.worker.agent || ''),
        EMB_AGENT_WORKER_PHASE: String(payload.launch.worker.phase || '')
      }
    });

    if (result.error) {
      return {
        bridge: {
          available: true,
          invoked: true,
          source: bridge.source || 'env',
          command: bridge.command,
          status: 'bridge-error',
          error: result.error.message
        },
        worker_result: normalizeWorkerResult(launchEnvelope, null, result.error.message)
      };
    }

    let parsed = null;
    try {
      parsed = result.stdout ? JSON.parse(String(result.stdout)) : {};
    } catch {
      parsed = {
        status: result.status === 0 ? 'ok' : 'failed',
        summary: String(result.stdout || '').trim().slice(0, 400)
      };
    }

    return {
      bridge: {
        available: true,
        invoked: true,
        source: bridge.source || 'env',
        command: bridge.command,
        status: result.status === 0 ? 'ok' : 'failed',
        exit_code: result.status,
        stderr: String(result.stderr || '').trim()
      },
      worker_result: normalizeWorkerResult(launchEnvelope, parsed)
    };
  }

  function isPidRunning(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
      return false;
    }

    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return Boolean(error && error.code === 'EPERM');
    }
  }

  function launchAsyncBridgeJob(payload, launchEnvelope) {
    const state = getDelegationJobsState();
    const bridge = (getRuntimeHost().subagentBridge) || { available: false };
    const jobId = buildJobId(launchEnvelope.worker.agent, launchEnvelope.worker.phase);
    const jobFile = getJobFilePath(state.jobsDir, jobId);
    const now = new Date().toISOString();
    if (bridge.mode === 'mock') {
      const workerResult = normalizeWorkerResult(launchEnvelope, {
        status: 'ok',
        worker_result: {
          agent: launchEnvelope.worker.agent,
          phase: launchEnvelope.worker.phase,
          status: 'ok',
          summary: `${launchEnvelope.worker.agent} completed ${launchEnvelope.worker.phase || 'research'}`,
          output_kind: launchEnvelope.worker.phase === 'verification' ? 'verification' : 'research',
          fresh_context: Boolean(launchEnvelope.worker.fresh_context_required),
          updated_at: now
        }
      });
      const completedRecord = {
        version: '1.0',
        id: jobId,
        agent: launchEnvelope.worker.agent || '',
        phase: launchEnvelope.worker.phase || '',
        status: 'completed',
        launched_at: now,
        updated_at: now,
        fresh_context_required: Boolean(launchEnvelope.worker.fresh_context_required),
        project_root: payload.session && payload.session.project_root ? payload.session.project_root : process.cwd(),
        bridge: {
          available: true,
          mode: bridge.mode || 'mock',
          source: bridge.source || '',
          command: bridge.command || '',
          command_argv: [],
          timeout_ms: bridge.timeout_ms || 15000,
          status: 'ok'
        },
        launch: launchEnvelope,
        payload,
        worker_result: workerResult,
        job_file: jobFile
      };
      writeJobFile(jobFile, completedRecord);

      return {
        bridge: summarizeBridgeForOutput(bridge, 'launched'),
        job: buildJobSummary(completedRecord),
        worker_result: null
      };
    }

    const bridgeArgv = Array.isArray(bridge.command_argv) ? bridge.command_argv : [];
    const stdoutPath = path.join(state.jobsDir, `${jobId}.stdout.json`);
    const stderrPath = path.join(state.jobsDir, `${jobId}.stderr.log`);
    const stdoutFd = fs.openSync(stdoutPath, 'w');
    const stderrFd = fs.openSync(stderrPath, 'w');
    const record = {
      version: '1.0',
      id: jobId,
      agent: launchEnvelope.worker.agent || '',
      phase: launchEnvelope.worker.phase || '',
      status: 'running',
      launched_at: now,
      updated_at: now,
      fresh_context_required: Boolean(launchEnvelope.worker.fresh_context_required),
      project_root: payload.session && payload.session.project_root ? payload.session.project_root : process.cwd(),
      bridge: {
        available: Boolean(bridge.available),
        mode: bridge.mode || '',
        source: bridge.source || '',
        command: bridge.command || '',
        command_argv: bridgeArgv,
        timeout_ms: bridge.timeout_ms || 15000,
        status: 'launched'
      },
      launch: launchEnvelope,
      payload,
      worker_result: null,
      stdout_path: stdoutPath,
      stderr_path: stderrPath
    };

    if (!bridge.command || bridgeArgv.length === 0) {
      fs.closeSync(stdoutFd);
      fs.closeSync(stderrFd);
      const blockedRecord = {
        ...record,
        status: 'blocked',
        updated_at: now,
        bridge: {
          ...record.bridge,
          status: 'bridge-unavailable'
        }
      };
      writeJobFile(jobFile, {
        ...blockedRecord,
        job_file: jobFile
      });

      return {
        bridge: summarizeBridgeForOutput(bridge, 'bridge-unavailable'),
        job: buildJobSummary({
          ...blockedRecord,
          job_file: jobFile
        }),
        worker_result: null
      };
    }

    const child = childProcess.spawn(bridgeArgv[0], bridgeArgv.slice(1), {
      cwd: record.project_root,
      detached: true,
      stdio: ['pipe', stdoutFd, stderrFd],
      windowsHide: true,
      env: {
        ...process.env,
        EMB_AGENT_WORKER_AGENT: String(payload.launch.worker.agent || ''),
        EMB_AGENT_WORKER_PHASE: String(payload.launch.worker.phase || '')
      }
    });
    child.stdin.end(JSON.stringify(payload, null, 2));
    child.unref();
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);

    writeJobFile(jobFile, {
      ...record,
      pid: child.pid,
      job_file: jobFile
    });

    return {
      bridge: summarizeBridgeForOutput(bridge, 'launched'),
      job: buildJobSummary({
        ...record,
        job_file: jobFile
      }),
      worker_result: null
    };
  }

  function executeBridgeJobNow(payload, launchEnvelope) {
    const state = getDelegationJobsState();
    const bridge = (getRuntimeHost().subagentBridge) || { available: false };
    const jobId = buildJobId(launchEnvelope.worker.agent, launchEnvelope.worker.phase);
    const jobFile = getJobFilePath(state.jobsDir, jobId);
    const launchedAt = new Date().toISOString();
    const invocation = invokeBridgePayload(payload, launchEnvelope);
    const workerResult = invocation.worker_result || null;
    const record = {
      version: '1.0',
      id: jobId,
      agent: launchEnvelope.worker.agent || '',
      phase: launchEnvelope.worker.phase || '',
      status: terminalJobStatus(workerResult, invocation.bridge),
      launched_at: launchedAt,
      updated_at: workerResult && workerResult.updated_at ? workerResult.updated_at : new Date().toISOString(),
      fresh_context_required: Boolean(launchEnvelope.worker.fresh_context_required),
      project_root: payload.session && payload.session.project_root ? payload.session.project_root : process.cwd(),
      bridge: {
        available: Boolean(invocation.bridge && invocation.bridge.available),
        mode: bridge.mode || '',
        source: invocation.bridge && invocation.bridge.source ? invocation.bridge.source : (bridge.source || ''),
        command: invocation.bridge && invocation.bridge.command ? invocation.bridge.command : (bridge.command || ''),
        command_argv: Array.isArray(bridge.command_argv) ? bridge.command_argv : [],
        timeout_ms: bridge.timeout_ms || 15000,
        status: invocation.bridge && invocation.bridge.status ? invocation.bridge.status : ''
      },
      launch: launchEnvelope,
      payload,
      worker_result: workerResult,
      job_file: jobFile
    };

    writeJobFile(jobFile, record);

    return {
      bridge: invocation.bridge,
      job: buildJobSummary(record),
      worker_result: workerResult
    };
  }

  function collectSubAgentBridgeJobs() {
    const state = getDelegationJobsState();
    const resolved = resolveSession();
    const diagnostics =
      resolved && resolved.session && resolved.session.diagnostics && isObject(resolved.session.diagnostics.delegation_runtime)
        ? resolved.session.diagnostics.delegation_runtime
        : {};
    const declaredJobs = Array.isArray(diagnostics.jobs) ? diagnostics.jobs : [];
    const knownIds = declaredJobs
      .map(item => item && item.id ? String(item.id) : '')
      .filter(Boolean);
    const candidateFiles = knownIds.length > 0
      ? knownIds.map(id => getJobFilePath(state.jobsDir, id))
      : fs.readdirSync(state.jobsDir)
        .filter(name => name.endsWith('.json'))
        .map(name => path.join(state.jobsDir, name));

    const jobs = [];
    const workerResults = [];
    candidateFiles.forEach(filePath => {
      if (!fs.existsSync(filePath)) {
        return;
      }
      const record = readJobFile(filePath);
      if (!record) {
        return;
      }
      let nextRecord = record;
      if (record.status === 'running' && !isPidRunning(Number(record.pid || 0))) {
        const stdout = record.stdout_path && fs.existsSync(record.stdout_path)
          ? String(fs.readFileSync(record.stdout_path, 'utf8') || '').trim()
          : '';
        const stderr = record.stderr_path && fs.existsSync(record.stderr_path)
          ? String(fs.readFileSync(record.stderr_path, 'utf8') || '').trim()
          : '';
        let parsed = null;
        try {
          parsed = stdout ? JSON.parse(stdout) : {};
        } catch {
          parsed = {
            status: stderr ? 'failed' : 'ok',
            summary: stdout || stderr
          };
        }
        const workerResult = normalizeWorkerResult(
          record.launch && isObject(record.launch) ? record.launch : { worker: { agent: record.agent, phase: record.phase } },
          parsed,
          stderr && !stdout ? stderr : ''
        );
        nextRecord = {
          ...record,
          status: terminalJobStatus(workerResult, {
            status: workerResult.status === 'ok' ? 'ok' : 'failed'
          }),
          updated_at: workerResult.updated_at || new Date().toISOString(),
          bridge: {
            ...(isObject(record.bridge) ? record.bridge : {}),
            status: workerResult.status === 'ok' ? 'ok' : 'failed',
            stderr
          },
          worker_result: workerResult
        };
        writeJobFile(filePath, nextRecord);
      }
      jobs.push(buildJobSummary(nextRecord));
      if (isObject(nextRecord.worker_result)) {
        workerResults.push(nextRecord.worker_result);
      }
    });

    let synthesisStatus = jobs.length === 0
      ? (diagnostics.synthesis && diagnostics.synthesis.status ? diagnostics.synthesis.status : 'pending')
      : 'running';

    if (jobs.length > 0 && jobs.every(item => ['completed', 'failed', 'blocked'].includes(item.status))) {
      synthesisStatus = workerResults.some(item => item && item.status === 'ok')
        ? 'ready'
        : jobs.some(item => item.status === 'blocked')
          ? MANUAL_WORKER_SYNTHESIS_STATUS
          : 'blocked-worker-results';
    }

    return {
      jobs,
      worker_results: workerResults,
      synthesis_status: synthesisStatus,
      collected_at: new Date().toISOString()
    };
  }

  function runSubAgentBridge(context, executionMeta, options) {
    const runOptions = isObject(options) ? options : {};
    const waitForResults = runOptions.wait !== false;
    const launchRequests = selectLaunchRequests(context);
    if (launchRequests.length === 0) {
      return {
        bridge: {
          available: Boolean(getRuntimeHost().subagentBridge && getRuntimeHost().subagentBridge.available),
          invoked: false,
          source: getRuntimeHost().subagentBridge ? getRuntimeHost().subagentBridge.source : 'none',
          command: getRuntimeHost().subagentBridge ? getRuntimeHost().subagentBridge.command || '' : '',
          status: 'no-launches'
        },
        launch_requests: [],
        jobs: [],
        worker_results: [],
        synthesis_status: 'pending'
      };
    }

    const launchEnvelopes = launchRequests.map(request => buildLaunchEnvelope(context, request));
    const bridge = getRuntimeHost().subagentBridge || { available: false };
    if (!bridge.available) {
      return {
        bridge: summarizeBridgeForOutput(bridge, 'bridge-unavailable'),
        launch_requests: launchEnvelopes.map(item => item.worker),
        jobs: [],
        worker_results: [],
        synthesis_status: MANUAL_WORKER_SYNTHESIS_STATUS
      };
    }

    const workerResults = [];
    const jobs = [];
    let lastBridge = {
      available: Boolean(bridge && bridge.available),
      invoked: false,
      mode: bridge.mode || '',
      source: bridge.source || 'none',
      command: bridge.command || '',
      status: 'idle'
    };

    launchEnvelopes.forEach(envelope => {
      const payload = buildBridgePayload(context, envelope, executionMeta || {});
      const invocation = waitForResults
        ? executeBridgeJobNow(payload, envelope)
        : launchAsyncBridgeJob(payload, envelope);
      lastBridge = invocation.bridge;
      if (invocation.job) {
        jobs.push(invocation.job);
      }
      if (invocation.worker_result) {
        workerResults.push(invocation.worker_result);
      }
    });

    const synthesisStatus = waitForResults
      ? (workerResults.some(item => item.status === 'ok')
        ? 'ready'
        : (lastBridge.status === 'bridge-unavailable' ? MANUAL_WORKER_SYNTHESIS_STATUS : 'blocked-worker-results'))
      : 'running';

    return {
      bridge: lastBridge,
      launch_requests: launchEnvelopes.map(item => item.worker),
      jobs,
      worker_results: workerResults,
      synthesis_status: synthesisStatus
    };
  }

  return {
    buildLaunchEnvelope,
    buildWorkerPrompt,
    collectSubAgentBridgeJobs,
    runSubAgentBridge
  };
}

module.exports = {
  createSubAgentRuntimeHelpers
};
