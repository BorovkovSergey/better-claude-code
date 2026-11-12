# note

A Claude Code mod that keeps a per-session markdown notebook in a pane beside the chat.

Ask Claude for a step-by-step plan, review it, then say "put it in my notes". The plan stays on screen while the chat scrolls on, and you can hide the pane whenever you need the full width.

## Features

- **Notes pane** docked to the right of the chat (fullscreen layout on a wide terminal), or above the prompt on a narrow one.
- **Full markdown**: headings, lists, tables, code blocks, links.
- **Clickable task lists**: `- [ ]` / `- [x]` render as ☐ / ☑; click one to tick it (fullscreen terminal).
- **One notebook per session**, stored as a plain file: `~/.claude/notes/<session-id>.md`. Edit it in any editor and the pane picks up the change. `/clear` starts a new, empty notebook.
- **A button above the prompt** (`[ 📝 Notes 2/5 ]`, only when the notebook is not empty) toggles the pane and shows task progress.
- **Claude edits the notebook only when you ask**: "add X to my notes", "put this checklist in my notes", "tick item 2".

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install note --marketplace BorovkovSergey/better-claude-code
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```
claude plugin install note --marketplace BorovkovSergey/better-claude-code
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `BorovkovSergey/better-claude-code`, then Add plugin.

## Usage

| Command | What it does |
| --- | --- |
| `/note` | Show or hide the Notes pane |
| `/note list` | List the notebooks of all sessions: import one into the current notebook, or delete it (press Delete twice) |

Tools Claude gets (called only on your explicit request): `mcp__note__read`, `mcp__note__write`, `mcp__note__append`, `mcp__note__edit`.

## Development

```
claude --plugin-dir plugins/note   # run from a working copy
claude plugin validate plugins/note
claude plugin test plugins/note
```
