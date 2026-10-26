import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createMusicOriginRegistry, installMusicOrigin,
  musicIntentKind } from '../plugin-src/host/music-origin.mjs';
import { HarnessClient } from '../src/channels/weixin/harness-client.mjs';

function fixture({ ptc = false } = {}) {
  const sessionId = `session-${randomUUID()}`;
  const events = [];
  const agent = { id: sessionId, session: { snapshotEvents: () => events } };
  const registry = createMusicOriginRegistry({
    sessionId, botId: 'approved-bot', senderId: 'approved-sender',
    modeOf: () => ptc ? 'ptc' : 'native',
    toolsReady: () => true,
  });
  const admit = (text, id = randomUUID(), onFailure) => {
    const rpcId = `weixin-${id}`;
    registry.admit({ channel: 'weixin', botId: 'approved-bot', senderId: 'approved-sender',
      sessionId, rpcId, text, onFailure });
    return { id, rpcId, message: { role: 'user', source: { kind: 'user', rpcId },
      content: [{ type: 'text', text }] } };
  };
  const append = (type, data) => events.push({ seq: events.length, type, data });
  return { registry, sessionId, agent, events, admit, append };
}

test('original Weixin sender, session and human body are bound to a durable user message', async () => {
  const f = fixture(), input = f.admit('播放周杰伦的七里香');
  // agent/pre-step runs before the Host appends user/message.
  const early = await f.registry.verify({ agent: f.agent, message: input.message, turn: 1 });
  assert.equal(early?.human, true);
  assert.equal(await f.registry.verifyExecution({ agent: f.agent, callId: 'not-durable',
    rootCallId: 'not-durable', eventId: input.id, rpcId: input.rpcId }), false);
  f.append('turn/start', { turn: 1 });
  f.append('user/message', { role: 'user', source: input.message.source,
    content: input.message.content });
  const proof = await f.registry.verify({ agent: f.agent, message: input.message, turn: 1 });
  assert.equal(proof.human, true);
  assert.equal(proof.sender_id, 'approved-sender');
  assert.equal(proof.session_id, f.sessionId);
  assert.equal(proof.content_sha256, createHash('sha256').update('播放周杰伦的七里香').digest('hex'));
  assert.equal(await f.registry.verify({ agent: f.agent, message: {
    ...input.message, content: [{ type: 'text', text: '播放刘德华的暗里着迷' }],
  } }), null);
  assert.equal(await f.registry.verify({ agent: { ...f.agent, id: `session-${randomUUID()}` },
    message: input.message }), null);
});

test('each durable tool call remains with the original message across a newer steer and repeat verification', async () => {
  const f = fixture(), old = f.admit('播放周杰伦的七里香');
  f.append('turn/start', { turn: 1 });
  f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', { role: 'user', source: old.message.source, content: old.message.content });
  f.append('tool/call', { turn: 1, step: 1, callId: 'old-call', name: 'tvmusic_music_play' });
  const check = (callId, input) => f.registry.verifyExecution({ agent: f.agent, callId,
    rootCallId: callId, eventId: input.id, rpcId: input.rpcId });
  assert.equal(await check('old-call', old), true);
  assert.equal(await check('old-call', old), true);
  const newer = f.admit('点一首刘德华的暗里着迷');
  f.append('step/start', { turn: 1, step: 2 });
  f.append('user/message', { role: 'user', source: newer.message.source, content: newer.message.content });
  f.append('tool/call', { turn: 1, step: 2, callId: 'new-call', name: 'tvmusic_music_play' });
  assert.equal(await check('old-call', old), false); // Superseded music may not start late.
  assert.deepEqual(f.registry.failureFor(old.rpcId), { reason: 'MUSIC_HOST_STALE_EVENT' });
  assert.equal(await check('old-call', newer), false);
  assert.equal(await check('new-call', newer), true);
  assert.equal(await check('missing-call', newer), false);
  f.registry.revokeSession(f.sessionId);
  assert.equal(await check('old-call', old), false);
});

test('a queued old tool recorded after a newer step never borrows its origin', async () => {
  const f = fixture(), old = f.admit('播放七里香'), newer = f.admit('播放暗里着迷');
  f.append('turn/start', { turn: 1 });
  f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', { role: 'user', source: old.message.source, content: old.message.content });
  f.append('step/start', { turn: 1, step: 2 });
  f.append('user/message', { role: 'user', source: newer.message.source, content: newer.message.content });
  f.append('tool/call', { turn: 1, step: 1, callId: 'late-old', name: 'tvmusic_music_play' });
  const check = (input) => f.registry.verifyExecution({ agent: f.agent, callId: 'late-old',
    rootCallId: 'late-old', eventId: input.id, rpcId: input.rpcId });
  assert.equal(await check(old), false); // The newer music event cancels late old dispatch.
  assert.equal(await check(newer), false);
});

