'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const installHelpersModule = require(path.join(repoRoot, 'runtime', 'lib', 'install-helpers.cjs'));
const installTargetsModule = require(path.join(repoRoot, 'runtime', 'lib', 'install-targets.cjs'));
const { DEFAULT_SKILL_SOURCE_LOCATION } = require(path.join(
  repoRoot,
  'runtime',
  'lib',
  'default-skill-source.cjs'
));
const runtimeHost = require(path.join(repoRoot, 'runtime', 'lib', 'runtime-host.cjs'));
const initProject = require(path.join(repoRoot, 'runtime', 'scripts', 'init-project.cjs'));

function createHelper(customProcess, options = {}) {
  const runtimeSrc = path.join(repoRoot, 'runtime');
  const {
    promptInstallerChoices,
    createTerminalUi,
    readline,
    previewSkillSource
  } = options;

  return installHelpersModule.createInstallHelpers({
    fs,
    os,
    path,
    process: customProcess,
    readline: readline || null,
    promptInstallerChoices,
    previewSkillSource,
    installTargets: installTargetsModule.createInstallTargets({
      os,
      path,
      process: customProcess
    }),
    runtimeHost,
    commandsSrc: path.join(repoRoot, 'commands', 'emb'),
    agentsSrc: path.join(repoRoot, 'agents'),
    runtimeSrc,
    runtimeHooksSrc: path.join(runtimeSrc, 'hooks'),
    packageVersion: '0.0.0-test',
    initProject,
    createTerminalUi
  });
}

test('interactive no-args install rejects non-tty sessions without developer name', async () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write(chunk) {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);
  await assert.rejects(() => helper.resolveArgs([]), /Non-interactive install requires --developer <name>/);
});

test('interactive no-args install can resolve local codex choice through prompt hook', async () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: true },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess, {
    promptInstallerChoices: async targets => {
      assert.deepEqual(targets.map(item => item.name), ['codex', 'claude', 'cursor']);
      return {
        runtime: 'codex',
        location: 'local',
        developer: 'welkon'
      };
    }
  });

  const args = await helper.resolveArgs([]);

  assert.equal(args.runtime, 'codex');
  assert.equal(args.global, false);
  assert.equal(args.local, true);
  assert.equal(args.developer, 'welkon');
  assert.equal(args.profile, 'core');
  assert.equal(args.subagentBridgeCmd, '');
  assert.equal(args.subagentBridgeTimeoutMs, runtimeHost.DEFAULT_SUBAGENT_BRIDGE_TIMEOUT_MS);
  assert.deepEqual(args.skillSources, []);
  assert.deepEqual(args.skillNames, []);
});

test('interactive prompt hook can request initial skill install', async () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: true },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess, {
    promptInstallerChoices: async () => ({
      runtime: 'codex',
      location: 'local',
      developer: 'welkon',
      installSkills: true,
      skillNames: 'scope-connect, scope-capture'
    })
  });

  const args = await helper.resolveArgs([]);

  assert.deepEqual(args.skillSources, [DEFAULT_SKILL_SOURCE_LOCATION]);
  assert.deepEqual(args.skillNames, ['scope-connect', 'scope-capture']);
});

