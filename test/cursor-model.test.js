import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { askAgent } from '../src/cursor-agent.js';

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
});
