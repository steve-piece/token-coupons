// Cursor chats come from two places, and the report says which it read.
//
//   the command line  ~/.cursor/projects/<project>/agent-transcripts/<id>/<id>.jsonl
//                     One line per turn, {role, message}, no timestamps and no
//                     model, so a chat is dated by its file and the model is
//                     unknown. Subagent transcripts sit in a subagents folder
//                     beside it and are not read, the same rule Claude Code
//                     gets.
//   the app           one SQLite file, state.vscdb, under the app's own data
//                     folder. Chats are composerData rows; every turn is a
//                     bubbleId row with a type (1 the person, 2 the agent),
//                     text, a timestamp and, for a tool call, the arguments it
//                     ran with. Reading it needs node:sqlite, which arrived in
//                     Node 22.5; on an older Node the report says the app's
//                     chats were not read rather than counting them as empty.
//
// A skill use, either way: the person typed /name, which Cursor answers by
// attaching the skill to the message (a command call), or the agent read a
// SKILL.md on its own (a context call). A read of a skill the person just
// typed is the same use, not a second one.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, basename, dirname } from 'node:path'

import { listDir, escapeRe } from './lib/util.mjs'
import { cursorDir, cursorAppDbCandidates, tildify } from './paths.mjs'

const READ_TOOLS = new Set(['Read', 'ReadFile', 'read_file', 'read_file_v2'])

export function cursorCliTranscripts () {
  const root = join(cursorDir(), 'projects')
  const out = []
  for (const proj of listDir(root)) {
    const at = join(root, proj, 'agent-transcripts')
    for (const id of listDir(at)) {
      const file = join(at, id, id + '.jsonl')
      if (existsSync(file)) out.push({ file, id, project: proj })
    }
  }
  return out
}

/** Both sources in one pass: calls, sessions, and what was and was not read. */
export function scanCursor (since = null) {
  const cli = scanCli(since)
  const app = scanApp(since)
  const sources = [
    { label: 'Cursor command line chats', path: tildify(join(cursorDir(), 'projects')), files: cli.files, read: true },
    app.source,
  ]
  const notes = []
  if (!cli.files) notes.push('no Cursor command line chats found under ' + tildify(join(cursorDir(), 'projects')))
  if (app.note) notes.push(app.note)
  return {
    calls: cli.calls.concat(app.calls),
    sessions: cli.sessions.concat(app.sessions),
    coverage: { measured: cli.sessions.length > 0 || app.read, sources, notes },
  }
}

/* ---------------------------------------------------------- command line */

function scanCli (since) {
  const calls = []
  const sessions = []
  const files = cursorCliTranscripts()
  for (const { file, id, project } of files) {
    let st
    try { st = statSync(file) } catch { continue }
    const lastTs = st.mtime.toISOString()
    const firstTs = (st.birthtime && st.birthtime.getTime() > 0 && st.birthtime <= st.mtime ? st.birthtime : st.mtime).toISOString()
    if (since && lastTs.slice(0, 10) < since) continue
    let raw
    try { raw = readFileSync(file, 'utf8') } catch { continue }
    const s = { client: 'cursor', source: 'cli', id, project, firstTs, lastTs, apiCalls: 0, models: {}, skillCalls: 0 }
    let lastUser = ''
    let seenThisTurn = new Set()
    for (const line of raw.split('\n')) {
      if (!line) continue
      let d
      try { d = JSON.parse(line) } catch { continue }
      const content = d.message && Array.isArray(d.message.content) ? d.message.content : []
      if (d.role === 'user') {
        const texts = content.filter((c) => c && typeof c.text === 'string').map((c) => c.text)
        const query = texts.find((t) => t.includes('<user_query>'))
        const attached = texts.flatMap(attachedSkills)
        if (!query && !attached.length) continue
        seenThisTurn = new Set()
        if (query) lastUser = query.replace(/^[\s\S]*?<user_query>/, '').replace(/<\/user_query>[\s\S]*$/, '')
        for (const a of attached) {
          seenThisTurn.add(a.path)
          calls.push({ client: 'cursor', skill: a.name, bare: a.name, path: a.path, ts: lastTs, mode: 'command', file: basename(file), session: id })
          s.skillCalls++
        }
        if (!attached.length) {
          const typed = slashName(lastUser)
          if (typed) {
            seenThisTurn.add(typed)
            calls.push({ client: 'cursor', skill: typed, bare: typed, path: null, ts: lastTs, mode: 'command', file: basename(file), session: id })
            s.skillCalls++
          }
        }
        continue
      }
      if (d.role !== 'assistant') continue
      s.apiCalls++
      for (const c of content) {
        if (!c || c.type !== 'tool_use' || !READ_TOOLS.has(String(c.name))) continue
        const path = readPath(c.input)
        if (!path) continue
        const bare = basename(dirname(path))
        if (seenThisTurn.has(path) || seenThisTurn.has(bare) || mentionsSlash(lastUser, bare)) continue
        seenThisTurn.add(path)
        calls.push({ client: 'cursor', skill: bare, bare, path, ts: lastTs, mode: 'context', file: basename(file), session: id })
        s.skillCalls++
      }
    }
    if (s.apiCalls > 0 || s.skillCalls > 0) sessions.push(s)
  }
  return { calls, sessions, files: files.length }
}

