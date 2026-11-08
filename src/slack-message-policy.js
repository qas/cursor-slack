export function shouldProcessMessage({ channelType, isMention, text = '' }) {
  return channelType === 'im' || shouldStartChat({ channelType, isMention, text });
}

export function shouldStartChat({ channelType, isMention, text = '' }) {
  return channelType === 'im' || isMention || /\bcursor agent\b/i.test(text);
}

export function slackMessageIdentity({ teamId, channelId, timestamp }) {
  return `${teamId}:${channelId}:${timestamp}`;
}
