// Fixture builder: a fake home directory with skills and transcripts, so every
// module can be tested end to end by pointing TOKEN_COUPONS_HOME at it.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * makeFixtureHome({
 *   skills: [{ name, description, gate: 'true'|'false'|undefined, where: 'user'|'project'|'plugin-cache'|'marketplace', plugin: 'name', mtimeDaysAgo }],
 *   transcripts: [{ session, project, turns: [ {user: 'text'} | {skill: 'name', model, usage} | {assistant: 'text', model, usage} ], dates: [...] }],
 *   settings: { model: 'opus[1m]' },
 * }) -> { home, cleanup, skillPath(name) }
 */
export function makeFixtureHome ({ skills = [], transcripts = [], settings = { model: 'opus[1m]' }, installed = null, knownMarketplaces = null } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'token-coupons-'))
  const paths = {}
  mkdirSync(join(home, '.claude', 'skills'), { recursive: true })
  mkdirSync(join(home, '.claude', 'projects', 'fixture'), { recursive: true })
  if (settings) writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(settings, null, 2))
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
    if (s.mtimeDaysAgo) {
      const t = new Date(Date.now() - s.mtimeDaysAgo * 86400000)
      utimesSync(join(dir, 'SKILL.md'), t, t)
    }
    paths[s.name] = dir
  }

  for (const t of transcripts) {
    const proj = join(home, '.claude', 'projects', t.project || 'fixture')
    mkdirSync(proj, { recursive: true })
    const lines = []
    let i = 0
    const base = t.date ? new Date(t.date) : new Date('2026-08-01T10:00:00Z')
    const model = t.model || 'claude-opus-5'
    for (const turn of t.turns) {
      const ts = new Date(base.getTime() + (i++) * 60000).toISOString()
      if (turn.user !== undefined) {
        lines.push(JSON.stringify({ type: 'user', sessionId: t.session, timestamp: ts, message: { role: 'user', content: turn.user } }))
      } else if (turn.skill !== undefined) {
        lines.push(JSON.stringify({
          type: 'assistant', sessionId: t.session, timestamp: ts, requestId: 'req_' + i,
          message: { role: 'assistant', model: turn.model || model, id: 'msg_' + i, usage: usageOf(turn), content: [{ type: 'tool_use', id: 'tu_' + i, name: 'Skill', input: { skill: turn.skill } }] },
        }))
        lines.push(JSON.stringify({ type: 'user', sessionId: t.session, timestamp: ts, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_' + i, content: 'ok' }] } }))
      } else if (turn.assistant !== undefined) {
        // one response may be stored as two lines sharing a requestId
        const req = 'req_' + i
        lines.push(JSON.stringify({ type: 'assistant', sessionId: t.session, timestamp: ts, requestId: req, message: { role: 'assistant', model: turn.model || model, id: 'msg_' + i, usage: usageOf(turn), content: [{ type: 'text', text: turn.assistant }] } }))
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
  if (where === 'cursor') return join(home, '.cursor', 'skills', s.name)
  if (where === 'repo') return join(home, 'Projects', s.project || 'repo', 'skills', s.category || 'cat', s.name)
  throw new Error('unknown where ' + where)
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
