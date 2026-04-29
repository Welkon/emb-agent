'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));
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

async function runQuiet(args) {
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;

  try {
    await cli.main(args);
  } finally {
    process.stdout.write = originalWrite;
  }
}

test('transcript import writes review-only artifacts and extracts hardware recovery signals', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-transcript-import-'));
  const currentCwd = process.cwd();

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await runQuiet(['init']);

    const transcriptPath = path.join(tempProject, 'conversation.md');
    fs.writeFileSync(
      transcriptPath,
      [
        '现在红灯的硬件电路改了，改成高电平亮灯，低电平不亮灯，红灯的负极接地了。',
        '我不要helper函数，会增加开销。',
        '现在有拔出USB，红灯还亮的情况，需要按一下按键开启主灯才会熄灭红灯的现象。',
        '现在有拔出USB，红灯还亮的情况，需要按一下按键开启主灯才会熄灭红灯的现象。',
        '现在待机功耗实测76uA左右，偏高'
      ].join('\n'),
      'utf8'
    );

    const imported = await captureCliJson([
      '--json',
      'transcript',
      'import',
      '--provider',
      'generic',
      '--file',
      transcriptPath
    ]);

    assert.equal(imported.imported, true);
    assert.equal(imported.applied, false);
    assert.equal(imported.provider, 'generic');
    assert.match(imported.files.analysis_file, /\.emb-agent\/imports\/analysis\/.+\.json$/);
    assert.match(imported.files.markdown_file, /\.emb-agent\/imports\/analysis\/.+\.md$/);
    assert.match(imported.files.ai_review_file, /\.emb-agent\/imports\/analysis\/.+\.ai-review\.md$/);
    assert.ok(fs.existsSync(path.join(tempProject, imported.files.analysis_file)));
    assert.ok(fs.existsSync(path.join(tempProject, imported.files.markdown_file)));
    assert.ok(fs.existsSync(path.join(tempProject, imported.files.ai_review_file)));
    assert.equal(imported.analysis.analysis_method, 'heuristic-prepass');
    assert.equal(imported.analysis.semantic_review.required, true);
    assert.equal(imported.guidance.review_required, true);
    assert.ok(imported.analysis.confirmed_facts.some(item => item.includes('红灯')));
    assert.ok(imported.analysis.user_preferences.some(item => item.includes('不要helper')));
    assert.ok(imported.analysis.open_risks.some(item => item.includes('偏高')));
    assert.ok(imported.analysis.repeated_symptoms.some(item => item.includes('2x')));
    assert.equal(imported.analysis.recommended_next.route, 'debug-forensics');
    assert.equal(cli.loadSession().last_command, 'transcript import');
    assert.equal(cli.buildNextContext().next.command, 'transcript-review');
  } finally {
    process.chdir(currentCwd);
  }
});

test('transcript apply requires confirmation and stores only session recovery signals', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-transcript-apply-'));
  const currentCwd = process.cwd();

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await runQuiet(['init']);

    const analysisPath = path.join(tempProject, 'analysis.json');
    fs.writeFileSync(
      analysisPath,
      JSON.stringify({
        version: '1.0',
        provider: 'claude',
        source_id: 'manual-export',
        source_file: 'conversation.json',
        confirmed_facts: ['RB4 red LED is active high'],
        user_preferences: ['不要 helper 函数'],
        open_questions: ['应该先查手册确认 sleep 电流吗？'],
        open_risks: ['待机功耗 76uA 偏高'],
        repeated_symptoms: ['2x 拔 USB 后红灯不灭'],
        pin_state_candidates: ['RB4: active high red LED'],
        recommended_next: {
          route: 'power-sleep-checklist',
          reason: 'Low-power symptom imported'
        }
      }, null, 2) + '\n',
      'utf8'
    );

    const blocked = await captureCliJson([
      '--json',
      'transcript',
      'apply',
      '--from',
      analysisPath
    ]);
    assert.equal(blocked.applied, false);
    assert.equal(blocked.status, 'permission-pending');

    const applied = await captureCliJson([
      '--json',
      'transcript',
      'apply',
      '--from',
      analysisPath,
      '--confirm'
    ]);
    assert.equal(applied.applied, false);
    assert.equal(applied.status, 'semantic-review-pending');

    const reviewed = await captureCliJson([
      '--json',
      'transcript',
      'review',
      '--from',
      analysisPath,
      '--accept-heuristic'
    ]);
    assert.equal(reviewed.reviewed, true);
    assert.equal(reviewed.analysis.analysis_method, 'ai-reviewed');
    assert.equal(reviewed.analysis.review_mode, 'accepted-heuristic');
    assert.equal(reviewed.analysis.semantic_review.status, 'accepted');
    assert.ok(fs.existsSync(path.join(tempProject, reviewed.files.reviewed_analysis_file)));

    const appliedReviewed = await captureCliJson([
      '--json',
      'transcript',
      'apply',
      '--from',
      path.join(tempProject, reviewed.files.reviewed_analysis_file),
      '--confirm'
    ]);
    assert.equal(appliedReviewed.applied, true);

    const session = cli.loadSession();
    assert.equal(session.last_command, 'transcript apply');
    assert.ok(session.open_questions.includes('应该先查手册确认 sleep 电流吗？'));
    assert.ok(session.known_risks.includes('待机功耗 76uA 偏高'));
    assert.ok(session.known_risks.some(item => item.includes('repeated transcript symptom')));
    assert.equal(session.diagnostics.latest_transcript_import.provider, 'claude');
    assert.equal(session.diagnostics.latest_transcript_import.semantic_review.required, true);
    assert.equal(session.diagnostics.latest_transcript_import.semantic_review.status, 'accepted');
    assert.deepEqual(session.diagnostics.latest_transcript_import.confirmed_facts, ['RB4 red LED is active high']);
    assert.equal(cli.buildNextContext().next.command, 'scan');
  } finally {
    process.chdir(currentCwd);
  }
});

