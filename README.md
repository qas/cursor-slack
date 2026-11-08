# Cursor Agent for Slack

A self-hosted Slack bot that connects approved Slack users and bots to Cursor Agent running on the same machine. It uses Slack Bolt for JavaScript in Socket Mode and the Cursor Agent CLI; it does not use Cursor's private wire protocol.

Channel messages trigger the bot when they mention it or contain the phrase “Cursor Agent,” including in threads. Direct messages do not require a mention and continue the chat for that DM. The bot runs one local Cursor CLI process per request and keeps thread-to-chat mappings in local state.

This is a local, single-workspace integration, not a hosted Slack app or a multi-workspace service. The Cursor CLI runs with the local account's credentials and access to the configured project. Only install it in a workspace you trust, and use narrow sender and channel allowlists.

## Requirements

- Node.js 24 or newer and npm.
- A Slack workspace where you can create and install an app.
- Cursor Agent CLI installed, authenticated, and available as `cursor` with the `agent` subcommand. This bot invokes `cursor agent create-chat` and `cursor agent --resume ...`. See Cursor's [CLI installation](https://docs.cursor.com/en/cli/installation) and [authentication](https://docs.cursor.com/en/cli/reference/authentication) guides.
- A local project directory for Cursor Agent to work in.

On macOS, Linux, or WSL, Cursor's documented installer is:

```bash
curl https://cursor.com/install -fsS | bash
cursor agent login
cursor agent status
```

Complete the browser login and confirm `cursor agent status` reports an authenticated account before starting this bot.

## Create and configure the Slack app

The Slack CLI is not required to run this bot; create and configure the app in Slack's app dashboard using the manifest below.

1. In Slack's app dashboard, create an app from [`manifest.json`](./manifest.json) and select your workspace. The manifest enables Socket Mode, the writable App Home Messages tab, the required bot scopes, and the message events.
2. Under **Basic Information → App-Level Tokens**, create an app-level token with the single scope `connections:write`. Save its `xapp-…` value as `SLACK_APP_TOKEN`.
3. Under **OAuth & Permissions**, install the app to the workspace and copy its **Bot User OAuth Token** (`xoxb-…`) as `SLACK_BOT_TOKEN`. Reinstall after changing requested scopes.
4. Under **App Home → Messages Tab**, enable the Messages tab and **Allow users to send Slash commands and messages from the messages tab**. The manifest sets `messages_tab_read_only_enabled` to `false`.
5. Invite the bot to the channel it should listen in, for example with `/invite @Cursor Agent`.
6. If you want the Cursor app icon, upload [`assets/cursor-app-icon.png`](./assets/cursor-app-icon.png) separately in the app settings. Slack does not include the icon in the manifest. The image is from [Cursor's official brand assets](https://cursor.com/brand).

The manifest requests `app_mentions:read`, `channels:history`, `groups:history`, `chat:write`, `reactions:write`, and `im:history`. It subscribes to `app_mention`, `message.channels`, `message.groups`, and `message.im`. Slack requires `im:history` to receive [`message.im`](https://docs.slack.dev/reference/events/message.im/).

## Configure and run

Set `BOT_DIR` to this checkout. Run the commands below from the root of the project you want Cursor Agent to work in; that makes `$PWD` the target workspace. If you want it to work in another project, set `CURSOR_WORKSPACE` to that project's absolute path instead.

```bash
export BOT_DIR="/path/to/cursor-slack"
export CURSOR_WORKSPACE="$PWD"
cp "$BOT_DIR/.env.example" "$BOT_DIR/.env"
```

Fill in the values in `$BOT_DIR/.env`:

- `SLACK_BOT_TOKEN`: the workspace bot token (`xoxb-…`).
- `SLACK_APP_TOKEN`: the app-level Socket Mode token (`xapp-…`).
- `SLACK_ALLOWED_USER_IDS`: approved Slack user IDs, separated by commas. Optional if bot IDs are configured.
- `SLACK_ALLOWED_BOT_IDS`: approved Slack bot IDs (`B…`) and/or Slack app IDs (`A…`), separated by commas. App IDs are matched against the sender's `bot_profile.app_id`. Optional if user IDs are configured.
- `SLACK_ALLOWED_CHANNEL_ID`: the ID of the one channel the bot may process.
- `CURSOR_MODEL`: optional model ID passed to `cursor agent --model` for each reply. Leave blank to use the Cursor CLI account's default model. Run `cursor agent models` to list available models.
- `CURSOR_SYSTEM_PROMPT`: optional instructions sent as the first prompt in each new Cursor chat. The bot ignores that setup turn's response; later Slack messages continue in the same chat.

At least one of the user or bot allowlists must contain an ID. The bot ignores messages from senders outside these lists and messages outside the configured channel or a DM with the bot. Keep `.env` private; it is excluded by `.gitignore`.

Then install the Node dependency and start the bot:

```bash
npm --prefix "$BOT_DIR" install
npm --prefix "$BOT_DIR" start
```

The bot runs in the foreground; stop it with Ctrl+C. `npm start` loads `$BOT_DIR/.env`. `SLACK_AGENT_STATE_PATH` optionally changes the local state file; the default is `state/conversations.json` under this checkout.

To try it, DM the bot, mention it in the configured channel, or include “Cursor Agent” in a channel message. Incoming Slack user mentions are preserved in the prompt so Cursor can reuse their IDs; valid mention tokens in Cursor replies are passed through to Slack. Each distinct Cursor assistant text entry is posted as a separate Slack message after the CLI run finishes; line breaks within an entry stay in that message. Common Markdown formatting is converted to Slack `mrkdwn`, including emphasis, headings, links, lists, code, and tables. The bot adds an hourglass reaction while working, then a success or failure reaction.

## Permissions and execution

The allowlists are checked before a message can start or continue a Cursor chat. Slack still delivers subscribed message events to this bot process, but unauthorized senders and channels are ignored.

Cursor Agent runs with workspace trust enabled and command approval at the CLI default. This bot does not approve commands on your behalf. Requests that require interactive command approval may pause until approved through the CLI. Do not expose the bot to untrusted users or run it against a project you do not intend Cursor Agent to access.

The local state file stores Slack-to-Cursor chat mappings and processed Slack event IDs. It does not store message text. Keep the state private and out of version control.