/* ------------------------------------------------------------------- app */

function scanApp (since) {
  const path = cursorAppDbCandidates().find((p) => existsSync(p)) || null
  const empty = { calls: [], sessions: [], read: false }
  if (!path) {
    return Object.assign(empty, {
      source: { label: 'Cursor app chats', path: tildify(cursorAppDbCandidates()[0]), files: 0, read: false },
      note: 'no Cursor app chat database found, so Cursor usage is from its command line chats only',
    })
  }
  const sqlite = loadSqlite()
  if (!sqlite) {
    return Object.assign(empty, {
      source: { label: 'Cursor app chats', path: tildify(path), files: 0, read: false },
      note: 'the Cursor app keeps its chats in a database this Node version cannot open (node:sqlite needs Node 22.5 or newer), so Cursor usage is from its command line chats only',
    })
  }
  let db
  try {
    db = new sqlite.DatabaseSync(path, { readOnly: true })
    const composers = db.prepare('select key, value from cursorDiskKV where key like ?').all('composerData:%')
    const bubbles = db.prepare('select key, value from cursorDiskKV where key like ? and (value like ? or value like ?)')
      .all('bubbleId:%', '%SKILL.md%', '%"type":1%')
    db.close()
    const out = readAppRows(composers, bubbles, since)
    return Object.assign(out, {
      read: true,
      source: { label: 'Cursor app chats', path: tildify(path), files: composers.length, read: true },
      note: null,
    })
  } catch (e) {
    try { if (db) db.close() } catch { /* already closed */ }
    return Object.assign(empty, {
      source: { label: 'Cursor app chats', path: tildify(path), files: 0, read: false },
      note: 'the Cursor app chat database could not be read (' + (e && e.message ? e.message : String(e)) + '), so Cursor usage is from its command line chats only',
    })
  }
}

/**
 * node:sqlite, when this Node has it. The module announces itself as
 * experimental on load; that warning is silenced here because the report is
 * not the place to read it, and the read is read only.
 */
function loadSqlite () {
  const require = createRequire(import.meta.url)
  const orig = process.emitWarning
  process.emitWarning = function (warning, ...rest) {
    const text = typeof warning === 'string' ? warning : (warning && warning.message) || ''
    if (/sqlite/i.test(text)) return
    return orig.call(process, warning, ...rest)
  }
  try { return require('node:sqlite') } catch { return null } finally { process.emitWarning = orig }
}