test('interactive prompts render structured sections and retry blank developer names', async () => {
  const askedQuestions = [];
  const answers = ['1', '2', 'skip', '', 'welkon'];
  let stdout = '';

  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    argv: ['node', 'install.js'],
    stdin: { isTTY: true },
    stdout: {
      isTTY: true,
      write(chunk) {
        stdout += String(chunk);
        return true;
      }
    },
    stderr: {
      isTTY: true,
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess, {
    previewSkillSource(argv) {
      assert.deepEqual(argv, [DEFAULT_SKILL_SOURCE_LOCATION, '--scope', 'project']);
      return {
        plugin: {
          name: 'emb-skills'
        },
        skills: [
          {
            name: 'xc8-build',
            description: 'Build firmware with the repo-local XC8 script.'
          }
        ]
      };
    },
    readline: {
      createInterface() {
        return {
          on() {},
          close() {},
          question(question, callback) {
            askedQuestions.push(String(question));
            callback(String(answers.shift() || ''));
          }
        };
      }
    },
    createTerminalUi() {
      const wrap = tag => text => `<${tag}>${String(text)}</${tag}>`;
      return {
        enabled: true,
        chalk: {
          bold: wrap('bold'),
          blue: wrap('blue'),
          cyan: wrap('cyan'),
          dim: wrap('dim'),
          gray: wrap('gray'),
          green: wrap('green'),
          red: wrap('red'),
          yellow: wrap('yellow'),
          white: wrap('white')
        }
      };
    }
  });

  const args = await helper.resolveArgs([]);

  assert.equal(args.runtime, 'codex');
  assert.equal(args.local, true);
  assert.equal(args.developer, 'welkon');
  assert.equal(askedQuestions.length, 5);
  assert.match(askedQuestions[0], /Select Runtime/);
  assert.match(askedQuestions[0], /Embedded workflow bootstrap/);
  assert.match(askedQuestions[0], /Choice \[1\] >/);
  assert.match(askedQuestions[1], /Install Location/);
  assert.match(askedQuestions[1], /Recommended for this runtime/);
  assert.match(askedQuestions[2], /Skill Selection/);
  assert.match(askedQuestions[2], /Choice \[skip\/all\/source\] >/);
  assert.match(askedQuestions[3], /Developer Identity/);
  assert.match(askedQuestions[3], /Developer name >/);
  assert.match(stdout, /Runtime:/);
  assert.match(stdout, /Location:/);
  assert.match(stdout, /Skill source:/);
  assert.match(stdout, /Skill bundle:/);
  assert.match(stdout, /Skills:/);
  assert.match(stdout, /Developer name is required/);
  assert.match(stdout, /Developer:/);
  assert.deepEqual(args.skillSources, []);
  assert.deepEqual(args.skillNames, []);
});

test('interactive prompts can collect initial skill source and selected skills', async () => {
  const askedQuestions = [];
  const answers = ['1', '2', '1 2', 'welkon'];
  let stdout = '';
  const longDescription = [
    'Build firmware with the repo-local Python XC8 build script.',
    'The script stays generic by defaulting to SCMCU project-file metadata,',
    'while still allowing explicit overrides for chip, source files, and image prefix.'
  ].join(' ');

  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    argv: ['node', 'install.js'],
    stdin: { isTTY: true },
    stdout: {
      isTTY: true,
      write(chunk) {
        stdout += String(chunk);
        return true;
      }
    },
    stderr: {
      isTTY: true,
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess, {
    previewSkillSource(argv) {
      assert.deepEqual(argv, [DEFAULT_SKILL_SOURCE_LOCATION, '--scope', 'project']);
      return {
        plugin: {
          name: 'scope-ops-kit'
        },
        skills: [
          {
            name: 'scope-connect',
            description: longDescription
          },
          {
            name: 'scope-capture',
            description: 'Capture a waveform.'
          }
        ]
      };
    },
    readline: {
      createInterface() {
        return {
          on() {},
          close() {},
          question(question, callback) {
            askedQuestions.push(String(question));
            callback(String(answers.shift() || ''));
          }
        };
      }
    }
  });

  const args = await helper.resolveArgs([]);

  assert.deepEqual(args.skillSources, [DEFAULT_SKILL_SOURCE_LOCATION]);
  assert.deepEqual(args.skillNames, ['scope-connect', 'scope-capture']);
  assert.equal(askedQuestions.length, 4);
  assert.match(askedQuestions[2], /Skill Selection/);
  assert.match(askedQuestions[2], /Press enter or type `skip` to skip initial skill installation/);
  assert.match(askedQuestions[2], /skip\.\s+Skip initial skill installation/);
  assert.match(askedQuestions[2], /space-separated numbers/);
  assert.match(askedQuestions[2], /Type `all` to enable every published skill/);
  assert.match(askedQuestions[2], /source/);
  assert.match(askedQuestions[2], /scope-connect/);
  assert.match(askedQuestions[2], /scope-capture/);
  assert.doesNotMatch(askedQuestions[2], /while still allowing explicit overrides for chip, source files, and image prefix\./);
  assert.match(askedQuestions[2], /Build firmware with the repo-local Python XC8 build script\./);
  assert.match(askedQuestions[3], /Developer Identity/);
  assert.match(stdout, /Skill source:/);
  assert.match(stdout, /Skill bundle:/);
  assert.match(stdout, /Skill selection:/);
});

