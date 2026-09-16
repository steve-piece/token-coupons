// The tools that read skills. Claude Code is the one this tool prices; the
// others are read so a skill kept for Codex, Cursor or Gemini CLI is a row in
// the report rather than a blind spot, and so "never used" can mean never used
// anywhere on the machine rather than never used here.
//
// Each client is a small record: where it keeps its skills, whether it honours
// the disable-model-invocation line, and how it spells an explicit call. The
// per client listing verdict (does THIS client put THIS skill in its list from
// this working directory) lives here too, beside the config files it reads to
// decide. Every rule below was checked against a real machine or the client's
// own documentation; where a client publishes no rule the verdict says so
// instead of guessing.

import { existsSync, realpathSync } from 'node:fs'
import { join, sep, relative } from 'node:path'

import { listDir, isDir, readText, readJson } from './lib/util.mjs'
import { homeDir, claudeDir, agentsDir, codexDir, cursorDir, geminiDir, etcCodexSkillsDir, tildify } from './paths.mjs'
import { nameLineChars, CHARS_PER_TOKEN } from './budget.mjs'

export const CLIENTS = [
  { id: 'claude', label: 'Claude Code', sigil: '/', honoursGate: true, dir: claudeDir },
  { id: 'codex', label: 'Codex', sigil: '$', honoursGate: false, dir: codexDir },
  { id: 'cursor', label: 'Cursor', sigil: '/', honoursGate: true, dir: cursorDir },
  { id: 'gemini', label: 'Gemini CLI', sigil: '/', honoursGate: false, dir: geminiDir },
]

export function clientById (id) { return CLIENTS.find((c) => c.id === id) || null }
export function clientLabel (id) { const c = clientById(id); return c ? c.label : String(id) }

/** A client counts as on this machine when its dot folder exists. */
export function presentClients () { return CLIENTS.filter((c) => isDir(c.dir())) }

/** The clients other than Claude Code that read the disable-model-invocation line. */
export const GATE_HONOURING = CLIENTS.filter((c) => c.honoursGate && c.id !== 'claude').map((c) => c.id)

/* ------------------------------------------------------------------ roots */

/**
 * Every folder the other tools read skills out of, with how deep to look.
 * Claude Code's own roots stay in discover.mjs. A depth above one means
 * skills inside skills are listed too: Codex lists
 * ~/.agents/skills/resend/templates beside ~/.agents/skills/resend, and
 * Cursor's plugin cache nests a marketplace, a plugin id, a commit and then
 * whatever path the plugin declared, so it is walked rather than addressed.
 */
export function otherToolRoots () {
  const out = []
  const push = (dir, depth = 1) => { if (isDir(dir)) out.push({ dir, depth }) }
  push(join(agentsDir(), 'skills'), 3)
  push(join(codexDir(), 'skills'))
  push(join(codexDir(), 'skills', '.system'))
  push(etcCodexSkillsDir())
  const codexCache = join(codexDir(), 'plugins', 'cache')
  for (const mp of listDir(codexCache)) {
    for (const plugin of listDir(join(codexCache, mp))) {
      for (const ver of listDir(join(codexCache, mp, plugin))) push(join(codexCache, mp, plugin, ver, 'skills'))
    }
  }
  push(join(cursorDir(), 'skills'))
  push(join(cursorDir(), 'skills-cursor'))
  for (const name of listDir(join(cursorDir(), 'plugins', 'local'))) push(join(cursorDir(), 'plugins', 'local', name, 'skills'))
  push(join(cursorDir(), 'plugins', 'cache'), 9)
  push(join(geminiDir(), 'skills'))
  for (const name of listDir(join(geminiDir(), 'extensions'))) push(join(geminiDir(), 'extensions', name, 'skills'))
  return out
}

/**
 * The skill directories under a root: the root itself when it is a skill,
 * else its children, and below that only when `depth` allows. Hidden folders,
 * node_modules and .git are skipped below the first level; a hidden root such
 * as ~/.codex/skills/.system is always added explicitly.
 */
export function skillDirsUnder (root, depth = 1) {
  if (existsSync(join(root, 'SKILL.md'))) return [root]
  const out = []
  const walk = (dir, left, top) => {
    for (const name of listDir(dir)) {
      if (!top && (name.startsWith('.') || name === 'node_modules')) continue
      if (name === '.git' || name === 'node_modules') continue
      const full = join(dir, name)
      if (!isDir(full)) continue
      if (existsSync(join(full, 'SKILL.md'))) out.push(full)
      if (left > 1) walk(full, left - 1, false)
    }
  }
  walk(root, Math.max(1, Number(depth) || 1), true)
  return out
}

