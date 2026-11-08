export function shouldProcessMessage({ channelType, isMention, text = '' }) {
  return channelType === 'im' || shouldStartChat({ isMention, text });
}

export function shouldStartChat({ isMention, text = '' }) {
  return isMention || /\bcursor agent\b/i.test(text);
}

export function slackMessageIdentity({ teamId, channelId, timestamp }) {
  return `${teamId}:${channelId}:${timestamp}`;
}
