'use strict';

function createAdapterCommandRuntime(deps) {
  const ROOT = deps.ROOT;
  const adapterDeriveCli = deps.adapterDeriveCli;
  const supportAnalysisCli = deps.supportAnalysisCli;
  const adapterSources = deps.adapterSources;
  const permissionGateHelpers = deps.permissionGateHelpers;
  const resolveProjectRoot = deps.resolveProjectRoot;
  const getProjectConfig = deps.getProjectConfig;
  const parseAdapterExportArgs = deps.parseAdapterExportArgs;
  const parseAdapterPublishArgs = deps.parseAdapterPublishArgs;

  function applyAdapterWritePermission(result, actionName, explicitConfirmation) {
    const permissionDecision = permissionGateHelpers.evaluateExecutionPermission({
      action_kind: 'write',
      action_name: actionName,
      risk: 'normal',
      explicit_confirmation: explicitConfirmation === true,
      permissions: (getProjectConfig() && getProjectConfig().permissions) || {}
    });

    return {
      permission: permissionDecision,
      result: permissionGateHelpers.applyPermissionDecision(result, permissionDecision)
    };
  }

  function runAdapterDerive(args) {
    const parsed = adapterDeriveCli.parseArgs(args || []);
    if (parsed.help) {
      return adapterDeriveCli.deriveProfiles(args, {
        runtimeRoot: ROOT,
        projectRoot: resolveProjectRoot()
      });
    }

    const actionName =
      parsed.target === 'runtime'
        ? 'support-derive-runtime'
        : parsed.target === 'path'
          ? 'support-derive-path'
          : 'support-derive-project';
    const blocked = applyAdapterWritePermission({
      status: 'permission-pending',
      target: parsed.target,
      output_root: parsed.outputRoot || '',
      family: parsed.family,
      device: parsed.device,
      chip: parsed.chip,
      tools: parsed.tools
    }, actionName, parsed.explicit_confirmation);

    if (blocked.permission.decision !== 'allow') {
      return blocked.result;
    }

    return permissionGateHelpers.applyPermissionDecision(adapterDeriveCli.deriveProfiles(args, {
      runtimeRoot: ROOT,
      projectRoot: resolveProjectRoot()
    }), blocked.permission);
  }

  function runAdapterGenerate(args) {
    const parsed = adapterDeriveCli.parseArgs(args || []);
    if (parsed.help) {
      return adapterDeriveCli.deriveProfiles(args, {
        runtimeRoot: ROOT,
        projectRoot: resolveProjectRoot()
      });
    }

    const blocked = applyAdapterWritePermission({
      status: 'permission-pending',
      target: parsed.target,
      output_root: parsed.outputRoot || '',
      family: parsed.family,
      device: parsed.device,
      chip: parsed.chip,
      tools: parsed.tools
    }, 'support-generate', parsed.explicit_confirmation);

    if (blocked.permission.decision !== 'allow') {
      return blocked.result;
    }

    return permissionGateHelpers.applyPermissionDecision(adapterDeriveCli.deriveProfiles(args, {
      runtimeRoot: ROOT,
      projectRoot: resolveProjectRoot()
    }), blocked.permission);
  }

  function runAdapterAnalysisInit(args) {
    const parsed = supportAnalysisCli.parseInitArgs(args || []);
    if (parsed.help) {
      return supportAnalysisCli.initAnalysis(args, {
        projectRoot: resolveProjectRoot()
      });
    }

    const blocked = applyAdapterWritePermission({
      status: 'permission-pending',
      target: 'project',
      output_root: parsed.output || '',
      family: parsed.family,
      device: parsed.device,
      chip: parsed.chip || parsed.model,
      tools: []
    }, 'support-analysis-init', true);

    if (blocked.permission.decision !== 'allow') {
      return blocked.result;
    }

    return permissionGateHelpers.applyPermissionDecision(supportAnalysisCli.initAnalysis(args, {
      projectRoot: resolveProjectRoot()
    }), blocked.permission);
  }

  function buildDerivedSupportTransferInspection(parsed) {
    return adapterDeriveCli.inspectDerivedSupport({
      projectRoot: resolveProjectRoot(),
      family: parsed.family,
      device: parsed.device,
      chip: parsed.chip
    });
  }

  function runAdapterExport(args) {
    const parsed = parseAdapterExportArgs(args || []);
    const inspection = buildDerivedSupportTransferInspection(parsed);
    const actionName = parsed.output_root ? 'support-export-path' : 'support-export-source';
    const blocked = applyAdapterWritePermission({
      status: 'permission-pending',
      target: parsed.output_root ? 'path' : 'source',
      output_root: parsed.output_root || '',
      family: inspection.family,
      device: inspection.device,
      chip: inspection.chip,
      tools: inspection.tools || []
    }, actionName, parsed.explicit_confirmation);

    if (blocked.permission.decision !== 'allow') {
      return blocked.result;
    }

    return permissionGateHelpers.applyPermissionDecision(adapterSources.exportDerivedSupport(
      ROOT,
      resolveProjectRoot(),
      getProjectConfig(),
      {
        sourceName: parsed.source_name,
        outputRoot: parsed.output_root,
        force: parsed.force,
        inspection
      }
    ), blocked.permission);
  }

  function runAdapterPublish(args) {
    const parsed = parseAdapterPublishArgs(args || []);
    const inspection = buildDerivedSupportTransferInspection(parsed);
    const actionName = parsed.output_root ? 'support-publish-path' : 'support-publish-source';
    const blocked = applyAdapterWritePermission({
      status: 'permission-pending',
      target: parsed.output_root ? 'path' : 'source',
      output_root: parsed.output_root || '',
      family: inspection.family,
      device: inspection.device,
      chip: inspection.chip,
      tools: inspection.tools || []
    }, actionName, parsed.explicit_confirmation);

    if (blocked.permission.decision !== 'allow') {
      return blocked.result;
    }

    return permissionGateHelpers.applyPermissionDecision(adapterSources.publishDerivedSupport(
      ROOT,
      resolveProjectRoot(),
      getProjectConfig(),
      {
        sourceName: parsed.source_name,
        outputRoot: parsed.output_root,
        force: parsed.force,
        inspection
      }
    ), blocked.permission);
  }

  return {
    applyAdapterWritePermission,
    buildDerivedSupportTransferInspection,
    runAdapterAnalysisInit,
    runAdapterDerive,
    runAdapterExport,
    runAdapterGenerate,
    runAdapterPublish
  };
}

module.exports = {
  createAdapterCommandRuntime
};
