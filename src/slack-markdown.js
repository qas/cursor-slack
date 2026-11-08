import { Marked } from 'marked';

function escapeSlackText(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function slackUrl(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return undefined;
  return escapeSlackText(url.href).replaceAll('|', '%7C');
}

const markdown = new Marked({
  gfm: true,
  renderer: {
    blockquote(token) {
      const body = this.parser.parse(token.tokens).trim();
      return `${body.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n')}\n\n`;
    },
    code(token) {
      const body = escapeSlackText(token.text.replace(/\n+$/, ''));
      return `\`\`\`\n${body}\n\`\`\`\n\n`;
    },
    codespan(token) {
      return `\`${escapeSlackText(token.text)}\``;
    },
    del(token) {
      return `~${this.parser.parseInline(token.tokens)}~`;
    },
    em(token) {
      return `_${this.parser.parseInline(token.tokens)}_`;
    },
    heading(token) {
      return `*${this.parser.parseInline(token.tokens)}*\n\n`;
    },
    hr() {
      return '────────\n\n';
    },
    html(token) {
      return `${escapeSlackText(token.text)}${token.block ? '\n\n' : ''}`;
    },
    image(token) {
      const url = slackUrl(token.href);
      const alt = this.parser.parseInline(token.tokens);
      return url ? `<${url}|${alt}>` : alt;
    },
    link(token) {
      const url = slackUrl(token.href);
      const label = this.parser.parseInline(token.tokens);
      return url ? `<${url}|${label}>` : `${label} (${escapeSlackText(token.href)})`;
    },
    list(token) {
      const firstNumber = typeof token.start === 'number' ? token.start : 1;
      const rows = token.items.map((item, index) => {
        const body = this.parser.parse(item.tokens).trim().replaceAll('\n', '\n  ');
        const marker = item.task ? (item.checked ? '☑' : '☐') : (token.ordered ? `${firstNumber + index}.` : '•');
        return `${marker} ${body}`;
      });
      return `${rows.join('\n')}\n\n`;
    },
    paragraph(token) {
      return `${this.parser.parseInline(token.tokens)}\n\n`;
    },
    strong(token) {
      return `*${this.parser.parseInline(token.tokens)}*`;
    },
    table(token) {
      const headers = token.header.map((cell) => this.parser.parseInline(cell.tokens).trim());
      const rows = token.rows.map((row) => row.map((cell, index) => {
        const header = headers[index] || `Column ${index + 1}`;
        return `*${header}:* ${this.parser.parseInline(cell.tokens).trim()}`;
      }).join('\n'));
      return `${rows.join('\n\n')}\n\n`;
    },
    text(token) {
      return escapeSlackText(token.text);
    },
  },
});

export function toSlackMrkdwn(text) {
  return markdown.parse(text).trim();
}
