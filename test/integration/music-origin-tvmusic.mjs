// Run explicitly with TVMUSIC_PR39_ROOT pointing to a verified PR #39 checkout.
// Not part of dsh-im's default npm test; no production network or audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installMusicOrigin, musicIntentKind as hostMusicIntentKind } from '../../plugin-src/host/music-origin.mjs';
import { WeixinHarnessBridge } from '../../src/channels/weixin/weixin-bridge.mjs';

if (!process.env.TVMUSIC_PR39_ROOT) throw Error('TVMUSIC_PR39_ROOT is required for isolated PR #39 integration');
const { installMusicImCandidate, musicIntentKind: tvmusicMusicIntentKind } = await import(pathToFileURL(join(
  process.env.TVMUSIC_PR39_ROOT, 'plugins/dsh-music-im-candidate.mjs')).href);

test('Host admission intent shapes match the exact TVmusic PR39 candidate corpus', () => {
  for (const text of [
    '播放周杰伦的七里香', '点一首刘德华的暗里着迷', '放点周杰伦的歌',
    '来首安静', '想听周杰伦的安静', '放个周杰伦的歌', '改成播放刘德华的暗里着迷',
    '停', '停一下', '停掉这首歌', '停止播放七里香', '这首歌现在怎么样了',
    '运行项目测试', '修复音乐页面代码', '查看电影任务', '暂停播放电影',
  ]) assert.equal(hostMusicIntentKind(text), tvmusicMusicIntentKind(text), text);
});

const sessionId = `session-${randomUUID()}`, botId = 'isolated-bot', senderId = 'isolated-owner';
const events = [], handlers = new Map(), guards = [], tools = new Map();
let mode = 'native', toolsAvailable = true, turn = 0, lastIntent = null;
const agent = { id: sessionId, session: { id: sessionId, snapshotEvents: () => events }, ctx: {
  on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name); },
  tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); },
    guard(fn) { guards.push(fn); return () => guards.splice(guards.indexOf(fn), 1); } },
} };
const ctx = { agents: { get: id => id === sessionId ? agent : undefined },
  on(name, fn) { handlers.set(`global:${name}`, fn); return () => handlers.delete(`global:${name}`); } };
const hostGuards = [], hostHooks = new Map(), provided = new Map();
const hostCtx = { agents: { get: id => id === sessionId ? agent : undefined },
  tools: { get: name => name === 'run_code' ? mode === 'ptc' ? { name } : undefined
    : toolsAvailable && tools.get(name),
  guard(fn) { hostGuards.push(fn); return () => hostGuards.splice(hostGuards.indexOf(fn), 1); } },
  on(name, fn) { hostHooks.set(name, fn); return () => hostHooks.delete(name); },
  provide(name, value) { provided.set(name, value); }, effect() {} };
const registry = installMusicOrigin(hostCtx, { sessionId, botId, senderId });
const proofService = provided.get('dshImMusicOrigin');
const begun = [], controlled = [], local = [], sent = [];
const client = {
  async begin(input, context) {
    begun.push({ input, context }); lastIntent = input.id;
    if (input.title === '七里香') return { id: input.id, status: 'READY', target: 'soundpro', source: 'sample-cache' };
    if (input.title === '暗里着迷') return { id: input.id, status: 'SEARCHING', target: 'soundpro', source: 'sample-search' };
    if (input.title === '离线样例') return { id: input.id, status: 'UNKNOWN', target: 'soundpro',
      instruction: '客厅 Sound Pro 当前不可用，原请求仍待核对。' };
    return { id: input.id, status: 'SEARCHING', target: 'soundpro', source: 'sample-artist-search' };
  },
  async status(id) { return { id, status: 'SEARCHING', target: 'soundpro' }; },
  async active() { return lastIntent ? { id: lastIntent } : { status: 'NO_ACTIVE' }; },
  async control(id, action) { controlled.push([id, action]);
    return { id, status: action === 'stop' ? 'STOPPED' : 'PAUSED', target: 'soundpro' }; },
};
const dispose = installMusicImCandidate(ctx, { sessionId,
  verifyOrigin: proofService.verify, verifyExecution: proofService.verifyExecution, client });
const stateSessions = new Map([['p2p:isolated-owner', sessionId]]), seen = new Set();
const state = { hasSeen: id => seen.has(id), markSeen: async id => { seen.add(id); },
  sessionFor: key => stateSessions.get(key) ?? null,
  setSession: async (key, id) => { stateSessions.set(key, id); },
  clearSession: async key => { stateSessions.delete(key); } };
const append = (type, data) => events.push({ seq: events.length, type, data });

