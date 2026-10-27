// Run explicitly with TVMUSIC_PR39_ROOT pointing to a verified PR #39 checkout.
// Not part of dsh-im's default npm test; no production network or audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installMusicOrigin, musicIntentKind as hostMusicIntentKind,
  businessIntentKind as hostBusinessIntentKind,
  businessActionKind as hostBusinessActionKind,
  mediaReadIntentKind as hostMediaReadIntentKind } from '../../plugin-src/host/music-origin.mjs';
import { WeixinHarnessBridge } from '../../src/channels/weixin/weixin-bridge.mjs';

if (!process.env.TVMUSIC_PR39_ROOT) throw Error('TVMUSIC_PR39_ROOT is required for isolated PR #39 integration');
const { musicIntentKind: tvmusicMusicIntentKind, businessIntentKind: tvmusicBusinessIntentKind,
  businessActionKind: tvmusicBusinessActionKind,
  mediaReadIntentKind: tvmusicMediaReadIntentKind } = await import(pathToFileURL(join(
  process.env.TVMUSIC_PR39_ROOT, 'plugins/dsh-music-im-candidate.mjs')).href);
const { installMusicImCandidate } = await import(pathToFileURL(join(
  process.env.TVMUSIC_PR39_ROOT, 'plugins/dsh-music-im-candidate.mjs')).href);

test('Host admission intent shapes match the exact TVmusic PR39 candidate corpus', () => {
  for (const text of [
    '播放周杰伦的七里香', '播放周杰伦的七里香然后停止', '播放周杰伦的七里香。停止',
    '放周杰伦的七里香', '给我来一曲周杰伦的七里香',
    '停止播放七里香。继续',
    '点一首刘德华的暗里着迷', '放点周杰伦的歌',
    '来首安静', '想听周杰伦的安静', '放个周杰伦的歌', '改成播放刘德华的暗里着迷',
    '停', '停一下', '停掉这首歌', '停止播放七里香', '这首歌现在怎么样了',
    '运行项目测试', '修复音乐页面代码', '查看电影任务', '暂停播放电影',
  ]) assert.equal(hostMusicIntentKind(text), tvmusicMusicIntentKind(text), text);
  for (const text of ['下载电影《流浪地球》', '我想看电影《流浪地球》',
    '给我下载电影《流浪地球》', '追《三体》第二季', '下载综艺《歌手》第三季',
    '暂停电影下载', '查电影下载进度', '下载 Sticker 素材', '执行任意命令',
    '下载电影《A》但别下载', '下载 Sticker 素材《电影》',
    '追《三体》第二季还是第三季？', '下载电影《A》和《B》',
    '下载电影《流浪地球》并用 afplay 播放', '下载电影《流浪地球》，先等等',
    '追《三体》第二季但先等等', '下载电影《流浪地球》。先查资源',
    '追《三体》第二季。先查进度',
    '下载电影《流浪地球》第二季', '点看电视剧《三体》'])
    { assert.equal(hostBusinessIntentKind(text), tvmusicBusinessIntentKind(text), text);
      assert.equal(hostBusinessActionKind(text), tvmusicBusinessActionKind(text), text); }
  for (const text of ['你好', '查 Content OS 发布状态', '找电影《流浪地球》',
    '查看综艺《歌手》字幕状态', '查影视资源', '查电影下载进度',
    '我想看《沙丘》', '看电影《沙丘》，放周杰伦的七里香',
    '放 Content OS 的文件到桌面', '放 Content OS 的日志',
    '放电影《沙丘》的预告', '放我喜欢的电影',
    '下载电影《A》但别下载'])
    assert.equal(hostMediaReadIntentKind(text), tvmusicMediaReadIntentKind(text), text);
});

const sessionId = `session-${randomUUID()}`, botId = 'isolated-bot', senderId = 'isolated-owner';
const sent = [], seen = new Set(), asks = [];
const agent = { id: sessionId, session: { id: sessionId, snapshotEvents: () => [] } };
const ctx = {
  agents: { get: id => id === sessionId ? agent : undefined },
  tools: { get: name => ['tvmusic_music_play', 'tvmusic_music_playback_status',
    'tvmusic_music_control'].includes(name) ? { name } : undefined, guard() { return () => {}; } },
  on() { return () => {}; }, provide() {}, effect() {},
};
const registry = installMusicOrigin(ctx, { sessionId, botId, senderId },
  { TVMUSIC_HARNESS_URL: 'http://127.0.0.1:4317/' });
