// Gemini CLI chats: ~/.gemini/tmp/<project hash>/chats/*.json, one file per
// session, as Gemini CLI documents them. A skill use is a call to its
// activate_skill tool, which is how the model takes a skill up; the person
// typing /name shows as that same call preceded by a message that names it.
//
// No Gemini CLI chat existed on the machine this was written on, so the walk
// below is shaped by the tool's documented recording format (Gemini API
// content, role plus parts, with functionCall parts) and reads leniently:
// it looks for activate_skill anywhere in the file and for user text in
// order, and claims nothing when it finds neither.

import { readFileSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

import { listDir, escapeRe } from './lib/util.mjs'
import { geminiDir, tildify } from './paths.mjs'

export function geminiChatFiles () {
  const tmp = join(geminiDir(), 'tmp')
  const out = []
  for (const hash of listDir(tmp)) {
    for (const f of listDir(join(tmp, hash, 'chats'))) if (f.endsWith('.json')) out.push(join(tmp, hash, 'chats', f))
  }
  return out
}

export function scanGemini (since = null) {
  const calls = []
  const sessions = []
  const files = geminiChatFiles()
  for (const file of files) {
    let raw, st
    try { raw = readFileSync(file, 'utf8'); st = statSync(file) } catch { continue }
    let doc
    try { doc = JSON.parse(raw) } catch { continue }
    const fileTs = st.mtime.toISOString()
    const s = { client: 'gemini', source: 'chats', id: basename(file, '.json'), project: null, firstTs: null, lastTs: null, apiCalls: 0, models: {}, skillCalls: 0 }
    let lastUser = ''
    const visit = (node, ts) => {
      if (Array.isArray(node)) { for (const n of node) visit(n, ts); return }
      if (!node || typeof node !== 'object') return
      const own = isoOf(node.timestamp || node.startTime || node.createdAt) || ts
      if (own) {
        if (!s.firstTs || own < s.firstTs) s.firstTs = own
        if (!s.lastTs || own > s.lastTs) s.lastTs = own
      }
      const role = String(node.role || node.type || '')
      if (role === 'user') lastUser = textOf(node)
      if (role === 'model' || role === 'gemini') s.apiCalls++
      if (node.model && typeof node.model === 'string') s.models[node.model] = (s.models[node.model] || 0) + 1
      const fc = node.functionCall
      if (fc && String(fc.name) === 'activate_skill') {
        const args = fc.args || {}
        const name = String(args.name || args.skill || args.skill_name || '').trim()
        if (name && !(since && own && own.slice(0, 10) < since)) {
          const typed = new RegExp('(^|[\\s(`"\'])/' + escapeRe(name) + '(?![A-Za-z0-9_-])').test(lastUser)
          calls.push({ client: 'gemini', skill: name, bare: name, path: null, ts: own || '', mode: typed ? 'command' : 'context', file: basename(file), session: s.id })
          s.skillCalls++
        }
      }
      for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v, own)
    }
    visit(doc, fileTs)
    if (!s.firstTs) s.firstTs = fileTs
    if (!s.lastTs) s.lastTs = fileTs
    if (since && s.lastTs.slice(0, 10) < since) continue
    sessions.push(s)
  }
  return {
    calls,
    sessions,
    coverage: {
      measured: sessions.length > 0,
      sources: [{ label: 'Gemini CLI chats', path: tildify(join(geminiDir(), 'tmp')), files: files.length, read: true }],
      notes: files.length ? [] : ['no Gemini CLI chats found under ' + tildify(join(geminiDir(), 'tmp'))],
    },
  }
}

function textOf (node) {
  if (typeof node.text === 'string') return node.text
  const parts = Array.isArray(node.parts) ? node.parts : (Array.isArray(node.content) ? node.content : [])
  return parts.map((p) => (p && typeof p.text === 'string') ? p.text : '').join('\n')
}

function isoOf (v) {
  if (v === null || v === undefined || v === '') return null
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