test('transcript review accepts strict AI reviewed schema', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-transcript-reviewed-file-'));
  const currentCwd = process.cwd();

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await runQuiet(['init']);

    const analysisPath = path.join(tempProject, 'analysis.json');
    fs.writeFileSync(
      analysisPath,
      JSON.stringify({
        version: '1.0',
        provider: 'codex',
        source_id: 'old-session',
        source_file: 'conversation.jsonl',
        confirmed_facts: ['raw fact should be reviewed'],
        open_questions: ['raw question?'],
        open_risks: ['raw risk'],
        recommended_next: {
          route: 'review-before-do',
          reason: 'raw route'
        },
        semantic_review: {
          required: true,
          status: 'pending',
          reviewer: 'host-ai'
        }
      }, null, 2) + '\n',
      'utf8'
    );

    const reviewedPath = path.join(tempProject, 'reviewed.json');
    fs.writeFileSync(
      reviewedPath,
      JSON.stringify({
        semantic_review: {
          required: true,
          status: 'accepted',
          reviewer: 'codex'
        },
        session_signals: {
          open_questions: ['AI reviewed question'],
          known_risks: ['AI reviewed risk'],
          focus: 'AI reviewed focus'
        },
        truth_candidates: {
          hardware: ['RB4 active high red LED'],
          requirements: ['no helper wrappers']
        },
        task_candidates: {
          suggested_task: 'review recovered USB detection issue',
          verification_needed: ['bench USB insert/remove']
        },
        discarded_items: ['tool chatter'],
        recommended_next: {
          route: 'review-before-do',
          reason: 'AI reviewed route'
        }
      }, null, 2) + '\n',
      'utf8'
    );

    const reviewed = await captureCliJson([
      '--json',
      'transcript',
      'review',
      '--from',
      analysisPath,
      '--reviewed-file',
      reviewedPath
    ]);
    assert.equal(reviewed.reviewed, true);
    assert.equal(reviewed.analysis.review_mode, 'reviewed-file');
    assert.equal(reviewed.analysis.semantic_review.reviewer, 'codex');
    assert.deepEqual(reviewed.analysis.session_signals.open_questions, ['AI reviewed question']);
    assert.deepEqual(reviewed.analysis.truth_candidates.hardware, ['RB4 active high red LED']);

    const applied = await captureCliJson([
      '--json',
      'transcript',
      'apply',
      '--from',
      path.join(tempProject, reviewed.files.reviewed_analysis_file),
      '--confirm'
    ]);
    assert.equal(applied.applied, true);
    assert.deepEqual(applied.added.open_questions, ['AI reviewed question']);
    assert.deepEqual(applied.added.known_risks, ['AI reviewed risk']);
    assert.equal(cli.buildNextContext().next.command, 'review');
  } finally {
    process.chdir(currentCwd);
  }
});