test('interactive prompts support arrow-key multi-select for skills', async () => {
  const askedQuestions = [];
  const answers = ['1', '2', 'welkon'];
  let stdout = '';
  const fakeStdin = new EventEmitter();
  fakeStdin.isTTY = true;
  fakeStdin.isRaw = false;
  fakeStdin.setRawModeCalls = [];
  fakeStdin.setRawMode = value => {
    fakeStdin.isRaw = Boolean(value);
    fakeStdin.setRawModeCalls.push(Boolean(value));
  };
  fakeStdin.resume = () => {};
  fakeStdin.pause = () => {};
  fakeStdin.setEncoding = () => {};

  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    argv: ['node', 'install.js'],
    stdin: fakeStdin,
    stdout: {
      isTTY: true,
      write(chunk) {
        stdout += String(chunk);
        return true;
      }
    },
    stderr: {
      isTTY: true,
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess, {
    previewSkillSource(argv) {
      assert.deepEqual(argv, [DEFAULT_SKILL_SOURCE_LOCATION, '--scope', 'project']);
      return {
        plugin: {
          name: 'scope-ops-kit'
        },
        skills: [
          {
            name: 'scope-connect',
            description: 'Connect to the active scope.'
          },
          {
            name: 'scope-capture',
            description: 'Capture a waveform.'
          }
        ]
      };
    },
    readline: {
      createInterface() {
        return {
          on() {},
          close() {},
          question(question, callback) {
            askedQuestions.push(String(question));
            const answer = String(answers.shift() || '');
            callback(answer);
            if (/Install Location/.test(String(question))) {
              setImmediate(() => {
                fakeStdin.emit('data', '\u001b[B');
                fakeStdin.emit('data', ' ');
                fakeStdin.emit('data', '\r');
              });
            }
          }
        };
      }
    }
  });

  const args = await helper.resolveArgs([]);

  assert.deepEqual(args.skillSources, [DEFAULT_SKILL_SOURCE_LOCATION]);
  assert.deepEqual(args.skillNames, ['scope-capture']);
  assert.equal(askedQuestions.length, 3);
  assert.match(stdout, /●/);
  assert.match(stdout, /○/);
  assert.match(stdout, /skip/);
  assert.match(stdout, /Skip initial skill installation/);
  assert.match(stdout, /Use ↑\/↓ to move and Space to toggle/);
  assert.match(stdout, /Highlight `skip` and press Enter/);
  assert.deepEqual(fakeStdin.setRawModeCalls, [true, false]);
});

