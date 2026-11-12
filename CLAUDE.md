# better-claude-code

Claude Code mods (function-hook plugins) by BorovkovSergey, published as one plugin marketplace.
GitHub: https://github.com/BorovkovSergey/better-claude-code (public, MIT).

## Layout

- `.claude-plugin/marketplace.json` lists every plugin; each entry's `source` is `./plugins/<name>`.
- `plugins/<name>/` holds one mod: `.claude-plugin/plugin.json`, `hooks/hooks.json` (names the module), `hooks/register.tsx`, `types/index.d.ts` (the `$.state` contract), `tests/*.test.tsx`, `tsconfig.json`.
- Adding a plugin: new folder under `plugins/`, plus an entry in `marketplace.json` and a row in the root `README.md`.

## Working on a mod

- Load the `plugin-authoring` skill before changing hooks code: the API is early access and changes between Claude Code releases. The skill names the current type declarations (`claude-code.d.ts`); grep them for the event or `$` method at hand.
- Run from the working copy: `claude --plugin-dir plugins/<name>` (hot-reloads on save).
- Check before every commit:
  - `claude plugin validate plugins/<name>` and `claude plugin validate .` (marketplace)
  - `claude plugin test plugins/<name>`
  - type-check: `npx -p typescript tsc -p plugins/<name>` once the engine has written `plugins/<name>/.claude-plugin/types/` (it does when it loads the mod; the folder is git-ignored).
- Before publishing new files, run the plugin-authoring secret scan and read every staged file: no keys, internal hosts, work project names or personal paths.

## Git

- Commit identity is repo-local: `BorovkovSergey <46203686+BorovkovSergey@users.noreply.github.com>`. Never commit with the global (work) identity.
- Remote `origin` is HTTPS; push only after the user approves. Never force-push.

## note plugin (`plugins/note`)

Per-session markdown notebook in a pane beside the chat.

- Storage: `~/.claude/notes/<session-id>.md`, written through `$.fs`. The pane polls the file mtime every 1.5 s, so outside edits show up. `/clear` changes the session id, so the pane follows to a new empty notebook (by design).
- UI: pane `note` (toggled by `/note` and by the AbovePrompt button `📝 Notes done/total`, shown only when the notebook is not empty); pane `note-list` (`/note list`: import into the current notebook, delete with a second press).
- Tools for the model: `mcp__note__read|write|append|edit`, `isDeferred: false`. Their descriptions say to call them ONLY on the user's explicit request; keep that rule.
- Clickable task boxes: `- [ ]` / `- [x]` are rewritten to `[☐](https://note.invalid/toggle/<line>)` links and caught by `Markdown`'s `onLinkPress` (fullscreen terminal only). Lines inside code fences are skipped.
- Deleting a notebook uses `$.process.run(['rm', ...])` because `$.fs` has no delete.
- User decisions (keep unless asked): one notebook per session, not per project; no automatic cleanup of old notebooks, deletion only by hand in `/note list`; the button shows only when the notebook is not empty; notebook content is full markdown, not a fixed checklist format.
- UI strings are Russian.

## Known issues / open items

- Upstream rendering bug: rows with emoji (e.g. 📝) next to a docked pane get a stray `│` left of the divider in the VS Code terminal. Not the mod's fault; related upstream issue: https://github.com/anthropics/claude-code/issues/84986. Do not strip emoji to work around it.
- Not yet verified: whether `claude --resume` keeps the session id (and so the notebook). If it does not, teach the mod to find the previous session's notebook.
- Pane width is the person's to drag (engine-side, remembered); the mod could set a default with `columns` in `$.ui.open`.
