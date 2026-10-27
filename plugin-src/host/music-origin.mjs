// Host-owned Weixin origin proof for a single explicitly scoped music Session.
// No model/tool arguments may admit an origin. This module stores only sender
// identity and a body digest; the durable Session events remain the authority.
import { createHash } from 'node:crypto';

const UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const MAX_ORIGINS = 2_000;
const ORIGIN_TTL_MS = 60 * 60_000;
const SOURCE_BLOCK = /^<(dsh_im_source|dsh_im_source_guidance|dsh_im_reply_to|dsh_im_context)>/;
const MUSIC_TOOLS = new Set(['tvmusic_music_search', 'tvmusic_music_play',
  'tvmusic_music_playback_status', 'tvmusic_music_control']);
const BUSINESS_TOOLS = new Set(['tvmusic_movie_watch', 'tvmusic_series_action', 'tvmusic_task_control']);
const SAFE_READS = new Set(['tvmusic_panel', 'tvmusic_page_url', 'tvmusic_search',
  'tvmusic_movie', 'tvmusic_movie_resources', 'tvmusic_series', 'tvmusic_tasks',
  'tvmusic_receipt']);
const REQUIRED_READS = ['tvmusic_panel', 'tvmusic_page_url', 'tvmusic_search', 'tvmusic_movie',
  'tvmusic_movie_resources', 'tvmusic_series', 'tvmusic_tasks', 'tvmusic_receipt'];
const TVMUSIC_HOST_ENV = new Set(['TVMUSIC_HARNESS_URL', 'TVMUSIC_IM_SESSION_ID']);
const BUSINESS_SECRETS = new Set(['TMDB_READ_ACCESS_TOKEN', 'MDBLIST_API_KEY', 'PROWLARR_API_KEY',
  'QBITTORRENT_USERNAME', 'QBITTORRENT_PASSWORD', 'SONARR_API_KEY', 'BAZARR_API_KEY',
  'SLSKD_API_KEY', 'DEEPSEEK_API_KEY']);
