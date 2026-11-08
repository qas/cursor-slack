import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldProcessMessage, slackMessageIdentity } from '../src/slack-message-policy.js';

test('channel messages without a mention or trigger phrase are ignored', () => {
  assert.equal(shouldProcessMessage({ channelType: 'channel', isMention: false }), false);
  assert.equal(shouldProcessMessage({ channelType: 'channel', isMention: true }), true);
});

test('channel messages containing Cursor Agent trigger case-insensitively', () => {
  assert.equal(shouldProcessMessage({ channelType: 'channel', text: 'Hey Cursor Agent, help with this.' }), true);
  assert.equal(shouldProcessMessage({ channelType: 'channel', text: 'Hey cursor agent, help with this.' }), true);
  assert.equal(shouldProcessMessage({ channelType: 'channel', text: 'Cursor agents are useful.' }), false);
});

test('direct messages do not require a mention', () => {
  assert.equal(shouldProcessMessage({ channelType: 'im', isMention: false }), true);
});

test('message identity is stable across Slack event types for the same message', () => {
  assert.equal(
    slackMessageIdentity({ teamId: 'T123', channelId: 'C123', timestamp: '123.456' }),
    'T123:C123:123.456',
  );
});
