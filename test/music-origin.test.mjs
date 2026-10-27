import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createMusicOriginRegistry, installMusicOrigin, assertTvmusicHostEnvironment,
  musicIntentKind, businessIntentKind, businessActionKind, mediaReadIntentKind } from '../plugin-src/host/music-origin.mjs';
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

test('Host refuses broad TVmusic/Infisical environment before scoped music installation', () => {
  const safe = { HOME: '/isolated', TVMUSIC_HARNESS_URL: 'http://127.0.0.1:4317/',
    TVMUSIC_IM_SESSION_ID: `session-${randomUUID()}` };
  assert.doesNotThrow(() => assertTvmusicHostEnvironment(safe));
  assert.throws(() => assertTvmusicHostEnvironment({ HOME: '/isolated' }), /MUSIC_HOST_ENVIRONMENT_UNSAFE/);
  for (const [key, value] of [['TVMUSIC_SOUNDPRO_PASSWORD', 'fixture-secret'],
    ['PROWLARR_API_KEY', 'fixture-secret'], ['INFISICAL_TOKEN', 'fixture-secret'],
    ['TVMUSIC_MUSIC_HARNESS_CAPABILITY', 'a'.repeat(64)]])
    assert.throws(() => assertTvmusicHostEnvironment({ ...safe, [key]: value }), /MUSIC_HOST_ENVIRONMENT_UNSAFE/);
  assert.throws(() => assertTvmusicHostEnvironment({ ...safe,
    TVMUSIC_HARNESS_URL: 'http://localhost:4317/' }), /MUSIC_HOST_ENVIRONMENT_UNSAFE/);
});

test('four TVmusic media intents are bounded; queries and other OS requests are not writes', () => {
  for (const text of ['下载电影《流浪地球》', '追《三体》第二季', '下载综艺《歌手》第三季',
    '暂停电影下载', '取消追这一季', '我想看电影《流浪地球》',
    '给我下载电影《流浪地球》']) assert.equal(businessIntentKind(text), 'business', text);
  for (const text of ['暂停电视剧下载《三体》', '停止电影下载《流浪地球》'])
    assert.equal(businessActionKind(text), 'unsupported-control', text);
  for (const text of ['查电影下载进度', '找电视剧《三体》', '下载 Sticker 素材',
    '运行任意命令', '读取文件', '访问任意 URL', '下载电影《A》但别下载',
    '下载 Sticker 素材《电影》', '追《三体》第二季还是第三季？',
    '下载电影《A》和《B》', '下载电影《流浪地球》并用 afplay 播放', '下载电影《流浪地球》第二季',
    '点看电视剧《三体》', '看《三体》', '下载电影《流浪地球》，先等等',
    '追《三体》第二季但先等等']) assert.equal(businessIntentKind(text), null, text);
  assert.equal(musicIntentKind('找周杰伦的歌'), 'search');
  assert.equal(musicIntentKind('播放周杰伦的七里香然后停止'), 'ambiguous');
  assert.equal(musicIntentKind('播放周杰伦的七里香。停止'), 'ambiguous');
  assert.equal(musicIntentKind('停止播放七里香。继续'), 'ambiguous');
  assert.equal(businessIntentKind('下载电影《流浪地球》。先查资源'), null);
  assert.equal(businessIntentKind('追《三体》第二季。先查进度'), null);
  assert.equal(businessIntentKind('播放周杰伦的七里香'), null);
  for (const text of ['查电影下载进度', '找电视剧《三体》', '查看综艺《向往的生活》字幕状态',
    '查询 TVmusic 任务', '查影视资源', '电影《流浪地球》资源', '播放电影《流浪地球》',
    '我想看《沙丘》', '看电影《沙丘》，放周杰伦的七里香',
    '放电影《沙丘》的预告', '放我喜欢的电影'])
    assert.equal(mediaReadIntentKind(text), 'read', text);
  for (const text of ['你好', '查 Content OS 发布状态', '查看 Sticker 项目', '运行项目测试',
    '帮我写一段“播放七里香”的测试文案', '放我房间的灯',
    '放 Content OS 的文件到桌面', '放 Content OS 的日志'])
    assert.equal(mediaReadIntentKind(text), null, text);
});

