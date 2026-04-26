'use strict';

const fs = require('fs');
const path = require('path');

function createSpecLoaderHelpers(deps) {
  const { fs: fsDep, path: pathDep } = deps;

  function parseAppliesTo(content) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return null;
    }
    try {
      const lines = frontmatterMatch[1].split('\n');
      const appliesTo = {};
      let currentKey = '';
      for (const line of lines) {
        const keyMatch = line.match(/^(\w+):\s*$/);
        if (keyMatch) {
          currentKey = keyMatch[1];
          appliesTo[currentKey] = [];
          continue;
        }
        const itemMatch = line.match(/^\s*-\s*"([^"]+)"/);
        if (itemMatch && currentKey) {
          if (!appliesTo[currentKey]) {
            appliesTo[currentKey] = [];
          }
          appliesTo[currentKey].push(itemMatch[1]);
        }
      }
      return appliesTo;
    } catch {
      return null;
    }
  }

  function loadSpecIndex(specsDir, scopeFilter) {
    const specFiles = [];
    const scopeSet = new Set(Array.isArray(scopeFilter) ? scopeFilter : []);

    function walk(dir, relativePath) {
      if (!fsDep.existsSync(dir)) {
        return;
      }
      const entries = fsDep.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = pathDep.join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          walk(fullPath, relPath);
        } else if (entry.name.endsWith('.md')) {
          specFiles.push({
            path: relPath,
            fullPath,
            type: entry.name === 'index.md' ? 'index' : 'constraint'
          });
        }
      }
    }

    walk(specsDir, '');

    if (scopeSet.size === 0) {
      return specFiles;
    }

    return specFiles.filter(file => {
      for (const scope of scopeSet) {
        if (file.path.startsWith(scope + '/') || file.path.startsWith(scope) ||
            scope.split('/').some(part => file.path.includes(part))) {
          return true;
        }
      }
      return file.path.startsWith('mcu/');
    });
  }

  function filterSpecsByAppliesTo(specFiles, hwConfig, taskScope) {
    const chipFamily = (hwConfig && hwConfig.family) ? String(hwConfig.family) : '';
    const boardName = (hwConfig && hwConfig.board) ? String(hwConfig.board) : '';
    const modules = Array.isArray(taskScope)
      ? taskScope.filter(s => s.startsWith('module/')).map(s => s.replace('module/', ''))
      : [];

    return specFiles.filter(file => {
      if (!fsDep.existsSync(file.fullPath)) {
        return false;
      }
      const content = fsDep.readFileSync(file.fullPath, 'utf8');
      const appliesTo = parseAppliesTo(content);

      if (!appliesTo) {
        return true;
      }

      const mcuMatch = !appliesTo.mcu || appliesTo.mcu.length === 0 ||
        appliesTo.mcu.some(m => chipFamily.includes(m) || m === chipFamily);
      const boardMatch = !appliesTo.board || appliesTo.board.length === 0 ||
        appliesTo.board.some(b => boardName.includes(b) || b === boardName);
      const moduleMatch = !appliesTo.module || appliesTo.module.length === 0 ||
        appliesTo.module.some(m => modules.includes(m));
      const productMatch = !appliesTo.product || appliesTo.product.length === 0;

      return mcuMatch && boardMatch && moduleMatch && productMatch;
    });
  }

  function loadSpecContent(filePath) {
    if (!fsDep.existsSync(filePath)) {
      return null;
    }
    const content = fsDep.readFileSync(filePath, 'utf8');
    return {
      path: filePath,
      content,
      size: Buffer.byteLength(content, 'utf8')
    };
  }

  function buildSpecInjectionBlock(specFiles, maxBytes) {
    const limit = maxBytes || 8000;
    let totalBytes = 0;
    const blocks = [];

    for (const file of specFiles) {
      const loaded = loadSpecContent(file.fullPath);
      if (!loaded) {
        continue;
      }
      if (totalBytes + loaded.size > limit) {
        blocks.push(`... (${specFiles.length - blocks.length} more spec files skipped, exceeding ${limit} byte budget)`);
        break;
      }
      blocks.push(`=== ${file.path} ===\n${loaded.content}`);
      totalBytes += loaded.size;
    }

    return blocks.join('\n\n');
  }

  function getSpecIndexLines(specsDir, scopeFilter, hwConfig, taskScope) {
    const allFiles = loadSpecIndex(specsDir, scopeFilter);
    const filtered = filterSpecsByAppliesTo(allFiles, hwConfig, taskScope);

    if (filtered.length === 0) {
      return [];
    }

    const lines = ['Available hardware constraint specs (read on demand):'];
    for (const file of filtered) {
      const tag = file.type === 'index' ? ' [index]' : '';
      lines.push(`.emb-agent/specs/${file.path}${tag}`);
    }
    return lines;
  }

  return {
    loadSpecIndex,
    filterSpecsByAppliesTo,
    loadSpecContent,
    buildSpecInjectionBlock,
    getSpecIndexLines,
    parseAppliesTo
  };
}

module.exports = { createSpecLoaderHelpers };