test('interactive prompts support selecting the direct skip option with arrow keys', async () => {
  const askedQuestions = [];
  const answers = ['1', '2', 'welkon'];
  let stdout = '';
  const fakeStdin = new EventEmitter();
  fakeStdin.isTTY = true;
  fakeStdin.isRaw = false;
  fakeStdin.setRawModeCalls = [];
  fakeStdin.setRawMode = value => {
    fakeStdin.isRaw = Boolean(value);
    fakeStdin.setRawModeCalls.push(Boolean(value));
  };
  fakeStdin.resume = () => {};
  fakeStdin.pause = () => {};
  fakeStdin.setEncoding = () => {};

  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    argv: ['node', 'install.js'],
    stdin: fakeStdin,
    stdout: {
      isTTY: true,
      write(chunk) {
        stdout += String(chunk);
        return true;
      }
    },
    stderr: {
      isTTY: true,
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess, {
    previewSkillSource(argv) {
      assert.deepEqual(argv, [DEFAULT_SKILL_SOURCE_LOCATION, '--scope', 'project']);
      return {
        plugin: {
          name: 'scope-ops-kit'
        },
        skills: [
          {
            name: 'scope-connect',
            description: 'Connect to the active scope.'
          },
          {
            name: 'scope-capture',
            description: 'Capture a waveform.'
          }
        ]
      };
    },
    readline: {
      createInterface() {
        return {
          on() {},
          close() {},
          question(question, callback) {
            askedQuestions.push(String(question));
            const answer = String(answers.shift() || '');
            callback(answer);
            if (/Install Location/.test(String(question))) {
              setImmediate(() => {
                fakeStdin.emit('data', '\u001b[A');
                fakeStdin.emit('data', '\r');
              });
            }
          }
        };
      }
    }
  });

  const args = await helper.resolveArgs([]);

  assert.deepEqual(args.skillSources, []);
  assert.deepEqual(args.skillNames, []);
  assert.equal(askedQuestions.length, 3);
  assert.match(stdout, /skip/);
  assert.match(stdout, /Skip initial skill installation/);
  assert.match(stdout, /Highlight `skip` and press Enter/);
  assert.match(stdout, /Skip initial bundle install/);
  assert.deepEqual(fakeStdin.setRawModeCalls, [true, false]);
});

test('interactive prompts skip initial skills when selection is left blank', async () => {
  const askedQuestions = [];
  const answers = ['1', '2', '', 'welkon'];
  let stdout = '';

  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    argv: ['node', 'install.js'],
    stdin: { isTTY: true },
    stdout: {
      isTTY: true,
      write(chunk) {
        stdout += String(chunk);
        return true;
      }
    },
    stderr: {
      isTTY: true,
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess, {
    previewSkillSource(argv) {
      assert.deepEqual(argv, [DEFAULT_SKILL_SOURCE_LOCATION, '--scope', 'project']);
      return {
        plugin: {
          name: 'scope-ops-kit'
        },
        skills: [
          {
            name: 'scope-connect',
            description: 'Connect to the active scope.'
          }
        ]
      };
    },
    readline: {
      createInterface() {
        return {
          on() {},
          close() {},
          question(question, callback) {
            askedQuestions.push(String(question));
            callback(String(answers.shift() || ''));
          }
        };
      }
    }
  });

  const args = await helper.resolveArgs([]);

  assert.deepEqual(args.skillSources, []);
  assert.deepEqual(args.skillNames, []);
  assert.equal(askedQuestions.length, 4);
  assert.match(askedQuestions[2], /Choice \[skip\/all\/source\] >/);
  assert.match(stdout, /Skip initial bundle install/);
});