test('verified business call permits only TVmusic writes and returns the durable receipt truth', async () => {
  const f = fixture(), input = f.admit('下载电影《流浪地球》');
  f.append('turn/start', { turn: 1 }); f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', { role: 'user', source: input.message.source, content: input.message.content });
  f.append('tool/call', { turn: 1, step: 1, callId: 'watch', name: 'tvmusic_movie_watch' });
  const call = name => f.registry.guardTool({ agent: f.agent, callId: 'watch', rootCallId: 'watch', name });
  assert.equal(call('tvmusic_movie_watch'), undefined);
  assert.notEqual(call('bash'), undefined);
  assert.notEqual(call('tvmusic_music_play'), undefined);
  const requestId = createHash('sha256').update(`tvmusic-business-v1:${input.id}`).digest('hex');
  await f.registry.recordOutcome({ agent: f.agent, callId: 'watch', rootCallId: 'watch',
    name: 'tvmusic_movie_watch' }, { value: { request_id: requestId, state: 'SUCCEEDED',
    result: { status: 'DOWNLOADING' } } });
  assert.deepEqual(f.registry.failureFor(input.rpcId), { reason: 'TVMUSIC_BUSINESS_ACCEPTED' });
  const dev = f.admit('运行项目测试');
  f.append('turn/start', { turn: 2 }); f.append('step/start', { turn: 2, step: 1 });
  f.append('user/message', { role: 'user', source: dev.message.source, content: dev.message.content });
  f.append('tool/call', { turn: 2, step: 1, callId: 'dev-write', name: 'tvmusic_movie_watch' });
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'dev-write', rootCallId: 'dev-write',
    name: 'tvmusic_movie_watch' }), 'MUSIC_HOST_LOCAL_FALLBACK_DENIED');
});

test('one Weixin Session keeps ordinary chat and other OS reads, while TVmusic queries stay bounded', async () => {
  const f = fixture(), ordinary = f.admit('你好');
  f.append('turn/start', { turn: 1 }); f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', { role: 'user', source: ordinary.message.source, content: ordinary.message.content });
  f.append('tool/call', { turn: 1, step: 1, callId: 'chat', name: 'mcp__memory_Content__search_nodes' });
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'chat', name: 'mcp__memory_Content__search_nodes' }), undefined);
  assert.notEqual(f.registry.guardTool({ agent: f.agent, callId: 'chat', name: 'tvmusic_music_play' }), undefined);
  const query = f.admit('找电影《流浪地球》');
  f.append('turn/start', { turn: 2 }); f.append('step/start', { turn: 2, step: 1 });
  f.append('user/message', { role: 'user', source: query.message.source, content: query.message.content });
  f.append('tool/call', { turn: 2, step: 1, callId: 'query', name: 'tvmusic_search' });
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'query', name: 'tvmusic_search' }), undefined);
  assert.notEqual(f.registry.guardTool({ agent: f.agent, callId: 'query', name: 'bash' }), undefined);
  assert.deepEqual(f.registry.failureFor(query.rpcId), { reason: 'TVMUSIC_BUSINESS_ROUTE_UNAVAILABLE' });
  await f.registry.recordOutcome({ agent: f.agent, callId: 'query', name: 'tvmusic_search' },
    { value: { items: [{ tmdb_id: 1 }] } });
  assert.equal(f.registry.failureFor(query.rpcId), null);
  const song = f.admit('播放周杰伦的七里香');
  f.append('turn/start', { turn: 3 }); f.append('step/start', { turn: 3, step: 1 });
  f.append('user/message', { role: 'user', source: song.message.source, content: song.message.content });
  f.append('tool/call', { turn: 3, step: 1, callId: 'fallback', name: 'bash' });
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'fallback', name: 'bash' }),
    'MUSIC_HOST_LOCAL_FALLBACK_DENIED');
  f.admit('查 Content OS 发布状态');
  assert.equal(await f.registry.verifyExecution({ agent: f.agent, callId: 'fallback',
    eventId: song.id, rpcId: song.rpcId }), false);
});

