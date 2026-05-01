'use strict';

const fs = require('fs');
const path = require('path');
const knowledgeFollowups = require('./knowledge-followups.cjs');
const registerWriteArtifact = require('./register-write-artifact.cjs');

function createAdapterToolChipCommandHelpers(deps) {
  const {
    toolCatalog,
    toolRuntime,
    chipCatalog,
    ROOT,
    buildAdapterStatus,
    addAdapterSource,
    removeAdapterSource,
    bootstrapAdapterSource,
    parseAdapterSyncArgs,
    syncNamedAdapterSource,
    syncAllAdapterSources,
    runAdapterDerive,
    runAdapterGenerate,
    runAdapterAnalysisInit,
    runAdapterExport,
    runAdapterPublish
  } = deps;

  function slugify(value) {
    return String(value || 'tool')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tool';
  }

  function timestampSlug() {
    return new Date().toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z')
      .replace('T', '-');
  }

  function parseToolRunSaveArgs(args) {
    const tokens = Array.isArray(args) ? args.slice() : [];
    let saveOutput = false;
    let outputPath = '';
    const cleaned = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token === '--save-output' || token === '--save') {
        saveOutput = true;
        continue;
      }
      if (token === '--output-file') {
        saveOutput = true;
        outputPath = tokens[i + 1] || '';
        i += 1;
        continue;
      }
      cleaned.push(token);
    }
    return {
      save_output: saveOutput,
      output_path: outputPath,
      tool_args: cleaned
    };
  }

  function saveToolRunOutput(toolName, result, parsed) {
    const projectRoot = path.resolve(process.cwd());
    const relativePath = parsed.output_path
      ? parsed.output_path.replace(/\\/g, '/')
      : `.emb-agent/runs/tool-${slugify(toolName)}-${timestampSlug()}.json`;
    const absolutePath = path.resolve(projectRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    const next = {
      ...(result && typeof result === 'object' && !Array.isArray(result) ? result : { result }),
      saved_output: relativePath
    };
    const nextSteps = Array.isArray(next.next_steps) ? next.next_steps.slice() : [];
    const snippetRequest = registerWriteArtifact.findFirmwareSnippetRequest(next);
    next.next_steps = knowledgeFollowups.buildSavedToolRunFollowups({
      existing: nextSteps,
      relativePath,
      firstRegister: registerWriteArtifact.firstRegisterName(next),
      hasSnippetRequest: snippetRequest && snippetRequest.protocol === 'emb-agent.firmware-snippet-request/1'
    });
    fs.writeFileSync(absolutePath, JSON.stringify(next, null, 2) + '\n', 'utf8');
    return next;
  }

  function handleAdapterToolChipCommands(cmd, subcmd, rest) {
    const isChipSupportCommand = cmd === 'support';
    const isAdapterCommand = cmd === 'adapter';

    if (isChipSupportCommand && subcmd === 'status') {
      return buildAdapterStatus(rest[0] || '');
    }

    if (isChipSupportCommand && subcmd === 'source' && rest[0] === 'list') {
      return buildAdapterStatus();
    }

    if (isChipSupportCommand && subcmd === 'source' && rest[0] === 'show') {
      if (!rest[1]) throw new Error('Missing source name');
      return buildAdapterStatus(rest[1]);
    }

    if (isChipSupportCommand && subcmd === 'source' && rest[0] === 'add') {
      if (!rest[1]) throw new Error('Missing source name');
      return addAdapterSource(rest[1], rest.slice(2));
    }

    if (isChipSupportCommand && subcmd === 'source' && rest[0] === 'remove') {
      if (!rest[1]) throw new Error('Missing source name');
      return removeAdapterSource(rest[1], rest.slice(2));
    }

    if (isChipSupportCommand && subcmd === 'bootstrap') {
      if (rest[0] && !rest[0].startsWith('--')) {
        return bootstrapAdapterSource(rest[0], rest.slice(1));
      }
      return bootstrapAdapterSource('', rest);
    }

    if (isChipSupportCommand && subcmd === 'sync') {
      if (rest[0] === '--all') {
        return syncAllAdapterSources(parseAdapterSyncArgs(rest));
      }

      if (!rest[0] || rest[0].startsWith('--')) {
        throw new Error('Missing source name');
      }

      return syncNamedAdapterSource(rest[0], parseAdapterSyncArgs(rest.slice(1)));
    }

    if (isAdapterCommand && subcmd === 'derive') {
      return runAdapterDerive(rest);
    }

    if (isAdapterCommand && subcmd === 'generate') {
      return runAdapterGenerate(rest);
    }

    if (isAdapterCommand && subcmd === 'analysis' && rest[0] === 'init') {
      return runAdapterAnalysisInit(rest.slice(1));
    }

    if (isAdapterCommand && subcmd === 'export') {
      return runAdapterExport(rest);
    }

    if (isAdapterCommand && subcmd === 'publish') {
      return runAdapterPublish(rest);
    }

    if (cmd === 'tool' && subcmd === 'list') {
      return toolCatalog.listToolSpecs(ROOT);
    }

    if (cmd === 'tool' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing tool name');
      return toolCatalog.loadToolSpec(ROOT, rest[0]);
    }

    if (cmd === 'tool' && subcmd === 'run') {
      if (!rest[0]) throw new Error('Missing tool name');
      const parsed = parseToolRunSaveArgs(rest.slice(1));
      const result = toolRuntime.runTool(ROOT, rest[0], parsed.tool_args);
      return parsed.save_output ? saveToolRunOutput(rest[0], result, parsed) : result;
    }

    if (cmd === 'tool' && subcmd === 'family' && rest[0] === 'list') {
      return toolCatalog.listFamilies(ROOT);
    }

    if (cmd === 'tool' && subcmd === 'family' && rest[0] === 'show') {
      if (!rest[1]) throw new Error('Missing family name');
      return toolCatalog.loadFamily(ROOT, rest[1]);
    }

    if (cmd === 'tool' && subcmd === 'device' && rest[0] === 'list') {
      return toolCatalog.listDevices(ROOT);
    }

    if (cmd === 'tool' && subcmd === 'device' && rest[0] === 'show') {
      if (!rest[1]) throw new Error('Missing device name');
      return toolCatalog.loadDevice(ROOT, rest[1]);
    }

    if (cmd === 'chip' && subcmd === 'list') {
      return chipCatalog.listChips(ROOT);
    }

    if (cmd === 'chip' && subcmd === 'show') {
      if (!rest[0]) throw new Error('Missing chip name');
      return chipCatalog.loadChip(ROOT, rest[0]);
    }

    return undefined;
  }

  return {
    handleAdapterToolChipCommands
  };
}

module.exports = {
  createAdapterToolChipCommandHelpers
};
