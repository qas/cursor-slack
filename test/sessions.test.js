import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openSessions } from '../src/sessions.js';

test('refreshes active chats and expires them at the idle timeout', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cursor-slack-state-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sessions = await openSessions(path.join(directory, 'state.json'), 1_000);

  await sessions.setChat('thread', 'chat-1', 1_000);
  assert.equal(await sessions.getChat('thread', 1_999), 'chat-1');
  assert.equal(await sessions.getChat('thread', 2_998), 'chat-1');
  assert.equal(await sessions.getChat('thread', 3_998), undefined);
});

test('rejects state from a different version without migrating it', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cursor-slack-state-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'state.json');
  await writeFile(filePath, JSON.stringify({
    version: 1,
    chats: { thread: 'old-chat' },
    events: ['old-message'],
  }));

  await assert.rejects(openSessions(filePath, 1_000), /Slack agent session state is invalid/);
  const state = JSON.parse(await readFile(filePath, 'utf8'));
  assert.equal(state.version, 1);
});

test('keeps only the latest 1,000 message identities', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cursor-slack-state-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'state.json');
  const identities = Array.from({ length: 1_001 }, (_, index) => `message-${index}`);
  await writeFile(filePath, JSON.stringify({ version: 2, chats: {}, messages: identities }));

  const sessions = await openSessions(filePath, 1_000);
  assert.equal(sessions.hasMessage('message-0'), false);
  assert.equal(sessions.hasMessage('message-1'), true);
  await sessions.recordMessage('message-new');

  const state = JSON.parse(await readFile(filePath, 'utf8'));
  assert.equal(state.messages.length, 1_000);
  assert.equal(state.messages[0], 'message-2');
  assert.equal(state.messages.at(-1), 'message-new');
});