export function assertTvmusicHostEnvironment(env) {
  if (!env || typeof env !== 'object' || Object.keys(env).some(key => key.startsWith('INFISICAL_')
    || key.startsWith('TVMUSIC_') && !TVMUSIC_HOST_ENV.has(key) || BUSINESS_SECRETS.has(key)))
    throw Error('MUSIC_HOST_ENVIRONMENT_UNSAFE');
  if (env.TVMUSIC_HARNESS_URL === undefined) throw Error('MUSIC_HOST_ENVIRONMENT_UNSAFE');
  let url;
  try { url = new URL(env.TVMUSIC_HARNESS_URL); } catch { throw Error('MUSIC_HOST_ENVIRONMENT_UNSAFE'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || url.pathname !== '/' || url.search || url.hash || url.username || url.password)
    throw Error('MUSIC_HOST_ENVIRONMENT_UNSAFE');
}
const PREPARING = new Set(['SEARCHING', 'QUEUED', 'CONFIRMING', 'PREPARING',
  'WAITING_ORIGINAL', 'DISPATCHING', 'STOPPING', 'PAUSING', 'RESUMING']);
const RESULT_REASONS = Object.freeze({
  READY: 'MUSIC_HOST_READY', ACCEPTED: 'MUSIC_HOST_ACCEPTED',
  PLAY_REQUEST_ACCEPTED: 'MUSIC_HOST_ACCEPTED',
  PLAYING: 'MUSIC_HOST_PLAYING_REPORTED', PAUSED: 'MUSIC_HOST_PAUSED_REPORTED',
  STOPPED: 'MUSIC_HOST_STOPPED_REPORTED', CLARIFY: 'MUSIC_HOST_CLARIFY',
});
const OTHER_INTENT_REASONS = Object.freeze({
  STOPPED: 'MUSIC_HOST_OTHER_STOPPED', PAUSED: 'MUSIC_HOST_OTHER_PAUSED',
  PLAYING: 'MUSIC_HOST_OTHER_PLAYING',
});
const digest = text => createHash('sha256').update(text).digest('hex');
const selectionIndex = text => {
  const match = /^(?:(?:选|播放|放)\s*)?第([一二三123])(?:首|个)(?:歌)?$/.exec(String(text ?? '').normalize('NFKC').trim());
  return match ? ({ 一: 1, 二: 2, 三: 3 }[match[1]] ?? Number(match[1])) : null;
};
const eventIdOf = rpcId => typeof rpcId === 'string'
  ? /^weixin-(?:steer-)?([a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})$/i.exec(rpcId)?.[1]
  : null;

function humanText(message) {
  let text = Array.isArray(message?.content)
    ? message.content.filter(part => part?.type === 'text').map(part => part.text).join('\n')
    : typeof message?.content === 'string' ? message.content : '';
  for (let index = 0; index < 8 && text.startsWith('<dsh_im_'); index++) {
    const open = SOURCE_BLOCK.exec(text);
    if (!open) return null;
    const close = `</${open[1]}>`, end = text.indexOf(close, open[0].length);
    if (end < 0 || end > 32_000) return null;
    text = text.slice(end + close.length).trimStart();
  }
  return text.startsWith('<dsh_im_') ? null : text;
}

// Admission safety only; mirror TVmusic PR #39's intent shapes so a recognized
// music request never falls through to local tools when the overlay is absent.
// Song matching/search remains solely in TVmusic. Keep the cross-repo corpus.
export function musicIntentKind(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim(), text = normalized.slice(0, 1000);
  if (text.startsWith('<dsh_im_')) return 'ambiguous';
  if (/^(?:帮我)?(?:写|修复|解释|分析|测试|查看|检查|如何|怎么|生成)(?:一|这|个|段|下|份|条|些|种|轮|次|本|套|：|:|\s)/.test(text)) return null;
  if (/^(?:(?:请帮我|请|帮我|给我|我)\s*)?(?:改成|换成|继续|停止|暂停)?(?:播放|放点|放)?(?:这部|一部)?(?:电影|影片|视频|电视剧|剧集|综艺)/.test(text)) return null;
  if (/^(?:取消|算了|不用了|不听了|先别放|别放了|不要放了|把(?:这首歌|音乐|音箱)(?:给我)?(?:关了|关掉|停掉)|关掉(?:音乐|音箱))$/.test(text)) return 'control';
  if (/(?:但别|但不|别播|别放|不要|不准|先别|暂不|如果|假如|是否|能否|可以吗|以及|并且|和|再来一首|然后|同时|接着|随后)/.test(text)
    || /[。！!].+/.test(text)) return 'ambiguous';
  if (/^(?:(?:这首歌|音乐|音箱|当前播放).{0,25}(?:怎么样|状态|进度|播了吗|还在放)|现在(?:在播什么|放到哪了))/.test(text)) return 'status';
  if (/^(?:改成|换成|改播|换歌放)(?:播放|放|听)/.test(text)) return 'play';
  if (/^(?:停|停止|暂停|继续)$/.test(text)) return 'control';
  if (/^停一下$/.test(text)) return 'control';
  if (selectionIndex(text)) return 'play';
  if (/^(?:(?:请|帮我|给我)\s*)?(?:找|搜|搜索|查)(?:一下|一首|点)?[^\n]{0,80}(?:歌|歌曲|音乐)/.test(text)) return 'search';
  if (/^(?:(?:请帮我|请|能不能|可以|帮我|给我|我|麻烦|随便)\s*)?(?:播放|放)(?:这部|一部)?(?:电影|影片|视频|电视剧|剧集|综艺)/.test(text)) return null;
  if (/^(?:停止|暂停|继续)播放(?:电影|影片|视频|电视剧|剧集|综艺|任务|进程|服务|构建)/.test(text)) return null;
  if (/^(?:(?:请帮我|请|帮我)\s*)?(?:停掉|停止|暂停|继续)播放[^\n]{1,80}$/.test(text)) return 'control';
  if (/^(?:(?:请|能不能|可以|帮我|给我)\s*)?(?:停掉|停止|暂停|继续)(?:(?:播放)?这首|歌曲|音乐|歌|播放(?:这首歌|歌曲|音乐)?(?=$|[，。！？\s]))(?:\b|.*$)/.test(text)) return 'control';
  if (/^(?:(?:请帮我|请|能不能|可以|帮我|给我|我|我要|麻烦|随便)\s*)?(?:来(?:一)?首|点(?:一)?首|播放|播|播一首|放点|放个|放(?:一)?首|再放一遍|想听|听听|听(?=.{1,80}的)|我要听)/.test(text))
    return /(?:电影|影片|视频|电视剧|剧集|综艺)/.test(text) ? 'ambiguous' : 'play';
  if (/(?:音乐|歌曲|首歌|点歌)/.test(text) && /(?:想|听|放|播|点)/.test(text)) return 'ambiguous';
  return normalized.length > text.length && /(?:点歌|来首|想听|播放|放歌|音乐|歌曲)/.test(normalized.slice(1000))
    ? 'ambiguous' : null;
}

export function businessActionKind(value) {
  if (typeof value !== 'string' || musicIntentKind(value)) return null;
  const text = value.normalize('NFKC').trim();
  if (/^(?:请|帮我|给我)?\s*(?:写|修复|解释|分析|测试|检查|如何|怎么|生成)/.test(text)
    || /^(?:查|查询|搜索|找|看看|了解|显示|汇报|进度|状态)/.test(text)
    || /(?:别|不要|不准|暂不|不下载|如果|假如|是否|能否|可以吗|但|先等等|稍后|待会|等一下|再说|先不|暂缓|考虑一下|然后|同时|接着|随后)/.test(text)
    || /[，,；;？?]/.test(text)
    || /[。！!].+/.test(text)
    || /(?:Sticker|Content|其他\s*OS|终端|命令|文件|URL|https?:)/i.test(text)
    || /(?:\b(?:afplay|ffplay|mpv|osascript)\b|Music\.app|本机播放器|Mac\s*播放|并用|并且|同时|然后|再(?:执行|打开|播放|下载))/i.test(text)
    || [...text.matchAll(/《[^》]{1,100}》/g)].length > 1
    || [...text.matchAll(/第[一二三四五六七八九十\d]+季/g)].length > 1) return null;
  if (!/(?:电影|影片|电视剧|剧集|综艺|本季|这一季|第[一二三四五六七八九十\d]+[季集]|《[^》]{1,100}》)/.test(text)) return null;
  const movie = /(?:电影|影片)/.test(text);
  const series = /(?:电视剧|剧集|综艺|本季|这一季|第[一二三四五六七八九十\d]+[季集])/.test(text);
  if (movie && series) return null;
  const action = text.replace(/^(?:(?:请|帮我|给我|我想|我要)\s*)?/, '');
  if (action.length > 200 || /[\r\n？?]/.test(action)) return null;
  if (/^暂停(?:电影|影片)?下载/.test(action)) return 'task-pause';
  if (/^(?:继续|恢复)(?:电影|影片)?下载/.test(action)) return 'task-resume';
  if (/^(?:暂停|继续|恢复|停止|取消)(?:电视剧|剧集|综艺|电影|影片)?(?:下载|任务)/.test(action))
    return 'unsupported-control';
  if (/^(?:停止追|取消追)/.test(action)) return 'series-unfollow_season';
  if (/^追/.test(action)) return 'series-follow_season';
  if (/^下载/.test(action) && /第[一二三四五六七八九十\d]+集/.test(action)) return 'series-download_episode';
  if (/^下载/.test(action) && /(?:电视剧|剧集|综艺|第[一二三四五六七八九十\d]+季)/.test(action)) return 'series-download_season';
  if (movie && /^(?:下载(?:电影|影片)|点看|看(?:电影|影片|《))/.test(action)) return 'movie-watch';
  return null;
}
export const businessIntentKind = value => businessActionKind(value) ? 'business' : null;
const businessAllowed = (action, name, args) => action === 'movie-watch' && name === 'tvmusic_movie_watch'
  || action?.startsWith('series-') && name === 'tvmusic_series_action' && args?.action === action.slice(7)
  || action === 'task-pause' && name === 'tvmusic_task_control' && args?.action === 'pause'
  || action === 'task-resume' && name === 'tvmusic_task_control' && args?.action === 'resume';

function explicitDevelopmentWork(text) {
  if (typeof text !== 'string' || musicIntentKind(text)
    || /(?:\bafplay\b|\bffplay\b|\bmpv\b|Music\.app|播放|点歌|放点|想听|听歌)/i.test(text)) return false;
  return /^(?:(?:请|帮我|给我)\s*)?(?:修复|检查|查看|编译|构建|调试|测试|写|分析|提交)(?=.{0,160}(?:代码|脚本|项目|构建|测试|日志|终端|命令|git|仓库|文件|报错|CI))/i.test(text)
    || /^(?:(?:请|帮我|给我)\s*)?(?:运行|执行)(?:项目|单元|集成|回归)?(?:测试|构建|编译|CI|lint)/i.test(text);
}

function resultReason(status, isError) {
  if (isError || status === 'FAILED') return 'MUSIC_HOST_TOOL_FAILED';
  if (status === 'UNKNOWN') return 'MUSIC_HOST_OUTPUT_UNKNOWN';
  if (PREPARING.has(status)) return 'MUSIC_HOST_PREPARING';
  return Object.hasOwn(RESULT_REASONS, status) ? RESULT_REASONS[status] : 'MUSIC_HOST_NO_RESULT';
}

function otherIntentReason(status) {
  if (Object.hasOwn(OTHER_INTENT_REASONS, status)) return OTHER_INTENT_REASONS[status];
  if (PREPARING.has(status) || status === 'READY' || status === 'ACCEPTED')
    return 'MUSIC_HOST_OTHER_PENDING';
  if (status === 'FAILED') return 'MUSIC_HOST_OTHER_FAILED';
  if (status === 'CLARIFY') return 'MUSIC_HOST_OTHER_CLARIFY';
  return 'MUSIC_HOST_OTHER_UNKNOWN';
}

export function createMusicOriginRegistry({ sessionId, botId, senderId,
  agentFor = id => ({ id }), modeOf = () => 'native', toolsReady = () => false,
  now = Date.now } = {}) {
  if (typeof sessionId !== 'string' || !/^session-/.test(sessionId)
    || typeof botId !== 'string' || !botId || typeof senderId !== 'string' || !senderId)
    throw Error('MUSIC_ORIGIN_SCOPE_REQUIRED');
  const origins = new Map();
  let closed = false, lastSearch = null;
  let nextAdmission = 0, latestMusicAdmission = 0;
  function prune() {
    const time = now();
    for (const [id, record] of origins) if (record.expiresAt <= time) origins.delete(id);
    while (origins.size > MAX_ORIGINS) origins.delete(origins.keys().next().value);
  }
  function recordFor(agent, rpcId, eventId) {
    if (closed) return null;
    prune();
    const record = origins.get(rpcId);
    if (!record || agent?.id !== sessionId
      || agent.session?.id !== undefined && agent.session.id !== sessionId) return null;
    return record.sessionId === sessionId && record.eventId === eventId ? record : null;
  }
  function eventsOf(agent) {
    try {
      const events = agent.session?.snapshotEvents?.();
      return Array.isArray(events) ? events : null;
    } catch { return null; }
  }
  function durableUser(events, rpcId, bodyHash, turn) {
    let activeTurn = null, matches = 0;
    for (const event of events) {
      if (event?.type === 'turn/start') activeTurn = event.data?.turn;
      if (event?.type !== 'user/message' || event.data?.source?.kind !== 'user'
        || event.data.source.rpcId !== rpcId) continue;
      if (activeTurn !== turn || humanText(event.data) === null
        || digest(humanText(event.data)) !== bodyHash) return false;
      matches++;
    }
    return matches === 1;
  }
  function callFacts(agent, callId, rootCallId) {
    const events = eventsOf(agent);
    if (!events || typeof callId !== 'string' || !callId) return null;
    let activeTurn = null, activeStep = null, root = null, target = null;
    const stepOwners = new Map();
    let rootCount = 0, targetCount = 0;
    for (const event of events) {
      if (event?.type === 'turn/start') { activeTurn = event.data?.turn; activeStep = null; }
      if (event?.type === 'step/start' && event.data?.turn === activeTurn) {
        const prior = activeStep;
        activeStep = event.data.step;
        const inherited = stepOwners.get(`${activeTurn}:${prior}`);
        stepOwners.set(`${activeTurn}:${activeStep}`, { owner: inherited?.owner ?? null,
          ambiguous: inherited?.ambiguous ?? false, seen: new Set() });
      }
      const currentStep = stepOwners.get(`${activeTurn}:${activeStep}`);
      if (event?.type === 'user/message' && event.data?.source?.kind === 'user'
        && currentStep) {
        const rpc = event.data.source.rpcId;
        if (!currentStep.seen.size) currentStep.owner = rpc;
        else if (!currentStep.seen.has(rpc)) currentStep.ambiguous = true;
        currentStep.seen.add(rpc);
      }
      if (event?.type === 'tool/call' && event.data?.callId === (rootCallId ?? callId)) {
        rootCount++;
        const owner = stepOwners.get(`${event.data.turn}:${event.data.step}`);
        root = { event, owner: owner?.owner, ambiguous: owner?.ambiguous,
          turn: activeTurn };
      }
      if (event?.type === 'tool/code-dispatch-start' && event.data?.subCallId === callId) {
        targetCount++;
        target = { event, owner: currentStep?.owner,
          ambiguous: currentStep?.ambiguous, turn: activeTurn };
      }
    }
    return { events, root, target, rootCount, targetCount };
  }
  function boundCall(agent, callId, rootCallId, rpcId, record, facts) {
    const { events, root, target, rootCount, targetCount } = facts;
    const mode = modeOf(agent);
    if (!record || !['native', 'ptc'].includes(mode)
      || mode === 'ptc' && record.kind !== 'development'
      || rootCount !== 1 || root?.ambiguous || root.owner !== rpcId
      || root.event.data.turn !== root.turn
      || !Number.isSafeInteger(root.event.data.step)
      || !durableUser(events, rpcId, record.bodyHash, root.turn)) return false;
    if (mode === 'native') return callId === (rootCallId ?? callId) && root.event.data.name !== 'run_code';
    if (root.event.data.name !== 'run_code') return false;
    if (callId === rootCallId) return true;
    return targetCount === 1 && !target?.ambiguous && target?.owner === rpcId
      && target.turn === root.turn && callId.startsWith(`${rootCallId}:ptc:`)
      && target.event.seq > root.event.seq;
  }
  async function notifyFailure(record, outcome) {
    if (!outcome?.reason || record.failureSent || typeof record.onFailure !== 'function') return;
    record.failureSent = true; // An uncertain send is never retried as a second phone reply.
    try { await record.onFailure(outcome); } catch { /* Existing Weixin delivery owns its diagnostics. */ }
  }
  return Object.freeze({
    close() { closed = true; origins.clear(); lastSearch = null; },
    isControl(text) { return musicIntentKind(text) === 'control'; },
    isBusiness(text) { return businessIntentKind(text) === 'business'; },
    matches(incomingBot, incomingSender, incomingSession) {
      return incomingBot === botId && incomingSender === senderId && incomingSession === sessionId;
    },
    belongs(incomingBot, incomingSender) {
      return incomingBot === botId && incomingSender === senderId;
    },
    revokeOrigin(rpcId) { origins.delete(rpcId); },
    checkInbound({ botId: incomingBot, senderId: incomingSender,
      sessionId: incomingSession, text, hasMedia = false } = {}) {
      if (incomingSession === sessionId && (incomingBot !== botId || incomingSender !== senderId))
        return { kind: 'reject', reason: 'MUSIC_HOST_SESSION_SHARED' };
      if (incomingBot !== botId || incomingSender !== senderId
        || !(musicIntentKind(text) || businessIntentKind(text)))
        return { kind: 'allow' }; // Other people and explicit development work keep their route.
      if (businessActionKind(text) === 'unsupported-control')
        return { kind: 'reject', reason: 'TVMUSIC_BUSINESS_UNSUPPORTED' };
      if (closed) return { kind: 'reject', reason: 'MUSIC_HOST_TOOLS_UNAVAILABLE' };
      if (hasMedia) return { kind: 'reject', reason: 'MUSIC_HOST_INPUT_UNSUPPORTED' };
      if (incomingSession !== sessionId) return { kind: 'reject', reason: 'MUSIC_HOST_SESSION_UNBOUND' };
      const agent = agentFor(sessionId);
      if (!agent) return { kind: 'reject', reason: 'MUSIC_HOST_TOOLS_UNAVAILABLE' };
      if (modeOf(agent) !== 'native') return { kind: 'reject', reason: 'MUSIC_HOST_MODE_UNSUPPORTED' };
      if (!toolsReady(agent)) return { kind: 'reject', reason: 'MUSIC_HOST_TOOLS_UNAVAILABLE' };
      return { kind: 'allow' };
    },
    admit({ channel, botId: incomingBot, senderId: incomingSender, sessionId: incomingSession,
      rpcId, text, onFailure } = {}) {
      const eventId = eventIdOf(rpcId);
      if (closed || channel !== 'weixin' || incomingBot !== botId || incomingSender !== senderId
        || incomingSession !== sessionId || !UUID.test(eventId ?? '')
        || typeof text !== 'string' || !text.trim() || text.length > 8_000) return false;
      prune();
      const bodyHash = digest(text);
      const prior = origins.get(rpcId);
      if (prior) return prior.bodyHash === bodyHash;
      const musicAction = musicIntentKind(text);
      if (!selectionIndex(text)) lastSearch = null; // Any intervening human message revokes ordinal context.
      const businessAction = businessActionKind(text);
      const kind = musicAction ? 'music' : businessAction ? 'business'
        : explicitDevelopmentWork(text) ? 'development' : 'unclassified';
      const admission = ++nextAdmission;
      origins.set(rpcId, { sessionId, senderId, eventId, bodyHash,
        kind, musicAction, businessAction, originalText: text,
        admission, expiresAt: now() + ORIGIN_TTL_MS,
        ...(typeof onFailure === 'function' ? { onFailure } : {}) });
      if (kind === 'music' || kind === 'business') latestMusicAdmission = admission;
      prune();
      return true;
    },
    revokeSession(id) { if (id === sessionId) {
      origins.clear(); latestMusicAdmission = 0; lastSearch = null;
    } },
    failureFor(rpcId) {
      prune();
      const record = origins.get(rpcId);
      if (closed || !['music', 'business'].includes(record?.kind)) return null;
      if (record.admission < latestMusicAdmission) return { reason: 'MUSIC_HOST_STALE_EVENT' };
      return Object.hasOwn(record, 'outcome') ? record.outcome
        : { reason: record.kind === 'business' ? 'TVMUSIC_BUSINESS_NO_RESULT' : 'MUSIC_HOST_NO_RESULT' };
    },
    async completeTurn(agent, turn) {
      const events = eventsOf(agent);
      if (closed || agent?.id !== sessionId || !events || !Number.isSafeInteger(turn)) return;
      for (const [rpcId, record] of origins) {
        if (!['music', 'business'].includes(record.kind) || record.failureSent || !record.onFailure
          || !durableUser(events, rpcId, record.bodyHash, turn)) continue;
        const outcome = record.admission < latestMusicAdmission
          ? { reason: 'MUSIC_HOST_STALE_EVENT' }
          : Object.hasOwn(record, 'outcome') ? record.outcome
            : { reason: record.kind === 'business' ? 'TVMUSIC_BUSINESS_NO_RESULT' : 'MUSIC_HOST_NO_RESULT' };
        await notifyFailure(record, outcome);
      }
    },
    async recordOutcome({ agent, callId, rootCallId, name, arguments: toolArgs } = {}, result) {
      if (!MUSIC_TOOLS.has(name) && !BUSINESS_TOOLS.has(name) || agent?.id !== sessionId) return;
      const facts = callFacts(agent, callId, rootCallId), rpcId = facts?.root?.owner;
      const record = recordFor(agent, rpcId, eventIdOf(rpcId));
      if (!record || record.admission < latestMusicAdmission
        || !facts || !boundCall(agent, callId, rootCallId, rpcId, record, facts)) return;
      const value = result?.value ?? result;
      if (BUSINESS_TOOLS.has(name)) {
        if (record.kind !== 'business') return;
        const expected = digest(`tvmusic-business-v1:${record.eventId}`);
        const status = value?.state === 'SUCCEEDED' && value?.result?.status === 'UNAVAILABLE'
          ? 'TVMUSIC_BUSINESS_UNSUPPORTED'
          : value?.state === 'SUCCEEDED' ? 'TVMUSIC_BUSINESS_ACCEPTED'
            : value?.state === 'IN_PROGRESS' ? 'TVMUSIC_BUSINESS_PREPARING'
              : 'TVMUSIC_BUSINESS_UNKNOWN';
        record.outcome = { reason: result?.isError ? 'TVMUSIC_BUSINESS_UNKNOWN'
          : value?.status === 'CLARIFY' ? 'TVMUSIC_BUSINESS_CLARIFY'
            : value?.status === 'CONFLICT' ? 'TVMUSIC_BUSINESS_CONFLICT'
            : value?.status === 'UNSUPPORTED' && name === 'tvmusic_task_control'
            ? 'TVMUSIC_BUSINESS_UNSUPPORTED'
            : value?.request_id === expected ? status : 'TVMUSIC_BUSINESS_UNKNOWN' };
        return;
      }
      if (record.kind !== 'music') return;
      if (name === 'tvmusic_music_search') {
        const choices = Array.isArray(value?.candidates) ? value.candidates
          .filter(row => typeof row?.name === 'string' && row.name.length <= 60
            && /^[a-f\d]{64}$/.test(row.id) && !/[\/\r\n]|https?:|token|secret/i.test(row.name))
          .slice(0, 3) : [];
        const names = choices.map((row, index) => `${index + 1}. ${row.name}`);
        record.outcome = { reason: result?.isError ? 'MUSIC_HOST_TOOL_FAILED'
          : value?.id !== record.eventId ? 'MUSIC_HOST_RESULT_MISMATCH'
            : value?.status === 'UNKNOWN' ? 'MUSIC_HOST_SEARCH_UNKNOWN'
              : value?.status === 'CLARIFY' ? 'MUSIC_HOST_CLARIFY'
              : names.length ? 'MUSIC_HOST_CLARIFY' : 'MUSIC_HOST_PREPARING',
        ...(names.length ? { instruction: names.join('；') } : {}) };
        if (!result?.isError && value?.id === record.eventId && record.admission === nextAdmission
          && ['RESULTS', 'EXISTING'].includes(value.status) && names.length
          && typeof value.title === 'string' && value.title && typeof value.artist === 'string'
          && value.artist)
          lastSearch = { search_id: value.id, title: value.title, artist: value.artist,
            candidates: choices.map(row => ({ id: row.id, name: row.name })),
            expiresAt: now() + 10 * 60_000 };
        return;
      }
      const rawInstruction = typeof value?.instruction === 'string' ? value.instruction.trim() : '';
      const instruction = rawInstruction.length > 0 && rawInstruction.length <= 180
        && !/[\r\n]|https?:|\/Users\/|[A-Za-z]:\\|token|secret|capability/i.test(rawInstruction)
        ? rawInstruction : null;
      let reason = resultReason(value?.status, result?.isError);
      if (!result?.isError && name === 'tvmusic_music_play' && value?.id !== record.eventId)
        reason = 'MUSIC_HOST_RESULT_MISMATCH';
      if (!result?.isError && name !== 'tvmusic_music_play') {
        const requested = typeof toolArgs?.intent_id === 'string' ? toolArgs.intent_id : null;
        if (value?.status === 'NO_ACTIVE' && !requested) reason = 'MUSIC_HOST_NO_ACTIVE';
        else if (!requested && !value?.id && value?.status === 'UNKNOWN')
          reason = name === 'tvmusic_music_control' ? 'MUSIC_HOST_OUTPUT_UNKNOWN' : 'MUSIC_HOST_OTHER_UNKNOWN';
        else if (!value?.id || requested && value.id !== requested) reason = 'MUSIC_HOST_RESULT_MISMATCH';
        else reason = name === 'tvmusic_music_control' && value.status === 'UNKNOWN'
          ? 'MUSIC_HOST_OUTPUT_UNKNOWN' : otherIntentReason(value.status);
      }
      record.outcome = { reason, ...(instruction ? { instruction } : {}) };
    },
    async verify({ agent, message, turn } = {}) {
      const rpcId = message?.source?.rpcId, eventId = eventIdOf(rpcId);
      if (message?.role !== 'user' || message.source?.kind !== 'user'
        || !Number.isSafeInteger(turn) || !UUID.test(eventId ?? '')) return null;
      const record = recordFor(agent, rpcId, eventId), body = humanText(message);
      // pre-step precedes durable user/message. The Host-created ingress claim
      // proves this admission; verifyExecution later requires both log events.
      if (!record || body === null || digest(body) !== record.bodyHash) return null;
      const index = selectionIndex(body), choice = index && lastSearch?.expiresAt > now()
        ? lastSearch.candidates[index - 1] : null;
      return { human: true, channel: 'weixin', session_id: sessionId, rpc_id: rpcId,
        sender_id: record.senderId, content_sha256: record.bodyHash,
        original_text: record.originalText, business_action: record.businessAction,
        ...(choice && /^[a-f\d]{64}$/.test(choice.id) ? { selection: {
          search_id: lastSearch.search_id, candidate_id: choice.id,
          title: lastSearch.title, artist: lastSearch.artist, index } } : {}) };
    },
    async verifyExecution({ agent, callId, rootCallId, rpcId, eventId } = {}) {
      if (typeof callId !== 'string' || !callId || !UUID.test(eventId ?? '')
        || eventIdOf(rpcId) !== eventId) return false;
      const record = recordFor(agent, rpcId, eventId), facts = callFacts(agent, callId, rootCallId);
      return facts !== null && !(record && record.admission < latestMusicAdmission)
        && boundCall(agent, callId, rootCallId, rpcId, record, facts);
    },
    guardTool({ agent, callId, rootCallId, name, arguments: toolArgs } = {}) {
      if (agent?.id !== sessionId) return undefined;
      if (closed) return 'MUSIC_HOST_ORIGIN_UNKNOWN';
      const facts = callFacts(agent, callId, rootCallId), rpcId = facts?.root?.owner;
      const record = recordFor(agent, rpcId, eventIdOf(rpcId));
      if (record && record.admission < latestMusicAdmission)
        return 'MUSIC_HOST_STALE_EVENT';
      if (!facts || !record || !boundCall(agent, callId, rootCallId, rpcId, record, facts)
        || (callId === (rootCallId ?? callId) ? facts.root.event.data.name : facts.target?.event.data.name) !== name)
        return 'MUSIC_HOST_ORIGIN_UNKNOWN';
      if (record.kind === 'development') return SAFE_READS.has(name)
        ? undefined : 'MUSIC_HOST_LOCAL_FALLBACK_DENIED';
      return record.kind === 'music' && MUSIC_TOOLS.has(name)
          && record.musicAction !== 'ambiguous'
          && (record.musicAction !== 'search' || name === 'tvmusic_music_search')
          && (record.musicAction !== 'status' || name === 'tvmusic_music_playback_status')
          && (record.musicAction !== 'control' || !['tvmusic_music_play', 'tvmusic_music_search'].includes(name))
          && (record.musicAction !== 'play' || name !== 'tvmusic_music_control')
        || record.kind === 'music' && record.musicAction === 'ambiguous' && SAFE_READS.has(name)
        || record.kind === 'business' && (businessAllowed(record.businessAction, name, toolArgs)
          || SAFE_READS.has(name))
        || record.kind === 'unclassified' && SAFE_READS.has(name)
        ? undefined : 'MUSIC_HOST_LOCAL_FALLBACK_DENIED';
    },
  });
}

/** Optional Host service, installed only with an explicitly scoped Weixin route. */
export function installMusicOrigin(ctx, config, env = process.env) {
  assertTvmusicHostEnvironment(env); // No secret values are logged or copied into Agent tools.
  if (env.TVMUSIC_IM_SESSION_ID && env.TVMUSIC_IM_SESSION_ID !== config?.sessionId)
    throw Error('MUSIC_HOST_ENVIRONMENT_UNSAFE');
  const root = ctx?.root ?? ctx;
  if (typeof ctx?.provide !== 'function' || typeof root?.on !== 'function'
    || typeof ctx?.effect !== 'function') throw Error('MUSIC_HOST_CONTEXT_REQUIRED');
  const agents = root.agents ?? root.get?.('agents');
  const tools = root.tools ?? root.get?.('tools');
  if (typeof agents?.get !== 'function' || typeof tools?.get !== 'function'
    || typeof tools.guard !== 'function')
    throw Error('MUSIC_HOST_TOOLS_REQUIRED');
  const registry = createMusicOriginRegistry({ ...config,
    agentFor: id => agents.get(id),
    modeOf: agent => tools.get('run_code', agent) ? 'ptc' : 'native',
    // This household route deliberately does not claim to exclude arbitrary
    // same-UID local code. It does require the scoped tools and original Weixin
    // proof before the Agent may dispatch a TVmusic business call.
    toolsReady: agent => [...MUSIC_TOOLS, ...BUSINESS_TOOLS, ...REQUIRED_READS]
      .every(name => Boolean(tools.get(name, agent))),
  });
  let stopGuard, stopExecute, stopSession, stopDisposed, retired = false;
  const retire = () => { if (retired) return; retired = true;
    stopDisposed?.(); stopSession?.(); stopExecute?.(); stopGuard?.(); };
  const cleanup = () => {
    registry.close();
    // The Weixin bridge can outlive its owner briefly. Keep a root-owned deny
    // guard for an already admitted Agent until it is disposed, not just until
    // this child plugin's effect ends.
    if (!agents.get(config.sessionId)) return retire();
    if (!stopDisposed) stopDisposed = root.on('agent/disposed', ({ agent }) => {
      if (agent?.id === config.sessionId) retire();
    }, { global: true });
    if (!agents.get(config.sessionId)) retire();
  };
  try {
    stopGuard = tools.guard(exec => registry.guardTool(exec));
    stopExecute = root.on('tools/execute', async (exec, next) => {
      const reason = registry.guardTool(exec);
      if (reason) throw Error(reason);
      try {
        const result = await next();
        await registry.recordOutcome(exec, result);
        return result;
      } catch (error) {
        await registry.recordOutcome(exec, { isError: true });
        throw error;
      }
    }, { global: true });
    stopSession = root.on('session/event', (session, event) => {
      if (session?.id === config.sessionId && event?.type === 'turn/end')
        return registry.completeTurn({ id: session.id, session }, event.data?.turn);
    }, { global: true });
    ctx.provide('dshImMusicOrigin', Object.freeze({ contractVersion: 1,
      base: env.TVMUSIC_HARNESS_URL,
      verify: registry.verify, verifyExecution: registry.verifyExecution }));
    ctx.effect(() => cleanup, 'dsh-im: scoped music origin');
  } catch (error) { cleanup(); throw error; }
  return registry;
}
