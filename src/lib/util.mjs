// Shared helpers. No dependencies, so this runs wherever the package lands.

import { readFileSync, readdirSync, statSync, lstatSync, existsSync, realpathSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

export function readText (path) {
  try { return readFileSync(path, 'utf8') } catch { return null }
}

export function readJson (path) {
  const raw = readText(path)
  if (raw === null) return { ok: false, reason: 'unreadable', raw: null, value: null }
  try { return { ok: true, reason: null, raw, value: JSON.parse(raw) } } catch (e) {
    return { ok: false, reason: e.message, raw, value: null }
  }
}

export function isDir (path) {
  try { return statSync(path).isDirectory() } catch { return false }
}

export function isSymlink (path) {
  try { return lstatSync(path).isSymbolicLink() } catch { return false }
}

export function listDir (path) {
  try { return readdirSync(path).sort() } catch { return [] }
}

export function safeReal (p) {
  try { return realpathSync(resolve(p)) } catch { return null }
}

/**
 * Minimal YAML frontmatter reader. Handles exactly the shapes SKILL.md files
 * use: `key: scalar`, `key: [a, b]`, block lists, and block scalars (`>` and
 * `|`, with optional chomping). Not a general YAML parser, deliberately: a real
 * one would be a dependency, and the contract here is narrow.
 *
 * Block scalars matter: a description written as a `>-` paragraph would
 * otherwise measure as one or two characters, and description length is the
 * whole point of this tool.
 */
export function parseFrontmatter (text) {
  const t = String(text || '')
  if (!t.startsWith('---\n')) return { ok: false, reason: 'no opening fence on line 1', data: {}, order: [], endLine: 0 }
  const end = t.indexOf('\n---', 4)
  if (end === -1) return { ok: false, reason: 'no closing fence', data: {}, order: [], endLine: 0 }
  const block = t.slice(4, end)
  const lines = block.split('\n')
  const data = {}
  const order = []
  let currentKey = null
  let scalarKey = null
  let scalarLines = []
  const flushScalar = () => {
    if (scalarKey === null) return
    data[scalarKey] = scalarLines.join(data[scalarKey] === '|' ? '\n' : ' ').trim()
    scalarKey = null; scalarLines = []
  }
  lines.forEach((line, i) => {
    if (scalarKey !== null && (/^\s+\S/.test(line) || line.trim() === '')) {
      scalarLines.push(line.trim())
      return
    }
    flushScalar()
    const blockItem = line.match(/^\s+-\s+(.*)$/)
    if (blockItem && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = []
      data[currentKey].push(unquote(blockItem[1]))
      return
    }
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/)
    if (!kv) return
    const [, key, rest] = kv
    currentKey = key
    order.push({ key, line: i + 2 })
    const val = rest.trim()
    if (val === '') { data[key] = []; return }
    if (/^[>|][-+]?$/.test(val)) { scalarKey = key; data[key] = val[0]; scalarLines = []; return }
    if (val.startsWith('[')) {
      data[key] = val.replace(/^\[|\]$/g, '').split(',').map((s) => unquote(s.trim())).filter(Boolean)
      return
    }
    data[key] = unquote(val)
  })
  flushScalar()
  return { ok: true, reason: null, data, order, endLine: t.slice(0, end).split('\n').length + 1 }
}

function unquote (s) {
  const t = String(s).trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1)
  return t
}

/**
 * Set, replace, or remove one top-level scalar key in a SKILL.md frontmatter
 * block, leaving every other byte of the file alone. `value === null` removes
 * the key. Used by apply to flip `disable-model-invocation`.
 *
 * Only single-line keys are handled. If the target key is a block scalar or a
 * list, the call returns { ok: false } rather than guessing at the edit.
 */
export function setFrontmatterKey (text, key, value) {
  const t = String(text || '')
  if (!t.startsWith('---\n')) return { ok: false, reason: 'no frontmatter', text: t }
  const end = t.indexOf('\n---', 4)
  if (end === -1) return { ok: false, reason: 'no closing fence', text: t }
  const head = t.slice(4, end)
  const tail = t.slice(end)
  const lines = head.split('\n')
  const idx = lines.findIndex((l) => new RegExp('^' + escapeRe(key) + ':').test(l))
  if (idx !== -1) {
    const val = lines[idx].slice(key.length + 1).trim()
    if (/^[>|][-+]?$/.test(val) || val === '') return { ok: false, reason: key + ' is a block value, edit by hand', text: t }
    // swallow any indented continuation lines that would belong to a block
    if (value === null) lines.splice(idx, 1)
    else lines[idx] = key + ': ' + String(value)
  } else if (value !== null) {
    lines.push(key + ': ' + String(value))
  }
  return { ok: true, reason: null, text: '---\n' + lines.join('\n') + tail }
}

export function escapeRe (s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** Every file under `dir`, recursively, as paths relative to `dir`. */
export function walk (dir, out = [], base = dir) {
  for (const name of listDir(dir)) {
    const full = join(dir, name)
    let st
    try { st = lstatSync(full) } catch { continue }
    if (st.isDirectory()) walk(full, out, base)
    else out.push(relative(base, full))
  }
  return out
}

/** Thousands separators. 12345 -> "12,345". */
export function fmt (n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }

/** Money, two decimals, with a $ and thousands separators. */
export function money (n, currency = 'USD') {
  const v = Number(n) || 0
  const s = v.toFixed(v < 1 && v > 0 ? 3 : 2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (currency === 'USD' ? '$' : currency + ' ') + s
}

export { existsSync, join, resolve, relative }
