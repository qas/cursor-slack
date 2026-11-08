export function formatSlackPrompt({ text, userId, botId, botAppId, botName }) {
  const sender = botId
    ? {
      type: 'bot',
      id: botId,
      ...(userId ? { userId, mention: `<@${userId}>` } : {}),
      ...(botAppId ? { appId: botAppId } : {}),
      ...(botName ? { name: botName } : {}),
    }
    : { type: 'user', id: userId, mention: `<@${userId}>` };

  return `Slack sender: ${JSON.stringify(sender)}\n\nSlack message:\n${text}`;
}