test('Host pins one verified media search only to the immediately following human turn', async () => {
  const f = fixture(), first = f.admit('我要看沙丘');
  f.append('turn/start', { turn: 1 }); f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', first.message);
  f.append('tool/call', { turn: 1, step: 1, callId: 'media-search', name: 'tvmusic_search' });
  await f.registry.recordOutcome({ agent: f.agent, callId: 'media-search', name: 'tvmusic_search' },
    { value: { items: [
      { media_type: 'movie', tmdb_id: 11, title: '沙丘', year: 1984 },
      { media_type: 'movie', tmdb_id: 12, title: '沙丘', year: 2021 },
    ] } });
  const second = f.admit('不是老版，是新版');
  const proof = await f.registry.verify({ agent: f.agent, message: second.message, turn: 2 });
  assert.equal(proof.previous_event_id, first.id);
  assert.deepEqual(proof.media_context.items.map(row => row.tmdb_id), [11, 12]);
  const third = f.admit('你好'), fourth = f.admit('新版');
  assert.equal((await f.registry.verify({ agent: f.agent, message: third.message, turn: 3 })).media_context, undefined);
  assert.equal((await f.registry.verify({ agent: f.agent, message: fourth.message, turn: 4 })).media_context, undefined);
});

test('verified contextual confirmations carry the immediately prior event, not a model-supplied object ID', async () => {
  const f = fixture(), proposal = f.admit('我要看沙丘');
  f.append('turn/start', { turn: 1 }); f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', proposal.message);
  f.append('tool/call', { turn: 1, step: 1, callId: 'detail', name: 'tvmusic_movie' });
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'detail', name: 'tvmusic_movie' }), undefined);
  const changed = f.admit('不是老版，是新版');
  assert.equal((await f.registry.verify({ agent: f.agent, message: changed.message, turn: 2 }))?.previous_event_id,
    proposal.id);
  const confirm = f.admit('就这部');
  f.append('turn/start', { turn: 3 }); f.append('step/start', { turn: 3, step: 1 });
  f.append('user/message', confirm.message);
  f.append('tool/call', { turn: 3, step: 1, callId: 'confirm', name: 'tvmusic_movie_watch' });
  assert.equal((await f.registry.verify({ agent: f.agent, message: confirm.message, turn: 3 }))?.previous_event_id,
    changed.id);
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'confirm', name: 'tvmusic_movie_watch' }), undefined);
  f.append('tool/call', { turn: 3, step: 1, callId: 'fallback', name: 'bash' });
  assert.notEqual(f.registry.guardTool({ agent: f.agent, callId: 'fallback', name: 'bash' }), undefined);
});

test('an unapproved chat sharing the Session keeps ordinary tools but cannot borrow TVmusic', () => {
  const f = fixture(), otherRpc = `weixin-${randomUUID()}`;
  f.append('turn/start', { turn: 1 }); f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', { role: 'user', source: { kind: 'user', rpcId: otherRpc },
    content: [{ type: 'text', text: '查 Content OS 发布状态' }] });
  f.append('tool/call', { turn: 1, step: 1, callId: 'other-read', name: 'mcp__memory_Content__search_nodes' });
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'other-read',
    name: 'mcp__memory_Content__search_nodes' }), undefined);
  assert.notEqual(f.registry.guardTool({ agent: f.agent, callId: 'other-read',
    name: 'tvmusic_music_play' }), undefined);
  const untrusted = `weixin-${randomUUID()}`;
  f.append('turn/start', { turn: 2 }); f.append('step/start', { turn: 2, step: 1 });
  f.append('user/message', { role: 'user', source: { kind: 'user', rpcId: untrusted },
    content: [{ type: 'text', text: '播放周杰伦的七里香' }] });
  f.append('tool/call', { turn: 2, step: 1, callId: 'untrusted-fallback', name: 'bash' });
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'untrusted-fallback', name: 'bash' }),
    'MUSIC_HOST_ORIGIN_UNKNOWN');
});

