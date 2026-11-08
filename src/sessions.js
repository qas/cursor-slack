import fs from 'node:fs/promises';
import path from 'node:path';

function validState(value) {
  return value !== null
    && typeof value === 'object'
    && value.version === 1
    && value.chats !== null
    && typeof value.chats === 'object'
    && Array.isArray(value.events)
    && value.events.every((eventId) => typeof eventId === 'string');
}

export async function openSessions(filePath) {
  let state = { version: 1, chats: {}, events: [] };
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!validState(parsed)) throw new Error('Slack agent session state is invalid');
    state = parsed;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

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
    getChat(key) {
      return state.chats[key];
    },
    async setChat(key, chatId) {
      state.chats[key] = chatId;
      await persist();
    },
    hasEvent(eventId) {
      return state.events.includes(eventId);
    },
    async recordEvent(eventId) {
      state.events.push(eventId);
      await persist();
    },
  };
}
