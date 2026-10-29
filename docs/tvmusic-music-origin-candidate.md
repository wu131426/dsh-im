# TVmusic IM origin Host candidate (not installed)

## 2026-10-28 最小拆分候选（未安装）

TVmusic 专属分类、工具白名单、来源登记、结果解释和手机文案现由
`tvmusic-os/dsh/weixin-origin-candidate` 独立插件持有。dsh-im 的微信桥只接收
`verifiedRoute` 通用接口；Host 配置必须显式设置
`verifiedRouteService: tvmusicWeixinRoute`，并在**私有测试 profile**中给 TVmusic
origin 插件配置 `botId`、原始微信 `from_user_id`（`senderId`，不是 `p2p:` 会话键）
和现有 `sessionId`；作用域工具插件也需同一 `sessionId`。这些身份值不得写进 Git。
旧 `musicOrigin` 配置现在启动即拒绝，不能静默当作已接线。缺服务、缺作用域或
业务合同不匹配时不得提供写工具或本机播放器退路。正式 desktop profile 未改；
下文旧 `musicOrigin` 安装说明仅为历史记录，不能照做。

2026-10-27 通用微信入口修正：`musicOrigin.senderId` 必须是已有微信入口的
原始 `from_user_id`，而非持久 Session 键的 `p2p:` 前缀版本。实测错误绑定曾
在 Agent 前回“这个会话已绑定指定点歌入口”，TVmusic 未收到意图。守卫现按
每条消息分流：TVmusic 音乐/影视查询和动作仍核原消息及工具调用，只能用
TVmusic 业务白名单；普通聊天、其它 OS 原有请求及不含 TVmusic 意图的批量
消息保持原 Harness 权限。其它聊天的 TVmusic 请求、无工具/合同和混合本机
播放器回退仍安全拒绝。此更新只是候选代码与模拟回归，需新固定 SHA 的另行
现场切换；旧版真实授权不自动延续。

2026-10-27 household business candidate: TVmusic PR #39 retired its shared
bearer route. This Host binds the verified Weixin sender/body and exact durable
tool call to four music and three media-write tools, and requires all eight
TVmusic query tools. Original text, action, title/year/season and selected
identity are rechecked before a durable movie/series/task command; uncertain
outcomes read the original receipt, never resubmit. Music searches do not
download; speaker control never falls back to Mac audio. The TVmusic route is
opt-in for one bot/sender/Session, not a TVmusic-only Harness Session. The
earlier real Weixin attempts were rejected before Agent work due to the wrong
sender representation; no successful Weixin→TVmusic or speaker test has run.
The older installation instructions below are historical; current
activation/rollback gates are in TVmusic PR #39
`docs/TVMUSIC_BUSINESS_ENTRY_CANDIDATE.md`.

This does **not** claim strong identity isolation among processes of the same
macOS user. A code tool can run the signed DSH binary with
`ELECTRON_RUN_AS_NODE=1`, and same-UID code can call TVmusic's loopback HTTP.
The Host guard limits the approved Agent path, not all local processes. DSH
receives only a fixed loopback URL, never the Sound Pro password or the entire
Infisical environment. Do not use the old bearer launch recipe.

## Historical PR461-only design (not the current combined candidate)

This candidate changes only the existing Weixin → dsh-im → Harness path. It does
not search or download music, control a real speaker, open an audio port, or
change the TVmusic web player. It is opt-in: absent `musicOrigin` configuration,
the existing channels and tool policies are unchanged.

## Exact scope and version

- Source repository: `xmanrui/dsh-im`, candidate based on main `7e78d771e33ff655a91f127fdd04e90440403e71`
  (`package.json` 5.6.0). The installed desktop profile remains `@xmanrui/dsh-im`
  5.4.0 (`v5.4.0` tag `fff9cb2be0444adba9142b6bdfe31308ac0b44bf`).
  A future installation would therefore be a reviewed plugin-version change,
  not a silent patch of the installed directory. Harness core remains untouched.
- Compatibility target: TVmusic Draft PR #39 Head
  `961bce77b8788974ba1eb55bf2dc40d1f3883f2a`, tree
  `c6023fbcaa5a97c28ed6c7417a7317d86e47508f`. Its candidate expects
  `dshImMusicOrigin.verify` and `verifyExecution` and does not register music
  writes if that service is absent. No production profile includes either
  candidate today.
- Opt-in Host config must name **one exact** Weixin bot, sender and existing
  Session (`musicOrigin.botId`, `senderId`, `sessionId`). These are identifiers,
  not model arguments or permission claims. Never configure a Session shared
  with a desktop user, another bot, sender or channel. No secret is stored in
  this config. This candidate does not implement a cross-channel exclusive
  binding query, so exclusive ownership is an installation preflight, not a
  claimed runtime proof.

## Proof and failure boundary

The authenticated Weixin bridge supplies its sender and original plain body.
After the existing workspace binding lock resolves the Session, `HarnessClient`
mints the actual `weixin-UUID` (or `weixin-steer-UUID`) and admits a bounded,
in-memory sender/body-digest record **before** submitting the prompt. Neither a
model argument nor `<dsh_im_source>` can create that record. `verify` checks
it at `agent/pre-step`, before `user/message` is durable. `verifyExecution`
requires the later durable `user/message`, `step/start` and exact `tool/call`
callId/turn/step. Repeated verification of the same call is read-only; a newer
music admission fences older queued music and local-capable development calls.
Ambiguous same-step human messages, unknown provenance, expired records and
changed tool mode fail closed. A Host-owned root guard and a `tools/execute`
recheck remain independent of the TVmusic overlay so a hot-unloaded music tool
does not make bash a fallback.

