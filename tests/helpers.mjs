// Fixture builder: a fake home directory with skills and transcripts, so every
// module can be tested end to end by pointing TOKEN_COUPONS_HOME at it.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, utimesSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * makeFixtureHome({
 *   skills: [{ name, description, gate: 'true'|'false'|undefined, where: 'user'|'project'|'plugin-cache'|'marketplace'|..., plugin: 'name', mtimeDaysAgo }],
 *   transcripts: [{ session, project, turns: [ {user: 'text'} | {skill: 'name', model, usage} | {assistant: 'text', model, usage} ], dates: [...] }],
 *   settings: { model: 'opus[1m]' },
 *   // the other tools, each created only when asked for, because a tool's folder existing is what makes it "on this machine"
 *   codex: { config: 'toml text', sessions: [{ id, date, cwd, model, turns: [{user} | {skillBlock: {name, path}} | {read: path} | {assistant}] }] },
 *   cursor: { plugins: manifestObject, transcripts: [{ id, project, date, turns: [{user} | {attached: [{name, path}]} | {read: path} | {assistant}] }],
 *             app: { composers: [{ id, createdAt, model, bubbles: [{user: text, at} | {read: path, at}] }] } },
 *   gemini: { chats: [{ name, messages: [{role: 'user', text} | {role: 'model', activate: 'skill'} | {role: 'model', text}] }] },
 * }) -> { home, cleanup, skillPath(name) }
 */