test('interactive prompts can switch away from the default initial skill bundle', async () => {
  const askedQuestions = [];
  const answers = ['1', '2', 'source', './custom-bundle', '1', 'welkon'];
  let stdout = '';
  const previewCalls = [];

  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    argv: ['node', 'install.js'],
    stdin: { isTTY: true },
    stdout: {
      isTTY: true,
      write(chunk) {
        stdout += String(chunk);
        return true;
      }
    },
    stderr: {
      isTTY: true,
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess, {
    previewSkillSource(argv) {
      previewCalls.push(argv.slice());
      if (argv[0] === DEFAULT_SKILL_SOURCE_LOCATION) {
        return {
          plugin: {
            name: 'default-scope-kit'
          },
          skills: [
            {
              name: 'scope-connect',
              description: 'Connect to the default scope.'
            }
          ]
        };
      }

      assert.deepEqual(argv, ['./custom-bundle', '--scope', 'project']);
      return {
        plugin: {
          name: 'custom-scope-kit'
        },
        skills: [
          {
            name: 'scope-capture',
            description: 'Capture from the custom bundle.'
          }
        ]
      };
    },
    readline: {
      createInterface() {
        return {
          on() {},
          close() {},
          question(question, callback) {
            askedQuestions.push(String(question));
            callback(String(answers.shift() || ''));
          }
        };
      }
    }
  });

  const args = await helper.resolveArgs([]);

  assert.deepEqual(previewCalls, [
    [DEFAULT_SKILL_SOURCE_LOCATION, '--scope', 'project'],
    ['./custom-bundle', '--scope', 'project']
  ]);
  assert.deepEqual(args.skillSources, ['./custom-bundle']);
  assert.deepEqual(args.skillNames, ['scope-capture']);
  assert.equal(askedQuestions.length, 6);
  assert.match(askedQuestions[2], /Skill Selection/);
  assert.match(askedQuestions[3], /Skill Source/);
  assert.match(askedQuestions[4], /Skill Selection/);
  assert.match(stdout, /default-scope-kit/);
  assert.match(stdout, /custom-scope-kit/);
});

test('interactive prompts let user skip initial skills after preview failure', async () => {
  const askedQuestions = [];
  const answers = ['1', '2', 'skip', 'welkon'];
  let stdout = '';

  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    argv: ['node', 'install.js'],
    stdin: { isTTY: true },
    stdout: {
      isTTY: true,
      write(chunk) {
        stdout += String(chunk);
        return true;
      }
    },
    stderr: {
      isTTY: true,
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess, {
    previewSkillSource() {
      throw new Error('git clone failed: required local dependency is not available in this environment');
    },
    readline: {
      createInterface() {
        return {
          on() {},
          close() {},
          question(question, callback) {
            askedQuestions.push(String(question));
            callback(String(answers.shift() || ''));
          }
        };
      }
    }
  });

  const args = await helper.resolveArgs([]);

  assert.deepEqual(args.skillSources, []);
  assert.deepEqual(args.skillNames, []);
  assert.equal(askedQuestions.length, 4);
  assert.match(stdout, /cannot be inspected from this environment right now/);
  assert.match(stdout, /Skip initial bundle install/);
  assert.equal(args.developer, 'welkon');
});

test('interactive prompts can be cancelled before answering a question', async () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    argv: ['node', 'install.js'],
    stdin: { isTTY: true },
    stdout: {
      isTTY: true,
      write() {
        return true;
      }
    },
    stderr: {
      isTTY: true,
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess, {
    readline: {
      createInterface() {
        const listeners = {};
        return {
          on(event, handler) {
            listeners[event] = handler;
          },
          close() {
            if (listeners.close) {
              listeners.close();
            }
          },
          question(_question, _callback) {
            if (listeners.close) {
              listeners.close();
            }
          }
        };
      }
    }
  });

  await assert.rejects(() => helper.resolveArgs([]), /Interactive install cancelled\./);
});

test('parseArgs accepts sub-agent bridge command and timeout', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);
  const args = helper.parseArgs([
    '--global',
    '--developer',
    'welkon',
    '--subagent-bridge-cmd',
    'node /tmp/mock-bridge.cjs --stdio-json',
    '--subagent-bridge-timeout-ms',
    '21000'
  ]);

  assert.equal(args.subagentBridgeCmd, 'node /tmp/mock-bridge.cjs --stdio-json');
  assert.equal(args.subagentBridgeTimeoutMs, 21000);
});

test('parseArgs defaults Codex installs to local project scope', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);
  const args = helper.parseArgs(['--developer', 'welkon']);

  assert.equal(args.runtime, 'codex');
  assert.equal(args.local, true);
  assert.equal(args.global, false);
});

