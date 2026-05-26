'use strict';

module.exports = {
  runTool(context) {
    const options = context.parseLongOptions(context.tokens || []);

    return {
      tool: context.toolName,
      status: 'ok',
      implementation: 'external-chip-support',
      chip_support_name: '{{ADAPTER_NAME}}',
      chip_support_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      notes: [
        'This is a project-level external chip-support template output. Implement the real formulas and register guidance here.',
        'Do not write vendor/chip bindings back into emb-agent core.'
      ]
    };
  }
};
