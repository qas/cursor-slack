import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldProcessMessage, shouldStartChat, slackMessageIdentity } from '../src/slack-message-policy.js';

test('channel messages without a mention or trigger phrase are ignored', () => {
  assert.equal(shouldProcessMessage({ channelType: 'channel', isMention: false }), false);
  assert.equal(shouldProcessMessage({ channelType: 'channel', isMention: true }), true);
});

test('channel messages containing Cursor Agent trigger case-insensitively', () => {
  assert.equal(shouldProcessMessage({ channelType: 'channel', text: 'Hey Cursor Agent, help with this.' }), true);
  assert.equal(shouldProcessMessage({ channelType: 'channel', text: 'Hey cursor agent, help with this.' }), true);
  assert.equal(shouldProcessMessage({ channelType: 'channel', text: 'Cursor agents are useful.' }), false);
});

test('mentions and the trigger phrase can both start new chats', () => {
  assert.equal(shouldStartChat({ channelType: 'channel', isMention: true }), true);
  assert.equal(shouldStartChat({ channelType: 'channel', isMention: false, text: 'Cursor Agent, help me.' }), true);
  assert.equal(shouldStartChat({ channelType: 'channel', isMention: false, text: 'Just chatting.' }), false);
});

test('a normal first direct message starts a chat without a mention', () => {
  assert.equal(shouldProcessMessage({ channelType: 'im', isMention: false }), true);
  assert.equal(shouldStartChat({ channelType: 'im', isMention: false, text: 'Hey, can you help?' }), true);
});

test('message identity is stable across Slack event types for the same message', () => {
  assert.equal(
    slackMessageIdentity({ teamId: 'T123', channelId: 'C123', timestamp: '123.456' }),
    'T123:C123:123.456',
  );
});
