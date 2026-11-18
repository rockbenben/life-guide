import {test} from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('direct release upload creates a public release and preserves build-job retry semantics', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'life-guide-upload-'));
  try {
    fs.copyFileSync(new URL('../release-draft.mjs', import.meta.url), path.join(root, 'upload.mjs'));
    fs.writeFileSync(path.join(root, 'release-notes.mjs'), 'export const releaseBodyFor = () => "Fixture release notes";');
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist/payload.zip'), 'fixture');
    const probe = `
      const calls = [];
      const mode = process.env.MODE;
      const release = {id: 41, tag_name: mode === 'wrong-tag' ? 'v0.0.1' : 'v9.9.9', draft: false, assets: []};
      globalThis.fetch = async (url, options = {}) => {
        calls.push({url, method: options.method || 'GET', body: options.headers?.['Content-Type'] === 'application/json' ? JSON.parse(options.body || 'null') : null});
        if (mode === 'api-error') return new Response('unavailable', {status: 503});
        if (url.endsWith('/releases?per_page=100')) return Response.json(mode === 'already-published' ? [release] : []);
        return Response.json(release);
      };
      process.argv[2] = 'dist';
      await import('./upload.mjs');
      console.log(JSON.stringify(calls));
    `;
    for (const mode of ['create', 'retry', 'wrong-tag', 'already-published', 'api-error']) {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
        cwd: root, encoding: 'utf8', env: {...process.env, MODE: mode, REPO: 'fixture/app', TAG: 'v9.9.9', GH_TOKEN: 'fixture',
          GITHUB_OUTPUT: '', RELEASE_ID: ['retry', 'wrong-tag'].includes(mode) ? '41' : ''},
      });
      const success = ['create', 'retry'].includes(mode);
      assert.equal(result.status === 0, success, result.stdout + result.stderr);
      if (!success) continue;
      const calls = JSON.parse(result.stdout.trim().split('\n').at(-1));
      const create = calls.find(call => call.method === 'POST' && call.url.endsWith('/releases'));
      if (mode === 'create') {
        assert.equal(create.body.draft, false);
        assert.equal(create.body.make_latest, 'false');
        assert.equal(create.body.body, 'Fixture release notes');
      } else {
        assert.equal(create, undefined);
        assert.ok(!calls.some(call => call.method === 'PATCH'));
      }
      assert.ok(calls.some(call => call.url.startsWith('https://uploads.github.com/repos/fixture/app/releases/41/assets?')));
    }
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