test('new music ingress cancels an older queued development bash, but later development is allowed', async () => {
  const f = fixture(), dev = f.admit('运行项目测试');
  f.append('turn/start', { turn: 1 });
  f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', { role: 'user', source: dev.message.source, content: dev.message.content });
  f.append('tool/call', { turn: 1, step: 1, callId: 'old-dev', name: 'bash' });
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'old-dev',
    rootCallId: 'old-dev', name: 'bash' }), undefined);
  f.admit('播放周杰伦的七里香');
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'old-dev',
    rootCallId: 'old-dev', name: 'bash' }), 'MUSIC_HOST_STALE_EVENT');
  const later = f.admit('运行回归测试');
  f.append('turn/start', { turn: 2 });
  f.append('step/start', { turn: 2, step: 1 });
  f.append('user/message', { role: 'user', source: later.message.source,
    content: later.message.content });
  f.append('tool/call', { turn: 2, step: 1, callId: 'later-dev', name: 'bash' });
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'later-dev',
    rootCallId: 'later-dev', name: 'bash' }), undefined);
});

test('Host guard blocks a music fallback even if TVmusic tools disappear mid-turn', () => {
  const f = fixture(), song = f.admit('播放周杰伦的七里香');
  f.append('turn/start', { turn: 1 });
  f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', { role: 'user', source: song.message.source, content: song.message.content });
  f.append('tool/call', { turn: 1, step: 1, callId: 'fallback', name: 'bash' });
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'fallback',
    rootCallId: 'fallback', name: 'bash' }), 'MUSIC_HOST_LOCAL_FALLBACK_DENIED');
  f.append('tool/call', { turn: 1, step: 1, callId: 'music-tool', name: 'tvmusic_music_play' });
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'music-tool',
    rootCallId: 'music-tool', name: 'tvmusic_music_play' }), undefined);
  const dev = f.admit('运行项目测试');
  f.append('turn/start', { turn: 2 });
  f.append('step/start', { turn: 2, step: 1 });
  f.append('user/message', { role: 'user', source: dev.message.source, content: dev.message.content });
  f.append('tool/call', { turn: 2, step: 1, callId: 'development', name: 'bash' });
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'development',
    rootCallId: 'development', name: 'bash' }), undefined);
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'no-durable-call',
    rootCallId: 'no-durable-call', name: 'bash' }), 'MUSIC_HOST_ORIGIN_UNKNOWN');
  f.registry.close();
  assert.equal(f.registry.admit({ channel: 'weixin', botId: 'approved-bot',
    senderId: 'approved-sender', sessionId: f.sessionId,
    rpcId: `weixin-${randomUUID()}`, text: '播放七里香' }), false);
  assert.deepEqual(f.registry.checkInbound({ botId: 'approved-bot',
    senderId: 'approved-sender', sessionId: f.sessionId, text: '播放七里香' }),
  { kind: 'reject', reason: 'MUSIC_HOST_TOOLS_UNAVAILABLE' });
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'development',
    rootCallId: 'development', name: 'bash' }), 'MUSIC_HOST_ORIGIN_UNKNOWN');
});

