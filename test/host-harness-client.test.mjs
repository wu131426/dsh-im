import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createHostHarnessClient } from '../src/host-harness-client.mjs';

test('HA channel reuses the current Host Session gateway and creates no process or model config', async t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ha-host-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const calls = [], sessionId = 'session-11111111-1111-4111-8111-111111111111';
  const ctx = {
    typertGateway: {
      async invoke(request) {
        calls.push(request);
        if (request.namespace === 'session' && request.method === 'create') return { sessionId };
        throw Error('unexpected Host call');
      },
      async stream() { throw Error('not needed for creation'); },
    },
    on: () => () => {}, effect: () => {},
  };
  const client = createHostHarnessClient(ctx, { workspace, rpcIdPrefix: 'ha-assist' });
  assert.equal(await client.createSession(), sessionId);
  assert.deepEqual(calls.map(call => [call.namespace, call.method]), [['session', 'create']]);
  assert.equal(calls[0].args.request.cwd, workspace);
  assert.equal(typeof client.ask, 'function');
});

test('Host-only client rejects remote or ambiguous configuration', () => {
  assert.match(import.meta.resolve('@xmanrui/dsh-im/host-harness'), /host-harness-client\.mjs$/);
  for (const value of [null, 'relative/path', '']) {
    assert.throws(() => createHostHarnessClient({ typertGateway: {} }, {
      workspace: value, rpcIdPrefix: 'ha-assist',
    }), /HOST_HARNESS_CLIENT_CONFIG/);
  }
  assert.throws(() => createHostHarnessClient({ typertGateway: {} }, {
    workspace: '/private/tmp/ha-assist', rpcIdPrefix: 'weixin sender',
  }), /HOST_HARNESS_CLIENT_CONFIG/);
});
