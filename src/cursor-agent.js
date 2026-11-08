import { spawn } from 'node:child_process';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env };
    for (const name of Object.keys(childEnv)) {
      if (name.startsWith('SLACK_')) delete childEnv[name];
    }
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.once('error', () => reject(new Error('Cursor CLI could not be started')));
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error('Cursor CLI command failed'));
      resolve(stdout.trim());
    });
  });
}

export async function createChat() {
  const chatId = await run('cursor', ['agent', 'create-chat']);
  if (!chatId) throw new Error('Cursor CLI returned no chat ID');
  return chatId;
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
  const args = [
    'agent',
    '--resume', chatId,
    ...(model ? ['--model', model] : []),
    '-p', prompt,
    '--trust',
    '--workspace', workspace,
    '--output-format', 'stream-json',
  ];
  const output = await run('cursor', args, { cwd: workspace });
  return assistantMessages(output);
}