const bridge = new WeixinHarnessBridge({
  api: { sendText: async request => { sent.push(request.text); return { messageId: `reply-${sent.length}` }; } },
  baseUrl: 'https://ilinkai.weixin.qq.com/', token: 'isolated-token', ownerUserId: senderId,
  botId, musicOrigin: registry, harness: { ask(...args) { asks.push(args); throw Error('UNEXPECTED_AGENT_CALL'); } },
  state: { hasSeen: id => seen.has(id), markSeen: async id => { seen.add(id); },
    sessionFor: () => sessionId }, logger: { error() {} },
});
const inbound = (id, text) => ({ message_id: id, message_type: 1, from_user_id: senderId,
  context_token: `context-${id}`, item_list: [{ type: 1, text_item: { text } }] });

test('production Host gate blocks old music tools before Agent even when tool names exist', async () => {
  await bridge.accept(inbound('cached', '播放周杰伦的七里香'));
  await bridge.accept(inbound('control', '停'));
  await bridge.accept(inbound('movie-read', '找电影《流浪地球》'));
  await bridge.accept(inbound('colloquial-song', '放周杰伦的七里香'));
  await bridge.accept(inbound('mixed', '看电影《沙丘》，放周杰伦的七里香'));
  assert.equal(asks.length, 0);
  assert.equal(sent.length, 5);
  assert.match(sent[0], /不可用.*Mac/);
  assert.match(sent[1], /不可用.*Mac/);
  assert.match(sent[2], /业务入口暂不可用.*没有执行下载或本机播放/);
  assert.match(sent[3], /不可用.*Mac/);
  assert.match(sent[4], /业务入口暂不可用.*没有执行下载或本机播放/);
  assert.deepEqual(registry.checkInbound({ botId, senderId: 'different-sender', sessionId,
    text: '播放周杰伦的七里香' }), { kind: 'reject', reason: 'MUSIC_HOST_SESSION_SHARED' });
  assert.deepEqual(registry.checkInbound({ botId, senderId: 'different-sender', sessionId,
    text: '查 Content OS 发布状态' }), { kind: 'allow' });
});

