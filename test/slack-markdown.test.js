import assert from 'node:assert/strict';
import test from 'node:test';
import { toSlackMrkdwn } from '../src/slack-markdown.js';

test('converts common Markdown formatting to Slack mrkdwn', () => {
  const markdown = [
    '# Summary',
    '',
    '**Bold**, *italic*, ~~removed~~, and [docs](https://example.com/a?x=1&y=2).',
    '',
    '- first item',
    '- second item',
    '',
    '| Name | Status |',
    '| --- | --- |',
    '| API | **Ready** |',
    '',
    '`inline`',
    '',
    '```js',
    'const ready = true;',
    '```',
  ].join('\n');

  assert.equal(toSlackMrkdwn(markdown), [
    '*Summary*',
    '',
    '*Bold*, _italic_, ~removed~, and <https://example.com/a?x=1&amp;y=2|docs>.',
    '',
    '• first item',
    '• second item',
    '',
    '*Name:* API',
    '*Status:* *Ready*',
    '',
    '`inline`',
    '',
    '```',
    'const ready = true;',
    '```',
  ].join('\n'));
});

test('escapes raw HTML and leaves unsupported links as text', () => {
  assert.equal(
    toSlackMrkdwn('<script>alert(1)</script>\n\n[local](file.md)'),
    '&lt;script&gt;alert(1)&lt;/script&gt;\n\nlocal (file.md)',
  );
});
