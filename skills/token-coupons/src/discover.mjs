// Discovery: every skill the machine can see, what its frontmatter declares,
// where it lives, and whether Claude Code actually puts it in the listing.
//
// A skill is a directory with SKILL.md; the invocable name is the directory
// name, prefixed with plugin: when it lives inside a plugin. Rows are
// deduplicated by real path so a symlinked skill is one row with aliases.
//
// Claude Code's folders come first (code.claude.com/docs/en/skills):
// ~/.claude/skills, the .claude/skills of the project you are working in, and
// the skills of ENABLED plugins from the plugin cache. `loaded` on a row means
// Claude Code lists it from the working directory, and that is the list the
// rest of the tool prices.
//
// The folders the other tools read (Codex, Cursor, Gemini CLI, and the shared
// ~/.agents/skills) are scanned as well, from clients.mjs, so every skill on
// the machine is a row. Each row says which clients list it in `listing`, one
// verdict per client on this machine, and `listedIn` is the short form. A row
// no client lists, or that only another tool lists, is reported as notLoaded
// rather than priced: it costs Claude Code nothing per message.
//
// Of what is scanned, not all is in any list: marketplace checkouts, plugin
// source repos, other projects, disabled plugins and stale cache versions sit
// on disk without costing anything. Those are notLoaded too, with the reason.

import { existsSync, realpathSync, statSync } from 'node:fs'
import { join, basename, dirname, sep } from 'node:path'

import { listDir, isDir, isSymlink, parseFrontmatter, readText, readJson } from './lib/util.mjs'
import { homeDir, claudeDir, pluginsDir, settingsFiles, agentsDir, codexDir, cursorDir, geminiDir, etcCodexSkillsDir } from './paths.mjs'
import { otherToolRoots, skillDirsUnder, clientState, listingVerdicts, codexImplicitPolicy, insideCwd, under } from './clients.mjs'

export function skillRoots () {
  const HOME = homeDir()
  const roots = [join(claudeDir(), 'skills')]
  const marketplaces = join(pluginsDir(), 'marketplaces')
  for (const mp of listDir(marketplaces)) {
    roots.push(join(marketplaces, mp, 'skills'))
    // marketplaces that are themselves collections of single-skill plugins
    for (const sub of listDir(join(marketplaces, mp))) {
      const d = join(marketplaces, mp, sub)
      if (isDir(d) && existsSync(join(d, 'SKILL.md'))) roots.push(join(marketplaces, mp))
    }
  }
  const cache = join(pluginsDir(), 'cache')
  for (const mp of listDir(cache)) {
    for (const plugin of listDir(join(cache, mp))) {
      for (const ver of listDir(join(cache, mp, plugin))) {
        roots.push(join(cache, mp, plugin, ver, 'skills'))
        roots.push(join(cache, mp, plugin, ver, '.claude', 'skills'))
      }
    }
  }
  // project-level skills under ~/Projects, shallow. The other tools' project
  // folders are collected here too, so a repo's .agents/skills is a row.
  const projects = join(HOME, 'Projects')
  for (const rel of walkDirs(projects, 4)) {
    if (basename(rel) === 'skills') roots.push(join(projects, rel))
    if (PROJECT_TOOL_DIRS.has(basename(rel))) roots.push(join(projects, rel, 'skills'))
  }
  return [...new Set(roots)].filter(isDir)
}

/** The per project folders each tool reads skills from. */
const PROJECT_TOOL_DIRS = new Set(['.claude', '.agents', '.codex', '.cursor', '.gemini'])

/**
 * Every root with how deep to look under it: Claude Code's and the projects'
 * one level down, except a project's .agents/skills, which Codex walks; then
 * the other tools' own folders from clients.mjs.
 */
function rootsWithDepth () {
  const out = new Map()
  for (const dir of skillRoots()) out.set(dir, /\/\.agents\/skills$/.test(dir) ? 3 : 1)
  for (const { dir, depth } of otherToolRoots()) out.set(dir, Math.max(out.get(dir) || 0, depth))
  return [...out.entries()].map(([dir, depth]) => ({ dir, depth }))
}

function walkDirs (dir, depth, base = dir, out = [], cur = 0) {
  if (cur >= depth) return out
  for (const name of listDir(dir)) {
    if (name === 'node_modules' || name === '.git' || name === '.next') continue
    const full = join(dir, name)
    if (!isDir(full)) continue
    out.push(full.slice(base.length + 1))
    walkDirs(full, depth, base, out, cur + 1)
  }
  return out
}

