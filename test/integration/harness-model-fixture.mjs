// Opt-in isolated real-Harness-model fixture. Never load in a desktop profile.
// All TVmusic operations below use in-memory music, speaker and download fakes.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.TVMUSIC_PR39_ROOT;
if (!root?.startsWith('/') || !root.endsWith('/TVmusic-OS')) throw Error('MODEL_FIXTURE_ROOT_REQUIRED');
const { registerMusicActionsCandidate } = await import(pathToFileURL(join(root,
  'plugins/dsh-music-actions-candidate.mjs')).href);
const { registerBusinessActionsCandidate } = await import(pathToFileURL(join(root,
  'plugins/dsh-business-actions-candidate.mjs')).href);

export const name = 'tvmusic-isolated-model-fixture';
export const inject = ['tools'];
const digest = value => createHash('sha256').update(value).digest('hex');
const eventId = (agentId, turn) => {
  const value = digest(`isolated-model:${agentId}:${turn}`).slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};
const output = { schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
const songs = new Map(), receipts = new Map(), active = new Map();
const audit = (operation, data) => console.error(`TVMUSIC_MODEL_FIXTURE=${JSON.stringify({ operation, ...data })}`);

function trustedContext(exec) {
  const events = exec.agent?.session?.snapshotEvents?.() ?? [];
  const call = events.findLast(row => row.type === 'tool/call' && row.data?.callId === exec.callId);
  let turn = null;
  const users = [];
  for (const event of events) {
    if (event.type === 'turn/start') turn = event.data?.turn;
    if (turn === call?.data?.turn && event.type === 'user/message' && event.data?.source?.kind === 'user')
      users.push(event.data);
  }
  if (!Number.isSafeInteger(call?.data?.turn) || users.length !== 1) throw Error('MODEL_FIXTURE_USER_REQUIRED');
  const text = users[0].content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? '';
  if (!text.trim()) throw Error('MODEL_FIXTURE_USER_REQUIRED');
  const id = exec.agent.id, current = call.data.turn;
  return { source: 'harness', human_request: true, event_id: eventId(id, current),
    previous_event_id: current > 1 ? eventId(id, current - 1) : null,
    session_hash: digest(`isolated-model:${id}`), human_text: text };
}

const musicClient = {
  async search(input) {
    audit('music.search', { id: input.id, title: input.title, artist: input.artist });
    return { id: input.id, title: input.title, artist: input.artist, status: 'RESULTS',
      candidates: input.title === '安静' ? [{ id: 'a'.repeat(64), name: '周杰伦 - 安静.flac' }]
        : input.title === '七里香' ? [{ id: 'b'.repeat(64), name: '周杰伦 - 七里香.flac' }] : [] };
  },
  async searchStatus(id) { return { id, status: 'RESULTS', candidates: [] }; },
  async begin(input, context) {
    const prior = songs.get(input.id);
    if (prior) return prior;
    const title = (input.title || '安静').replace('靜', '静');
    if (title !== '安静' || input.artist && !['周杰伦', '周杰倫'].includes(input.artist))
      return { id: input.id, status: 'CLARIFY', reason: '没有可信的同一版本歌曲。' };
    const row = { id: input.id, title, artist: '周杰伦', target: 'soundpro',
      status: 'ACCEPTED', preparation: 'READY', playback_evidence: 'DEVICE_ACCEPTED_ONLY' };
    songs.set(input.id, row); active.set(context.session_hash, row);
    audit('music.play', { id: input.id, title, target: row.target });
    return row;
  },
  async status(id) { return songs.get(id) ?? { id, status: 'UNKNOWN' }; },
  async active(context) { return active.get(context.session_hash) ?? { status: 'NO_ACTIVE' }; },
  async control(id, action, context) {
    const row = active.get(context.session_hash);
    if (row?.id !== id) return { status: 'NO_ACTIVE' };
    if (!['pause', 'resume', 'stop'].includes(action)) throw Error('MODEL_FIXTURE_ACTION_INVALID');
    if (row.control_command?.action === 'stop' || row.control_command?.action === action
      || action === 'resume' && (row.control_command?.action !== 'pause'
        || row.device_report !== 'PAUSED')) return row;
    const updated = { ...row, status: 'UNKNOWN', code: 'OUTPUT_CONTROL_UNKNOWN',
      control_command: { action, accepted: true },
      ...(action === 'pause' ? { device_report: 'PAUSED' }
        : row.device_report ? { device_report: row.device_report } : {}),
      playback_evidence: 'NONE' };
    songs.set(id, updated); active.set(context.session_hash, updated);
    audit(`music.${action}`, { id, status: updated.status, device_report: updated.device_report });
    return updated;
  },
};

const following = new Set();
const movies = [
  { tmdb_id: 11, title: '沙丘', year: 1984, media_type: 'movie', display_type: '电影', genre: '科幻' },
  { tmdb_id: 12, title: '沙丘', year: 2021, media_type: 'movie', display_type: '电影', genre: '科幻' },
];
const shows = [
  { tmdb_id: 20, title: '三体', year: 2023, media_type: 'series', display_type: '剧集' },
  { tmdb_id: 30, title: '歌手', year: 2025, media_type: 'variety', display_type: '综艺' },
];
const businessClient = {
  async panel() { return { app: 'tvmusic', schema_version: 1, items: [...movies, ...shows] }; },
  async search(query) { audit('media.search', { query }); return { items: [...movies, ...shows]
    .filter(row => `${row.title}${row.genre ?? ''}`.includes(query) || query.includes(row.title)) }; },
  async movie(id) { return { item: movies.find(row => row.tmdb_id === id) ?? null }; },
  async movieResources(id) { return { tmdb_id: id, candidates: [{ source: 'fixture', status: 'AVAILABLE' }] }; },
  async series(id, season) { return { item: shows.find(row => row.tmdb_id === id) ?? null,
    seasons: [{ number: 1 }, { number: 2 }, { number: 3 }],
    episodes: [{ number: 1, imported: false, subtitle_state: 'NOT_IMPORTED', status: '找资源' },
      { number: 3, imported: false, subtitle_state: 'NOT_IMPORTED', status: '找资源' }],
    summary: { total: 2, imported: 0, chinese_ready: 0, subtitle_unverified: 0, status: '找资源' },
    ...(season === undefined ? {} : { selected_season: season,
      monitored: following.has(`${id}:${season}`) }) }; },
  async tasks() { return { items: [] }; },
  async submit(command) {
    if (command.operation === 'series.action' && ['follow_season', 'unfollow_season'].includes(command.payload.action)) {
      const key = `${command.payload.tmdb_id}:${command.payload.season_number}`;
      if (command.payload.action === 'follow_season') following.add(key); else following.delete(key);
    }
    if (!receipts.has(command.request_id)) receipts.set(command.request_id, { schema_version: 1,
      request_id: command.request_id, operation: command.operation, state: 'SUCCEEDED',
      result: { status: command.operation === 'series.action' && command.payload.action === 'follow_season'
        ? 'FOLLOWING' : command.operation === 'series.action' && command.payload.action === 'unfollow_season'
          ? 'UNFOLLOWED' : 'DOWNLOADING' } });
    audit('media.submit', { request_id: command.request_id, operation: command.operation,
      payload: command.payload });
    return receipts.get(command.request_id);
  },
  async receipt(id) { return receipts.get(id) ?? { schema_version: 1, request_id: id, state: 'NOT_FOUND' }; },
};

export function apply(ctx) {
  const disposers = [];
  const register = (name, description, properties, execute) => {
    const dispose = ctx.tools.register({ name, description,
      parameters: { type: 'object', properties, additionalProperties: false }, output,
      timeoutMs: 15000, isConcurrencySafe: () => true,
      async execute(args, exec) { exec.signal.throwIfAborted(); trustedContext(exec); return execute(args); } });
    if (typeof dispose === 'function') disposers.push(dispose);
  };
  register('tvmusic_panel', '只读获取当前 TVmusic 的候选快照，不下载。', {}, () => businessClient.panel());
  register('tvmusic_search', '按关键词或类型只读搜索电影、电视剧和综艺，返回真实候选身份和年份；不下载。纯找片只介绍候选，不自行发起确认下载；用户明确想看或追季时再用业务工具给一次准确确认。',
    { query: { type: 'string' } }, args => businessClient.search(args.query));
  register('tvmusic_movie', '按搜索结果中的 TMDb ID 只读查电影详情和年份，不下载。',
    { tmdb_id: { type: 'integer' } }, args => businessClient.movie(args.tmdb_id));
  register('tvmusic_movie_resources', '只读查电影资源候选，不下载。',
    { tmdb_id: { type: 'integer' } }, args => businessClient.movieResources(args.tmdb_id));
  register('tvmusic_series', '按 TMDb ID 和可选季号只读查电视剧或综艺季集详情，不下载、不追季。',
    { tmdb_id: { type: 'integer' }, season_number: { type: 'integer' } },
    args => businessClient.series(args.tmdb_id, args.season_number));
  register('tvmusic_tasks', '只读查 TVmusic 任务进度。', {}, () => businessClient.tasks());
  register('tvmusic_receipt', '只读查原业务回执。',
    { request_id: { type: 'string' } }, args => businessClient.receipt(args.request_id));
  register('content_os_read', '隔离的其他 OS 只读查询示例，不经 TVmusic，不触碰真实 Content OS。',
    { query: { type: 'string' } }, args => ({ source: 'fake-content-os', query: args.query, status: 'READ_ONLY' }));
  disposers.push(registerMusicActionsCandidate(ctx, { trustedContext, client: musicClient }));
  disposers.push(registerBusinessActionsCandidate(ctx, { trustedContext, clientForExec: () => businessClient }));
  disposers.push(ctx.tools.guard(exec => ['content_os_read'].includes(exec.name)
    || exec.name?.startsWith('tvmusic_') ? undefined : 'MODEL_FIXTURE_NON_TVMUSIC_DENIED'));
  const close = () => { for (const dispose of disposers.reverse()) dispose?.(); disposers.length = 0; };
  ctx.effect?.(() => () => close(), 'isolated TVmusic model fixture');
  return close;
}
