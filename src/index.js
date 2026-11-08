import { App } from '@slack/bolt';
import { loadConfig } from './config.js';
import { askAgent, createChat, initializeChat } from './cursor-agent.js';
import { openSessions } from './sessions.js';
import { toSlackMrkdwn } from './slack-markdown.js';
import { shouldProcessMessage, shouldStartChat, slackMessageIdentity } from './slack-message-policy.js';

const config = loadConfig();
const sessions = await openSessions(config.statePath);
const app = new App({
  token: config.botToken,
  appToken: config.appToken,
  socketMode: true,
});
const threadQueues = new Map();

function threadKey(teamId, channelId, threadTs) {
  return `${teamId}:${channelId}:${threadTs}`;
}

function enqueue(key, operation) {
  const previous = threadQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  threadQueues.set(key, current);
  current.finally(() => {
    if (threadQueues.get(key) === current) threadQueues.delete(key);
  }).catch(() => {});
  return current;
}

function messageText(text) {
  return (text ?? '').replace(/<@[A-Z0-9]+>/g, '').trim();
}

function log(operation, fields = {}) {
  process.stdout.write(`${JSON.stringify({ operation, ...fields })}\n`);
}

async function react(client, channel, timestamp, name, method) {
  try {
    await client.reactions[method]({ channel, timestamp, name });
  } catch {
    log('slack_reaction_failed', { method, name });
  }
}

async function handleMessage({ event, body, client, isMention }) {
  if (!shouldProcessMessage({ channelType: event.channel_type, isMention, text: event.text })) return;

  const isDm = event.channel_type === 'im';
  const isBot = typeof event.bot_id === 'string' && event.bot_id.length > 0;
  const isAllowedBot = isBot && (
    config.allowedBotIds.has(event.bot_id)
    || config.allowedBotIds.has(event.bot_profile?.app_id)
  );
  if (isBot ? !isAllowedBot : !config.allowedUserIds.has(event.user)) return;
  if (!isDm && event.channel !== config.allowedChannelId) return;
  if (event.subtype && (!isBot || event.subtype !== 'bot_message')) return;

  const replyThreadTs = isDm ? event.thread_ts : (event.thread_ts ?? event.ts);
  const conversationTs = isDm ? 'direct' : (event.thread_ts ?? event.ts);
  const text = messageText(event.text);
  if (!text) return;

  const teamId = body.team_id;
  if (!teamId || !event.channel || !event.ts) return;
  const key = threadKey(teamId, event.channel, conversationTs);
  const messageIdentity = slackMessageIdentity({ teamId, channelId: event.channel, timestamp: event.ts });
  if (sessions.hasMessage(messageIdentity)) return;
  await sessions.recordMessage(messageIdentity);

  await enqueue(key, async () => {
    await react(client, event.channel, event.ts, 'hourglass_flowing_sand', 'add');
    try {
      let chatId = sessions.getChat(key);
      if (!chatId) {
        if (!shouldStartChat({ isMention, text: event.text })) return;
        chatId = await createChat();
        if (config.systemPrompt) {
          await initializeChat({
            chatId,
            prompt: config.systemPrompt,
            workspace: config.workspace,
            model: config.model,
          });
        }
        await sessions.setChat(key, chatId);
      }
      const responses = await askAgent({
        chatId,
        prompt: text,
        workspace: config.workspace,
        model: config.model,
      });
      for (const response of responses) {
        const reply = {
          channel: event.channel,
          text: toSlackMrkdwn(response).slice(0, 39_000),
        };
        if (replyThreadTs) reply.thread_ts = replyThreadTs;
        await client.chat.postMessage(reply);
      }
      await react(client, event.channel, event.ts, 'white_check_mark', 'add');
    } catch (error) {
      log('agent_message_failed', { error: error instanceof Error ? error.message : 'unknown error' });
      const reply = {
        channel: event.channel,
        text: 'I hit an error while handling that message. Check the bot log for details.',
      };
      if (replyThreadTs) reply.thread_ts = replyThreadTs;
      await client.chat.postMessage(reply);
      await react(client, event.channel, event.ts, 'x', 'add');
    } finally {
      await react(client, event.channel, event.ts, 'hourglass_flowing_sand', 'remove');
    }
  });
}

app.event('app_mention', async ({ event, body, client }) => {
  await handleMessage({ event, body, client, isMention: true });
});

app.message(async ({ message, body, client }) => {
  if ((!('user' in message) && !('bot_id' in message)) || !('channel' in message) || !('ts' in message)) return;
  await handleMessage({ event: message, body, client, isMention: false });
});

await app.start();
log('slack_agent_started', { channelId: config.allowedChannelId, workspace: config.workspace });

async function shutdown() {
  await app.stop();
  process.exit(0);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