/** Composer rows become sessions; bubble rows become calls, walked in time order per chat. */
export function readAppRows (composers, bubbles, since = null) {
  const calls = []
  const sessions = []
  const bySession = new Map()
  for (const row of composers) {
    let o
    try { o = JSON.parse(row.value) } catch { continue }
    const id = String(o.composerId || String(row.key).slice('composerData:'.length))
    const first = isoOf(o.createdAt)
    const last = isoOf(o.lastUpdatedAt) || first
    if (since && last && last.slice(0, 10) < since) continue
    const s = { client: 'cursor', source: 'app', id, project: null, firstTs: first, lastTs: last, apiCalls: 0, models: {}, skillCalls: 0 }
    const model = o.modelConfig && o.modelConfig.modelName
    if (model) s.models[String(model)] = 1
    bySession.set(id, s)
    sessions.push(s)
  }
  const events = new Map()
  for (const row of bubbles) {
    const parts = String(row.key).split(':')
    if (parts.length < 3) continue
    const session = parts[1]
    let o
    try { o = JSON.parse(row.value) } catch { continue }
    const at = isoOf(o.createdAt) || ''
    if (since && at && at.slice(0, 10) < since) continue
    const list = events.get(session) || []
    if (Number(o.type) === 1 && typeof o.text === 'string' && o.text.trim()) list.push({ at, kind: 'user', text: o.text })
    const t = o.toolFormerData
    if (t && READ_TOOLS.has(String(t.name))) {
      const path = readPath(parseArgs(t.rawArgs)) || readPath(parseArgs(t.params))
      if (path) list.push({ at, kind: 'read', path })
    }
    events.set(session, list)
  }
  for (const [session, list] of events) {
    list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    const s = bySession.get(session) || null
    let lastUser = ''
    let seenThisTurn = new Set()
    for (const e of list) {
      if (e.kind === 'user') {
        lastUser = e.text
        seenThisTurn = new Set()
        const typed = slashName(lastUser)
        if (typed) {
          seenThisTurn.add(typed)
          calls.push({ client: 'cursor', skill: typed, bare: typed, path: null, ts: e.at, mode: 'command', file: 'state.vscdb', session })
          if (s) s.skillCalls++
        }
        continue
      }
      const bare = basename(dirname(e.path))
      if (seenThisTurn.has(e.path) || seenThisTurn.has(bare) || mentionsSlash(lastUser, bare)) continue
      seenThisTurn.add(e.path)
      calls.push({ client: 'cursor', skill: bare, bare, path: e.path, ts: e.at, mode: 'context', file: 'state.vscdb', session })
      if (s) s.skillCalls++
    }
  }
  return { calls, sessions }
}

/* ---------------------------------------------------------------- helpers */

/** "Skill Name: x\nPath: /abs/SKILL.md" pairs from an attached skills block. */
function attachedSkills (text) {
  if (!text.includes('<manually_attached_skills>')) return []
  const out = []
  const re = /Skill Name:\s*([^\n]+)\n\s*Path:\s*([^\n]+)/g
  let m
  while ((m = re.exec(text))) out.push({ name: m[1].trim(), path: m[2].trim() })
  return out
}

/** The skill a message starts with when it starts with a slash: /name, /plugin/name or /plugin:name. */
function slashName (text) {
  const m = String(text || '').match(/^\s*\/([A-Za-z0-9_][A-Za-z0-9_./:-]*)/)
  if (!m) return null
  return m[1].split(/[/:]/).filter(Boolean).pop() || null
}

function mentionsSlash (text, bare) {
  return new RegExp('(^|[\\s(`"\'/:])/?' + escapeRe(bare) + '(?![A-Za-z0-9_-])').test(String(text || '')) &&
    new RegExp('/(?:[A-Za-z0-9_.-]+[/:])*' + escapeRe(bare) + '(?![A-Za-z0-9_-])').test(String(text || ''))
}

function readPath (input) {
  if (!input || typeof input !== 'object') return null
  const p = input.path || input.target_file || input.targetFile || input.file || null
  const s = p ? String(p) : ''
  return /\/SKILL\.md$/.test(s) ? s : null
}

function parseArgs (raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try { return JSON.parse(String(raw)) } catch { return null }
}

function isoOf (v) {
  if (v === null || v === undefined || v === '') return null
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
