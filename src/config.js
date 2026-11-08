import path from 'node:path';

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function idList(env, name, pattern) {
  const value = env[name]?.trim();
  if (!value) return new Set();

  const ids = value.split(',').map((id) => id.trim());
  if (ids.some((id) => !pattern.test(id))) throw new Error(`${name} is invalid`);
  return new Set(ids);
}

export function loadConfig(env = process.env) {
  const botToken = required(env, 'SLACK_BOT_TOKEN');
  const appToken = required(env, 'SLACK_APP_TOKEN');
  const allowedUserIds = idList(env, 'SLACK_ALLOWED_USER_IDS', /^U[A-Z0-9]+$/);
  const allowedBotIds = idList(env, 'SLACK_ALLOWED_BOT_IDS', /^[AB][A-Z0-9]+$/);
  const allowedChannelId = required(env, 'SLACK_ALLOWED_CHANNEL_ID');
  const workspace = path.resolve(required(env, 'CURSOR_WORKSPACE'));
  const model = env.CURSOR_MODEL?.trim() || undefined;
  const statePath = path.resolve(env.SLACK_AGENT_STATE_PATH?.trim() || 'state/conversations.json');

  if (!botToken.startsWith('xoxb-')) throw new Error('SLACK_BOT_TOKEN is invalid');
  if (!appToken.startsWith('xapp-')) throw new Error('SLACK_APP_TOKEN is invalid');
  if (allowedUserIds.size === 0 && allowedBotIds.size === 0) {
    throw new Error('SLACK_ALLOWED_USER_IDS or SLACK_ALLOWED_BOT_IDS is required');
  }
  if (!/^[CG][A-Z0-9]+$/.test(allowedChannelId)) throw new Error('SLACK_ALLOWED_CHANNEL_ID is invalid');

  return {
    botToken,
    appToken,
    allowedUserIds,
    allowedBotIds,
    allowedChannelId,
    workspace,
    model,
    statePath,
  };
}
