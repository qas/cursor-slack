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
    && Object.values(value.chats).every((chat) => isRecord(chat)
      && typeof chat.chatId === 'string'
      && Number.isSafeInteger(chat.lastActivityAt))
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

export async function openSessions(filePath, idleTimeoutMs) {
  if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs <= 0) {
    throw new Error('Session idle timeout must be a positive integer');
  }

  let state = { version: 2, chats: {}, messages: [] };
  try {
    state = loadState(JSON.parse(await fs.readFile(filePath, 'utf8')));
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

  return {
    async getChat(key, nowMs) {
      const chat = state.chats[key];
      if (!chat) return undefined;
      if (nowMs - chat.lastActivityAt >= idleTimeoutMs) {
        delete state.chats[key];
        await persist();
        return undefined;
      }

      chat.lastActivityAt = nowMs;
      await persist();
      return chat.chatId;
    },
    async setChat(key, chatId, nowMs) {
      state.chats[key] = { chatId, lastActivityAt: nowMs };
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
