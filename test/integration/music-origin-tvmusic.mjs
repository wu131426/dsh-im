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
const { musicIntentKind: tvmusicMusicIntentKind } = await import(pathToFileURL(join(
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
const sent = [], seen = new Set(), asks = [];
const agent = { id: sessionId, session: { id: sessionId, snapshotEvents: () => [] } };
const ctx = {
  agents: { get: id => id === sessionId ? agent : undefined },
  tools: { get: name => name === 'run_code' ? undefined : { name }, guard() { return () => {}; } },
  on() { return () => {}; }, provide() {}, effect() {},
};
const registry = installMusicOrigin(ctx, { sessionId, botId, senderId });
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
  assert.equal(asks.length, 0);
  assert.equal(sent.length, 2);
  assert.match(sent[0], /不可用.*Mac/);
  assert.match(sent[1], /不可用.*Mac/);
  assert.deepEqual(registry.checkInbound({ botId, senderId: 'different-sender', sessionId,
    text: '播放周杰伦的七里香' }), { kind: 'reject', reason: 'MUSIC_HOST_SESSION_SHARED' });
});