Normal text, automatic steer and explicit `/steer` pass the same ingress gate.
The limited safety classifier mirrors PR #39's recognized intent forms and
is checked by a cross-repo corpus; it does **not** select songs or replace the
Agent's language understanding. Unknown text in the approved Session has no
local-tool authority unless it is an explicit development task. A new/unbound
Session, missing tools, PTC mode or text with media gets a fixed Weixin reply
before Agent submission. Approved-chat batch synthesis is rejected instead of
being misrepresented as one original human message. The Host uses the
canonical TVmusic tool value for a short fixed phone status: preparing, file
ready, speaker command accepted, device-linked playing, paused, stopped,
clarification, failed or UNKNOWN. ACCEPTED and READY do **not** claim audible
playback. Missing tool result is phrased as neither a successful playback nor a
definitely submitted request. Stop/pause failure explicitly says speaker state
is unconfirmed, and a late older music answer is labelled superseded instead
of relaying the model's old claim.
For a successful steer admission, the Host retains a one-shot return route to
the original Weixin sender: an UNKNOWN/failed tool result, or a turn end with no
TVmusic result, sends a fixed follow-up. A later music admission replaces the
old reply with a superseded notice. Delivery failure is not retried blindly.

Ordinary single-message development tasks in the approved native Session can
still use their usual tools when both Host and TVmusic classify them as
explicit development. The approved chat's **batch mode**, including nonmusic
batches, is conservatively rejected: its synthetic `/send` prompt is not one
original human message and TVmusic PR #39 cannot yet attest individual batch
members. This is a known user-visible limitation, not a claim that every
nonmusic workflow is unchanged. Music-related code requests that PR #39 marks
unclassified are also conservatively unable to run bash in this Session;
another unbound development Session remains unaffected. A separate coordinated
contract would be needed before enabling those cases without weakening the
music safety gate.

The installed Host's `run_code` visibility is used as the PTC-mode signal
because DSH 0.2.1-rc.2 reserves that transport for non-native presentation.
Music is never routed through `run_code`; verified ordinary development may use
the original Host policy. **Before installation**, confirm this mode and the
root guard's scope on the exact target Host/profile. The classifier cannot
prove every possible colloquial sentence, nor can aborting a new request prove
an already-started local process or physical speaker has stopped. Those cases
remain UNKNOWN/manual confirmation, never an automatic Mac fallback.

## Isolated evidence and remaining gates

Run `npm run check` (build, all tests, package verification), the music-origin,
Weixin bridge, Host lifecycle and control-command tests, and the optional
cross-repo integration with `TVMUSIC_PR39_ROOT` pointing to the exact PR #39
checkout. The integration uses genuine source modules and a fake Host scheduler,
search/cache responses and Sound Pro; labels such as 七里香 READY and 暗里着迷
SEARCHING are **samples**, not real media evidence. No real song, download,
device, credential or 4318 address is touched. GitHub Actions billing remains
separate from local results; do not claim CI PASS.

This repository's `src/channels/shared/AGENTS.md` requires new Chinese `t()`
keys in both English and Russian dictionaries and their existing mergers; the
candidate supplies them. The root has no `AGENTS.md`.

## One-time installation and rollback request — not authorized here

1. Approve the reviewed Host PR and a **fixed** dsh-im release/SHA upgrade
   from installed 5.4.0, plus the separately reviewed TVmusic PR #39 candidate.
   Snapshot desktop profile, package identity, current Agent/session bindings,
   tool list, and the prior recoverable profile/release. Confirm the approved
   Session is exclusive, native-mode and idle; verify the Host proof service
   and fixed failure replies before registering the three scoped music tools.
   No all-session write permission and no global bash disablement.
2. Separately approve one existing READY cache song for a real phone → single
   living-room Sound Pro request, then pause/stop and physical-state checks.
   The speaker identity/credentials must be reused securely. Any 4318 private
   audio URL sent through Xiaomi Cloud needs its own explicit address, source,
   lifetime and revocation approval; a fake-device test does not authorize it.
3. Only after that, separately approve one specified noncached song with the
   TVmusic bounded search/prepare budget. Check the original event/intent and
   device evidence; absence or UNKNOWN is not success.
4. To recover: stop new Weixin ingress, inspect outstanding intent/device state,
   then stop/dispose the approved Agent **before** unloading the Host guard or
   hot-replacing the plugin. A closed registry retains a root-owned deny
   tombstone until Agent disposal; hot reload into that still-live Session will
   deliberately block tools. Restore the saved profile/release only after this
   quiescence and compatibility check. Never switch to Mac audio or assume a
   Stop HTTP 200 proves silence.

The root tombstone fences queued calls, not an already-started local process.
Before a real installation, independently check no previous Mac player remains
active and confirm the approved Session is exclusive across all channels; the
candidate can reject another Weixin chat bound to the same Session, but cannot
prove every desktop/third-party binding from its local registry alone.
