/** The current session's notebook as last read from disk. */
export type Doc = { sessionId: string; text: string; mtimeMs: number }

/** One notebook file, as `/note list` shows it. */
export type Entry = {
  id: string
  title: string
  mtimeMs: number
  size: number
  isCurrent: boolean
}

declare module 'claude-code' {
  interface PluginState {
    note: {
      doc: Shaped<Doc>
      entries: Shaped<Entry[]>
      /** Id of the notebook whose Delete was pressed once and awaits a confirm. */
      pendingDelete: string
    }
  }
}