test('ordinal song choice expires after any intervening human message, including late search results', async () => {
  const f = fixture(), first = f.admit('找周杰伦的七里香歌曲');
  f.append('turn/start', { turn: 1 }); f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', { role: 'user', source: first.message.source, content: first.message.content });
  f.append('tool/call', { turn: 1, step: 1, callId: 'search-one', name: 'tvmusic_music_search' });
  const response = { id: first.id, title: '七里香', artist: '周杰伦', status: 'RESULTS',
    candidates: [{ id: 'a'.repeat(64), name: '周杰伦 - 七里香.flac' }] };
  await f.registry.recordOutcome({ agent: f.agent, callId: 'search-one', rootCallId: 'search-one',
    name: 'tvmusic_music_search' }, { value: response });
  const immediate = f.admit('第一首');
  assert.equal((await f.registry.verify({ agent: f.agent, message: immediate.message, turn: 2 }))?.selection?.candidate_id,
    'a'.repeat(64));
  f.admit('查电影下载进度');
  const stale = f.admit('第一首');
  assert.equal((await f.registry.verify({ agent: f.agent, message: stale.message, turn: 3 }))?.selection, undefined);
  const late = f.admit('找周杰伦的七里香歌曲');
  f.append('turn/start', { turn: 4 }); f.append('step/start', { turn: 4, step: 1 });
  f.append('user/message', { role: 'user', source: late.message.source, content: late.message.content });
  f.append('tool/call', { turn: 4, step: 1, callId: 'search-late', name: 'tvmusic_music_search' });
  f.admit('查电影下载进度');
  await f.registry.recordOutcome({ agent: f.agent, callId: 'search-late', rootCallId: 'search-late',
    name: 'tvmusic_music_search' }, { value: { ...response, id: late.id } });
  const afterLate = f.admit('第一首');
  assert.equal((await f.registry.verify({ agent: f.agent, message: afterLate.message, turn: 5 }))?.selection, undefined);
});

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

test('ordinary Harness work keeps its original tools; a music turn still blocks fallback', async () => {
  const f = fixture(), dev = f.admit('运行项目测试');
  f.append('turn/start', { turn: 1 });
  f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', { role: 'user', source: dev.message.source, content: dev.message.content });
  f.append('tool/call', { turn: 1, step: 1, callId: 'old-dev', name: 'bash' });
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'old-dev',
    rootCallId: 'old-dev', name: 'bash' }), undefined);
  f.admit('播放周杰伦的七里香');
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'old-dev',
    rootCallId: 'old-dev', name: 'bash' }), undefined);
  const later = f.admit('运行回归测试');
  f.append('turn/start', { turn: 2 });
  f.append('step/start', { turn: 2, step: 1 });
  f.append('user/message', { role: 'user', source: later.message.source,
    content: later.message.content });
  f.append('tool/call', { turn: 2, step: 1, callId: 'later-dev', name: 'bash' });
  assert.equal(f.registry.guardTool({ agent: f.agent, callId: 'later-dev',
    rootCallId: 'later-dev', name: 'bash' }), undefined);
  assert.notEqual(f.registry.guardTool({ agent: f.agent, callId: 'later-dev',
    rootCallId: 'later-dev', name: 'tvmusic_music_play' }), undefined);
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

