'use strict';

module.exports = {
  runTool(context) {
    const options = context.parseLongOptions(context.tokens || []);

    return {
      tool: context.toolName,
      status: 'ok',
      implementation: 'external-adapter',
      adapter_name: '{{ADAPTER_NAME}}',
      adapter_path: context.adapterPath,
      inputs: {
        raw_tokens: context.tokens || [],
        options
      },
      notes: [
        'This is a project-level external adapter template output. Implement the real formulas and register guidance here.',
        'Do not write vendor/chip bindings back into emb-agent core.'
      ]
    };
  }
};