/**
 * Where a skill lives decides what `apply` may do to it. Anything under the
 * plugin cache is overwritten on the next plugin update, so it is not editable
 * in place; the fix belongs in the plugin's source repo (linked as sourcePath
 * when that repo is on this machine).
 */
export function classifyLocation (real, dir) {
  const HOME = homeDir()
  if (real.includes('/.claude/plugins/cache/')) return { location: 'plugin-cache', editable: false }
  if (real.includes('/.claude/plugins/marketplaces/')) return { location: 'marketplace', editable: true }
  if (dir.startsWith(join(HOME, '.claude', 'skills')) && isSymlink(dir)) return { location: 'user-symlink', editable: true }
  if (dir.startsWith(join(HOME, '.claude', 'skills'))) return { location: 'user', editable: true }
  if (dir.startsWith(join(HOME, 'Projects')) && /\/\.claude\/skills\/[^/]+$/.test(dir)) return { location: 'project', editable: true }
  // The other tools' folders, by the real path: a shortcut in ~/.cursor/skills
  // to ~/.agents/skills/x is still a skill that lives in ~/.agents/skills.
  const other = otherToolLocation(real)
  if (other) return other
  if (dir.startsWith(join(HOME, 'Projects')) && /\/\.(agents|codex|cursor|gemini)\/skills\//.test(dir)) {
    return { location: 'project-' + dir.match(/\/\.(agents|codex|cursor|gemini)\/skills\//)[1], editable: true }
  }
  if (dir.startsWith(join(HOME, 'Projects'))) return { location: 'project-source', editable: true }
  return { location: 'other', editable: true }
}

/**
 * Where a skill lives when Claude Code does not read the folder. The copies a
 * tool installs and refreshes itself (its bundled skills, its plugin cache, an
 * extension) are not editable in place, for the same reason the Claude Code
 * plugin cache is not.
 */
function otherToolLocation (real) {
  const inside = (root) => under(real, root)
  const codex = codexDir()
  const cursor = cursorDir()
  const gemini = geminiDir()
  if (inside(join(codex, 'skills', '.system'))) return { location: 'codex-system', editable: false }
  if (inside(join(codex, 'plugins', 'cache'))) return { location: 'codex-plugin-cache', editable: false }
  if (inside(join(codex, 'skills'))) return { location: 'codex', editable: true }
  if (inside(etcCodexSkillsDir())) return { location: 'codex-machine', editable: false }
  if (inside(join(cursor, 'skills-cursor'))) return { location: 'cursor-builtin', editable: false }
  if (inside(join(cursor, 'plugins', 'cache'))) return { location: 'cursor-plugin-cache', editable: false }
  if (inside(join(cursor, 'plugins', 'local'))) return { location: 'cursor-plugin-local', editable: true }
  if (inside(join(cursor, 'skills'))) return { location: 'cursor', editable: true }
  if (inside(join(gemini, 'extensions'))) return { location: 'gemini-extension', editable: false }
  if (inside(join(gemini, 'skills'))) return { location: 'gemini', editable: true }
  if (inside(join(agentsDir(), 'skills'))) return { location: 'agents', editable: true }
  return null
}

/** Locations that belong to another tool's folder, in the words the report uses. */
export const OTHER_TOOL_LOCATIONS = {
  agents: 'the shared ~/.agents/skills folder',
  codex: 'a Codex skill',
  'codex-system': 'a skill that ships with Codex',
  'codex-plugin-cache': 'a Codex plugin',
  'codex-machine': 'a machine wide Codex skill',
  cursor: 'a Cursor skill',
  'cursor-builtin': 'a skill that ships with Cursor',
  'cursor-plugin-cache': 'a Cursor plugin',
  'cursor-plugin-local': 'a Cursor plugin under development',
  gemini: 'a Gemini CLI skill',
  'gemini-extension': 'a Gemini CLI extension',
  'project-agents': 'a project\'s .agents/skills',
  'project-codex': 'a project\'s .codex/skills',
  'project-cursor': 'a project\'s .cursor/skills',
  'project-gemini': 'a project\'s .gemini/skills',
}

/**
 * What Claude Code has installed and enabled, read from the files it keeps
 * itself. Missing files degrade to "everything in the cache counts", which is
 * the older behaviour and the right fallback for a fixture.
 */
export function pluginState () {
  const installed = readJson(join(pluginsDir(), 'installed_plugins.json'))
  const enabled = {}
  for (const file of settingsFiles()) {
    const s = readJson(file)
    if (s.ok && s.value && s.value.enabledPlugins) Object.assign(enabled, s.value.enabledPlugins)
  }
  const installPaths = new Map() // realpath of install dir -> plugin@mp
  if (installed.ok && installed.value && installed.value.plugins) {
    for (const [key, entries] of Object.entries(installed.value.plugins)) {
      for (const e of Array.isArray(entries) ? entries : [entries]) {
        if (!e || !e.installPath) continue
        let real = e.installPath
        try { real = realpathSync(e.installPath) } catch { /* keep as given */ }
        installPaths.set(real, key)
      }
    }
  }
  return { hasRegistry: installed.ok, installPaths, enabled }
}

/**
 * Marketplaces whose source is a directory on this machine, plus any repo under
 * ~/Projects that carries a .claude-plugin/marketplace.json naming a known
 * marketplace. Both are places where the SOURCE of a cached plugin skill lives.
 */
function marketplaceSources () {
  const out = new Map() // marketplace name -> [source dirs]
  const known = readJson(join(pluginsDir(), 'known_marketplaces.json'))
  if (known.ok && known.value) {
    for (const [name, v] of Object.entries(known.value)) {
      const src = v && v.source
      if (src && src.source === 'directory' && src.path) push(out, name, safeReal(src.path))
    }
  }
  const projects = join(homeDir(), 'Projects')
  for (const rel of walkDirs(projects, 3)) {
    const mf = readJson(join(projects, rel, '.claude-plugin', 'marketplace.json'))
    if (mf.ok && mf.value && mf.value.name) push(out, String(mf.value.name), safeReal(join(projects, rel)))
  }
  return out
}

function push (map, k, v) { if (!v) return; const a = map.get(k) || []; if (!a.includes(v)) a.push(v); map.set(k, a) }
function safeReal (p) { try { return realpathSync(p) } catch { return null } }

/**
 * Discover every skill on disk. Each row carries `loaded` (true when Claude
 * Code lists it right now, from this working directory), `loadedReason` in
 * plain words, and, for loaded plugin-cache rows whose source repo is on this
 * machine, `sourcePath` pointing at the editable copy. Source copies that were
 * folded into a loaded row are dropped from the returned list and appear in
 * that row's `copies`.
 *
 * @param cwd  the working directory Claude Code would be started from
 */
export function discoverSkills ({ cwd = process.cwd() } = {}) {
  const HOME = homeDir()
  const state = pluginState()
  const sources = marketplaceSources()
  const clients = clientState()
  const byReal = new Map()
  for (const { dir: root, depth } of rootsWithDepth()) {
    // some roots ARE the skill (single-skill plugin roots collected above)
    for (const dir of skillDirsUnder(root, depth)) {
      const skillMd = join(dir, 'SKILL.md')
      if (!existsSync(skillMd)) continue
      let real
      try { real = realpathSync(dir) } catch { continue }
      const fm = parseFrontmatter(readText(skillMd) || '')
      const name = (fm.ok && fm.data.name) ? String(fm.data.name) : basename(dir)
      const plugin = pluginNameFor(real)
      const invocable = plugin ? plugin + ':' + basename(dir) : basename(dir)
      const gate = fm.ok ? fm.data['disable-model-invocation'] : undefined
      const mode = String(gate).toLowerCase() === 'true' ? 'command' : 'context'
      const description = fm.ok ? String(fm.data.description || '') : ''
      const loc = classifyLocation(real, dir)
      const existing = byReal.get(real)
      if (existing) {
        if (!existing.aliases.includes(dir)) existing.aliases.push(dir)
        if (!existing.names.includes(invocable)) existing.names.push(invocable)
        if (loc.location === 'user-symlink') existing.symlinks.push(dir)
        // a symlink under ~/.claude/skills makes any target loaded
        if (loc.location === 'user' || loc.location === 'user-symlink') {
          existing.loaded = true
          existing.loadedReason = 'linked from ~/.claude/skills'
          existing.location = loc.location
          existing.editable = true
        }
        continue
      }
      let modifiedOn = null
      try { modifiedOn = statSync(skillMd).mtime.toISOString().slice(0, 10) } catch { /* leave null */ }
      const load = loadedState(loc.location, real, dir, { cwd, state, HOME })
      byReal.set(real, {
        listing: {},
        listedIn: [],
        codexImplicit: codexImplicitPolicy(real),
        name: basename(dir),
        names: [invocable, basename(dir)].filter((v, i, a) => a.indexOf(v) === i),
        frontmatterName: name,
        realPath: real,
        skillMd: join(real, 'SKILL.md'),
        aliases: [dir],
        symlinks: loc.location === 'user-symlink' ? [dir] : [],
        plugin: plugin || null,
        marketplace: marketplaceOf(real),
        installKey: load.installKey,
        location: loc.location,
        editable: loc.editable,
        loaded: load.loaded,
        loadedReason: load.reason,
        sourcePath: null,
        copies: [],
        mode,
        gateDeclared: gate !== undefined,
        gateValue: gate === undefined ? null : String(gate),
        description,
        descriptionChars: description.length,
        modifiedOn,
      })
    }
  }
  // Verdicts run last, once every alias has reached its row: a skill in
  // ~/.agents/skills is listed by Cursor through the shortcut in
  // ~/.cursor/skills, and that shortcut may be visited after the real folder.
  for (const row of byReal.values()) {
    row.listing = listingVerdicts(row, { cwd, state: clients, claude: { listed: row.loaded, reason: row.loadedReason } })
    row.listedIn = Object.keys(row.listing).filter((id) => row.listing[id].listed)
  }
  return linkCopies([...byReal.values()], sources)
}

/** Which marketplace a cache or checkout path belongs to, or null. */
function marketplaceOf (real) {
  const m = real.match(/\/\.claude\/plugins\/(?:cache|marketplaces)\/([^/]+)\//)
  return m ? m[1] : null
}

function loadedState (location, real, dir, { cwd, state, HOME }) {
  if (location === 'user' || location === 'user-symlink') return { loaded: true, reason: 'in ~/.claude/skills', installKey: null }
  if (location === 'project') {
    // Claude Code reads .claude/skills from the working directory and its
    // parents, never its children, so the only question is whether cwd sits
    // at or below the project root. Each side is compared as given and as
    // resolved, so a home behind a symlink (macOS /var to /private/var) and a
    // cwd that does not exist yet both compare like any other path.
    const projectRoot = dir.replace(/\/\.claude\/skills\/[^/]+$/, '')
    return insideCwd(projectRoot, cwd)
      ? { loaded: true, reason: 'project skill, and you are working in that project', installKey: null }
      : { loaded: false, reason: 'project skill; loads only when you work in ' + projectRoot.replace(HOME, '~'), installKey: null }
  }
  if (location === 'plugin-cache') {
    // .../cache/<mp>/<plugin>/<version>/(.claude/)?skills/<skill>
    const installDir = real.replace(/\/(?:\.claude\/)?skills\/[^/]+$/, '')
    const key = state.installPaths.get(installDir) || null
    if (!state.hasRegistry) return { loaded: state.enabled[guessKey(real)] !== false, reason: 'plugin in the cache', installKey: guessKey(real) }
    if (!key) return { loaded: false, reason: 'an older version left in the plugin cache; not the installed one', installKey: null }
    if (state.enabled[key] === false) return { loaded: false, reason: 'plugin ' + key + ' is installed but disabled', installKey: key }
    return { loaded: true, reason: 'enabled plugin ' + key, installKey: key }
  }
  if (location === 'marketplace') return { loaded: false, reason: 'marketplace checkout; the installed copy lives in the plugin cache', installKey: null }
  if (location === 'project-source') return { loaded: false, reason: 'source repo; not installed from here', installKey: null }
  if (OTHER_TOOL_LOCATIONS[location]) return { loaded: false, reason: OTHER_TOOL_LOCATIONS[location] + '; Claude Code does not read that folder', installKey: null }
  return { loaded: false, reason: 'outside every folder Claude Code reads', installKey: null }
}

function guessKey (real) {
  const m = real.match(/\/plugins\/cache\/([^/]+)\/([^/]+)\//)
  return m ? m[2] + '@' + m[1] : null
}

/**
 * Fold source copies into the loaded row they are the source of, so a plugin
 * skill counts once and gains an editable path. Two rows are the same skill
 * when they share the skill directory name and either the same marketplace
 * (checkout versus cache) or a marketplace whose source directory contains
 * the copy (a repo under ~/Projects, or a directory-sourced marketplace).
 */
export function linkCopies (rows, sources = new Map()) {
  const loaded = rows.filter((r) => r.loaded)
  const keep = []
  for (const r of rows) {
    if (r.loaded) { keep.push(r); continue }
    let target = null
    if (r.location === 'marketplace' && r.marketplace) {
      target = loaded.find((l) => l.location === 'plugin-cache' && l.marketplace === r.marketplace && l.name === r.name)
    } else if (r.location === 'project-source' || r.location === 'project' || r.location === 'other') {
      for (const [mp, dirs] of sources) {
        if (!dirs.some((d) => r.realPath === d || r.realPath.startsWith(d + sep))) continue
        target = loaded.find((l) => l.location === 'plugin-cache' && l.marketplace === mp && l.name === r.name)
        if (target) break
      }
    }
    if (!target) { keep.push(r); continue }
    // A repo under ~/Projects is the place to edit; a marketplace checkout is
    // only the fallback source when no repo copy exists.
    const current = target.copies.find((c) => c.path === target.sourcePath)
    if (!target.sourcePath || (current && current.location === 'marketplace' && r.location !== 'marketplace')) target.sourcePath = r.realPath
    target.copies.push({ path: r.realPath, location: r.location, sameDescription: r.description === target.description })
  }
  return keep
}

/** If this skill sits inside a plugin tree, return the plugin name for name:skill attribution. */
export function pluginNameFor (real) {
  // .../.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>
  const m = real.match(/\/\.claude\/plugins\/cache\/[^/]+\/([^/]+)\/[^/]+\/(?:\.claude\/)?skills\/[^/]+$/)
  if (m) return m[1]
  // .../marketplaces/<mp>/skills/<skill>  -> plugin is the marketplace-level plugin.json name
  const m2 = real.match(/\/plugins\/marketplaces\/([^/]+)\/skills\/[^/]+$/)
  if (m2) return manifestName(real.replace(/\/skills\/[^/]+$/, '')) || m2[1]
  // Any tree with a plugin manifest above the skill. Cursor and Codex nest a
  // plugin's declared skills path under the commit, so the manifest may sit a
  // few levels up rather than directly above skills/.
  const m3 = real.match(/^(.*)\/(?:skills[^/]*)\/[^/]+$/)
  if (m3) {
    let dir = m3[1]
    for (let i = 0; i < 4 && dir && dir !== sep; i++) {
      const name = manifestName(dir)
      if (name) return name
      dir = dirname(dir)
    }
  }
  // .../.cursor/plugins/cache/<marketplace>/<plugin id>/<commit>/...: the id
  // is only a number, and the name lives in the manifest beside the cache.
  const m4 = real.match(/\/\.cursor\/plugins\/cache\/([^/]+)\/([^/]+)\/[^/]+\//)
  if (m4) return cursorPluginName(m4[2]) || m4[2]
  // .../.codex/plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>
  const m5 = real.match(/\/\.codex\/plugins\/cache\/[^/]+\/([^/]+)\/[^/]+\/skills\/[^/]+$/)
  if (m5) return m5[1]
  return null
}

let cursorNames = null
function cursorPluginName (id) {
  if (!cursorNames) {
    cursorNames = new Map()
    const res = readJson(join(cursorDir(), 'plugins', 'cache', '.cloud-plugin-manifest.json'))
    for (const p of (res.ok && res.value && Array.isArray(res.value.plugins)) ? res.value.plugins : []) {
      if (p && p.pluginId !== undefined && p.name) cursorNames.set(String(p.pluginId), String(p.name))
    }
  }
  return cursorNames.get(String(id)) || null
}

function manifestName (root) {
  // The cache folder of a whole marketplace is never a plugin, whatever sits in it.
  if (/\/plugins\/cache$/.test(root) || /\/plugins\/cache\/[^/]+$/.test(root)) return null
  for (const rel of ['.claude-plugin/plugin.json', '.cursor-plugin/plugin.json', '.codex-plugin/plugin.json', 'plugin.json']) {
    const t = readText(join(root, rel))
    if (!t) continue
    try { const n = JSON.parse(t).name; if (n) return String(n) } catch { /* fallthrough */ }
  }
  return null
}