test('Host records actual TVmusic tool failure for a deterministic phone reply, not model text', () => {
  const f = fixture(), song = f.admit('播放离线样例');
  f.append('turn/start', { turn: 1 });
  f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', { role: 'user', source: song.message.source, content: song.message.content });
  assert.deepEqual(f.registry.failureFor(song.rpcId), { reason: 'MUSIC_HOST_NO_RESULT' });
  f.append('tool/call', { turn: 1, step: 1, callId: 'speaker-call', name: 'tvmusic_music_play' });
  f.registry.recordOutcome({ agent: f.agent, callId: 'speaker-call', rootCallId: 'speaker-call',
    name: 'tvmusic_music_play' }, { isError: false, value: {
    id: song.id, status: 'UNKNOWN', instruction: '客厅 Sound Pro 当前不可用，原请求仍待核对。',
  }, content: [{ type: 'text', text: '{"status":"PLAYING"}' }] });
  assert.deepEqual(f.registry.failureFor(song.rpcId), {
    reason: 'MUSIC_HOST_OUTPUT_UNKNOWN', instruction: '客厅 Sound Pro 当前不可用，原请求仍待核对。',
  });
  f.registry.recordOutcome({ agent: f.agent, callId: 'speaker-call', rootCallId: 'speaker-call',
    name: 'tvmusic_music_play' }, { isError: false, value: { id: song.id, status: 'SEARCHING' } });
  assert.deepEqual(f.registry.failureFor(song.rpcId), { reason: 'MUSIC_HOST_PREPARING' });
  f.registry.recordOutcome({ agent: f.agent, callId: 'speaker-call', rootCallId: 'speaker-call',
    name: 'tvmusic_music_play' }, { isError: false, value: { id: song.id, status: 'PLAY_REQUEST_ACCEPTED' } });
  assert.deepEqual(f.registry.failureFor(song.rpcId), { reason: 'MUSIC_HOST_ACCEPTED' });
  f.registry.recordOutcome({ agent: f.agent, callId: 'speaker-call', rootCallId: 'speaker-call',
    name: 'tvmusic_music_play' }, { isError: false, value: { id: randomUUID(), status: 'PLAYING' } });
  assert.deepEqual(f.registry.failureFor(song.rpcId), { reason: 'MUSIC_HOST_RESULT_MISMATCH' });
});

test('status of an older intent never becomes new-song proof, including NO_ACTIVE', async () => {
  const f = fixture(), input = f.admit('播放另一首歌'), olderId = randomUUID();
  f.append('turn/start', { turn: 1 });
  f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', { role: 'user', source: input.message.source,
    content: input.message.content });
  f.append('tool/call', { turn: 1, step: 1, callId: 'old-status',
    name: 'tvmusic_music_playback_status' });
  const exec = { agent: f.agent, callId: 'old-status', rootCallId: 'old-status',
    name: 'tvmusic_music_playback_status', arguments: { intent_id: olderId } };
  for (const status of ['SEARCHING', 'READY', 'ACCEPTED', 'UNKNOWN']) {
    await f.registry.recordOutcome(exec, { isError: false, value: { id: olderId, status } });
    assert.match(f.registry.failureFor(input.rpcId).reason, /^MUSIC_HOST_OTHER_/);
  }
  await f.registry.recordOutcome({ ...exec, arguments: {} }, {
    isError: false, value: { status: 'NO_ACTIVE' },
  });
  assert.deepEqual(f.registry.failureFor(input.rpcId), { reason: 'MUSIC_HOST_NO_ACTIVE' });
});

test('steer failure callback is once-only for UNKNOWN and absent tool results', async () => {
  const f = fixture(), notices = [];
  const input = f.admit('停掉这首歌', randomUUID(), result => notices.push(result));
  f.append('turn/start', { turn: 1 });
  f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', { role: 'user', source: input.message.source,
    content: input.message.content });
  f.append('tool/call', { turn: 1, step: 1, callId: 'stop-call', name: 'tvmusic_music_control' });
  const exec = { agent: f.agent, callId: 'stop-call', rootCallId: 'stop-call',
    name: 'tvmusic_music_control', arguments: { intent_id: randomUUID(), action: 'stop' } };
  await f.registry.recordOutcome(exec, { isError: false,
    value: { id: exec.arguments.intent_id, status: 'UNKNOWN', instruction: '音箱停止结果待确认。' } });
  await f.registry.recordOutcome(exec, { isError: false,
    value: { id: exec.arguments.intent_id, status: 'STOPPED' } });
  assert.deepEqual(notices, []);
  await f.registry.completeTurn(f.agent, 1);
  assert.deepEqual(notices, [{ reason: 'MUSIC_HOST_OTHER_STOPPED' }]);
  const noTool = f.admit('播放安静', randomUUID(), result => notices.push(result));
  f.append('turn/start', { turn: 2 });
  f.append('step/start', { turn: 2, step: 1 });
  f.append('user/message', { role: 'user', source: noTool.message.source,
    content: noTool.message.content });
  await f.registry.completeTurn(f.agent, 2);
  await f.registry.completeTurn(f.agent, 2);
  assert.deepEqual(notices.at(-1), { reason: 'MUSIC_HOST_NO_RESULT' });
  assert.equal(notices.length, 2);
});