test('parseArgs keeps Claude installs global by default', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);
  const args = helper.parseArgs(['--claude', '--developer', 'welkon']);

  assert.equal(args.runtime, 'claude');
  assert.equal(args.local, true);
  assert.equal(args.global, false);
});

test('parseArgs rejects removed external runtime shorthand', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);
  assert.throws(
    () => helper.parseArgs(['--external', '--developer', 'welkon']),
    /Install flag "--external" has been removed/
  );
});

test('parseArgs accepts default adapter source overrides', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);
  const args = helper.parseArgs([
    '--global',
    '--developer',
    'welkon',
    '--default-chip-support-source-location',
    'git@github.com:Welkon/emb-agent-adapters.git',
    '--default-chip-support-source-branch',
    'main',
    '--default-chip-support-source-subdir',
    'emb-agent'
  ]);

  assert.equal(args.defaultAdapterSourceLocation, 'git@github.com:Welkon/emb-agent-adapters.git');
  assert.equal(args.defaultAdapterSourceBranch, 'main');
  assert.equal(args.defaultAdapterSourceSubdir, 'emb-agent');
});

test('parseArgs accepts install profile override', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);
  const args = helper.parseArgs(['--global', '--developer', 'welkon', '--profile', 'workflow']);

  assert.equal(args.profile, 'workflow');
});

test('parseArgs accepts color mode overrides', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);
  const explicit = helper.parseArgs(['--global', '--developer', 'welkon', '--color=always']);
  const disabled = helper.parseArgs(['--global', '--developer', 'welkon', '--no-color']);

  assert.equal(explicit.color, 'always');
  assert.equal(disabled.color, 'never');
});

test('parseArgs rejects sub-agent bridge timeout without command', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);

  assert.throws(
    () => helper.parseArgs(['--global', '--developer', 'welkon', '--subagent-bridge-timeout-ms', '21000']),
    /--subagent-bridge-timeout-ms requires --subagent-bridge-cmd/
  );
});

