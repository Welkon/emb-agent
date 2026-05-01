'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

async function captureCliJson(args) {
  const originalWrite = process.stdout.write;
  let stdout = '';

  process.stdout.write = chunk => {
    stdout += String(chunk);
    return true;
  };

  try {
    await cli.main(args);
  } finally {
    process.stdout.write = originalWrite;
  }

  return JSON.parse(stdout);
}

function writeToolOutput(projectRoot) {
  const outputDir = path.join(projectRoot, '.emb-agent', 'runs');
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, 'pwm-calc.json');
  fs.writeFileSync(
    outputPath,
    JSON.stringify({
      tool: 'pwm-calc',
      status: 'ok',
      best_candidate: {
        pwm: 'PWM1',
        period_value: 999,
        duty_value: 499,
        register_writes: {
          registers: [
            {
              register: 'PWMTL',
              mask_hex: '0xFF',
              write_value_hex: '0xE7',
              fields: ['PWMT<7:0>'],
              c_statement: 'PWMTL = (PWMTL & ~0xFF) | 0xE7;',
              hal_statement: 'MODIFY_REG(PWMTL, 0xFF, 0xE7);'
            },
            {
              register: 'PWMD1L',
              mask_hex: '0xFF',
              write_value_hex: '0xF3',
              fields: ['PWMD1<7:0>'],
              c_statement: 'PWMD1L = (PWMD1L & ~0xFF) | 0xF3;',
              hal_statement: 'MODIFY_REG(PWMD1L, 0xFF, 0xF3);'
            }
          ],
          c_statements: [
            'PWMTL = (PWMTL & ~0xFF) | 0xE7;',
            'PWMD1L = (PWMD1L & ~0xFF) | 0xF3;'
          ],
          hal_statements: [
            'MODIFY_REG(PWMTL, 0xFF, 0xE7);',
            'MODIFY_REG(PWMD1L, 0xFF, 0xF3);'
          ],
          firmware_snippet_request: {
            protocol: 'emb-agent.firmware-snippet-request/1',
            authoring: 'ai-authored',
            status: 'draft-until-verified',
            inputs: {
              required_context: [
                'hardware truth',
                'current firmware style',
                'worktree status and dirty source files'
              ]
            },
            required_output: [
              'code_snippet',
              'source_edit_policy',
              'behavior_couplings',
              'verification_evidence'
            ],
            gates: [
              'link generated code back to register_writes.registers[] values',
              'mark source patches blocked when dirty source files or unreviewed behavior couplings exist'
            ],
            constraints: [
              'do not add helper functions solely to wrap generated register writes',
              'do not patch firmware sources when relevant source files are dirty unless the user explicitly requests that integration'
            ]
          }
        }
      }
    }, null, 2),
    'utf8'
  );
  return path.relative(projectRoot, outputPath).split(path.sep).join('/');
}

test('snippet draft previews then writes artifact without patching dirty firmware sources', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-snippet-draft-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    childProcess.execFileSync('git', ['init'], { cwd: tempProject, stdio: 'ignore' });
    await cli.main(['init']);

    fs.mkdirSync(path.join(tempProject, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tempProject, 'src', 'main.c'),
      [
        '#include "app.h"',
        '',
        'void system_init(void)',
        '{',
        '    PWMTL = 0xFFU; // 初始化 PWM 周期。',
        '}',
        ''
      ].join('\n'),
      'utf8'
    );
    const beforeSource = fs.readFileSync(path.join(tempProject, 'src', 'main.c'), 'utf8');
    const toolOutput = writeToolOutput(tempProject);

    const preview = await captureCliJson([
      'snippet',
      'draft',
      '--from-tool-output',
      toolOutput,
      '--title',
      'SC8P052B PWM1 1kHz'
    ]);

    const artifactPath = path.join(tempProject, '.emb-agent', 'firmware-snippets', 'sc8p052b-pwm1-1khz.md');
    assert.equal(preview.status, 'confirmation-required');
    assert.equal(preview.write_mode, 'preview');
    assert.equal(preview.target, '.emb-agent/firmware-snippets/sc8p052b-pwm1-1khz.md');
    assert.equal(fs.existsSync(artifactPath), false);
    assert.equal(preview.source_edit_policy.mode, 'artifact-only');
    assert.ok(preview.worktree.dirty_source_files.includes('src/main.c'));
    assert.ok(preview.behavior_couplings.some(item => item.includes('PWM changes')));
    assert.match(preview.content, /Source Edit Policy/);
    assert.match(preview.content, /do not add helper functions solely/);

    const written = await captureCliJson([
      'snippet',
      'draft',
      '--from',
      toolOutput,
      '--title',
      'SC8P052B PWM1 1kHz',
      '--confirm'
    ]);

    assert.equal(written.status, 'written');
    assert.equal(written.write_mode, 'artifact');
    assert.equal(written.artifact_path, '.emb-agent/firmware-snippets/sc8p052b-pwm1-1khz.md');
    assert.equal(fs.existsSync(artifactPath), true);
    assert.equal(fs.readFileSync(path.join(tempProject, 'src', 'main.c'), 'utf8'), beforeSource);

    const content = fs.readFileSync(artifactPath, 'utf8');
    assert.match(content, /PWMTL = \(PWMTL & ~0xFF\) \| 0xE7;/);
    assert.match(content, /source_patch_status: `blocked-until-reviewed`|Source patch status: `blocked-until-reviewed`/);
    assert.match(content, /dirty firmware source files block automatic source patching/);
    assert.match(content, /No firmware compile or static check was run/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('snippet command is visible in advanced command inventory', async () => {
  const shown = await captureCliJson(['commands', 'show', 'snippet']);
  const listed = await captureCliJson(['commands', 'list', '--all']);

  assert.ok(listed.includes('snippet'));
  assert.equal(shown.name, 'snippet');
  assert.match(shown.content, /firmware snippet artifacts/i);
  assert.match(shown.content, /snippet draft/);
});