test('two distinct humans in one step make tool ownership ambiguous, never newest-wins', async () => {
  const f = fixture(), old = f.admit('播放七里香'), newer = f.admit('播放暗里着迷');
  f.append('turn/start', { turn: 1 });
  f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', { role: 'user', source: old.message.source, content: old.message.content });
  f.append('user/message', { role: 'user', source: newer.message.source, content: newer.message.content });
  f.append('tool/call', { turn: 1, step: 1, callId: 'ambiguous', name: 'tvmusic_music_play' });
  for (const input of [old, newer]) assert.equal(await f.registry.verifyExecution({
    agent: f.agent, callId: 'ambiguous', rootCallId: 'ambiguous', eventId: input.id,
    rpcId: input.rpcId,
  }), false);
});

test('PTC code transport cannot carry music; verified ordinary development remains scoped', async () => {
  const f = fixture({ ptc: true }), music = f.admit('来首安静');
  f.append('turn/start', { turn: 1 });
  f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', { role: 'user', source: music.message.source, content: music.message.content });
  f.append('tool/call', { turn: 1, step: 1, callId: 'music-code', name: 'run_code' });
  assert.equal(await f.registry.verifyExecution({ agent: f.agent, callId: 'music-code',
    rootCallId: 'music-code', eventId: music.id, rpcId: music.rpcId }), false);
  const dev = f.admit('运行项目测试');
  f.append('turn/start', { turn: 2 });
  f.append('step/start', { turn: 2, step: 1 });
  f.append('user/message', { role: 'user', source: dev.message.source, content: dev.message.content });
  f.append('tool/call', { turn: 2, step: 1, callId: 'dev-code', name: 'run_code' });
  f.append('tool/code-dispatch-start', { subCallId: 'dev-code:ptc:1', name: 'bash' });
  assert.equal(await f.registry.verifyExecution({ agent: f.agent, callId: 'dev-code',
    rootCallId: 'dev-code', eventId: dev.id, rpcId: dev.rpcId }), true);
  assert.equal(await f.registry.verifyExecution({ agent: f.agent, callId: 'dev-code:ptc:1',
    rootCallId: 'dev-code', eventId: dev.id, rpcId: dev.rpcId }), true);
  const newSong = f.admit('播放七里香');
  f.append('step/start', { turn: 2, step: 2 });
  f.append('user/message', { role: 'user', source: newSong.message.source,
    content: newSong.message.content });
  f.append('tool/code-dispatch-start', { subCallId: 'dev-code:ptc:2', name: 'bash' });
  assert.equal(await f.registry.verifyExecution({ agent: f.agent, callId: 'dev-code:ptc:2',
    rootCallId: 'dev-code', eventId: dev.id, rpcId: dev.rpcId }), false);
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'dev-code:ptc:2',
    rootCallId: 'dev-code', name: 'bash' }), 'MUSIC_HOST_STALE_EVENT');
});

test('bounded safety classification distinguishes song requests from explicit nonmusic work', () => {
  for (const text of ['播放周杰伦的七里香', '点一首刘德华的暗里着迷', '放点周杰伦的歌',
    '想听安静', '暂停这首歌', '停掉这首歌', '停一下', '停止播放七里香',
    '放个周杰伦的歌', '请帮我播放周杰伦的七里香', '改成播放刘德华的暗里着迷',
    '这首歌现在怎么样了']) assert.ok(musicIntentKind(text), text);
  for (const text of ['运行项目测试', '修复音乐页面代码', '查看电影任务', '检查服务日志'])
    assert.equal(musicIntentKind(text), null);
});

