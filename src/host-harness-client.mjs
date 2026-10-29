// Reuse the active Host's model/session transport without another Harness process.

import { isAbsolute } from 'node:path';

import { HarnessClient } from './channels/shared/harness-client.mjs';
import { harnessConnection } from '../plugin-src/host/harness-connection.mjs';

/**
 * A channel plugin supplies its own admission and per-Agent tool guard.
 * This client only creates/asks in an isolated Session on the current Host.
 */
export function createHostHarnessClient(ctx, { workspace, rpcIdPrefix } = {}) {
  if (!ctx?.typertGateway || typeof workspace !== 'string' || !isAbsolute(workspace)
    || typeof rpcIdPrefix !== 'string' || !/^[a-z][a-z-]{1,32}$/.test(rpcIdPrefix))
    throw Error('HOST_HARNESS_CLIENT_CONFIG');
  return new HarnessClient({ ...harnessConnection(ctx), workspace,
    ungroupedWorkspace: workspace, rpcIdPrefix, logPrefix: rpcIdPrefix,
    autostart: false });
}
