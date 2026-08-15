// Calls and sessions, both read from ~/.claude/projects/*/*.jsonl with no
// instrumentation. Two things come out of the same walk:
//
//   calls     every Skill tool invocation, attributed by exact name and
//             classified active (the user typed /<skill>) or passive (the
//             router chose it)
//   sessions  every top-level session: how many API calls it made, on which
//             models, and how many input tokens it sent. Every API call
//             re-sends the system prompt, and the skill listing rides in it,
//             so API calls per session is the multiplier that turns a listing
//             size into a cost.
//
// Subagent transcripts (the <session>/subagents/*.jsonl files) are not read.
// Subagents carry their own listing, so everything here is a lower bound.

import { readFileSync } from 'node:fs'
import { join, basename } from 'node:path'

import { listDir } from './lib/util.mjs'
import { projectsDir } from './paths.mjs'

export function transcriptFiles () {
  const root = projectsDir()
  const out = []
  for (const proj of listDir(root)) {
    for (const f of listDir(join(root, proj))) {
      if (f.endsWith('.jsonl')) out.push(join(root, proj, f))
    }
  }
  return out
}

function textOf (content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((c) => (c && typeof c === 'object' && typeof c.text === 'string') ? c.text : '').join('\n')
}

function escapeRe (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/**
 * Walk each transcript in order. Track the most recent human turn. When a
 * Skill tool call appears, look for /<name> or /<plugin:name> as literal text
 * in that turn: present means the human summoned it (active), absent means
 * the agent chose it (passive). Skill-backed slashes are recorded this way;
 * the <command-name> marker exists only for standalone command stubs.
 */
export function collectCalls (since = null) {
  return scanTranscripts(since).calls
}

export function collectSessions (since = null) {
  return scanTranscripts(since).sessions
}

/** One pass over every transcript, producing both calls and session stats. */
export function scanTranscripts (since = null) {
  const calls = []
  const sessions = []
  for (const file of transcriptFiles()) {
    let raw
    try { raw = readFileSync(file, 'utf8') } catch { continue }
    let lastUser = ''
    const seenReq = new Set()
    const s = {
      id: basename(file, '.jsonl'),
      project: basename(join(file, '..')),
      firstTs: null,
      lastTs: null,
      apiCalls: 0,
      models: {},
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      skillCalls: 0,
    }
    for (const line of raw.split('\n')) {
      if (!line) continue
      let d
      try { d = JSON.parse(line) } catch { continue }
      const ts = d.timestamp || ''
      if (since && ts && ts.slice(0, 10) < since) continue
      const msg = d.message
      if (!msg) continue
      if (ts) {
        if (!s.firstTs || ts < s.firstTs) s.firstTs = ts
        if (!s.lastTs || ts > s.lastTs) s.lastTs = ts
      }
      if (msg.role === 'user') {
        // tool_result turns are also role user; only replace lastUser when a human typed
        const t = textOf(msg.content)
        const hasToolResult = Array.isArray(msg.content) && msg.content.some((c) => c && c.type === 'tool_result')
        if (!hasToolResult && t.trim()) lastUser = t
        continue
      }
      if (msg.role !== 'assistant') continue
      // One API response is stored as several lines (one per content block)
      // sharing a requestId, each repeating the same usage. Count it once.
      const req = d.requestId || msg.id || null
      const model = String(msg.model || '')
      if (req && !seenReq.has(req) && model && model !== '<synthetic>') {
        seenReq.add(req)
        s.apiCalls++
        s.models[model] = (s.models[model] || 0) + 1
        const u = msg.usage || {}
        const inp = Number(u.input_tokens) || 0
        const cr = Number(u.cache_read_input_tokens) || 0
        const cw = Number(u.cache_creation_input_tokens) || 0
        s.uncachedInputTokens += inp
        s.cacheReadTokens += cr
        s.cacheWriteTokens += cw
        s.inputTokens += inp + cr + cw
        s.outputTokens += Number(u.output_tokens) || 0
      }
      if (!Array.isArray(msg.content)) continue
      for (const c of msg.content) {
        if (!c || c.type !== 'tool_use' || c.name !== 'Skill') continue
        const skill = String((c.input && c.input.skill) || '')
        if (!skill) continue
        const bare = skill.split(':').pop()
        const summoned = new RegExp('(^|[\\s(`"\'])/(' + escapeRe(skill) + '|' + escapeRe(bare) + ')(?![A-Za-z0-9_-])').test(lastUser)
        calls.push({ skill, bare, ts, mode: summoned ? 'active' : 'passive', file: basename(file), session: s.id })
        s.skillCalls++
      }
    }
    if (s.apiCalls > 0) sessions.push(s)
  }
  return { calls, sessions }
}

/**
 * Aggregate the session list into the multipliers the cost model needs.
 * Everything is measured; the only assumptions are the fallbacks used when
 * there is no history at all, and those are labelled as such.
 */
export function sessionStats (sessions, { since = null, today = null } = {}) {
  const now = today ? new Date(today) : new Date()
  const withTs = sessions.filter((s) => s.firstTs)
  const first = withTs.length ? withTs.map((s) => s.firstTs).sort()[0] : null
  const start = since ? new Date(since) : (first ? new Date(first) : now)
  const days = Math.max(1, Math.round((now - start) / 86400000))
  const n = sessions.length
  const apiCalls = sessions.map((s) => s.apiCalls).sort((a, b) => a - b)
  const median = apiCalls.length ? apiCalls[Math.floor(apiCalls.length / 2)] : 0
  const mean = apiCalls.length ? apiCalls.reduce((a, b) => a + b, 0) / apiCalls.length : 0
  const totalInput = sessions.reduce((a, s) => a + s.inputTokens, 0)
  const totalCacheRead = sessions.reduce((a, s) => a + s.cacheReadTokens, 0)
  const totalCacheWrite = sessions.reduce((a, s) => a + s.cacheWriteTokens, 0)
  const models = {}
  for (const s of sessions) for (const [m, c] of Object.entries(s.models)) models[m] = (models[m] || 0) + c
  const measured = n > 0
  return {
    measured,
    sessions: n,
    days,
    firstSession: first ? first.slice(0, 10) : null,
    sessionsPerDay: measured ? +(n / days).toFixed(2) : 3,
    sessionsPerWeek: measured ? +((n / days) * 7).toFixed(1) : 21,
    apiCallsPerSessionMedian: measured ? median : 25,
    apiCallsPerSessionMean: measured ? +mean.toFixed(1) : 25,
    apiCallsTotal: apiCalls.reduce((a, b) => a + b, 0),
    inputTokensTotal: totalInput,
    inputTokensPerWeek: measured ? Math.round((totalInput / days) * 7) : 0,
    cacheReadShare: totalInput ? +(totalCacheRead / totalInput).toFixed(3) : 0,
    cacheWriteShare: totalInput ? +(totalCacheWrite / totalInput).toFixed(3) : 0,
    modelsSeen: Object.entries(models).sort((a, b) => b[1] - a[1]).map(([model, apiCalls]) => ({ model, apiCalls })),
    note: measured
      ? 'measured from session transcripts'
      : 'no session history found; using assumed 3 sessions per day and 25 API calls per session',
  }
}
