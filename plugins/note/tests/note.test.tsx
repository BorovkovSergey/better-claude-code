import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/home/u'
const DIR = `${HOME}/.claude/notes`
const SESSION = 'sess-1'
const FILE = `${DIR}/${SESSION}.md`

/** An in-memory file system and the engine calls the mod needs. */
function engine(on: On, files: Map<string, { text: string; mtimeMs: number }>) {
  let tick = 1
  mock.env(on, { HOME })
  mock.clock(on)
  on('session.id', () => ({ value: SESSION }))
  on('command.register', () => ({ value: { command: 'note' } }))
  on('tool.register', (_, e) => ({ value: { tool: `mcp__note__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.exists', (_, e) => ({ value: files.has(e.path) || e.path === DIR }))
  on('fs.read', (_, e) => {
    const file = files.get(e.path)

    return file ? { value: file.text } : { deny: 'ENOENT' }
  })
  on('fs.write', (_, e) => {
    tick += 1
    files.set(e.path, { text: e.text, mtimeMs: tick })

    return { value: undefined }
  })
  on('fs.stat', (_, e) => {
    const file = files.get(e.path)

    return file
      ? { value: { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false } }
      : { deny: 'ENOENT' }
  })
  on('fs.list', () => ({
    value: [...files.entries()]
      .filter(([path]) => path.startsWith(`${DIR}/`))
      .map(([path, file]) => ({
        name: path.slice(DIR.length + 1),
        kind: 'file' as const,
        size: file.text.length,
        mtimeMs: file.mtimeMs,
        isLink: false,
      })),
  }))
}

const PANE = {
  plugin: 'note',
  component: 'Pane',
  requestId: 'note',
  surface: 'terminal',
  props: {
    title: 'Notes',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'note',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

test('write fills the notebook; pane draws tasks as pressable boxes; band counts them', async ($, on) => {
  const files = new Map<string, { text: string; mtimeMs: number }>()
  engine(on, files)
  await $.session.start(START)

  const md = '# Plan\n\n- [ ] one\n- [x] two\n\n```\n- [ ] not a task\n```\n'
  await $.tool.call({ tool: 'mcp__note__write', content: md })
  expect(files.get(FILE)?.text).toBe(md)

  const pane = await $.ui.mount(PANE)
  const drawn = await pane.find({ type: 'Markdown' })
  expect(drawn).toBeDefined()
  await pane.unmount()

  const band = await $.ui.mount(BAND)
  const button = await band.find({ type: 'Button', key: 'toggle' })
  expect(button?.text).toContain('1/2')
  await band.unmount()
})

test('pressing a box ticks the task in the file, fenced lines untouched', async ($, on) => {
  const md = '- [ ] one\n```\n- [ ] fenced\n```\n- [ ] three\n'
  const files = new Map([[FILE, { text: md, mtimeMs: 1 }]])
  engine(on, files)
  await $.session.start(START)

  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'doc', link: { href: 'https://note.invalid/toggle/4' } })
  expect(files.get(FILE)?.text).toBe('- [ ] one\n```\n- [ ] fenced\n```\n- [x] three\n')

  await pane.press({ key: 'doc', link: { href: 'https://note.invalid/toggle/2' } })
  expect(files.get(FILE)?.text).toBe('- [ ] one\n```\n- [ ] fenced\n```\n- [x] three\n')
  await pane.unmount()
})

test('edit replaces a unique fragment and refuses an ambiguous one', async ($, on) => {
  const files = new Map([[FILE, { text: '- [ ] a\n- [ ] a\n- [ ] b\n', mtimeMs: 1 }]])
  engine(on, files)
  await $.session.start(START)

  const ambiguous = await $.tool.call({ tool: 'mcp__note__edit', old_string: '- [ ] a', new_string: 'x' })
  expect(ambiguous.deny).toContain('2 times')

  await $.tool.call({ tool: 'mcp__note__edit', old_string: '- [ ] b', new_string: '- [x] b' })
  expect(files.get(FILE)?.text).toBe('- [ ] a\n- [ ] a\n- [x] b\n')

  await $.tool.call({ tool: 'mcp__note__append', content: '- [ ] c' })
  expect(files.get(FILE)?.text).toBe('- [ ] a\n- [ ] a\n- [x] b\n- [ ] c\n')
})

test('band stays hidden while the notebook is empty', async ($, on) => {
  engine(on, new Map())
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  await $.session.start(START)

  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Button', key: 'toggle' })).toBeUndefined()
  await band.unmount()
})

test('/note list imports another notebook and deletes after a confirm', async ($, on) => {
  const other = `${DIR}/old-1.md`
  const files = new Map([
    [FILE, { text: '# Now\n', mtimeMs: 5 }],
    [other, { text: '# Old plan\n- [ ] x\n', mtimeMs: 3 }],
  ])
  engine(on, files)
  const removed: string[] = []
  on('process.run', (_, e) => {
    const path = e.argv[e.argv.length - 1] ?? ''
    removed.push(path)
    files.delete(path)

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', () => ({ value: undefined }))
  await $.session.start(START)
  await $.command.run({
    command: 'note',
    args: 'list',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 200 },
  })

  const list = await $.ui.mount({ ...PANE, requestId: 'note-list', props: { ...PANE.props, title: 'Notebooks' } })
  expect(await list.find({ type: 'Text', text: /Old plan/ })).toBeDefined()

  await list.press({ key: 'import-old-1' })
  expect(files.get(FILE)?.text).toBe('# Now\n\n# Old plan\n- [ ] x\n')

  await list.press({ key: 'delete-old-1' })
  expect(removed).toEqual([])
  await list.press({ key: 'delete-old-1' })
  expect(removed).toEqual([other])
  await list.unmount()
})