async function dispatch(name, args, callId) {
  const exec = { agent, name, arguments: args, callId, rootCallId: callId,
    signal: new AbortController().signal };
  const pre = await handlers.get('tools/pre-execute')(exec, async () => ({ kind: 'allow' }));
  if (pre.kind !== 'allow') throw Error(pre.reason);
  const reason = guards.map(guard => guard(exec)).find(value => value !== undefined);
  if (reason) throw Error(reason);
  const hostReason = hostGuards.map(guard => guard(exec)).find(value => value !== undefined);
  if (hostReason) throw Error(hostReason);
  return hostHooks.get('tools/execute')(exec, () => handlers.get('tools/execute')(exec, async () => {
    if (tools.has(name)) return tools.get(name).execute(args, exec);
    local.push(name); return { local: true };
  }));
}
const harness = { sessionExists: async () => true,
  async ask(id, prompt, options) {
    const body = typeof prompt === 'string' ? prompt : prompt.at(-1)?.text ?? '';
    const rpcId = `weixin-${randomUUID()}`;
    options.claimMusicOrigin({ sessionId: id, rpcId });
    const currentTurn = ++turn, message = { role: 'user', source: { kind: 'user', rpcId },
      content: [{ type: 'text', text: body }] };
    append('turn/start', { turn: currentTurn });
    append('step/start', { turn: currentTurn, step: 1 });
    append('user/message', message);
    const decision = await handlers.get('agent/pre-step')({ agent, turn: currentTurn, step: 1,
      signal: new AbortController().signal, messages: [message] },
    async () => ({ kind: 'enter', messages: [message] }));
    assert.equal(decision.kind, 'enter');
    const name = body === '运行项目测试' ? 'bash'
      : body === '停' ? 'tvmusic_music_control' : 'tvmusic_music_play';
    const args = name === 'bash' ? { command: 'isolated-test' }
      : name === 'tvmusic_music_control' ? { action: 'stop', intent_id: lastIntent }
        : body.includes('七里香') ? { title: '七里香', artist: '周杰伦' }
          : body.includes('暗里着迷') ? { title: '暗里着迷', artist: '刘德华' }
            : body.includes('离线样例') ? { title: '离线样例' }
            : { artist: '周杰伦' };
    const callId = randomUUID();
    append('tool/call', { turn: currentTurn, step: 1, callId, name });
    return JSON.stringify(await dispatch(name, args, callId));
  } };
const bridge = new WeixinHarnessBridge({
  api: { sendText: async request => { sent.push(request.text); return { messageId: `reply-${sent.length}` }; } },
  baseUrl: 'https://ilinkai.weixin.qq.com/', token: 'isolated-token', ownerUserId: senderId,
  botId, musicOrigin: registry, harness, state, logger: { error() {} },
});
const inbound = (id, text) => ({ message_id: id, message_type: 1, from_user_id: senderId,
  context_token: `context-${id}`, item_list: [{ type: 1, text_item: { text } }] });

test('real Host bridge + TVmusic PR39 scoped tools: cache, search, artist, stop and no Mac fallback', async t => {
  t.after(dispose);
  await bridge.accept(inbound('cached', '播放周杰伦的七里香'));
  await bridge.accept(inbound('cached', '播放周杰伦的七里香')); // Same provider message never re-enters.
  await bridge.accept(inbound('search', '点一首刘德华的暗里着迷'));
  await bridge.accept(inbound('artist', '放点周杰伦的歌'));
  await bridge.accept(inbound('offline', '播放离线样例'));
  assert.match(sent.at(-1), /播放结果待确认.*Sound Pro 当前不可用/);
  await bridge.accept(inbound('stop', '停'));
  await bridge.accept(inbound('development', '运行项目测试'));
  assert.deepEqual(begun.map(({ input }) => [input.title, input.artist]), [
    ['七里香', '周杰伦'], ['暗里着迷', '刘德华'], ['', '周杰伦'],
    ['离线样例', ''],
  ]);
  assert.ok(begun.every(({ context }) => context.source === 'harness'));
  assert.deepEqual(controlled, [[begun.at(-1).input.id, 'stop']]);
  assert.deepEqual(local, ['bash']); // Only the explicit nonmusic terminal task.
  assert.ok(sent.some(text => /歌曲文件已就绪.*出声仍待确认/.test(text)));
  assert.ok(sent.some(text => /正在准备这首歌.*尚未确认音箱出声/.test(text)));
  const prior = begun.length;
  toolsAvailable = false;
  await bridge.accept(inbound('missing', '播放周杰伦的七里香'));
  assert.equal(begun.length, prior);
  assert.match(sent.at(-1), /不可用.*Mac/);
  mode = 'ptc'; toolsAvailable = true;
  await bridge.accept(inbound('ptc', '播放周杰伦的七里香'));
  assert.equal(begun.length, prior);
  assert.match(sent.at(-1), /工具模式.*Mac/);
  await bridge.accept(inbound('new', '/new'));
  mode = 'native';
  await bridge.accept(inbound('unbound', '播放周杰伦的七里香'));
  assert.equal(begun.length, prior);
  assert.match(sent.at(-1), /未绑定.*Mac/);
});
