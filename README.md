# better-claude-code

Claude Code mods by BorovkovSergey, published as one plugin marketplace.

## Plugins

| Plugin | What it does |
| --- | --- |
| [note](plugins/note) | Per-session markdown notebook in a pane beside the chat; Claude edits it only on explicit request |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install <plugin> --marketplace BorovkovSergey/better-claude-code
```

Answer `y` to add the marketplace (once), then pick a scope. For example: `/plugin install note --marketplace BorovkovSergey/better-claude-code`.

From a shell:

```
claude plugin install <plugin> --marketplace BorovkovSergey/better-claude-code
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `BorovkovSergey/better-claude-code`, then Add plugin.

## Layout

```
.claude-plugin/marketplace.json   lists every plugin
plugins/<name>/                   one folder per plugin
```

To add a plugin: put it in `plugins/<name>/` and add an entry to `.claude-plugin/marketplace.json`.

## License

[MIT](LICENSE)
