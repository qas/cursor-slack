import { spawn } from 'node:child_process';

export function createConcurrencyLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('Cursor process limit must be a positive integer');
  }

  let active = 0;
  const waiting = [];

  return function runLimited(operation) {
    return new Promise((resolve, reject) => {
      const run = () => {
        active += 1;
        Promise.resolve()
          .then(operation)
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            waiting.shift()?.();
          });
      };

      if (active < limit && waiting.length === 0) run();
      else waiting.push(run);
    });
  };
}

const limitCursorProcesses = createConcurrencyLimit(4);
const runningProcesses = new Set();
let stopping = false;
const shutdownGraceMs = 5_000;

function run(command, args, options = {}) {
  return limitCursorProcesses(() => {
    if (stopping) throw new Error('Cursor process runner is shutting down');

    return new Promise((resolve, reject) => {
      const childEnv = { ...process.env };
      for (const name of Object.keys(childEnv)) {
        if (name.startsWith('SLACK_')) delete childEnv[name];
      }
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'ignore'],
        detached: process.platform !== 'win32',
      });
      runningProcesses.add(child);
      let stdout = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.once('error', () => {
        runningProcesses.delete(child);
        reject(new Error('Cursor CLI could not be started'));
      });
      child.once('close', (code) => {
        runningProcesses.delete(child);
        if (code !== 0) return reject(new Error('Cursor CLI command failed'));
        resolve(stdout.trim());
      });
    });
  });
}

function signalProcess(child, signal) {
  try {
    if (child.pid === undefined) return;
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function waitForClose(child) {
  if (!runningProcesses.has(child)) return Promise.resolve();
  return new Promise((resolve) => child.once('close', resolve));
}

export async function stopCursorProcesses() {
  stopping = true;
  const children = [...runningProcesses];
  for (const child of children) signalProcess(child, 'SIGTERM');

  let timeout;
  await Promise.race([
    Promise.all(children.map(waitForClose)),
    new Promise((resolve) => { timeout = setTimeout(resolve, shutdownGraceMs); }),
  ]);
  clearTimeout(timeout);

  const remaining = [...runningProcesses];
  for (const child of remaining) signalProcess(child, 'SIGKILL');
  await Promise.all(remaining.map(waitForClose));
}

export async function createChat() {
  const chatId = await run('cursor', ['agent', 'create-chat']);
  if (!chatId) throw new Error('Cursor CLI returned no chat ID');
  return chatId;
}

function promptArgs({ chatId, prompt, workspace, model }) {
  return [
    'agent',
    '--resume', chatId,
    ...(model ? ['--model', model] : []),
    '-p', prompt,
    '--trust',
    '--workspace', workspace,
    '--output-format', 'stream-json',
  ];
}

function assistantMessages(output) {
  let events;
  try {
    events = output.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    throw new Error('Cursor CLI returned invalid stream JSON');
  }

  const messages = events
    .filter((event) => event.type === 'assistant' && Array.isArray(event.message?.content))
    .map((event) => event.message.content
      .filter((item) => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('')
      .trim())
    .filter(Boolean);

  if (messages.length === 0) throw new Error('Cursor CLI returned no response');
  return messages;
}

export async function askAgent({ chatId, prompt, workspace, model }) {
  const output = await run('cursor', promptArgs({ chatId, prompt, workspace, model }), { cwd: workspace });
  return assistantMessages(output);
}

export async function initializeChat({ chatId, prompt, workspace, model }) {
  await run('cursor', promptArgs({ chatId, prompt, workspace, model }), { cwd: workspace });
}
