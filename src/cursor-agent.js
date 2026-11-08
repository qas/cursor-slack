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

export async function askAgent({ chatId, prompt, workspace }) {
  const output = await run('cursor', [
    'agent',
    '--resume', chatId,
    '-p', prompt,
    '--trust',
    '--workspace', workspace,
    '--output-format', 'json',
  ], { cwd: workspace });

  let result;
  try {
    result = JSON.parse(output);
  } catch {
    throw new Error('Cursor CLI returned invalid JSON');
  }
  if (typeof result.result !== 'string' || !result.result.trim()) {
    throw new Error('Cursor CLI returned no response');
  }
  return result.result.trim();
}
