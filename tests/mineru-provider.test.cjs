'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const mineruProvider = require(path.join(repoRoot, 'runtime', 'lib', 'doc-providers', 'mineru.cjs'));

function buildResponse(options) {
  const body = options.body;
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    statusText: options.statusText || 'OK',
    async json() {
      return body;
    },
    async text() {
      if (typeof body === 'string') {
        return body;
      }
      return JSON.stringify(body);
    },
    async arrayBuffer() {
      if (Buffer.isBuffer(body)) {
        return body;
      }
      return Buffer.from(String(body || ''), 'utf8');
    }
  };
}

function buildStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

test('mineru provider parses markdown via api mode batch flow', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-mineru-api-'));
  const filePath = path.join(tempDir, 'demo.pdf');
  fs.writeFileSync(filePath, 'fake pdf', 'utf8');

  const zipBuffer = buildStoredZip([
    { name: 'result/full.md', data: '# API Parse\n\n- Timer16 exists\n' }
  ]);

  const calls = [];
  let pollCount = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });

    if (url === 'https://mineru.net/api/v4/file-urls/batch') {
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      const body = JSON.parse(options.body);
      assert.equal(body.model_version, 'vlm');
      assert.equal(body.files[0].name, 'demo.pdf');
      return buildResponse({
        body: {
          code: 0,
          data: {
            batch_id: 'batch-1',
            file_urls: [{ upload_url: 'https://upload.invalid/file1', file_id: 'f1' }]
          }
        }
      });
    }

    if (url === 'https://upload.invalid/file1') {
      assert.equal(options.method, 'PUT');
      return buildResponse({ body: '' });
    }

    if (url === 'https://mineru.net/api/v4/extract-results/batch/batch-1') {
      pollCount += 1;
      if (pollCount === 1) {
        return buildResponse({
          body: {
            code: 0,
            data: {
              extract_result: [{ state: 'running' }]
            }
          }
        });
      }

      return buildResponse({
        body: {
          code: 0,
          data: {
            extract_result: [
              {
                state: 'done',
                full_zip_url: 'https://download.invalid/result.zip'
              }
            ]
          }
        }
      });
    }

    if (url === 'https://download.invalid/result.zip') {
      return buildResponse({ body: zipBuffer });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const parsed = await mineruProvider.parseDocument(
    {
      file_path: filePath,
      file_name: 'demo.pdf',
      pages: '1-2',
      language: 'ch',
      ocr: false,
      enable_table: true,
      enable_formula: true
    },
    {
      mode: 'api',
      base_url: 'https://mineru.net/api/v4',
      api_key_env: 'MINERU_API_KEY',
      model_version: 'vlm',
      language: 'ch',
      enable_table: true,
      is_ocr: false,
      enable_formula: true,
      poll_interval_ms: 1,
      timeout_ms: 1000
    },
    {
      fetchImpl,
      env: {
        MINERU_API_KEY: 'test-token'
      }
    }
  );

  assert.equal(parsed.provider, 'mineru');
  assert.equal(parsed.mode, 'api');
  assert.equal(parsed.task_id, 'batch-1');
  assert.match(parsed.markdown, /API Parse/);
  assert.equal(calls.length, 5);
});

test('mineru provider accepts string upload urls from api create response', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-mineru-api-string-url-'));
  const filePath = path.join(tempDir, 'demo.pdf');
  fs.writeFileSync(filePath, 'fake pdf', 'utf8');

  const zipBuffer = buildStoredZip([
    { name: 'result/full.md', data: '# API Parse String URL\n\n- Timer16 exists\n' }
  ]);

  let pollCount = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url === 'https://mineru.net/api/v4/file-urls/batch') {
      return buildResponse({
        body: {
          code: 0,
          data: {
            batch_id: 'batch-string',
            file_urls: ['https://upload.invalid/file-string']
          }
        }
      });
    }

    if (url === 'https://upload.invalid/file-string') {
      assert.equal(options.method, 'PUT');
      return buildResponse({ body: '' });
    }

    if (url === 'https://mineru.net/api/v4/extract-results/batch/batch-string') {
      pollCount += 1;
      if (pollCount === 1) {
        return buildResponse({
          body: {
            code: 0,
            data: {
              extract_result: [{ state: 'running' }]
            }
          }
        });
      }

      return buildResponse({
        body: {
          code: 0,
          data: {
            extract_result: [
              {
                state: 'done',
                full_zip_url: 'https://download.invalid/result-string.zip'
              }
            ]
          }
        }
      });
    }

    if (url === 'https://download.invalid/result-string.zip') {
      return buildResponse({ body: zipBuffer });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const parsed = await mineruProvider.parseDocument(
    {
      file_path: filePath,
      file_name: 'demo.pdf'
    },
    {
      mode: 'api',
      base_url: 'https://mineru.net/api/v4',
      api_key_env: 'MINERU_API_KEY',
      model_version: 'vlm',
      poll_interval_ms: 1,
      timeout_ms: 1000
    },
    {
      fetchImpl,
      env: {
        MINERU_API_KEY: 'test-token'
      }
    }
  );

  assert.equal(parsed.mode, 'api');
  assert.match(parsed.markdown, /API Parse String URL/);
});

