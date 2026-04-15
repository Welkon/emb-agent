'use strict';

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
    runAdapterGenerate
  } = deps;

  function handleAdapterToolChipCommands(cmd, subcmd, rest) {
    const isChipSupportCommand = cmd === 'adapter' || cmd === 'support';

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

    if (isChipSupportCommand && subcmd === 'derive') {
      return runAdapterDerive(rest);
    }

    if (isChipSupportCommand && subcmd === 'generate') {
      return runAdapterGenerate(rest);
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
      return toolRuntime.runTool(ROOT, rest[0], rest.slice(1));
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