test('transcript review rejects incomplete reviewed schema', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-transcript-invalid-reviewed-file-'));
  const currentCwd = process.cwd();

  try {
    initProject.main(['--project', tempProject]);
    process.chdir(tempProject);
    await runQuiet(['init']);

    const analysisPath = path.join(tempProject, 'analysis.json');
    fs.writeFileSync(
      analysisPath,
      JSON.stringify({
        version: '1.0',
        provider: 'codex',
        source_id: 'old-session',
        semantic_review: {
          required: true,
          status: 'pending',
          reviewer: 'host-ai'
        }
      }, null, 2) + '\n',
      'utf8'
    );

    const reviewedPath = path.join(tempProject, 'reviewed-incomplete.json');
    fs.writeFileSync(
      reviewedPath,
      JSON.stringify({
        semantic_review: {
          status: 'accepted',
          reviewer: 'codex'
        },
        session_signals: {
          open_questions: [],
          focus: ''
        },
        truth_candidates: {
          hardware: [],
          requirements: []
        },
        task_candidates: {
          suggested_task: '',
          verification_needed: []
        },
        discarded_items: [],
        recommended_next: {
          route: 'scan-first',
          reason: ''
        }
      }, null, 2) + '\n',
      'utf8'
    );

    await assert.rejects(
      captureCliJson([
        '--json',
        'transcript',
        'review',
        '--from',
        analysisPath,
        '--reviewed-file',
        reviewedPath
      ]),
      /session_signals\.known_risks must be an array of strings/
    );
  } finally {
    process.chdir(currentCwd);
  }
});

test('transcript import accepts host-specific providers from files without binding the command to codex', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-transcript-host-file-'));
  const currentCwd = process.cwd();

  try {
    process.chdir(tempProject);
    await runQuiet(['init']);

    const claudePath = path.join(tempProject, 'claude-transcript.json');
    fs.writeFileSync(
      claudePath,
      JSON.stringify({
        messages: [
          {
            role: 'user',
            text: 'RB5 是 Type-C 检测脚，SS8550 反灌导致 USB 判断风险。'
          }
        ]
      }, null, 2) + '\n',
      'utf8'
    );

    const imported = await captureCliJson([
      '--json',
      'transcript',
      'import',
      '--provider',
      'claude',
      '--file',
      claudePath
    ]);

    assert.equal(imported.imported, true);
    assert.equal(imported.provider, 'claude');
    assert.ok(imported.analysis.confirmed_facts.some(item => item.includes('RB5')));
    assert.ok(imported.analysis.open_risks.some(item => item.includes('反灌')));
  } finally {
    process.chdir(currentCwd);
  }
});

test('codex id import finds session files and filters host noise', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-transcript-codex-id-'));
  const currentCwd = process.cwd();
  const previousCodexHome = process.env.CODEX_HOME;

  try {
    process.chdir(tempProject);
    await runQuiet(['init']);

    const codexHome = path.join(tempProject, 'codex-home');
    const sessionId = '019dcc60-563a-7383-8afe-447712ea493c';
    const sessionDir = path.join(codexHome, 'sessions', '2026', '04', '27');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionPath = path.join(sessionDir, `rollout-${sessionId}.jsonl`);
    const rows = [
      {
        timestamp: '2026-04-27T00:00:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: '<permissions instructions>ignore</permissions instructions>' }]
        }
      },
      {
        timestamp: '2026-04-27T00:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '# AGENTS.md instructions for /tmp/project\nignore' }]
        }
      },
      {
        timestamp: '2026-04-27T00:00:02.000Z',
        type: 'event_msg',
        payload: {
          type: 'user_message',
          message: '现在红灯的硬件电路改了，改成高电平亮灯，低电平不亮灯，红灯的负极接地了。'
        }
      },
      {
        timestamp: '2026-04-27T00:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '我会先搜索 RB4 红灯相关实现。' }]
        }
      },
      {
        timestamp: '2026-04-27T00:00:04.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: '是，当前主灯输出是 `RB1 / PWM1`。' }]
        }
      }
    ];
    fs.writeFileSync(sessionPath, rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
    process.env.CODEX_HOME = codexHome;

    const imported = await captureCliJson([
      '--json',
      'transcript',
      'import',
      '--provider',
      'codex',
      '--id',
      sessionId,
      '--output-dir',
      path.join(tempProject, 'imports')
    ]);

    assert.equal(imported.imported, true);
    assert.equal(imported.source_file, sessionPath);
    assert.equal(imported.analysis.semantic_review.required, true);
    assert.ok(fs.existsSync(path.join(tempProject, imported.files.ai_review_file)));
    assert.ok(imported.analysis.confirmed_facts.some(item => item.includes('红灯')));
    assert.ok(imported.analysis.candidate_facts.some(item => item.includes('RB1')));
    assert.ok(!imported.analysis.confirmed_facts.some(item => item.includes('AGENTS')));
    assert.ok(!imported.analysis.confirmed_facts.some(item => item.includes('我会先搜索')));
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    process.chdir(currentCwd);
  }
});