export function makeFixtureHome ({ skills = [], transcripts = [], settings = { model: 'opus[1m]' }, installed = null, knownMarketplaces = null, today = null, codex = null, cursor = null, gemini = null } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'token-coupons-'))
  const paths = {}
  mkdirSync(join(home, '.claude', 'skills'), { recursive: true })
  mkdirSync(join(home, '.claude', 'projects', 'fixture'), { recursive: true })
  if (settings) writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(settings, null, 2))
  if (codex) writeCodex(home, codex)
  if (cursor) writeCursor(home, cursor)
  if (gemini) writeGemini(home, gemini)
  // installed: [{ key: 'plug@mp', marketplace, plugin, version }] writes the registry Claude Code keeps
  if (installed) {
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true })
    const plugins = {}
    for (const i of installed) {
      const installPath = join(home, '.claude', 'plugins', 'cache', i.marketplace || 'mp', i.plugin || 'plug', i.version || '1.0.0')
      plugins[i.key] = [{ scope: 'user', installPath, version: i.version || '1.0.0' }]
    }
    writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins }, null, 2))
  }
  if (knownMarketplaces) {
    mkdirSync(join(home, '.claude', 'plugins'), { recursive: true })
    writeFileSync(join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify(knownMarketplaces, null, 2))
  }

  for (const s of skills) {
    const dir = skillDir(home, s)
    mkdirSync(dir, { recursive: true })
    const fm = ['---', 'name: ' + s.name, 'description: ' + JSON.stringify(s.description || 'A skill.')]
    if (s.gate !== undefined) fm.push('disable-model-invocation: ' + s.gate)
    fm.push('---', '', '# ' + s.name, '', s.body || 'Body.', '')
    writeFileSync(join(dir, 'SKILL.md'), fm.join('\n'))
    if (s.plugin && (s.where === 'plugin-cache' || s.where === 'marketplace' || s.where === 'project-plugin')) {
      const root = join(dir, '..', '..')
      mkdirSync(join(root, '.claude-plugin'), { recursive: true })
      writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: s.plugin, version: '0.0.1' }))
    }
    if (s.symlinkAs) {
      symlinkSync(dir, join(home, '.claude', 'skills', s.symlinkAs))
    }
    // a shortcut in another tool's folder, the way `skills add` links one canonical copy everywhere
    if (s.cursorSymlinkAs) {
      mkdirSync(join(home, '.cursor', 'skills'), { recursive: true })
      symlinkSync(dir, join(home, '.cursor', 'skills', s.cursorSymlinkAs))
    }
    if (s.openaiPolicy !== undefined) {
      mkdirSync(join(dir, 'agents'), { recursive: true })
      writeFileSync(join(dir, 'agents', 'openai.yaml'), 'policy:\n  allow_implicit_invocation: ' + String(s.openaiPolicy) + '\n')
    }
    if (s.mtimeDaysAgo) {
      // Counted back from the same day the report is told it is, not from the
      // real clock. Anchoring these to Date.now() while a test pins `today` to
      // a fixed date makes the gap between them shrink as real time passes,
      // so a skill that was stale when the test was written silently becomes
      // too-new later and the test fails on a day nobody changed anything.
      const from = today ? Date.parse(today + 'T12:00:00Z') : Date.now()
      const t = new Date(from - s.mtimeDaysAgo * 86400000)
      utimesSync(join(dir, 'SKILL.md'), t, t)
    }
    paths[s.name] = dir
  }

  for (const t of transcripts) {
    const proj = join(home, '.claude', 'projects', t.project || 'fixture')
    mkdirSync(proj, { recursive: true })
    const lines = []
    let i = 0
    let offsetMs = 0
    const base = t.date ? new Date(t.date) : new Date('2026-08-01T10:00:00Z')
    const model = t.model || 'claude-opus-5'
    for (const turn of t.turns) {
      // gapMinutes pushes the clock forward before this turn, which is how a
      // fixture reproduces coming back after the prompt cache has expired.
      offsetMs += (Number(turn.gapMinutes) || 0) * 60000
      const ts = new Date(base.getTime() + (i++) * 60000 + offsetMs).toISOString()
      if (turn.user !== undefined) {
        lines.push(JSON.stringify({ type: 'user', sessionId: t.session, timestamp: ts, message: { role: 'user', content: turn.user } }))
      } else if (turn.skill !== undefined) {
        lines.push(JSON.stringify({
          type: 'assistant', sessionId: t.session, timestamp: ts, requestId: 'req_' + i, effort: turn.effort,
          message: { role: 'assistant', model: turn.model || model, id: 'msg_' + i, usage: usageOf(turn), content: [{ type: 'tool_use', id: 'tu_' + i, name: 'Skill', input: { skill: turn.skill } }] },
        }))
        lines.push(JSON.stringify({ type: 'user', sessionId: t.session, timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_' + i, content: 'ok' }] } }))
      } else if (turn.assistant !== undefined) {
        // one response may be stored as two lines sharing a requestId
        const req = 'req_' + i
        lines.push(JSON.stringify({ type: 'assistant', sessionId: t.session, timestamp: ts, requestId: req, effort: turn.effort, message: { role: 'assistant', model: turn.model || model, id: 'msg_' + i, usage: usageOf(turn), content: [{ type: 'text', text: turn.assistant }] } }))
        if (turn.split) lines.push(JSON.stringify({ type: 'assistant', sessionId: t.session, timestamp: ts, requestId: req, message: { role: 'assistant', model: turn.model || model, id: 'msg_' + i, usage: usageOf(turn), content: [{ type: 'text', text: 'second block' }] } }))
      }
    }
    writeFileSync(join(proj, t.session + '.jsonl'), lines.join('\n') + '\n')
  }

  return {
    home,
    skillPath: (name) => paths[name],
    cleanup: () => { try { rmSync(home, { recursive: true, force: true }) } catch { /* best effort */ } },
  }
}

function usageOf (turn) {
  const u = turn.usage || {}
  return {
    input_tokens: u.input ?? 10,
    cache_creation_input_tokens: u.cacheWrite ?? 0,
    cache_read_input_tokens: u.cacheRead ?? 1000,
    output_tokens: u.output ?? 20,
  }
}

function skillDir (home, s) {
  const where = s.where || 'user'
  if (where === 'user') return join(home, '.claude', 'skills', s.name)
  if (where === 'project') return join(home, 'Projects', s.project || 'proj', '.claude', 'skills', s.name)
  if (where === 'project-plugin') return join(home, 'Projects', s.project || 'proj', 'skills', s.name)
  if (where === 'plugin-cache') return join(home, '.claude', 'plugins', 'cache', s.marketplace || 'mp', s.plugin || 'plug', s.version || '1.0.0', 'skills', s.name)
  if (where === 'marketplace') return join(home, '.claude', 'plugins', 'marketplaces', s.marketplace || 'mp', 'skills', s.name)
  if (where === 'agents-dir') return join(home, '.agents', 'skills', s.name)
  if (where === 'agents-nested') return join(home, '.agents', 'skills', s.parent || 'parent', s.name)
  if (where === 'cursor') return join(home, '.cursor', 'skills', s.name)
  if (where === 'cursor-builtin') return join(home, '.cursor', 'skills-cursor', s.name)
  if (where === 'cursor-plugin-cache') return join(home, '.cursor', 'plugins', 'cache', s.marketplace || 'cursor-public', s.pluginId || '100', s.ref || 'abc123', 'skills', s.name)
  if (where === 'cursor-plugin-local') return join(home, '.cursor', 'plugins', 'local', s.plugin || 'dev', 'skills', s.name)
  if (where === 'codex') return join(home, '.codex', 'skills', s.name)
  if (where === 'codex-system') return join(home, '.codex', 'skills', '.system', s.name)
  if (where === 'codex-plugin-cache') return join(home, '.codex', 'plugins', 'cache', s.marketplace || 'mp', s.plugin || 'plug', s.version || '1.0.0', 'skills', s.name)
  if (where === 'gemini') return join(home, '.gemini', 'skills', s.name)
  if (where === 'gemini-extension') return join(home, '.gemini', 'extensions', s.extension || 'ext', 'skills', s.name)
  if (where === 'project-agents') return join(home, 'Projects', s.project || 'proj', '.agents', 'skills', s.name)
  if (where === 'project-codex') return join(home, 'Projects', s.project || 'proj', '.codex', 'skills', s.name)
  if (where === 'project-cursor') return join(home, 'Projects', s.project || 'proj', '.cursor', 'skills', s.name)
  if (where === 'project-gemini') return join(home, 'Projects', s.project || 'proj', '.gemini', 'skills', s.name)
  if (where === 'repo') return join(home, 'Projects', s.project || 'repo', 'skills', s.category || 'cat', s.name)
  throw new Error('unknown where ' + where)
}

/* ------------------------------------------------------------ other tools */

/** ~/.codex: a config.toml and rollout files shaped like the real ones. */
function writeCodex (home, codex) {
  const root = join(home, '.codex')
  const H = (v) => String(v).replace(/__HOME__/g, home)
  mkdirSync(join(root, 'skills'), { recursive: true })
  if (typeof codex.config === 'string') writeFileSync(join(root, 'config.toml'), H(codex.config))
  for (const s of codex.sessions || []) {
    const date = s.date || '2026-08-01T10:00:00Z'
    const day = date.slice(0, 10).split('-')
    const dir = join(root, 'sessions', day[0], day[1], day[2])
    mkdirSync(dir, { recursive: true })
    const base = new Date(date)
    const lines = []
    let i = 0
    const at = () => new Date(base.getTime() + (i++) * 60000).toISOString()
    lines.push(JSON.stringify({ timestamp: at(), type: 'session_meta', payload: { id: s.id, timestamp: date, cwd: s.cwd || join(home, 'Projects', 'proj') } }))
    for (const turn of s.turns || []) {
      if (turn.user !== undefined) {
        lines.push(JSON.stringify({ timestamp: at(), type: 'event_msg', payload: { type: 'user_message', message: turn.user } }))
        lines.push(JSON.stringify({ timestamp: at(), type: 'turn_context', payload: { turn_id: 't' + i, cwd: s.cwd || '', model: s.model || 'gpt-5.4' } }))
      } else if (turn.skillBlock) {
        const b = turn.skillBlock
        lines.push(JSON.stringify({ timestamp: at(), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<skill>\n<name>' + b.name + '</name>\n<path>' + H(b.path) + '</path>\n---\nname: ' + b.name + '\n---\nbody' }] } }))
      } else if (turn.read) {
        lines.push(JSON.stringify({ timestamp: at(), type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: "sed -n '1,200p' " + H(turn.read) }), call_id: 'c' + i } }))
      } else if (turn.assistant !== undefined) {
        lines.push(JSON.stringify({ timestamp: at(), type: 'event_msg', payload: { type: 'agent_message', message: turn.assistant } }))
        lines.push(JSON.stringify({ timestamp: at(), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 }, model_context_window: s.contextWindow || 258400 } } }))
      }
    }
    writeFileSync(join(dir, 'rollout-' + date.replace(/[:.]/g, '-') + '-' + s.id + '.jsonl'), lines.join('\n') + '\n')
  }
}