test('a search tool result for an original play request reports playback progress, never empty-source clarification', async () => {
  const f = fixture(), song = f.admit('播放周杰伦的安静');
  f.append('turn/start', { turn: 1 }); f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', { role: 'user', source: song.message.source, content: song.message.content });
  f.append('tool/call', { turn: 1, step: 1, callId: 'play-prelude', name: 'tvmusic_music_search' });
  const exec = { agent: f.agent, callId: 'play-prelude', rootCallId: 'play-prelude',
    name: 'tvmusic_music_search', arguments: { title: '安静', artist: '周杰伦' } };
  assert.equal(f.registry.guardTool(exec), undefined);
  await f.registry.recordOutcome(exec, { value: { id: song.id, status: 'SEARCHING', target: 'soundpro' } });
  assert.deepEqual(f.registry.failureFor(song.rpcId), { reason: 'MUSIC_HOST_PREPARING' });
  await f.registry.recordOutcome(exec, { value: { id: song.id, status: 'ACCEPTED', target: 'soundpro' } });
  assert.deepEqual(f.registry.failureFor(song.rpcId), { reason: 'MUSIC_HOST_ACCEPTED' });
  await f.registry.recordOutcome(exec, { value: { id: randomUUID(), status: 'ACCEPTED' } });
  assert.deepEqual(f.registry.failureFor(song.rpcId), { reason: 'MUSIC_HOST_RESULT_MISMATCH' });
});

test('pure search reports only actual candidates; later status and unrelated receipt do not erase play truth', async () => {
  const f = fixture(), query = f.admit('搜一下周杰伦的歌');
  f.append('turn/start', { turn: 1 }); f.append('step/start', { turn: 1, step: 1 });
  f.append('user/message', query.message);
  f.append('tool/call', { turn: 1, step: 1, callId: 'query-song', name: 'tvmusic_music_search' });
  await f.registry.recordOutcome({ agent: f.agent, callId: 'query-song', name: 'tvmusic_music_search',
    arguments: { purpose: 'lookup' } }, { value: { id: query.id, status: 'RESULTS', title: '安静',
    artist: '周杰伦', candidates: [{ id: 'a'.repeat(64), name: '周杰伦 - 安静.flac' }] } });
  assert.deepEqual(f.registry.failureFor(query.rpcId), { reason: 'MUSIC_HOST_SEARCH_RESULTS',
    instruction: '1. 周杰伦 - 安静.flac' });
  const song = f.admit('播放周杰伦的安静');
  f.append('turn/start', { turn: 2 }); f.append('step/start', { turn: 2, step: 1 });
  f.append('user/message', song.message);
  f.append('tool/call', { turn: 2, step: 1, callId: 'play-song', name: 'tvmusic_music_play' });
  await f.registry.recordOutcome({ agent: f.agent, callId: 'play-song', name: 'tvmusic_music_play' },
    { value: { id: song.id, status: 'ACCEPTED', target: 'soundpro' } });
  f.append('tool/call', { turn: 2, step: 1, callId: 'play-status', name: 'tvmusic_music_playback_status' });
  await f.registry.recordOutcome({ agent: f.agent, callId: 'play-status', name: 'tvmusic_music_playback_status' },
    { value: { id: song.id, status: 'ACCEPTED', target: 'soundpro' } });
  f.append('tool/call', { turn: 2, step: 1, callId: 'bad-receipt', name: 'tvmusic_receipt' });
  await f.registry.recordOutcome({ agent: f.agent, callId: 'bad-receipt', name: 'tvmusic_receipt' },
    { isError: true });
  assert.deepEqual(f.registry.failureFor(song.rpcId), { reason: 'MUSIC_HOST_ACCEPTED' });
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
  assert.deepEqual(notices, [{ reason: 'MUSIC_HOST_STOPPED_REPORTED' }]);
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
    rootCallId: 'dev-code', name: 'bash' }), undefined); // Original Host still owns ordinary tool policy.
});

