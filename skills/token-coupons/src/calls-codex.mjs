// Codex chats: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl, one file per
// thread, plus the flat archived_sessions folder. Every line carries a
// timestamp and a type. What a skill use looks like, checked against this
// machine's own rollouts rather than taken from a document:
//
//   typed    the person wrote $name. Codex expands it into a user message that
//            starts <skill><name>..</name><path>..</path> and carries the whole
//            SKILL.md, so that block is the call, and it is a command call.
//   chosen   the model ran a command that reads a SKILL.md (cat, sed -n).
//            Codex has no skill tool: reading the file is how it takes a skill
//            up, so that read is a context call. A read of the skill the
//            person just typed is the same use, not a second one, and two
//            reads of one file inside one turn count once.
//
// The model comes from turn_context, tokens from token_count events. Subagent
// threads are their own rollouts and are read like any other; nothing here
// tells them apart, so Codex counts are not a lower bound the way Claude
// Code's are.

import { readFileSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'

import { listDir, walk, escapeRe } from './lib/util.mjs'
import { codexDir, homeDir, tildify } from './paths.mjs'

export function codexTranscriptFiles () {
  const out = []
  const sessions = join(codexDir(), 'sessions')
  for (const rel of walk(sessions)) if (rel.endsWith('.jsonl')) out.push(join(sessions, rel))
  const archived = join(codexDir(), 'archived_sessions')
  for (const f of listDir(archived)) if (f.endsWith('.jsonl')) out.push(join(archived, f))
  return out
}

/** One pass over every rollout: calls, sessions, and what was read to get them. */
export function scanCodex (since = null) {
  const calls = []
  const sessions = []
  const files = codexTranscriptFiles()
  for (const file of files) {
    let raw
    try { raw = readFileSync(file, 'utf8') } catch { continue }
    const s = {
      client: 'codex',
      source: 'rollout',
      id: basename(file, '.jsonl'),
      project: null,
      firstTs: null,
      lastTs: null,
      apiCalls: 0,
      models: {},
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      skillCalls: 0,
      contextWindow: null,
    }
    let lastUser = ''
    let model = ''
    let metaSeen = false
    let seenThisTurn = new Set()
    for (const line of raw.split('\n')) {
      if (!line) continue
      let d
      try { d = JSON.parse(line) } catch { continue }
      const ts = d.timestamp || ''
      if (since && ts && ts.slice(0, 10) < since) continue
      const p = d.payload || {}
      if (d.type === 'session_meta') {
        // a forked thread carries its parent's meta line second; the first is its own
        if (!metaSeen) { metaSeen = true; if (p.id) s.id = String(p.id); if (p.cwd) s.project = String(p.cwd) }
        continue
      }
      if (ts) {
        if (!s.firstTs || ts < s.firstTs) s.firstTs = ts
        if (!s.lastTs || ts > s.lastTs) s.lastTs = ts
      }
      if (d.type === 'turn_context') {
        if (p.model) model = String(p.model)
        seenThisTurn = new Set()
        continue
      }
      if (d.type === 'event_msg') {
        if (p.type === 'user_message') lastUser = String(p.message || '')
        else if (p.type === 'token_count') {
          const u = p.info && p.info.last_token_usage
          if (u) {
            s.apiCalls++
            s.inputTokens += Number(u.input_tokens) || 0
            s.cachedInputTokens += Number(u.cached_input_tokens) || 0
            s.outputTokens += Number(u.output_tokens) || 0
            if (model) s.models[model] = (s.models[model] || 0) + 1
          }
          if (p.info && p.info.model_context_window) s.contextWindow = Number(p.info.model_context_window) || s.contextWindow
        }
        continue
      }
      if (d.type !== 'response_item') continue
      if (p.type === 'message' && p.role === 'user') {
        const m = textOf(p.content).match(/^\s*<skill>\s*<name>([^<]+)<\/name>\s*<path>([^<]+)<\/path>/)
        if (!m) continue
        const path = expandHome(m[2].trim())
        seenThisTurn.add(path)
        calls.push({ client: 'codex', skill: m[1].trim(), bare: m[1].trim(), path, ts, mode: 'command', file: basename(file), session: s.id })
        s.skillCalls++
        continue
      }
      if (p.type === 'function_call') {
        for (const path of skillPathsIn(String(p.arguments || ''))) {
          if (seenThisTurn.has(path)) continue
          const bare = basename(dirname(path))
          // the typed call above already counted this one
          if (mentionsDollar(lastUser, bare)) continue
          seenThisTurn.add(path)
          calls.push({ client: 'codex', skill: bare, bare, path, ts, mode: 'context', file: basename(file), session: s.id })
          s.skillCalls++
        }
      }
    }
    if (s.apiCalls > 0 || s.skillCalls > 0) sessions.push(s)
  }
  return {
    calls,
    sessions,
    coverage: {
      measured: sessions.length > 0,
      sources: [{ label: 'Codex chats', path: tildify(join(codexDir(), 'sessions')), files: files.length, read: true }],
      notes: files.length ? [] : ['no Codex chats found under ' + tildify(join(codexDir(), 'sessions'))],
    },
  }
}

function textOf (content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((c) => (c && typeof c === 'object' && typeof c.text === 'string') ? c.text : '').join('\n')
}

/** Every absolute SKILL.md path in a command string, home shorthands expanded. */
export function skillPathsIn (text) {
  const out = new Set()
  const re = /((?:~|\$HOME|\$CODEX_HOME|\/)[^\s"'`\\]*?\/SKILL\.md)/g
  let m
  while ((m = re.exec(String(text || '')))) out.add(expandHome(m[1]))
  return [...out]
}

function expandHome (p) {
  if (p.startsWith('~/')) return join(homeDir(), p.slice(2))
  if (p.startsWith('$HOME/')) return join(homeDir(), p.slice(6))
  if (p.startsWith('$CODEX_HOME/')) return join(codexDir(), p.slice(12))
  return p
}

function mentionsDollar (text, bare) {
  return new RegExp('(^|[\\s(\\[`"\'])\\$' + escapeRe(bare) + '(?![A-Za-z0-9_-])').test(String(text || ''))
}