/** ~/.cursor: the plugin manifest, command line transcripts, and an app database when node:sqlite is here. */
function writeCursor (home, cursor) {
  const root = join(home, '.cursor')
  const H = (v) => String(v).replace(/__HOME__/g, home)
  mkdirSync(join(root, 'skills'), { recursive: true })
  if (cursor.plugins) {
    mkdirSync(join(root, 'plugins', 'cache'), { recursive: true })
    writeFileSync(join(root, 'plugins', 'cache', '.cloud-plugin-manifest.json'), JSON.stringify(cursor.plugins, null, 2))
  }
  for (const t of cursor.transcripts || []) {
    const dir = join(root, 'projects', t.project || 'Users-me-Projects-proj', 'agent-transcripts', t.id)
    mkdirSync(dir, { recursive: true })
    const lines = []
    for (const turn of t.turns || []) {
      if (turn.user !== undefined) {
        lines.push(JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: '<user_query>\n' + turn.user + '\n</user_query>' }] } }))
      } else if (turn.attached) {
        const block = '<manually_attached_skills>\nThe user has manually attached the following skills to their message.\n\n' +
          turn.attached.map((a) => 'Skill Name: ' + a.name + '\nPath: ' + H(a.path) + '\n\n---\nbody\n').join('\n') + '</manually_attached_skills>'
        const content = [{ type: 'text', text: block }]
        if (turn.query !== undefined) content.push({ type: 'text', text: '<user_query>\n' + turn.query + '\n</user_query>' })
        lines.push(JSON.stringify({ role: 'user', message: { content } }))
      } else if (turn.read) {
        lines.push(JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: 'reading' }, { type: 'tool_use', name: 'Read', input: { path: H(turn.read) } }] } }))
      } else if (turn.assistant !== undefined) {
        lines.push(JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: turn.assistant }] } }))
      }
    }
    const file = join(dir, t.id + '.jsonl')
    writeFileSync(file, lines.join('\n') + '\n')
    if (t.date) { const d = new Date(t.date); utimesSync(file, d, d) }
  }
  if (cursor.app) writeCursorApp(home, cursor.app)
}

