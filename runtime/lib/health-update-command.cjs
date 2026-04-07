'use strict';

const runtimeHostHelpers = require('./runtime-host.cjs');
const updateCheckHelpers = require('./update-check.cjs');

const RUNTIME_HOST = runtimeHostHelpers.resolveRuntimeHostFromModuleDir(__dirname);
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ADAPTER_SOURCE_BOOTSTRAP_CLI =
  `${runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['adapter', 'bootstrap'])}`;

function createHealthUpdateCommandHelpers(deps) {
  const {
    fs,
    path,
    process,
    childProcess,
    runtime,
    RUNTIME_CONFIG,
    resolveProjectRoot,
    getProjectExtDir,
    getProjectStatePaths,
    getProjectConfig,
    normalizeSession,
    loadProfile,
    loadPack,
    findChipProfileByModel,
    resolveSession,
    buildToolExecutionFromRecommendation,
    adapterSources,
    rootDir,
    updateSession
  } = deps;

  function readHookVersion() {
    const hookFile = path.join(RUNTIME_HOST.runtimeRoot, 'hooks', 'emb-session-start.js');
    if (!fs.existsSync(hookFile)) {
      return '';
    }

    const lines = runtime.readText(hookFile).split(/\r?\n/).slice(0, 5);
    const versionLine = lines.find(line => line.includes('emb-hook-version:'));
    if (!versionLine) {
      return '';
    }

    return versionLine.split('emb-hook-version:')[1].trim();
  }

  function parseScalar(content, key) {
    const line = String(content || '')
      .split(/\r?\n/)
      .find(item => item.trim().startsWith(`${key}:`));

    if (!line) {
      return '';
    }

    return line
      .split(':')
      .slice(1)
      .join(':')
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }

  function loadHardwareIdentity() {
    const hwPath = path.join(resolveProjectRoot(), 'emb-agent', 'hw.yaml');
    if (!fs.existsSync(hwPath)) {
      return {
        file: path.relative(resolveProjectRoot(), hwPath),
        vendor: '',
        model: '',
        package: ''
      };
    }

    const content = runtime.readText(hwPath);
    return {
      file: path.relative(resolveProjectRoot(), hwPath),
      vendor: parseScalar(content, 'vendor'),
      model: parseScalar(content, 'model'),
      package: parseScalar(content, 'package')
    };
  }

  function createCheck(key, status, summary, evidence, recommendation) {
    return {
      key,
      status,
      summary,
      evidence: Array.isArray(evidence) ? evidence.filter(Boolean) : [],
      recommendation: recommendation || ''
    };
  }

  function pushNextCommand(target, key, summary, cli, kind) {
    if (!cli) {
      return;
    }

    if (target.some(item => item.key === key || item.cli === cli)) {
      return;
    }

    target.push({
      key,
      kind: kind || 'command',
      summary,
      cli
    });
  }

  function summarizeChecks(checks) {
    const counts = {
      pass: 0,
      warn: 0,
      fail: 0,
      info: 0
    };

    checks.forEach(item => {
      counts[item.status] = (counts[item.status] || 0) + 1;
    });

    return {
      status: counts.fail > 0 ? 'fail' : counts.warn > 0 ? 'warn' : 'pass',
      counts
    };
  }

  function buildHealthReport() {
    const projectRoot = resolveProjectRoot();
    const projectExtDir = getProjectExtDir();
    const projectConfigPath = path.join(projectExtDir, 'project.json');
    const hwPath = path.join(projectExtDir, 'hw.yaml');
    const reqPath = path.join(projectExtDir, 'req.yaml');
    const docsDir = path.join(projectRoot, 'docs');
    const docCacheDir = path.join(projectExtDir, 'cache', 'docs');
    const adapterCacheDir = path.join(projectExtDir, 'cache', 'adapter-sources');
    const adaptersDir = path.join(projectExtDir, 'adapters');
    const statePaths = getProjectStatePaths();
    const checks = [];
    const nextCommands = [];
    let projectConfig = null;
    let normalizedSession = null;
    let rawSession = null;
    let handoff = null;

    checks.push(
      createCheck(
        'project_root',
        fs.existsSync(projectRoot) ? 'pass' : 'fail',
        fs.existsSync(projectRoot) ? '项目根目录可访问' : '项目根目录不存在',
        [projectRoot],
        fs.existsSync(projectRoot) ? '' : '先确认当前 cwd 是否为项目根目录。'
      )
    );

    checks.push(
      createCheck(
        'emb_agent_dir',
        fs.existsSync(projectExtDir) ? 'pass' : 'fail',
        fs.existsSync(projectExtDir) ? 'emb-agent 目录存在' : 'emb-agent 目录缺失',
        [path.relative(projectRoot, projectExtDir) || 'emb-agent'],
        fs.existsSync(projectExtDir) ? '' : '先执行 init，生成 emb-agent 最小项目骨架。'
      )
    );

    checks.push(
      createCheck(
        'project_config_file',
        fs.existsSync(projectConfigPath) ? 'pass' : 'fail',
        fs.existsSync(projectConfigPath) ? 'project.json 已存在' : 'project.json 缺失',
        [path.relative(projectRoot, projectConfigPath)],
        fs.existsSync(projectConfigPath) ? '' : '先执行 init，补齐 emb-agent/project.json。'
      )
    );

    try {
      projectConfig = getProjectConfig();
      checks.push(
        createCheck(
          'project_config_valid',
          projectConfig ? 'pass' : 'fail',
          projectConfig ? 'project.json 校验通过' : 'project.json 尚未初始化',
          projectConfig
            ? [
                `profile=${projectConfig.project_profile || '(default)'}`,
                `packs=${(projectConfig.active_packs || []).join(',') || '(none)'}`,
                `adapter_sources=${(projectConfig.adapter_sources || []).length}`
              ]
            : [path.relative(projectRoot, projectConfigPath)],
          projectConfig ? '' : '先执行 init，写入最小项目配置。'
        )
      );
    } catch (error) {
      checks.push(
        createCheck(
          'project_config_valid',
          'fail',
          'project.json 非法',
          [error.message],
          '先修正 emb-agent/project.json，再继续使用 emb-agent。'
        )
      );
    }

    [
      ['hw_truth', hwPath, 'hw.yaml 已存在', 'hw.yaml 缺失', '先补齐 emb-agent/hw.yaml，沉淀 MCU/引脚/约束真值。'],
      ['req_truth', reqPath, 'req.yaml 已存在', 'req.yaml 缺失', '先补齐 emb-agent/req.yaml，沉淀目标/功能/验收。'],
      ['docs_dir', docsDir, 'docs 目录存在', 'docs 目录缺失', '先创建 docs 目录，便于后续文档导入与固定报告落盘。'],
      ['doc_cache_dir', docCacheDir, '文档缓存目录存在', '文档缓存目录缺失', '重新执行 init，补齐 emb-agent/cache/docs。'],
      ['adapter_cache_dir', adapterCacheDir, 'adapter 缓存目录存在', 'adapter 缓存目录缺失', '重新执行 init，补齐 emb-agent/cache/adapter-sources。'],
      ['adapters_dir', adaptersDir, 'adapter 目录存在', 'adapter 目录缺失', '重新执行 init，补齐 emb-agent/adapters。']
    ].forEach(([key, targetPath, passSummary, failSummary, recommendation]) => {
      const exists = fs.existsSync(targetPath);
      checks.push(
        createCheck(
          key,
          exists ? 'pass' : 'fail',
          exists ? passSummary : failSummary,
          [path.relative(projectRoot, targetPath)],
          exists ? '' : recommendation
        )
      );
    });

    if (fs.existsSync(statePaths.sessionPath)) {
      try {
        rawSession = runtime.readJson(statePaths.sessionPath);
        normalizedSession = normalizeSession(rawSession, statePaths);
        checks.push(
          createCheck(
            'session_state',
            'pass',
            'session 状态文件可读',
            [
              path.relative(projectRoot, statePaths.sessionPath),
              `last_command=${normalizedSession.last_command || '(empty)'}`,
              `last_files=${(normalizedSession.last_files || []).length}`
            ],
            ''
          )
        );
      } catch (error) {
        checks.push(
          createCheck(
            'session_state',
            'fail',
            'session 状态文件损坏',
            [error.message],
            '删除损坏的 session state，或重新执行 init/resume 让 emb-agent 重建会话状态。'
          )
        );
      }
    } else {
      checks.push(
        createCheck(
          'session_state',
          'warn',
          '尚未发现 session 状态文件',
          [path.relative(projectRoot, statePaths.sessionPath)],
          '执行一次 init、next 或 resume，让 emb-agent 建立项目会话状态。'
        )
      );
      pushNextCommand(
        nextCommands,
        'init',
        '初始化或重建当前项目的 emb-agent 骨架',
        runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['init'])
      );
    }

    if (fs.existsSync(statePaths.handoffPath)) {
      try {
        handoff = runtime.validateHandoff(runtime.readJson(statePaths.handoffPath), RUNTIME_CONFIG);
        checks.push(
          createCheck(
            'handoff_state',
            'warn',
            '存在未消费的 handoff',
            [
              path.relative(projectRoot, statePaths.handoffPath),
              `next_action=${handoff.next_action || '(empty)'}`,
              `resume_cli=${runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['resume'])}`
            ],
            '如果这就是当前工作现场，优先执行 resume；否则先确认这份 handoff 是否过期。'
          )
        );
        pushNextCommand(
          nextCommands,
          'resume',
          '当前存在 handoff，优先接回上次上下文',
          runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['resume'])
        );
      } catch (error) {
        checks.push(
          createCheck(
            'handoff_state',
            'fail',
            'handoff 状态文件损坏',
            [error.message],
            '修正或清理损坏的 handoff 文件，避免 resume 接回错误上下文。'
          )
        );
      }
    } else {
      checks.push(
        createCheck(
          'handoff_state',
          'info',
          '当前没有 handoff',
          [],
          ''
        )
      );
    }

    const desiredProfile = projectConfig && projectConfig.project_profile
      ? projectConfig.project_profile
      : RUNTIME_CONFIG.default_profile;
    try {
      loadProfile(desiredProfile);
      checks.push(
        createCheck(
          'profile_resolution',
          'pass',
          '当前 profile 可解析',
          [`profile=${desiredProfile}`],
          ''
        )
      );
    } catch (error) {
      checks.push(
        createCheck(
          'profile_resolution',
          'fail',
          '当前 profile 不可解析',
          [error.message],
          '修正 project.json 中的 profile，或补齐对应 profile.yaml。'
        )
      );
    }

    const desiredPacks =
      projectConfig && Array.isArray(projectConfig.active_packs) && projectConfig.active_packs.length > 0
        ? projectConfig.active_packs
        : RUNTIME_CONFIG.default_packs;
    const unresolvedPacks = [];
    desiredPacks.forEach(name => {
      try {
        loadPack(name);
      } catch (error) {
        unresolvedPacks.push(`${name}: ${error.message}`);
      }
    });
    checks.push(
      createCheck(
        'pack_resolution',
        unresolvedPacks.length > 0 ? 'fail' : 'pass',
        unresolvedPacks.length > 0 ? '存在不可解析的 packs' : '当前 packs 可解析',
        unresolvedPacks.length > 0
          ? unresolvedPacks
          : [`packs=${desiredPacks.join(',') || '(none)'}`],
        unresolvedPacks.length > 0 ? '修正 project.json 中的 packs，或补齐对应 pack.yaml。' : ''
      )
    );

    const hardwareIdentity = loadHardwareIdentity();
    if (!hardwareIdentity.model) {
      checks.push(
        createCheck(
          'hardware_identity',
          'warn',
          'hw.yaml 尚未填入 MCU 型号',
          [hardwareIdentity.file],
          '把 vendor/model/package 写进 hw.yaml，后续 tool 和 chip profile 才能自动发现。'
        )
      );
    } else {
      const chipProfile = findChipProfileByModel(hardwareIdentity.model, hardwareIdentity.package);
      checks.push(
        createCheck(
          'hardware_identity',
          chipProfile ? 'pass' : 'warn',
          chipProfile ? 'MCU 型号已映射到 chip profile' : 'MCU 型号尚未映射到 chip profile',
          chipProfile
            ? [
                `model=${hardwareIdentity.model}`,
                `chip_profile=${chipProfile.name}`,
                `family=${chipProfile.family}`
              ]
            : [`model=${hardwareIdentity.model}`],
          chipProfile ? '' : '补充 adapter/chip profile 后，tool 自动发现才能完全接上。'
        )
      );
    }

    if (projectConfig && projectConfig.integrations && projectConfig.integrations.mineru) {
      const mineru = projectConfig.integrations.mineru;
      const apiKeyConfigured = Boolean(mineru.api_key) || Boolean(process.env[mineru.api_key_env || 'MINERU_API_KEY']);
      checks.push(
        createCheck(
          'mineru_integration',
          mineru.mode === 'api' && !apiKeyConfigured ? 'warn' : 'pass',
          mineru.mode === 'api' && !apiKeyConfigured
            ? 'MinerU API 模式已开启，但未发现可用 API Key'
            : `MinerU 配置可用 (${mineru.mode})`,
          [
            `mode=${mineru.mode}`,
            `api_key_env=${mineru.api_key_env || 'MINERU_API_KEY'}`
          ],
          mineru.mode === 'api' && !apiKeyConfigured
            ? '在 .env 或宿主环境里提供 API Key，避免文档导入走到 API 模式时失败。'
            : ''
        )
      );
    }

    if (projectConfig) {
      const adapterSourceStatus = adapterSources.listSourceStatus(rootDir, projectRoot, projectConfig);
      const enabledSources = adapterSourceStatus.filter(item => item.enabled !== false);
      const syncedProjectSources = enabledSources.filter(
        item => item.targets && item.targets.project && item.targets.project.synced
      );
      const matchedProjectSources = syncedProjectSources.filter(item => {
        const selection = item.targets.project.selection;
        return selection && selection.filtered && Array.isArray(selection.matched && selection.matched.chips)
          ? selection.matched.chips.length > 0
          : false;
      });

      checks.push(
        createCheck(
          'adapter_sources_registered',
          enabledSources.length > 0 ? 'pass' : 'warn',
          enabledSources.length > 0 ? '已登记 adapter sources' : '尚未登记 adapter source',
          enabledSources.length > 0
            ? enabledSources.map(item => `source=${item.name}`)
            : ['emb-agent/project.json -> adapter_sources'],
          enabledSources.length > 0
            ? ''
            : '先执行 adapter source add，把 emb-agent-adapters 或你的私有 source 登记进项目。'
        )
      );
      if (enabledSources.length === 0) {
        pushNextCommand(
          nextCommands,
          hardwareIdentity.model ? 'adapter-bootstrap' : 'adapter-source-add',
          hardwareIdentity.model ? '登记默认 adapter 仓库并按当前项目匹配同步' : '登记默认 adapter 仓库',
          hardwareIdentity.model
            ? DEFAULT_ADAPTER_SOURCE_BOOTSTRAP_CLI
            : `${runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['adapter', 'source', 'add', 'default-pack'])} --type git --location https://github.com/Welkon/emb-agent-adapters.git`
        );
      }

      checks.push(
        createCheck(
          'adapter_sync_project',
          syncedProjectSources.length > 0 ? 'pass' : enabledSources.length > 0 ? 'warn' : 'info',
          syncedProjectSources.length > 0
            ? 'adapter 已同步到项目目录'
            : enabledSources.length > 0
              ? 'adapter source 已登记，但尚未同步'
              : '当前还没有可同步的 adapter source',
          syncedProjectSources.length > 0
            ? syncedProjectSources.map(item => `source=${item.name}, files=${item.targets.project.files_count}`)
            : enabledSources.length > 0
              ? enabledSources.map(item => `source=${item.name}`)
              : [],
          syncedProjectSources.length > 0
            ? ''
            : enabledSources.length > 0
              ? `执行 adapter sync ${enabledSources[0].name}，把匹配到的 adapter/profile 铺到项目里。`
              : ''
        )
      );
      if (enabledSources.length > 0 && syncedProjectSources.length === 0) {
        pushNextCommand(
          nextCommands,
          hardwareIdentity.model ? 'adapter-bootstrap' : 'adapter-sync',
          hardwareIdentity.model ? '按当前项目匹配同步 adapter source' : '把已登记的 adapter source 同步到当前项目',
          hardwareIdentity.model
            ? runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['adapter', 'bootstrap', enabledSources[0].name])
            : runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['adapter', 'sync', enabledSources[0].name])
        );
      }

      if (hardwareIdentity.model) {
        checks.push(
          createCheck(
            'adapter_match',
            matchedProjectSources.length > 0 ? 'pass' : syncedProjectSources.length > 0 ? 'warn' : 'info',
            matchedProjectSources.length > 0
              ? '已发现与当前硬件匹配的 adapter 子集'
              : syncedProjectSources.length > 0
                ? 'adapter 已同步，但还没有确认命中当前硬件'
                : '等待 adapter source 完成同步后再检查匹配结果',
            matchedProjectSources.length > 0
              ? matchedProjectSources.map(item => {
                  const selection = item.targets.project.selection;
                  const chips = (selection && selection.matched && selection.matched.chips) || [];
                  const tools = (selection && selection.matched && selection.matched.tools) || [];
                  return `source=${item.name}, chips=${chips.join(',') || '(none)'}, tools=${tools.join(',') || '(none)'}`;
                })
              : syncedProjectSources.length > 0
                ? syncedProjectSources.map(item => {
                    const selection = item.targets.project.selection;
                    return selection && selection.filtered === false
                      ? `source=${item.name}, mode=full-sync`
                      : `source=${item.name}, matched_chips=${((selection && selection.matched && selection.matched.chips) || []).join(',') || '(none)'}`;
                  })
                : [`model=${hardwareIdentity.model}`, `package=${hardwareIdentity.package || '(empty)'}`],
            matchedProjectSources.length > 0
              ? ''
              : syncedProjectSources.length > 0
                ? '检查 hw.yaml 的 vendor/model/package 是否准确，或补齐对应的 family/device/chip profiles。'
                : '先补 hw.yaml，再执行 adapter sync，让 emb-agent 自动挑出当前芯片需要的 adapters。'
          )
        );
      }
    }

    if (normalizedSession) {
      if ((normalizedSession.open_questions || []).length > 0) {
        checks.push(
          createCheck(
            'open_questions',
            'warn',
            '仍有未决问题挂起',
            (normalizedSession.open_questions || []).slice(0, 4).map(item => `question=${item}`),
            '优先收敛这些问题，否则 plan/do 会持续漂移。'
          )
        );
      }

      if ((normalizedSession.known_risks || []).length > 0) {
        checks.push(
          createCheck(
            'known_risks',
            'warn',
            '仍有已知风险未闭环',
            (normalizedSession.known_risks || []).slice(0, 4).map(item => `risk=${item}`),
            '决定这些风险要进入 review、thread 还是 bench 验证，不要长期挂空。'
          )
        );
      }
    }

    const summary = summarizeChecks(checks);
    let resolvedSession = null;

    try {
      resolvedSession = resolveSession ? resolveSession() : null;
    } catch {
      resolvedSession = null;
    }

    const toolRecommendations =
      resolvedSession &&
      resolvedSession.effective &&
      Array.isArray(resolvedSession.effective.tool_recommendations)
        ? resolvedSession.effective.tool_recommendations
        : [];
    const primaryToolExecution =
      toolRecommendations.length > 0
        ? buildToolExecutionFromRecommendation(toolRecommendations[0])
        : null;

    if (primaryToolExecution && primaryToolExecution.cli) {
      pushNextCommand(
        nextCommands,
        'tool-run-primary',
        primaryToolExecution.recommended
          ? `运行首选工具：${primaryToolExecution.tool}`
          : `准备首个工具草案：${primaryToolExecution.tool}`,
        primaryToolExecution.cli,
        'tool'
      );
    }

    if (nextCommands.length === 0 && summary.status !== 'fail') {
      pushNextCommand(
        nextCommands,
        'next',
        '进入 emb-agent 推荐的下一步',
        runtimeHostHelpers.buildCliCommand(RUNTIME_HOST, ['next'])
      );
    }

    return {
      command: 'health',
      project_root: projectRoot,
      runtime_host: RUNTIME_HOST.name,
      status: summary.status,
      summary: summary.counts,
      checks,
      next_commands: nextCommands,
      recommendations: runtime.unique(
        checks
          .filter(item => item.status === 'fail' || item.status === 'warn')
          .map(item => item.recommendation)
          .filter(Boolean)
      )
    };
  }

  function buildUpdateView(forceCheck) {
    const cachePath = updateCheckHelpers.getUpdateCachePath(path, RUNTIME_HOST.stateRoot);
    const installed = updateCheckHelpers.readInstalledVersion(fs, path, RUNTIME_HOST.runtimeRoot);
    const hookVersion = process.env.EMB_AGENT_FORCE_HOOK_VERSION || readHookVersion();
    const cache = updateCheckHelpers.readUpdateCache(fs, cachePath);
    const staleInstall = updateCheckHelpers.detectStaleInstall(installed, hookVersion);
    const trigger = updateCheckHelpers.triggerUpdateCheck({
      fs,
      path,
      childProcess,
      process,
      cachePath,
      installed,
      packageName: 'emb-agent',
      intervalMs: UPDATE_CHECK_INTERVAL_MS,
      cache,
      force: Boolean(forceCheck)
    });
    const latestCache = updateCheckHelpers.readUpdateCache(fs, cachePath) || cache;

    const recommendations = [];
    if (staleInstall) {
      recommendations.push('重新运行 emb-agent 安装，先把 hooks / runtime / skills 版本对齐。');
    }
    if (latestCache && latestCache.update_available && latestCache.latest) {
      recommendations.push('检测到新版本；先看 release 说明，再重新安装 runtime。');
    }
    if (trigger.triggered) {
      recommendations.push('后台已触发版本检查；稍后再执行一次 update 查看最新结果。');
    }
    if (recommendations.length === 0) {
      recommendations.push('当前没有明确升级阻塞；若要确认最新版本，可执行 update check。');
    }

    return {
      command: 'update',
      runtime_host: RUNTIME_HOST.name,
      installed_version: installed || '',
      hook_version: hookVersion || '',
      stale_install: staleInstall,
      cache: latestCache
        ? {
            installed: latestCache.installed || '',
            latest: latestCache.latest || '',
            checked_at: latestCache.checked_at || 0,
            update_available: Boolean(latestCache.update_available),
            status: latestCache.status || 'unknown',
            error: latestCache.error || ''
          }
        : null,
      check: {
        triggered: trigger.triggered,
        reason: trigger.reason || '',
        cache_path: cachePath,
        stale: updateCheckHelpers.isUpdateCacheStale(cache, UPDATE_CHECK_INTERVAL_MS)
      },
      recommendations
    };
  }

  function handleHealthUpdateCommands(cmd, subcmd, rest) {
    if (cmd === 'health') {
      if (subcmd && subcmd !== 'show') {
        throw new Error(`Unknown health subcommand: ${subcmd}`);
      }
      if (rest && rest.length > 0) {
        throw new Error('health does not accept positional arguments');
      }

      updateSession(current => {
        current.last_command = 'health';
      });
      return buildHealthReport();
    }

    if (cmd === 'update') {
      if (subcmd && subcmd !== 'show' && subcmd !== 'check') {
        throw new Error(`Unknown update subcommand: ${subcmd}`);
      }
      if (rest && rest.length > 0) {
        throw new Error('update does not accept extra positional arguments');
      }

      updateSession(current => {
        current.last_command = subcmd === 'check' ? 'update check' : 'update';
      });
      return buildUpdateView(subcmd === 'check');
    }

    return undefined;
  }

  return {
    buildHealthReport,
    buildUpdateView,
    handleHealthUpdateCommands,
    readHookVersion
  };
}

module.exports = {
  createHealthUpdateCommandHelpers
};
