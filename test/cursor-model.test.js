import assert from 'node:assert/strict';
import { spawn as spawnProcess } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, watch, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { askAgent, createConcurrencyLimit, createChat, initializeChat, stopCursorProcesses } from '../src/cursor-agent.js';
import { formatSlackPrompt } from '../src/slack-prompt.js';

const requiredConfig = {
  SLACK_BOT_TOKEN: 'xoxb-test',
  SLACK_APP_TOKEN: 'xapp-test',
  SLACK_ALLOWED_USER_IDS: 'U123',
  SLACK_ALLOWED_CHANNEL_ID: 'C123',
  CURSOR_WORKSPACE: '/tmp',
};

test('CURSOR_MODEL is optional and trimmed when configured', () => {
  assert.equal(loadConfig(requiredConfig).model, undefined);
  assert.equal(loadConfig({ ...requiredConfig, CURSOR_MODEL: '  composer-2  ' }).model, 'composer-2');
});

test('CURSOR_SYSTEM_PROMPT is optional and trimmed when configured', () => {
  assert.equal(loadConfig(requiredConfig).systemPrompt, undefined);
  assert.equal(loadConfig({ ...requiredConfig, CURSOR_SYSTEM_PROMPT: '  Slack instructions  ' }).systemPrompt, 'Slack instructions');
});

test('Cursor process concurrency stays within its configured limit', async () => {
  const limit = createConcurrencyLimit(2);
  let active = 0;
  let maximumActive = 0;
  let started = 0;
  let release;
  let notifyStarted;
  const gate = new Promise((resolve) => { release = resolve; });
  const twoStarted = new Promise((resolve) => { notifyStarted = resolve; });
  const operations = Array.from({ length: 5 }, () => limit(async () => {
    active += 1;
    started += 1;
    maximumActive = Math.max(maximumActive, active);
    if (started === 2) notifyStarted();
    await gate;
    active -= 1;
  }));

  await twoStarted;
  assert.equal(active, 2);
  assert.equal(started, 2);
  release();
  await Promise.all(operations);
  assert.equal(maximumActive, 2);
  assert.equal(started, 5);
});

test('agent prompt includes the Slack sender identity and preserves message mentions', () => {
  assert.equal(
    formatSlackPrompt({ userId: 'U123', text: 'Hi <@U456>' }),
    'Slack sender: {"type":"user","id":"U123","mention":"<@U123>"}\n\nSlack message:\nHi <@U456>',
  );
  assert.equal(
    formatSlackPrompt({ userId: 'U456', botId: 'B123', botAppId: 'A123', botName: 'Engineering Bot', text: 'hello' }),
    'Slack sender: {"type":"bot","id":"B123","userId":"U456","mention":"<@U456>","appId":"A123","name":"Engineering Bot"}\n\nSlack message:\nhello',
  );
});

test('askAgent passes a configured model to the Cursor CLI', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cursor-slack-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const argumentPath = path.join(directory, 'arguments.json');
  const executable = path.join(directory, 'cursor');
  const events = [
    {
      type: 'assistant',
      model_call_id: 'call-1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'First entry.' }] },
    },
    { type: 'tool', tool_name: 'Read' },
    {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Second entry.\n\nStill the second entry.' }] },
    },
  ];
  await writeFile(executable, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "fs.writeFileSync(process.env.CURSOR_ARGS_FILE, JSON.stringify(process.argv.slice(2)));",
    `process.stdout.write(${JSON.stringify(`${events.map((event) => JSON.stringify(event)).join('\n')}\n`)});`,
    '',
  ].join('\n'));
  await chmod(executable, 0o755);

  const previousPath = process.env.PATH;
  const previousArgumentPath = process.env.CURSOR_ARGS_FILE;
  process.env.PATH = `${directory}${path.delimiter}${previousPath ?? ''}`;
  process.env.CURSOR_ARGS_FILE = argumentPath;
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousArgumentPath === undefined) delete process.env.CURSOR_ARGS_FILE;
    else process.env.CURSOR_ARGS_FILE = previousArgumentPath;
  });

  const response = await askAgent({
    chatId: 'chat-id',
    prompt: 'hello',
    workspace: '/tmp',
    model: 'composer-2',
  });
  const args = JSON.parse(await readFile(argumentPath, 'utf8'));

  assert.deepEqual(response, ['First entry.', 'Second entry.\n\nStill the second entry.']);
  assert.deepEqual(args.slice(0, 5), ['agent', '--resume', 'chat-id', '--model', 'composer-2']);
  assert.deepEqual(args.slice(-2), ['--output-format', 'stream-json']);

  const initializationResult = await initializeChat({
    chatId: 'chat-id',
    prompt: 'Set Slack behavior instructions',
    workspace: '/tmp',
    model: 'composer-2',
  });
  const initializationArgs = JSON.parse(await readFile(argumentPath, 'utf8'));
  assert.equal(initializationResult, undefined);
  assert.deepEqual(initializationArgs.slice(0, 5), ['agent', '--resume', 'chat-id', '--model', 'composer-2']);
  assert.equal(initializationArgs[5], '-p');
  assert.equal(initializationArgs[6], 'Set Slack behavior instructions');
});

test('shutdown stops bot-owned Cursor processes but leaves unrelated processes alone', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cursor-slack-shutdown-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'cursor');
  const markerPath = path.join(directory, 'started');
  await writeFile(executable, [
    '#!/usr/bin/env node',
    "require('node:fs').writeFileSync(process.env.CURSOR_START_MARKER, 'started');",
    "process.on('SIGTERM', () => { process.stdout.write('test-chat\\n'); process.exit(0); });",
    'setInterval(() => {}, 1000);',
    '',
  ].join('\n'));
  await chmod(executable, 0o755);

  const outsideProcess = spawnProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => outsideProcess.kill('SIGKILL'));
  const previousPath = process.env.PATH;
  const previousMarker = process.env.CURSOR_START_MARKER;
  process.env.PATH = `${directory}${path.delimiter}${previousPath ?? ''}`;
  process.env.CURSOR_START_MARKER = markerPath;
  t.after(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousMarker === undefined) delete process.env.CURSOR_START_MARKER;
    else process.env.CURSOR_START_MARKER = previousMarker;
  });

  const watcher = watch(directory);
  const chatPromise = createChat();
  for await (const event of watcher) {
    if (String(event.filename) === 'started') break;
  }

  await stopCursorProcesses();
  assert.equal(await chatPromise, 'test-chat');
  assert.doesNotThrow(() => process.kill(outsideProcess.pid, 0));
  outsideProcess.kill('SIGTERM');
});
