import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_RECENT_MESSAGES = 1_000;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validVersionTwo(value) {
  return isRecord(value)
    && value.version === 2
    && isRecord(value.chats)
    && Object.values(value.chats).every((chatId) => typeof chatId === 'string')
    && Array.isArray(value.messages)
    && value.messages.every((identity) => typeof identity === 'string');
}

function loadState(value) {
  if (validVersionTwo(value)) {
    return {
      version: 2,
      chats: value.chats,
      messages: [...new Set(value.messages)].slice(-MAX_RECENT_MESSAGES),
    };
  }

  throw new Error('Slack agent session state is invalid');
}

export async function openSessions(filePath) {
  let state = { version: 2, chats: {}, messages: [] };
  let compactLoadedMessages = false;
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    state = loadState(parsed);
    compactLoadedMessages = parsed.messages.length !== state.messages.length;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const messages = new Set(state.messages);
  let writeTail = Promise.resolve();
  async function persist() {
    const snapshot = JSON.stringify(state);
    const write = async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      await fs.writeFile(temporaryPath, snapshot, { mode: 0o600 });
      await fs.rename(temporaryPath, filePath);
    };
    const pending = writeTail.then(write);
    writeTail = pending.catch(() => {});
    await pending;
  }

  if (compactLoadedMessages) await persist();

  return {
    getChat(key) {
      return state.chats[key];
    },
    async setChat(key, chatId) {
      state.chats[key] = chatId;
      await persist();
    },
    hasMessage(messageIdentity) {
      return messages.has(messageIdentity);
    },
    async recordMessage(messageIdentity) {
      if (messages.has(messageIdentity)) return;
      messages.add(messageIdentity);
      if (messages.size > MAX_RECENT_MESSAGES) {
        messages.delete(messages.values().next().value);
      }
      state.messages = [...messages];
      await persist();
    },
  };
}