/**
 * The Cursor app database, only when node:sqlite is available. Tests that
 * need it call hasSqlite() and skip otherwise; the tool itself degrades the
 * same way, which is the behaviour those tests exist to check.
 */
function writeCursorApp (home, app) {
  const sqlite = loadSqlite()
  const H = (v) => String(v).replace(/__HOME__/g, home)
  if (!sqlite) return
  mkdirSync(join(home, 'cursor-app'), { recursive: true })
  const db = new sqlite.DatabaseSync(join(home, 'cursor-app', 'state.vscdb'))
  db.exec('create table cursorDiskKV (key text primary key, value text)')
  const put = db.prepare('insert into cursorDiskKV (key, value) values (?, ?)')
  for (const c of app.composers || []) {
    const bubbles = c.bubbles || []
    put.run('composerData:' + c.id, JSON.stringify({
      composerId: c.id,
      createdAt: new Date(c.createdAt || '2026-08-01T10:00:00Z').getTime(),
      lastUpdatedAt: new Date(c.lastUpdatedAt || c.createdAt || '2026-08-01T10:00:00Z').getTime(),
      modelConfig: { modelName: c.model || 'claude-4.5-opus-high-thinking' },
      fullConversationHeadersOnly: bubbles.map((b, i) => ({ bubbleId: 'b' + i, type: b.user !== undefined ? 1 : 2 })),
    }))
    bubbles.forEach((b, i) => {
      const at = b.at || new Date(new Date(c.createdAt || '2026-08-01T10:00:00Z').getTime() + i * 60000).toISOString()
      const row = b.user !== undefined
        ? { type: 1, text: b.user, createdAt: at }
        : { type: 2, text: '', createdAt: at, toolFormerData: { name: 'read_file_v2', rawArgs: JSON.stringify({ path: H(b.read) }), status: 'completed' } }
      put.run('bubbleId:' + c.id + ':b' + i, JSON.stringify(row))
    })
  }
  db.close()
}

export function hasSqlite () { return Boolean(loadSqlite()) }

function loadSqlite () {
  const orig = process.emitWarning
  process.emitWarning = function (w, ...rest) { if (/sqlite/i.test(typeof w === 'string' ? w : (w && w.message) || '')) return; return orig.call(process, w, ...rest) }
  try { return createRequire(import.meta.url)('node:sqlite') } catch { return null } finally { process.emitWarning = orig }
}

/** ~/.gemini: chats in the Gemini API content shape, one file each under tmp/<hash>/chats. */
function writeGemini (home, gemini) {
  const root = join(home, '.gemini')
  mkdirSync(join(root, 'skills'), { recursive: true })
  for (const chat of gemini.chats || []) {
    const dir = join(root, 'tmp', chat.hash || 'projecthash', 'chats')
    mkdirSync(dir, { recursive: true })
    const messages = (chat.messages || []).map((m) => {
      if (m.activate) return { role: 'model', parts: [{ functionCall: { name: 'activate_skill', args: { name: m.activate } } }] }
      return { role: m.role || 'user', parts: [{ text: m.text || '' }] }
    })
    const file = join(dir, (chat.name || 'session-1') + '.json')
    writeFileSync(file, JSON.stringify({ sessionId: chat.name || 'session-1', startTime: chat.date || '2026-08-01T10:00:00Z', messages }, null, 2))
    if (chat.date) { const d = new Date(chat.date); utimesSync(file, d, d) }
  }
}

/** Run a callback with TOKEN_COUPONS_HOME pointed at a fixture, restoring after. */
export async function withHome (home, fn) {
  const prev = process.env.TOKEN_COUPONS_HOME
  process.env.TOKEN_COUPONS_HOME = home
  try { return await fn() } finally {
    if (prev === undefined) delete process.env.TOKEN_COUPONS_HOME
    else process.env.TOKEN_COUPONS_HOME = prev
  }
}