test('trusted Weixin turns reach only the four TVmusic media tool families', async t => {
  const scopedSession = `session-${randomUUID()}`, owner = 'fixture-owner', bot = 'fixture-bot';
  const events = [], hooks = new Map(), tools = new Map(), guards = [], hostGuards = [], hostHooks = new Map();
  const app = { id: scopedSession, session: { id: scopedSession, snapshotEvents: () => events }, ctx: {
    on(name, fn) { hooks.set(name, fn); return () => hooks.delete(name); },
    tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); },
      guard(fn) { guards.push(fn); return () => guards.splice(guards.indexOf(fn), 1); } },
  } };
  const provided = new Map(), host = { agents: { get: id => id === scopedSession ? app : undefined },
    tools: { get: (name) => name === 'run_code' ? undefined : tools.get(name),
      guard(fn) { hostGuards.push(fn); return () => hostGuards.splice(hostGuards.indexOf(fn), 1); } },
    on(name, fn) { hostHooks.set(name, fn); return () => hostHooks.delete(name); },
    provide(name, value) { provided.set(name, value); }, effect() {} };
  const origin = installMusicOrigin(host, { sessionId: scopedSession, botId: bot, senderId: owner },
    { TVMUSIC_HARNESS_URL: 'http://127.0.0.1:4317/' });
  const proof = provided.get('dshImMusicOrigin');
  const writes = [], local = [], sent = [], seen = new Set();
  const businessClient = { async movie(id) { return { item: { tmdb_id: id, title: '流浪地球', year: 2019,
    display_type: '电影' } }; },
    async series(id, season) { return { item: { tmdb_id: id, title: id === 30 ? '歌手' : '三体',
      year: id === 30 ? 2025 : 2023, display_type: id === 30 ? '综艺' : '剧集' }, seasons: [{ number: season }],
      episodes: [{ number: 3 }] }; },
    async search(query) { return { items: [{ media_type: query === '流浪地球' ? 'movie' : 'series',
      tmdb_id: query === '流浪地球' ? 10 : query === '歌手' ? 30 : 20, title: query,
      display_type: query === '流浪地球' ? '电影' : query === '歌手' ? '综艺' : '剧集',
      year: query === '流浪地球' ? 2019 : query === '歌手' ? 2025 : 2023 }] }; },
    async tasks() { return { items: [] }; },
    async submit(command) { writes.push(command); return { schema_version: 1, request_id: command.request_id,
      operation: command.operation, state: 'SUCCEEDED', result: { status: 'DOWNLOADING' } }; } };
  const musicSearches = [];
  const musicClient = { async search(input) { musicSearches.push(input); return { id: input.id, title: input.title,
      artist: input.artist, status: 'RESULTS', candidates: [{ id: 'a'.repeat(64), name: '周杰伦 - 七里香.flac' }] }; },
    async begin(input) { writes.push({ operation: 'music.play', ...input });
      return { id: input.id, status: 'ACCEPTED', target: 'soundpro' }; },
    async status(id) { return { id, status: 'ACCEPTED' }; },
    async active() { return { status: 'NO_ACTIVE' }; },
    async control(id) { return { id, status: 'UNKNOWN' }; } };
  const dispose = installMusicImCandidate({ agents: host.agents, on: host.on }, {
    sessionId: scopedSession, verifyOrigin: proof.verify, verifyExecution: proof.verifyExecution,
    client: musicClient, clientForExec: () => businessClient });
  t.after(dispose);
  for (const name of ['tvmusic_panel', 'tvmusic_page_url', 'tvmusic_search', 'tvmusic_movie',
    'tvmusic_movie_resources', 'tvmusic_series', 'tvmusic_receipt'])
    tools.set(name, { execute: async () => ({ status: 'READ_ONLY' }) });
  tools.set('tvmusic_tasks', { execute: async () => businessClient.tasks() });
  for (const name of ['read_file', 'web_fetch', 'other_os_download', 'content_os_read'])
    tools.set(name, { execute: async () => { local.push(`original:${name}`); return { originalHost: name }; } });
  const append = (type, data) => events.push({ seq: events.length, type, data });
  let turn = 0, stagedTool = null;
  const harness = { sessionExists: async () => true,
    async ask(id, prompt, options) {
      const body = typeof prompt === 'string' ? prompt : prompt.at(-1)?.text ?? '';
      const rpcId = `weixin-${randomUUID()}`;
      options.claimMusicOrigin({ sessionId: id, rpcId });
      if (body === '你好') return '普通聊天';
      const currentTurn = ++turn, message = { role: 'user', source: { kind: 'user', rpcId },
        content: [{ type: 'text', text: body }] };
      append('turn/start', { turn: currentTurn }); append('step/start', { turn: currentTurn, step: 1 });
      append('user/message', message);
      await hooks.get('agent/pre-step')({ agent: app, turn: currentTurn, step: 1,
        signal: new AbortController().signal, messages: [message] },
      async () => ({ kind: 'enter', messages: [message] }));
      const [name, args] = ['对', '就这部', '开始吧'].includes(body) && stagedTool
        ? [stagedTool, {}]
        : body.includes('bash') ? ['bash', { command: 'afplay' }]
        : body.includes('读取文件') ? ['read_file', { path: '/tmp/sample' }]
          : body.includes('任意 URL') ? ['web_fetch', { url: 'http://127.0.0.1/' }]
            : body.includes('Sticker') ? ['other_os_download', {}]
              : body.includes('Content OS') ? ['content_os_read', {}]
              : body.includes('并下载') ? ['tvmusic_movie_watch', { tmdb_id: 10 }]
                : body.startsWith('找周杰伦') ? ['tvmusic_music_search', { title: '七里香', artist: '周杰伦', purpose: 'lookup' }]
                  : body.startsWith('播放周杰伦的安静') ? ['tvmusic_music_search', { title: '安静', artist: '周杰伦', purpose: 'play' }]
                  : body === '第一首' ? ['tvmusic_music_play', {}]
                    : body.includes('周杰伦') ? ['tvmusic_music_play', { title: '七里香', artist: '周杰伦' }]
        : body.includes('电影《') ? ['tvmusic_movie_watch', { tmdb_id: 10 }]
          : body.includes('综艺《') ? ['tvmusic_series_action', { tmdb_id: 30, season_number: 3, action: 'download_season', media_type: 'variety' }]
            : body.includes('《三体》') ? ['tvmusic_series_action', { tmdb_id: 20, season_number: 2, action: 'follow_season', media_type: 'series' }]
              : ['tvmusic_tasks', {}];
      const callId = randomUUID(), exec = { agent: app, name, arguments: args, callId,
        rootCallId: callId, signal: new AbortController().signal };
      append('tool/call', { turn: currentTurn, step: 1, callId, name });
      const pre = await hooks.get('tools/pre-execute')(exec, async () => ({ kind: 'allow' }));
      if (pre.kind !== 'allow') { local.push(pre.reason); return pre.reason; }
      for (const guard of [...guards, ...hostGuards]) {
        const reason = guard(exec); if (reason) { local.push(reason); return reason; }
      }
      const result = await hostHooks.get('tools/execute')(exec, () => hooks.get('tools/execute')(exec,
        () => tools.get(name).execute(args, exec)));
      if (result?.status === 'CONFIRM_REQUIRED') stagedTool = name;
      else if (['SUCCEEDED', 'IN_PROGRESS', 'UNKNOWN'].includes(result?.state)) stagedTool = null;
      return JSON.stringify(result);
    } };
  const state = { hasSeen: id => seen.has(id), markSeen: async id => { seen.add(id); },
    sessionFor: () => scopedSession };
  const bridge = new WeixinHarnessBridge({
    api: { sendText: async request => { sent.push(request.text); return { messageId: `reply-${sent.length}` }; } },
    baseUrl: 'https://ilinkai.weixin.qq.com/', token: 'isolated-token', ownerUserId: owner,
    botId: bot, musicOrigin: origin, harness, state, logger: { error() {} },
  });
  const inbound = (id, text) => ({ message_id: id, message_type: 1, from_user_id: owner,
    context_token: `context-${id}`, item_list: [{ type: 1, text_item: { text } }] });
  for (const [id, text] of [['song', '播放周杰伦的七里香'], ['movie', '下载电影《流浪地球》'],
    ['movie-confirm', '就这部'], ['series', '追《三体》第二季'], ['series-confirm', '开始吧'],
    ['variety', '下载综艺《歌手》第三季'], ['variety-confirm', '对'], ['query', '查电影下载进度']])
    await bridge.accept(inbound(id, text));
  assert.deepEqual(writes.map(row => row.operation), ['music.play', 'movie.watch', 'series.action', 'series.action']);
  assert.equal(new Set(writes.filter(row => row.request_id).map(row => row.request_id)).size, 3);
  assert.equal(local.length, 0);
  assert.ok(sent.some(text => /Sound Pro.*出声/.test(text)));
  assert.ok(sent.some(text => /业务请求/.test(text)));
  await bridge.accept(inbound('ordinary-chat', '你好'));
  assert.equal(sent.at(-1), '普通聊天');
  await bridge.accept(inbound('content-read', '查 Content OS 发布状态'));
  assert.ok(local.includes('original:content_os_read'));
  for (const [id, text] of [['bash', '下载电影《流浪地球》并运行 bash'],
    ['file', '读取文件'], ['url', '访问任意 URL'], ['other', '下载 Sticker 素材'],
    ['query-write', '查电影下载进度并下载'],
    ['mixed-url', '查电影《流浪地球》并访问任意 URL']]) await bridge.accept(inbound(id, text));
  assert.ok(local.includes('original:read_file') && local.includes('original:web_fetch')
    && local.includes('original:other_os_download'));
  assert.equal(local.filter(value => value.startsWith('original:')).length, 4);
  assert.ok(local.filter(value => !value.startsWith('original:')).length >= 2);
  assert.equal(writes.length, 4);
  await bridge.accept(inbound('unsupported', '暂停电视剧下载《三体》'));
  assert.match(sent.at(-1), /不受.*支持/);
  assert.equal(writes.length, 4);
  await bridge.accept(inbound('song-search', '找周杰伦的七里香歌曲'));
  assert.match(sent.at(-1), /七里香/);
  await bridge.accept(inbound('song-choice', '第一首'));
  assert.equal(writes.length, 5);
  assert.equal(writes.at(-1).title, '七里香');
  assert.equal(writes.at(-1).artist, '周杰伦');
  assert.equal(writes.at(-1).candidate_id, 'a'.repeat(64));
  const beforeVoice = writes.length, beforeSearch = musicSearches.length;
  for (const [id, text] of [['voice-one', '播放周杰伦的安静'],
    ['voice-two', '播放周杰伦的安静在大厅的小米音箱']]) {
    await bridge.accept(inbound(id, text));
    assert.doesNotMatch(sent.at(-1), /搜索源为空|音乐源为空/);
  }
  assert.equal(writes.length, beforeVoice + 2);
  assert.equal(musicSearches.length, beforeSearch); // Search-shaped calls were play preludes.
  assert.ok(writes.slice(-2).every(row => row.operation === 'music.play'
    && row.title === '安静' && row.artist === '周杰伦'));
  assert.equal(new Set(writes.slice(-2).map(row => row.id)).size, 2);
  await bridge.accept(inbound('voice-two', '播放周杰伦的安静在大厅的小米音箱'));
  assert.equal(writes.length, beforeVoice + 2); // Duplicate delivery cannot submit again.
});