test('bounded safety classification distinguishes song requests from explicit nonmusic work', () => {
  for (const text of ['播放周杰伦的七里香', '点一首刘德华的暗里着迷', '放点周杰伦的歌',
    '放周杰伦的七里香', '给我来一曲周杰伦的七里香',
    '想听安静', '暂停这首歌', '停掉这首歌', '停一下', '停止播放七里香',
    '放个周杰伦的歌', '请帮我播放周杰伦的七里香', '改成播放刘德华的暗里着迷',
    '这首歌现在怎么样了']) assert.ok(musicIntentKind(text), text);
  for (const text of ['运行项目测试', '修复音乐页面代码', '查看电影任务', '检查服务日志'])
    assert.equal(musicIntentKind(text), null);
  assert.equal(musicIntentKind('放我房间的灯'), null);
  for (const text of ['放 Content OS 的文件到桌面', '放 Content OS 的日志',
    '放电影《沙丘》的预告', '放我喜欢的电影']) assert.equal(musicIntentKind(text), null, text);
});

test('inbound gate protects TVmusic requests, not the whole Weixin/Harness Session', () => {
  const f = fixture();
  const scoped = { botId: 'approved-bot', senderId: 'approved-sender', sessionId: f.sessionId };
  assert.deepEqual(f.registry.checkInbound({ ...scoped, text: '运行项目测试' }), { kind: 'allow' });
  assert.deepEqual(f.registry.checkInbound({ ...scoped, senderId: 'different-sender',
    text: '运行项目测试' }), { kind: 'allow' });
  assert.deepEqual(f.registry.checkInbound({ ...scoped, sessionId: `session-${randomUUID()}`,
    senderId: 'different-sender', text: '运行项目测试' }), { kind: 'allow' });
  assert.deepEqual(f.registry.checkInbound({ ...scoped, senderId: 'p2p:approved-sender',
    text: '播放周杰伦的七里香' }), { kind: 'reject', reason: 'MUSIC_HOST_SESSION_SHARED' });
  assert.deepEqual(f.registry.checkInbound({ ...scoped, senderId: 'different-sender',
    text: '播放周杰伦的七里香' }), { kind: 'reject', reason: 'MUSIC_HOST_SESSION_SHARED' });
  assert.deepEqual(f.registry.checkInbound({ ...scoped, senderId: 'different-sender',
    sessionId: `session-${randomUUID()}`, text: '找电影《流浪地球》' }),
  { kind: 'reject', reason: 'MUSIC_HOST_SESSION_UNBOUND' });
  assert.deepEqual(f.registry.checkInbound({ ...scoped, sessionId: null,
    text: '播放周杰伦的七里香' }), { kind: 'reject', reason: 'MUSIC_HOST_SESSION_UNBOUND' });
  assert.deepEqual(f.registry.checkInbound({ ...scoped, text: '播放周杰伦的七里香' }), { kind: 'allow' });
  const missing = createMusicOriginRegistry({ ...scoped, modeOf: () => 'native', toolsReady: () => false });
  assert.deepEqual(missing.checkInbound({ ...scoped, text: '点一首刘德华的暗里着迷' }),
    { kind: 'reject', reason: 'MUSIC_HOST_TOOLS_UNAVAILABLE' });
  assert.deepEqual(missing.checkInbound({ ...scoped, text: '找电视剧《三体》' }),
    { kind: 'reject', reason: 'MUSIC_HOST_TOOLS_UNAVAILABLE' });
  for (const text of ['放周杰伦的七里香', '给我来一曲周杰伦的七里香',
    '我想看《沙丘》', '看电影《沙丘》，放周杰伦的七里香'])
    assert.deepEqual(missing.checkInbound({ ...scoped, text }),
      { kind: 'reject', reason: 'MUSIC_HOST_TOOLS_UNAVAILABLE' }, text);
  assert.deepEqual(missing.checkInbound({ ...scoped, text: '放 Content OS 的文件到桌面' }),
    { kind: 'allow' });
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
  const registry = installMusicOrigin(pluginCtx, { sessionId, botId: 'approved-bot', senderId: 'owner' },
    { TVMUSIC_HARNESS_URL: 'http://127.0.0.1:4317/' });
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