/* ------------------------------------------------------------------ config */

/**
 * Codex's own config: which plugins are enabled and which skills are switched
 * off by absolute path. A reader for exactly the two table shapes involved,
 * not a TOML parser; anything else in the file is passed over.
 *
 *   [[skills.config]]                 path = "/abs/SKILL.md"   enabled = false
 *   [plugins."github@openai-curated"] enabled = true
 */
export function readCodexConfig () {
  const text = readText(join(codexDir(), 'config.toml'))
  const out = { ok: text !== null, disabledPaths: new Set(), plugins: new Map() }
  if (text === null) return out
  let section = null
  let cur = {}
  const flush = () => {
    if (section && section.kind === 'skill' && cur.path && String(cur.enabled).toLowerCase() === 'false') {
      out.disabledPaths.add(cur.path)
      const real = safeReal(cur.path)
      if (real) out.disabledPaths.add(real)
    }
    if (section && section.kind === 'plugin' && cur.enabled !== undefined) out.plugins.set(section.key, String(cur.enabled).toLowerCase() === 'true')
    cur = {}
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    let m
    if ((m = line.match(/^\[\[\s*skills\.config\s*\]\]/))) { flush(); section = { kind: 'skill' }; continue }
    if ((m = line.match(/^\[\s*plugins\.\s*"([^"]+)"\s*\]/))) { flush(); section = { kind: 'plugin', key: m[1] }; continue }
    if (line.startsWith('[')) { flush(); section = null; continue }
    if (!section) continue
    if ((m = line.match(/^([A-Za-z_]+)\s*=\s*(.+?)\s*$/))) cur[m[1]] = unquote(m[2])
  }
  flush()
  return out
}

/**
 * Codex's per skill sidecar, agents/openai.yaml. Only one line matters here:
 * policy.allow_implicit_invocation false keeps the skill out of the model's
 * list entirely while $name still reaches it. Returns true, false, or null
 * when there is no sidecar or it says nothing about it.
 */
export function codexImplicitPolicy (skillDir) {
  const text = readText(join(skillDir, 'agents', 'openai.yaml'))
  if (text === null) return null
  const m = text.match(/^\s*allow_implicit_invocation\s*:\s*(true|false)\b/m)
  return m ? m[1] === 'true' : null
}

/**
 * What Cursor has installed from its marketplace, from the manifest it keeps
 * beside the cache. A plugin with no enabled capabilities contributes nothing.
 */
export function readCursorPlugins () {
  const res = readJson(join(cursorDir(), 'plugins', 'cache', '.cloud-plugin-manifest.json'))
  const plugins = []
  if (res.ok && res.value && Array.isArray(res.value.plugins)) {
    for (const p of res.value.plugins) {
      if (!p || !p.name) continue
      plugins.push({
        name: String(p.name),
        enabled: Array.isArray(p.enabledCapabilities) && p.enabledCapabilities.length > 0,
        ref: p.gitRef ? String(p.gitRef) : null,
        skillPaths: (((p.declaredCapabilityPaths || {}).skill) || []).map(String),
      })
    }
  }
  return { ok: res.ok, plugins }
}

/** Everything the verdicts below read, gathered once per discovery pass. */
export function clientState () {
  return {
    present: new Set(presentClients().map((c) => c.id)),
    codex: readCodexConfig(),
    cursor: readCursorPlugins(),
  }
}

/* ---------------------------------------------------------------- verdicts */

/**
 * Whether each client on this machine lists the skill from `cwd`, and why, in
 * one plain sentence each. Claude Code's verdict is made in discover.mjs and
 * handed in, so the four are returned together.
 *
 * @param row    a Skill row with realPath and aliases
 * @param claude { listed, reason } from discover's loadedState
 */
export function listingVerdicts (row, { cwd, state, claude }) {
  const paths = [row.realPath].concat(Array.isArray(row.aliases) ? row.aliases : []).filter(Boolean)
  const out = {}
  if (state.present.has('claude')) out.claude = { listed: Boolean(claude && claude.listed), reason: (claude && claude.reason) || '' }
  if (state.present.has('codex')) out.codex = codexVerdict(paths, row, cwd, state.codex)
  if (state.present.has('cursor')) out.cursor = cursorVerdict(paths, cwd, state.cursor)
  if (state.present.has('gemini')) out.gemini = geminiVerdict(paths, cwd)
  return out
}

const yes = (reason) => ({ listed: true, reason })
const no = (reason) => ({ listed: false, reason })

function codexVerdict (paths, row, cwd, cfg) {
  const skillsDir = join(codexDir(), 'skills')
  if (paths.some((p) => cfg.disabledPaths.has(join(p, 'SKILL.md')))) return no('switched off in ~/.codex/config.toml')
  if (row.codexImplicit === false) return no('its agents/openai.yaml keeps it out of the list; only $' + row.name + ' reaches it')
  if (paths.some((p) => under(p, join(skillsDir, '.system')))) return yes('ships with Codex')
  if (paths.some((p) => under(p, skillsDir))) return yes('in ' + tildify(skillsDir))
  if (paths.some((p) => under(p, join(agentsDir(), 'skills')))) return yes('in ~/.agents/skills')
  if (paths.some((p) => under(p, etcCodexSkillsDir()))) return yes('in /etc/codex/skills')
  const cache = join(codexDir(), 'plugins', 'cache')
  const cached = paths.find((p) => under(p, cache))
  if (cached) {
    const [mp, plugin] = relative(rootFor(cached, cache), cached).split(sep)
    const key = plugin + '@' + mp
    const on = cfg.plugins.get(key)
    if (on === true) return yes('enabled plugin ' + key)
    return no('plugin ' + key + (on === false ? ' is switched off' : ' is not enabled') + ' in ~/.codex/config.toml')
  }
  const proj = projectOf(paths, ['agents', 'codex'])
  if (proj) return insideCwd(proj.root, cwd) ? yes('project skill, and you are working in that project') : no('project skill; Codex lists it only when you work in ' + tildify(proj.root))
  return no('outside every folder Codex reads')
}

function cursorVerdict (paths, cwd, manifest) {
  const cd = cursorDir()
  if (paths.some((p) => under(p, join(cd, 'skills-cursor')))) return yes('ships with Cursor')
  if (paths.some((p) => under(p, join(cd, 'skills')))) return yes('in ~/.cursor/skills')
  const agents = join(agentsDir(), 'skills')
  const inAgents = paths.find((p) => under(p, agents))
  if (inAgents) {
    return depthBelow(inAgents, agents) === 1
      ? yes('in ~/.agents/skills')
      : no('nested inside another skill in ~/.agents/skills, and Cursor publishes no rule for those, so it is not counted')
  }
  for (const [dir, label] of [[join(claudeDir(), 'skills'), '~/.claude/skills'], [join(codexDir(), 'skills'), '~/.codex/skills']]) {
    if (paths.some((p) => under(p, dir) && depthBelow(p, dir) === 1)) return yes('in ' + label + ', which Cursor also reads')
  }
  if (paths.some((p) => under(p, join(cd, 'plugins', 'local')))) return yes('a plugin under development in ~/.cursor/plugins/local')
  const cache = join(cd, 'plugins', 'cache')
  const cached = paths.find((p) => under(p, cache))
  if (cached) return cursorCacheVerdict(cached, manifest)
  const proj = projectOf(paths, ['cursor', 'agents', 'claude', 'codex'])
  if (proj) return insideCwd(proj.root, cwd) ? yes('project skill, and you are working in that project') : no('project skill; Cursor lists it only when you work in ' + tildify(proj.root))
  return no('outside every folder Cursor reads')
}

/**
 * Cursor caches a plugin twice, under its numeric id and under its name, and
 * marks the copy it actually installed with a file beside it: <commit>.installed.
 * When that marker exists anywhere for the commit, only the copy beside it
 * counts; the manifest settles enabled or disabled after that.
 */
function cursorCacheVerdict (dir, manifest) {
  const m = dir.match(/^(.*\/plugins\/cache\/[^/]+)\/([^/]+)\/([^/]+)(?:\/|$)/)
  if (m) {
    const [, mp, entry, ref] = m
    const mine = existsSync(join(mp, entry, ref + '.installed'))
    if (!mine) {
      const marked = listDir(mp).find((other) => other !== entry && existsSync(join(mp, other, ref + '.installed')))
      if (marked) return no('a second copy of the installed version; Cursor loads the one under ' + marked)
    }
  }
  if (!manifest.ok) return yes('plugin in the cache')
  const md = join(dir, 'SKILL.md')
  let declaredElsewhere = null
  for (const p of manifest.plugins) {
    if (!p.skillPaths.some((sp) => md.endsWith('/' + sp))) continue
    if (p.ref && !dir.includes(sep + p.ref + sep)) { declaredElsewhere = p; continue }
    return p.enabled ? yes('enabled plugin ' + p.name) : no('plugin ' + p.name + ' is installed but disabled')
  }
  if (declaredElsewhere) return no('an older version left in the plugin cache; not the installed one')
  return no('no plugin Cursor has installed declares it')
}

function geminiVerdict (paths, cwd) {
  const gd = geminiDir()
  if (paths.some((p) => under(p, join(gd, 'skills')))) return yes('in ~/.gemini/skills')
  const ext = join(gd, 'extensions')
  const inExt = paths.find((p) => under(p, ext))
  if (inExt) return yes('part of the ' + relative(rootFor(inExt, ext), inExt).split(sep)[0] + ' extension')
  const proj = projectOf(paths, ['gemini'])
  if (proj) return insideCwd(proj.root, cwd) ? yes('project skill, and you are working in that project') : no('project skill; Gemini CLI lists it only when you work in ' + tildify(proj.root))
  return no('outside every folder Gemini CLI reads')
}

/* ------------------------------------------------------------- list sizes */

/**
 * What one row costs in a client's list. Claude Code's shape is in budget.mjs
 * and is reused for the clients that publish no format. Codex is measured:
 * it writes "- name: description (file: /abs/path/SKILL.md)" per skill.
 */
export function entryChars (clientId, { name, descriptionChars, path }) {
  const desc = Number(descriptionChars) || 0
  if (clientId === 'codex') return String(name).length + desc + String(path || '').length + 12
  return nameLineChars(name) + desc
}

/**
 * The room a client gives its list. Codex documents 2 percent of the model's
 * context window, or 8,000 characters when the window is unknown; the rest
 * publish nothing, and null says so rather than inventing one.
 */
export function listingBudgetFor (clientId, { contextWindow = null } = {}) {
  if (clientId === 'codex') {
    const win = Number(contextWindow) || 0
    const chars = win ? Math.round(win * 0.02) * CHARS_PER_TOKEN : 8000
    return { chars, tokens: Math.round(chars / CHARS_PER_TOKEN), contextWindow: win || null, source: win ? '2 percent of a ' + win + ' token window, seen in its chats' : '8,000 characters, the documented fallback when the window is unknown' }
  }
  return null
}

/* ---------------------------------------------------------------- helpers */

/**
 * Whether `p` sits at or below `root`, with the root taken as given and as
 * resolved. Rows carry real paths and the roots come from homeDir(), so on a
 * home behind a symlink (macOS keeps its temp folders under /private) the two
 * only meet once one of them is resolved.
 */
export function under (p, root) { return rootFor(p, root) !== null }

/** The form of `root` (as given or resolved) that `p` is under, or null. */
function rootFor (p, root) {
  if (!p || !root) return null
  if (p === root || p.startsWith(root + sep)) return root
  const real = realRoot(root)
  if (real && real !== root && (p === real || p.startsWith(real + sep))) return real
  return null
}

const realRoots = new Map()
function realRoot (root) {
  if (!realRoots.has(root)) realRoots.set(root, safeReal(root))
  return realRoots.get(root)
}

function depthBelow (p, root) {
  const base = rootFor(p, root)
  return base ? relative(base, p).split(sep).filter(Boolean).length : 0
}
function unquote (s) { const t = String(s).trim(); return (/^".*"$/.test(t) || /^'.*'$/.test(t)) ? t.slice(1, -1) : t }
function safeReal (p) { try { return realpathSync(p) } catch { return null } }

/**
 * The project root when any path sits in a project's .<tool>/skills, else
 * null. The home folder is not a project: ~/.codex/skills matches the same
 * shape and is a tool's own folder, handled before this is asked.
 */
function projectOf (paths, tools) {
  const re = new RegExp('^(.*)/\\.(' + tools.join('|') + ')/skills/.+$')
  const home = homeDir()
  const homes = new Set([home, realRoot(home)].filter(Boolean))
  for (const p of paths) {
    const m = String(p).match(re)
    if (m && !homes.has(m[1])) return { root: m[1], tool: m[2] }
  }
  return null
}

/**
 * Whether cwd sits at or below the project root, comparing each side as given
 * and as resolved, so a home behind a symlink and a cwd that does not exist
 * yet both compare like any other path.
 */
export function insideCwd (projectRoot, cwd) {
  const roots = [projectRoot, safeReal(projectRoot)].filter(Boolean)
  const cwds = [cwd, safeReal(cwd)].filter(Boolean)
  return cwds.some((c) => roots.some((r) => c === r || c.startsWith(r + sep)))
}
