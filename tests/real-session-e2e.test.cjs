'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
const cli = require(path.join(repoRoot, 'runtime', 'bin', 'emb-agent.cjs'));

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

test('real session regression covers source intake through verify closure hints', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-real-session-e2e-'));
  const currentCwd = process.cwd();
  const originalWrite = process.stdout.write;
  const previousTrust = process.env.EMB_AGENT_WORKSPACE_TRUST;
  const projectEmbDir = path.join(tempProject, '.emb-agent');

  process.stdout.write = () => true;

  try {
    process.env.EMB_AGENT_WORKSPACE_TRUST = '1';

    initProject.main(['--project', tempProject, '--profile', 'baremetal-loop']);
    writeFile(path.join(tempProject, 'docs', 'PMS150G.pdf'), 'fake pdf payload\n');

    process.chdir(tempProject);
    await cli.main(['init']);

    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'chips', 'profiles'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'families'), { recursive: true });
    fs.mkdirSync(path.join(projectEmbDir, 'extensions', 'tools', 'devices'), { recursive: true });
    writeFile(
      path.join(projectEmbDir, 'extensions', 'chips', 'registry.json'),
      JSON.stringify({ devices: ['PMS150G'] }, null, 2) + '\n'
    );
    writeFile(
      path.join(projectEmbDir, 'extensions', 'chips', 'profiles', 'pms150g.json'),
      JSON.stringify({
        name: 'PMS150G',
        vendor: 'Padauk',
        family: 'padauk-8bit',
        sample: false,
        series: 'PMS',
        package: 'SOP8',
        architecture: '8-bit',
        runtime_model: 'main_loop_plus_isr',
        description: 'Project-local PMS150G profile.',
        summary: {},
        capabilities: ['timer16', 'pwm'],
        docs: [],
        related_tools: ['timer-calc'],
        source_modules: [],
        notes: []
      }, null, 2) + '\n'
    );
    writeFile(
      path.join(projectEmbDir, 'extensions', 'tools', 'families', 'padauk-8bit.json'),
      JSON.stringify({
        name: 'padauk-8bit',
        vendor: 'Padauk',
        series: 'PMS',
        sample: false,
        description: 'Project-local Padauk tool family profile.',
        supported_tools: ['timer-calc'],
        clock_sources: ['sysclk'],
        bindings: {},
        notes: []
      }, null, 2) + '\n'
    );
    writeFile(
      path.join(projectEmbDir, 'extensions', 'tools', 'devices', 'pms150g.json'),
      JSON.stringify({
        name: 'PMS150G',
        family: 'padauk-8bit',
        sample: false,
        description: 'Project-local PMS150G tool profile.',
        supported_tools: ['timer-calc'],
        bindings: {
          'timer-calc': {
            algorithm: 'padauk-timer16',
            params: {
              default_timer: 'tm16'
            }
          }
        },
        notes: []
      }, null, 2) + '\n'
    );

    const beforeIntake = cli.buildNextContext();
    assert.equal(beforeIntake.next.command, 'health');
    assert.equal(beforeIntake.next.gated_by_health, true);
    assert.match(beforeIntake.action_card.first_cli, /ingest doc --file docs\/PMS150G\.pdf/);

    const providerImpls = {
      mineru: {
        async parseDocument() {
          return {
            provider: 'mineru',
            mode: 'agent',
            task_id: 'task-real-session',
            markdown: '# PMS150G SOP8\n\n- PWM output supported\n- PA5 reserved for programming\n',
            metadata: {
              completed: {
                full_md_url: 'https://mineru.invalid/pms150g.md'
              }
            }
          };
        }
      }
    };

    const ingested = await cli.runIngestCommand(
      'doc',
      ['--file', 'docs/PMS150G.pdf', '--kind', 'datasheet', '--to', 'hardware'],
      { providerImpls }
    );
    const applied = await cli.runIngestCommand(
      'apply',
      ['doc', ingested.doc_id, '--to', 'hardware'],
      { providerImpls }
    );

    assert.equal(ingested.truth_write.status, 'ready-to-apply');
    assert.equal(applied.truth_write.status, 'written');

    await cli.main([
      'task',
      'add',
      '--confirm',
      'Close the PMS150G board loop',
      '--type',
      'implement',
      '--scope',
      'smoke'
    ]);
    const createdTaskName = fs.readdirSync(path.join(projectEmbDir, 'tasks'))
      .filter(name => name !== '00-bootstrap-project' && name !== 'archive')[0];
    await cli.main(['task', 'activate', createdTaskName, '--confirm']);
    await cli.main(['focus', 'set', 'close the integrated regression loop']);
    await cli.main(['capability', 'run', 'do']);

    const nextAfterDo = cli.buildNextContext();

    assert.equal(nextAfterDo.next.command, 'verify');
    assert.equal(nextAfterDo.task.name, createdTaskName);
    assert.equal(nextAfterDo.hardware.chip_profile.name, 'PMS150G');
    assert.deepEqual(nextAfterDo.quality_gates.required_skills, ['scope-capture']);
    assert.deepEqual(nextAfterDo.quality_gates.required_signoffs, ['board-bench']);
    assert.ok(nextAfterDo.next_actions.some(item => item.includes('quality_gate_install=') && item.includes('--skill scope-capture')));
    assert.ok(nextAfterDo.next_actions.some(item => item.includes('quality_gate_run=skills run scope-capture')));
    assert.ok(nextAfterDo.next_actions.some(item => item.includes('quality_gate_signoff=verify confirm board-bench')));
  } finally {
    if (previousTrust === undefined) {
      delete process.env.EMB_AGENT_WORKSPACE_TRUST;
    } else {
      process.env.EMB_AGENT_WORKSPACE_TRUST = previousTrust;
    }
    process.chdir(currentCwd);
    process.stdout.write = originalWrite;
  }
});