test('parseArgs rejects empty default adapter source location', () => {
  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    stdin: { isTTY: false },
    stdout: {
      write() {
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess);

  assert.throws(
    () => helper.parseArgs(['--global', '--developer', 'welkon', '--default-chip-support-source-location']),
    /Missing value after --default-chip-support-source-location/
  );
});

test('main reports install progress through injected terminal ui', async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-install-ui-'));
  const activities = [];
  let stderr = '';
  let receivedColorMode = '';

  const fakeProcess = {
    cwd: () => repoRoot,
    env: {},
    argv: ['node', 'install.js'],
    stdin: { isTTY: true },
    stdout: {
      isTTY: true,
      write() {
        return true;
      }
    },
    stderr: {
      isTTY: true,
      write(chunk) {
        stderr += String(chunk);
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess, {
    createTerminalUi(options = {}) {
      receivedColorMode = String(options.colorMode || '');
      return {
        enabled: true,
        chalk: {
          bold: text => String(text),
          cyan: text => String(text),
          dim: text => String(text),
          green: text => String(text),
          yellow: text => String(text)
        },
        createActivity(text) {
          activities.push({ type: 'start', text });
          return {
            succeed(message) {
              activities.push({ type: 'succeed', text: message });
            },
            fail(message, error) {
              activities.push({
                type: 'fail',
                text: message,
                error: error && error.message ? error.message : ''
              });
            }
          };
        }
      };
    }
  });

  await helper.main(['--codex', '--global', '--config-dir', tempHome, '--developer', 'welkon', '--color=always']);

  assert.match(stderr, /emb-agent installer/);
  assert.match(stderr, /Runtime:/);
  assert.match(stderr, /Target:/);
  assert.match(stderr, /Installation complete/);
  assert.match(stderr, /Next:/);
  assert.match(stderr, /then open a new session/);
  assert.equal(receivedColorMode, 'always');
  assert.deepEqual(
    activities.filter(item => item.type === 'start').map(item => item.text),
    [
      'Installing emb-agent runtime files',
      'Installing host agents, hooks, and commands',
      'Preparing local environment template'
    ]
  );
  assert.ok(
    activities.some(item => item.type === 'succeed' && item.text === 'Installed emb-agent runtime files')
  );
  assert.ok(
    activities.some(
      item => item.type === 'succeed' && /Installed \d+ host integration artifacts/.test(item.text)
    )
  );
  assert.ok(
    activities.some(item => item.type === 'succeed' && /env example/.test(item.text))
  );
  assert.equal(activities.some(item => item.type === 'fail'), false);
});

test('interactive main keeps final summary in terminal ui instead of stdout dump', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-interactive-main-'));
  const currentCwd = process.cwd();
  let stdout = '';
  let stderr = '';

  const fakeProcess = {
    cwd: () => tempProject,
    env: { EMB_AGENT_WORKSPACE_TRUST: '1' },
    argv: ['node', 'install.js'],
    stdin: { isTTY: true },
    stdout: {
      isTTY: true,
      write(chunk) {
        stdout += String(chunk);
        return true;
      }
    },
    stderr: {
      isTTY: true,
      write(chunk) {
        stderr += String(chunk);
        return true;
      }
    }
  };

  try {
    process.chdir(tempProject);
    const helper = createHelper(fakeProcess, {
      promptInstallerChoices: async () => ({
        runtime: 'codex',
        location: 'local',
        developer: 'welkon'
      }),
      createTerminalUi() {
        return {
          enabled: true,
          chalk: {
            bold: text => String(text),
            blue: text => String(text),
            cyan: text => String(text),
            dim: text => String(text),
            gray: text => String(text),
            green: text => String(text),
            red: text => String(text),
            yellow: text => String(text),
            white: text => String(text)
          },
          createActivity() {
            return {
              succeed() {},
              fail() {}
            };
          }
        };
      }
    });

    await helper.main([]);

    assert.equal(stdout, '');
    assert.match(stderr, /Installation complete/);
    assert.match(stderr, /Runtime Dir:/);
    assert.match(stderr, /Next:/);
    assert.match(stderr, /then open a new session/);
  } finally {
    process.chdir(currentCwd);
  }
});

test('flag-driven tty install keeps final summary in terminal ui instead of stdout dump', async () => {
  const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-flag-main-'));
  const tempConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-flag-config-'));
  let stdout = '';
  let stderr = '';

  const fakeProcess = {
    cwd: () => tempProject,
    env: { EMB_AGENT_WORKSPACE_TRUST: '1' },
    argv: ['node', 'install.js'],
    stdin: { isTTY: true },
    stdout: {
      isTTY: true,
      write(chunk) {
        stdout += String(chunk);
        return true;
      }
    },
    stderr: {
      isTTY: true,
      write(chunk) {
        stderr += String(chunk);
        return true;
      }
    }
  };

  const helper = createHelper(fakeProcess, {
    createTerminalUi() {
      return {
        enabled: true,
        chalk: {
          bold: text => String(text),
          blue: text => String(text),
          cyan: text => String(text),
          dim: text => String(text),
          gray: text => String(text),
          green: text => String(text),
          red: text => String(text),
          yellow: text => String(text),
          white: text => String(text)
        },
        createActivity() {
          return {
            succeed() {},
            fail() {}
          };
        }
      };
    }
  });

  await helper.main(['--codex', '--global', '--config-dir', tempConfig, '--developer', 'welkon']);

  assert.equal(stdout, '');
  assert.match(stderr, /Installation complete/);
  assert.match(stderr, /Runtime Dir:/);
  assert.match(stderr, /Next:/);
  assert.match(stderr, /then open a new session/);
});