test('mineru provider can auto-select api mode from thresholds and project .env', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-mineru-auto-api-'));
  const filePath = path.join(tempDir, 'demo.pdf');
  fs.writeFileSync(filePath, Buffer.alloc(4096, 0x61));
  fs.writeFileSync(path.join(tempDir, '.env'), 'MINERU_API_KEY=file-token\n', 'utf8');

  const zipBuffer = buildStoredZip([
    { name: 'result/full.md', data: '# Auto API Parse\n\n- PA5 reserved\n' }
  ]);

  let pollCount = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url === 'https://mineru.net/api/v4/file-urls/batch') {
      assert.equal(options.headers.Authorization, 'Bearer file-token');
      return buildResponse({
        body: {
          code: 0,
          data: {
            batch_id: 'batch-auto',
            file_urls: [{ upload_url: 'https://upload.invalid/auto', file_id: 'f-auto' }]
          }
        }
      });
    }

    if (url === 'https://upload.invalid/auto') {
      return buildResponse({ body: '' });
    }

    if (url === 'https://mineru.net/api/v4/extract-results/batch/batch-auto') {
      pollCount += 1;
      if (pollCount === 1) {
        return buildResponse({
          body: {
            code: 0,
            data: {
              extract_result: [{ state: 'running' }]
            }
          }
        });
      }

      return buildResponse({
        body: {
          code: 0,
          data: {
            extract_result: [
              {
                state: 'done',
                full_zip_url: 'https://download.invalid/auto.zip'
              }
            ]
          }
        }
      });
    }

    if (url === 'https://download.invalid/auto.zip') {
      return buildResponse({ body: zipBuffer });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const parsed = await mineruProvider.parseDocument(
    {
      file_path: filePath,
      file_name: 'demo.pdf'
    },
    {
      mode: 'auto',
      base_url: '',
      api_key: '',
      api_key_env: 'MINERU_API_KEY',
      model_version: 'vlm',
      auto_api_page_threshold: 10,
      auto_api_file_size_kb: 1,
      poll_interval_ms: 1,
      timeout_ms: 1000
    },
    {
      fetchImpl,
      env: {},
      projectRoot: tempDir
    }
  );

  assert.equal(parsed.mode, 'api');
  assert.match(parsed.markdown, /Auto API Parse/);
});

test('mineru provider keeps agent route when base_url explicitly points to agent', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-mineru-auto-agent-'));
  const filePath = path.join(tempDir, 'demo.pdf');
  fs.writeFileSync(filePath, Buffer.alloc(4096, 0x61));
  fs.writeFileSync(path.join(tempDir, '.env'), 'MINERU_API_KEY=file-token\n', 'utf8');

  let polled = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url === 'https://mineru.net/api/v1/agent/parse/file') {
      return buildResponse({
        body: {
          task_id: 'task-agent-auto',
          file_url: 'https://upload.invalid/agent-auto'
        }
      });
    }

    if (url === 'https://upload.invalid/agent-auto') {
      assert.equal(options.method, 'PUT');
      return buildResponse({ body: '' });
    }

    if (url === 'https://mineru.net/api/v1/agent/parse/task-agent-auto') {
      polled += 1;
      if (polled === 1) {
        return buildResponse({
          body: {
            state: 'done',
            full_md_url: 'https://download.invalid/agent-auto.md'
          }
        });
      }
    }

    if (url === 'https://download.invalid/agent-auto.md') {
      return buildResponse({ body: '# Agent Parse\n\n- small route forced\n' });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  const parsed = await mineruProvider.parseDocument(
    {
      file_path: filePath,
      file_name: 'demo.pdf',
      pages: '1-20'
    },
    {
      mode: 'auto',
      base_url: 'https://mineru.net/api/v1/agent',
      api_key_env: 'MINERU_API_KEY',
      auto_api_page_threshold: 5,
      auto_api_file_size_kb: 1,
      poll_interval_ms: 1,
      timeout_ms: 1000
    },
    {
      fetchImpl,
      env: {},
      projectRoot: tempDir
    }
  );

  assert.equal(parsed.mode, 'agent');
  assert.match(parsed.markdown, /Agent Parse/);
});

test('mineru provider rejects api mode when token is missing', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-agent-mineru-api-key-'));
  const filePath = path.join(tempDir, 'demo.pdf');
  fs.writeFileSync(filePath, 'fake pdf', 'utf8');

  await assert.rejects(
    () =>
      mineruProvider.parseDocument(
        {
          file_path: filePath,
          file_name: 'demo.pdf'
        },
        {
          mode: 'api',
          base_url: 'https://mineru.net/api/v4',
          api_key: '',
          api_key_env: 'MINERU_API_KEY',
          model_version: 'vlm',
          poll_interval_ms: 1,
          timeout_ms: 1000
        },
        {
          fetchImpl: async () => {
            throw new Error('should not fetch');
          },
          env: {}
        }
      ),
    /MinerU API key missing/
  );
});
