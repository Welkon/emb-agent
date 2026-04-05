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
        '这是项目级外部 adapter 模板输出，请在这里实现真正的公式和寄存器提示。',
        '不要把厂商/芯片绑定回写到 emb-agent core。'
      ]
    };
  }
};
