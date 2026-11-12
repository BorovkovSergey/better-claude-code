import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Doc, Entry } from '../types'

// Per-session markdown notebook.
// File: ~/.claude/notes/<session-id>.md. The pane re-reads it when its mtime
// changes, so edits made in an editor show up too. After /clear the session
// id changes and the pane follows to the new (empty) notebook.

const PANE = 'note'
const LIST = 'note-list'
const POLL_MS = 1500
const TOGGLE_HREF = 'https://note.invalid/toggle/'
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/
// A GFM task-list item: bullet or ordered marker, then `[ ]` / `[x]`.
const TASK_RE = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+)\[( |x|X)\](?=\s|$)/
const FENCE_RE = /^\s{0,3}(```|~~~)/

const EMPTY_DOC: Doc = { sessionId: '', text: '', mtimeMs: 0 }
const doc = atom({ plugin: 'note', key: 'doc' } as const, EMPTY_DOC, {
  shape: 'doc-1',
})
const entries = atom({ plugin: 'note', key: 'entries' } as const, [] as Entry[], {
  shape: 'entries-1',
})
const pendingDelete = atom({ plugin: 'note', key: 'pendingDelete' } as const, '')

const TOOL_RULE =
  "The user's per-session markdown notebook, shown in their Notes pane beside the chat. " +
  'Call ONLY when the user explicitly asks to read or change their notes ' +
  '("add this to my notes", "put the checklist in my notes", "tick item 2", "what is in my notes", ' +
  '"добавь в заметки", "отметь пункт 2"). ' +
  'Never call it on your own initiative, and never to store your own plans or progress.'

async function notesDir($: EngineInterface): Promise<string> {
  const home = await $.env.get('HOME')
  if (!home) {
    throw new Error('HOME is not set')
  }

  return `${home}/.claude/notes`
}

async function currentFile($: EngineInterface): Promise<{ id: string; path: string }> {
  const id = await $.session.id()

  return { id, path: `${await notesDir($)}/${id}.md` }
}

async function readFile($: EngineInterface, path: string): Promise<string> {
  return (await $.fs.exists(path)) ? await $.fs.read(path) : ''
}

/** Re-reads the current notebook into state when the session or the file changed. */
async function refresh($: EngineInterface): Promise<void> {
  const { id, path } = await currentFile($)
  const stat = await $.fs.stat(path).catch(() => undefined)
  const held = await read($, doc)

  if (!stat) {
    if (held.sessionId !== id || held.text !== '') {
      await update($, doc, () => ({ sessionId: id, text: '', mtimeMs: 0 }))
    }

    return
  }

  if (held.sessionId === id && held.mtimeMs === stat.mtimeMs) {
    return
  }

  const text = await $.fs.read(path)
  await update($, doc, () => ({ sessionId: id, text, mtimeMs: stat.mtimeMs }))
}

async function save($: EngineInterface, text: string): Promise<void> {
  const { path } = await currentFile($)
  await $.fs.write(path, text)
  await refresh($)
}

type Decorated = { md: string; hrefs: string[]; done: number; total: number }

/** Lines of `text` that are task items outside code fences, by line index. */
function taskLines(lines: readonly string[]): Map<number, boolean> {
  const tasks = new Map<number, boolean>()
  let fence: string | null = null

  lines.forEach((line, index) => {
    const opener = FENCE_RE.exec(line)?.[1]
    if (opener) {
      fence = fence === null ? opener : fence === opener ? null : fence

      return
    }
    if (fence !== null) {
      return
    }
    const match = TASK_RE.exec(line)
    if (match) {
      tasks.set(index, match[2] !== ' ')
    }
  })

  return tasks
}

/** Turns `[ ]` / `[x]` into pressable ☐ / ☑ links; counts the tasks. */
function decorate(text: string): Decorated {
  const lines = text.split('\n')
  const tasks = taskLines(lines)
  const hrefs: string[] = []
  let done = 0

  for (const [index, isDone] of tasks) {
    const line = lines[index] ?? ''
    const match = TASK_RE.exec(line)
    if (!match) {
      continue
    }
    if (isDone) {
      done += 1
    }
    const href = `${TOGGLE_HREF}${index}`
    if (hrefs.length < 256) {
      hrefs.push(href)
      lines[index] = `${match[1]}[${isDone ? '☑' : '☐'}](${href})${line.slice(match[0].length)}`
    } else {
      lines[index] = `${match[1]}${isDone ? '☑' : '☐'}${line.slice(match[0].length)}`
    }
  }

  return { md: lines.join('\n'), hrefs, done, total: tasks.size }
}

/** Flips the task on line `index` of the current notebook, read fresh from disk. */
async function toggleTask($: EngineInterface, href: string): Promise<void> {
  if (!href.startsWith(TOGGLE_HREF)) {
    return
  }
  const index = Number(href.slice(TOGGLE_HREF.length))
  const { path } = await currentFile($)
  const lines = (await readFile($, path)).split('\n')
  const isDone = taskLines(lines).get(index)
  if (isDone === undefined) {
    return
  }
  const line = lines[index] ?? ''
  const match = TASK_RE.exec(line)
  if (!match) {
    return
  }
  lines[index] = `${match[1]}[${isDone ? ' ' : 'x'}]${line.slice(match[0].length)}`
  await save($, lines.join('\n'))
}

async function togglePane($: EngineInterface): Promise<boolean> {
  const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })

    return false
  }
  await refresh($)
  await $.ui.open({ id: PANE, title: 'Notes' })

  return true
}

function titleOf(text: string): string {
  const line = text
    .split('\n')
    .map(one => one.trim())
    .find(one => one !== '')
  const title = (line ?? '(empty)').replace(/^#+\s*/, '')

  return title.length > 60 ? `${title.slice(0, 59)}…` : title
}

async function loadEntries($: EngineInterface): Promise<void> {
  const dir = await notesDir($)
  const currentId = await $.session.id()
  const files = (await $.fs.exists(dir)) ? await $.fs.list(dir) : []
  const found: Entry[] = []

  for (const file of files) {
    const id = file.name.endsWith('.md') ? file.name.slice(0, -3) : ''
    if (file.kind !== 'file' || !ID_RE.test(id)) {
      continue
    }
    const text = await $.fs.read(`${dir}/${file.name}`).catch(() => '')
    found.push({
      id,
      title: titleOf(text),
      mtimeMs: file.mtimeMs,
      size: file.size,
      isCurrent: id === currentId,
    })
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs)
  await update($, entries, () => found.slice(0, 100))
  await update($, pendingDelete, () => '')
}

async function importNotebook($: EngineInterface, id: string): Promise<void> {
  if (!ID_RE.test(id)) {
    return
  }
  const source = (await readFile($, `${await notesDir($)}/${id}.md`)).trim()
  if (source === '') {
    $.ui.toast('This notebook is empty')

    return
  }
  const { path } = await currentFile($)
  const current = (await readFile($, path)).replace(/\s+$/, '')
  await save($, current === '' ? `${source}\n` : `${current}\n\n${source}\n`)
  $.ui.toast('Imported into the current notebook')
}

async function deleteNotebook($: EngineInterface, id: string): Promise<void> {
  if (!ID_RE.test(id)) {
    return
  }
  if ((await read($, pendingDelete)) !== id) {
    await update($, pendingDelete, () => id)

    return
  }
  const path = `${await notesDir($)}/${id}.md`
  const { exitCode, stderr } = await $.process.run(['rm', '-f', '--', path])
  if (exitCode !== 0) {
    $.ui.toast(`Could not delete: ${stderr.trim()}`)
  }
  await loadEntries($)
  await refresh($)
}

function stamp(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'note',
      description: 'Notes pane: /note toggles it, /note list shows notebooks of all sessions',
    })
    await $.tool.register({
      name: 'read',
      description: `Read the notebook. ${TOOL_RULE}`,
      inputSchema: { type: 'object', properties: {} },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'write',
      description: `Replace the whole notebook with new markdown. ${TOOL_RULE}`,
      inputSchema: {
        type: 'object',
        properties: { content: { type: 'string', description: 'Full markdown' } },
        required: ['content'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'append',
      description: `Append markdown to the end of the notebook. ${TOOL_RULE}`,
      inputSchema: {
        type: 'object',
        properties: { content: { type: 'string', description: 'Markdown to append' } },
        required: ['content'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'edit',
      description:
        'Replace an exact fragment of the notebook (like the Edit tool; old_string must be unique ' +
        `unless replace_all). Use it to tick a task: "- [ ] x" -> "- [x] x". ${TOOL_RULE}`,
      inputSchema: {
        type: 'object',
        properties: {
          old_string: { type: 'string' },
          new_string: { type: 'string' },
          replace_all: { type: 'boolean' },
        },
        required: ['old_string', 'new_string'],
      },
      isDeferred: false,
    })

    await refresh($)
    $.clock.every(POLL_MS, () => {
      void refresh($).catch(() => undefined)
    })

    return next(e)
  })

  on('command.run', { command: 'note' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'list') {
      await loadEntries($)
      await $.ui.open({ id: LIST, title: 'Notebooks', focus: true, closeOnEscape: true })

      return { text: 'Notebook list opened (Esc to close).' }
    }
    if (args !== '') {
      return { text: 'Usage: /note shows or hides the pane, /note list lists the notebooks of all sessions.' }
    }
    const isOpen = await togglePane($)
    const { path } = await currentFile($)

    return { text: isOpen ? `Notes shown: ${path}` : 'Notes hidden.' }
  })

  on('tool.call', { tool: 'mcp__note__read' }, async $ => {
    const { path } = await currentFile($)
    const text = await readFile($, path)

    return { result: text.trim() === '' ? `Notebook is empty (${path}).` : `File: ${path}\n\n${text}` }
  }).catch(() => ({ deny: "note mod failed on read" }))

  on('tool.call', { tool: 'mcp__note__write' }, async ($, e) => {
    const content = str(e.content)
    if (content === undefined) {
      return { deny: 'content must be a string' }
    }
    const { path } = await currentFile($)
    const wasEmpty = (await readFile($, path)).trim() === ''
    await save($, content.endsWith('\n') ? content : `${content}\n`)
    if (wasEmpty) {
      await $.ui.open({ id: PANE, title: 'Notes' })
    }

    return { result: `Notebook replaced (${path}).` }
  }).catch(() => ({ deny: "note mod failed on write" }))

  on('tool.call', { tool: 'mcp__note__append' }, async ($, e) => {
    const content = str(e.content)
    if (content === undefined || content.trim() === '') {
      return { deny: 'content must be a non-empty string' }
    }
    const { path } = await currentFile($)
    const current = (await readFile($, path)).replace(/\s+$/, '')
    await save($, current === '' ? `${content.trim()}\n` : `${current}\n${content.replace(/\s+$/, '')}\n`)
    if (current === '') {
      await $.ui.open({ id: PANE, title: 'Notes' })
    }

    return { result: `Appended to notebook (${path}).` }
  }).catch(() => ({ deny: "note mod failed on append" }))

  on('tool.call', { tool: 'mcp__note__edit' }, async ($, e) => {
    const oldString = str(e.old_string)
    const newString = str(e.new_string)
    if (oldString === undefined || newString === undefined || oldString === '') {
      return { deny: 'old_string (non-empty) and new_string must be strings' }
    }
    const { path } = await currentFile($)
    const text = await readFile($, path)
    const count = text.split(oldString).length - 1
    if (count === 0) {
      return { deny: 'old_string not found in the notebook; call mcp__note__read first' }
    }
    if (count > 1 && e.replace_all !== true) {
      return { deny: `old_string occurs ${count} times; make it unique or set replace_all` }
    }
    await save($, text.split(oldString).join(newString))

    return { result: `Notebook edited (${count} replacement${count > 1 ? 's' : ''}).` }
  }).catch(() => ({ deny: "note mod failed on edit" }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Markdown, Text } = $.ui.resolve(e)
    const current = await read($, doc)

    if (current.text.trim() === '') {
      return (
        <Box flexDirection="column">
          <Text dimColor>The notebook is empty.</Text>
          <Text dimColor>Ask Claude: "add … to my notes" or "put the checklist in my notes".</Text>
        </Box>
      )
    }

    const view = decorate(current.text)

    return (
      <Box flexDirection="column">
        <Markdown
          key="doc"
          text={view.md}
          pressableLinks={view.hrefs}
          onLinkPress={link => {
            void toggleTask($, link.href)
          }}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const current = await read($, doc)
    if (current.text.trim() === '') {
      return next(e)
    }
    const { Box, Button } = $.ui.resolve(e)
    const view = decorate(current.text)
    const label = view.total > 0 ? `📝 Notes ${view.done}/${view.total}` : '📝 Notes'

    return (
      <Box>
        <Button key="toggle" label={label} onPress={() => void togglePane($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: LIST }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, entries)
    const pending = await read($, pendingDelete)

    if (list.length === 0) {
      return <Text dimColor>No notebooks yet.</Text>
    }

    return (
      <Box flexDirection="column">
        {list.map(entry => (
          <Box key={`row-${entry.id}`} flexDirection="column" marginBottom={1}>
            <Text>
              {entry.isCurrent ? '● ' : '  '}
              {entry.title}
            </Text>
            <Text dimColor>
              {'  '}
              {stamp(entry.mtimeMs)} · {entry.size} B · {entry.id.slice(0, 8)}
              {entry.isCurrent ? ' · current' : ''}
            </Text>
            <Box>
              <Text>{'  '}</Text>
              {!entry.isCurrent && (
                <Button
                  key={`import-${entry.id}`}
                  label="Import"
                  onPress={() => void importNotebook($, entry.id)}
                />
              )}
              <Button
                key={`delete-${entry.id}`}
                label={pending === entry.id ? 'Really delete?' : 'Delete'}
                onPress={() => void deleteNotebook($, entry.id)}
              />
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