test('inbound gate rejects missing tools, changed Session and PTC before Agent, but not nonmusic work', () => {
  const f = fixture();
  const scoped = { botId: 'approved-bot', senderId: 'approved-sender', sessionId: f.sessionId };
  assert.deepEqual(f.registry.checkInbound({ ...scoped, text: '运行项目测试' }), { kind: 'allow' });
  assert.deepEqual(f.registry.checkInbound({ ...scoped, senderId: 'different-sender',
    text: '运行项目测试' }), { kind: 'reject', reason: 'MUSIC_HOST_SESSION_SHARED' });
  assert.deepEqual(f.registry.checkInbound({ ...scoped, sessionId: `session-${randomUUID()}`,
    senderId: 'different-sender', text: '运行项目测试' }), { kind: 'allow' });
  assert.deepEqual(f.registry.checkInbound({ ...scoped, sessionId: null,
    text: '播放周杰伦的七里香' }), { kind: 'reject', reason: 'MUSIC_HOST_SESSION_UNBOUND' });
  assert.deepEqual(f.registry.checkInbound({ ...scoped, text: '播放周杰伦的七里香' }), { kind: 'allow' });
  const missing = createMusicOriginRegistry({ ...scoped, modeOf: () => 'native', toolsReady: () => false });
  assert.deepEqual(missing.checkInbound({ ...scoped, text: '点一首刘德华的暗里着迷' }),
    { kind: 'reject', reason: 'MUSIC_HOST_TOOLS_UNAVAILABLE' });
  const ptc = createMusicOriginRegistry({ ...scoped, modeOf: () => 'ptc', toolsReady: () => true });
  assert.deepEqual(ptc.checkInbound({ ...scoped, text: '放点周杰伦的歌' }),
    { kind: 'reject', reason: 'MUSIC_HOST_MODE_UNSUPPORTED' });
  assert.deepEqual(f.registry.checkInbound({ ...scoped, text: '播放周杰伦的七里香', hasMedia: true }),
    { kind: 'reject', reason: 'MUSIC_HOST_INPUT_UNSUPPORTED' });
});

test('actual HarnessClient mints the prompt id after binding and claims before submit', async () => {
  const client = new HarnessClient({ baseUrl: 'http://127.0.0.1:3080', workspace: '/tmp/isolated' });
  client.ensureRunning = async () => undefined;
  const calls = [];
  client.rpc = async (method, payload, _timeout, options) => {
    calls.push([method, payload, options]);
    if (method === 'workspace.list') return { archivedSessionIds: [] };
    if (method === 'session.history') return { events: [] };
    if (method === 'session.prompt') throw Error('ISOLATED_PROMPT_STOP');
    throw Error(`UNEXPECTED_${method}`);
  };
  let claim;
  await assert.rejects(client.ask('session-isolated', '播放周杰伦的七里香', {
    claimMusicOrigin: value => { claim = value; },
  }), /ISOLATED_PROMPT_STOP/);
  assert.equal(claim.sessionId, 'session-isolated');
  assert.match(claim.rpcId, /^weixin-[a-f\d-]{36}$/);
  assert.equal(calls.find(([method]) => method === 'session.prompt')[2].rpcId, claim.rpcId);
  const guarded = new HarnessClient({ baseUrl: 'http://127.0.0.1:3080', workspace: '/tmp/isolated' });
  guarded.ensureRunning = async () => undefined;
  let submitted = 0;
  guarded.rpc = async method => { if (method === 'workspace.list') return { archivedSessionIds: [] };
    if (method === 'session.history') return { events: [] };
    if (method === 'session.prompt') submitted++;
    return {}; };
  await assert.rejects(guarded.ask('session-isolated', '播放周杰伦的七里香', {
    claimMusicOrigin: () => { throw Error('MUSIC_HOST_ORIGIN_ADMISSION_FAILED'); },
  }), /MUSIC_HOST_ORIGIN_ADMISSION_FAILED/);
  assert.equal(submitted, 0);
});

test('Host teardown keeps a root-owned deny tombstone until the approved Agent is disposed', () => {
  const sessionId = `session-${randomUUID()}`, agent = { id: sessionId,
    session: { id: sessionId, snapshotEvents: () => [] } };
  let live = agent, cleanup;
  const guards = new Set(), hooks = new Map();
  const root = { agents: { get: id => id === sessionId ? live : undefined },
    tools: { get: () => undefined, guard(fn) { guards.add(fn); return () => guards.delete(fn); } },
    on(name, fn) { hooks.set(name, fn); return () => hooks.delete(name); } };
  const pluginCtx = { root, provide() {}, effect(factory) { cleanup = factory(); } };
  const registry = installMusicOrigin(pluginCtx, { sessionId, botId: 'approved-bot', senderId: 'owner' });
  assert.equal(guards.size, 1);
  cleanup();
  assert.deepEqual(registry.checkInbound({ botId: 'approved-bot', senderId: 'owner',
    sessionId, text: '播放七里香' }), { kind: 'reject', reason: 'MUSIC_HOST_TOOLS_UNAVAILABLE' });
  assert.equal(guards.size, 1);
  assert.equal([...guards][0]({ agent, callId: 'old-call', name: 'bash' }), 'MUSIC_HOST_ORIGIN_UNKNOWN');
  live = null;
  hooks.get('agent/disposed')({ agent });
  assert.equal(guards.size, 0);
  assert.equal(hooks.size, 0);
});
