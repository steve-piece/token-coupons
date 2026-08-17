// Apply: carry out the decisions a person marked in the report.
//
// Three rules shape everything here.
//
//   1. Nothing happens without `--yes`. Planning reads files; it never writes.
//   2. Nothing is unrecoverable. Shortcuts are unlinked instead of followed,
//      folders are moved into a dated trash folder instead of erased, and the
//      copies a plugin manages are refused outright.
//   3. Every step carries an undo line a person can read and run. If a step
//      cannot say how to undo itself, it does not belong in the plan.

import { writeFileSync, mkdirSync, renameSync, cpSync, rmSync, unlinkSync, existsSync } from 'node:fs'
import { join, basename, dirname, isAbsolute, resolve } from 'node:path'

import { readText, safeReal, isSymlink, setFrontmatterKey, timeStamp } from './lib/util.mjs'
import { homeDir, trashDir as defaultTrashDir, tildify } from './paths.mjs'

/** The actions a decisions file may ask for. `keep` means do nothing at all. */
export const ACTIONS = ['keep', 'active', 'passive', 'optimize', 'delete']

/** Fallback when the caller passes no thresholds. Matches the contract default. */
export const DEFAULT_OPTIMIZE_TARGET_CHARS = 350

const GATE_KEY = 'disable-model-invocation'

/* ------------------------------------------------------------------ */
/* reading the decisions file                                          */
/* ------------------------------------------------------------------ */

/**
 * Read and check a decisions file. Returns { ok, decisions, reason }.
 *
 * A problem with the file as a whole (not JSON, no decisions list, a version
 * this tool does not read) fails the whole call, because there is nothing
 * sensible to do with the rest. A problem with one entry (an action nobody
 * recognises, a skill that is not installed) does not: that entry is kept and
 * `planApply` refuses it by itself, so one typo cannot block the other rows.
 */
export function parseDecisions (text) {
  const fail = (reason) => ({ ok: false, decisions: [], reason })
  const raw = text == null ? '' : String(text)
  if (raw.trim() === '') return fail('the decisions file is empty')

  let value
  try { value = JSON.parse(raw) } catch (e) {
    return fail('the decisions file is not valid JSON: ' + e.message)
  }

  const wrapped = value && typeof value === 'object' && !Array.isArray(value)
  if (wrapped && value.version !== undefined && Number(value.version) !== 1) {
    return fail('this file says version ' + value.version + ', and this version of the tool only reads version 1')
  }

  const list = Array.isArray(value) ? value : (wrapped ? value.decisions : null)
  if (!Array.isArray(list)) {
    return fail('the decisions file needs a "decisions" list. Export it again from the report page.')
  }

  const decisions = []
  for (let i = 0; i < list.length; i++) {
    const d = list[i]
    const where = 'entry ' + (i + 1) + ' of the decisions list'
    if (!d || typeof d !== 'object' || Array.isArray(d)) return fail(where + ' is not an object')
    const name = str(d.name)
    const path = str(d.path)
    if (!name && !path) return fail(where + ' has neither a name nor a path, so there is no way to tell which skill it means')
    decisions.push({ name, path, action: str(d.action).toLowerCase(), note: str(d.note) })
  }
  return { ok: true, decisions, reason: null }
}

function str (v) { return v == null ? '' : String(v).trim() }

/* ------------------------------------------------------------------ */
/* planning                                                            */
/* ------------------------------------------------------------------ */

/**
 * Turn decisions plus the discovered skills into a plan.
 *
 * @param decisions  the array, or the whole parsed decisions file
 * @param skills     discoverSkills() output
 * @param thresholds only `optimizeTargetChars` is read
 */
export function planApply (decisions, { skills = [], thresholds = {} } = {}) {
  const targetChars = Number((thresholds || {}).optimizeTargetChars) || DEFAULT_OPTIMIZE_TARGET_CHARS
  const list = Array.isArray(decisions)
    ? decisions
    : (decisions && Array.isArray(decisions.decisions) ? decisions.decisions : [])
  const index = buildIndex(skills)

  const steps = []
  const worklist = []
  const refused = []
  const refuse = (name, action, path, reason) => {
    refused.push({ name, action, reason })
    steps.push({
      name,
      action,
      path: path || null,
      kind: 'refuse',
      detail: reason,
      undo: 'nothing to undo, nothing was changed',
    })
  }
  const noop = (name, action, path, detail) => {
    steps.push({ name, action, path, kind: 'noop', detail, undo: 'nothing to undo, nothing was changed' })
  }

  for (const d of list) {
    const action = str(d && d.action).toLowerCase()
    const label = str(d && d.name) || str(d && d.path) || '(unnamed)'
    if (action === 'keep' || action === '') continue
    if (!ACTIONS.includes(action)) {
      refuse(label, action, str(d.path), '"' + action + '" is not an action this tool knows. Use keep, active, passive, optimize, or delete.')
      continue
    }

    const match = matchSkill(d, index)
    if (!match.skill) { refuse(label, action, str(d.path), match.reason); continue }

    const skill = match.skill
    const name = firstName(skill)
    const { path: skillMd, refreshNote } = editTarget(skill)

    if (action === 'optimize') {
      const description = String(skill.description || '')
      const currentChars = Number(skill.descriptionChars) || description.length
      worklist.push({ name, path: skillMd, currentDescription: description, currentChars, targetChars })
      steps.push({
        name,
        action,
        path: skillMd,
        kind: 'worklist',
        detail: 'rewrite the description, ' + currentChars + ' characters today, down to about ' + targetChars + '. This tool changes no file for you.' + refreshNote,
        undo: 'nothing to undo, this tool does not touch the text',
      })
      continue
    }

    if (action === 'delete') {
      const links = Array.isArray(skill.symlinks) ? skill.symlinks : []
      if (links.length) {
        for (const link of links) {
          steps.push({
            name,
            action,
            path: link,
            kind: 'unlink',
            target: skill.realPath,
            detail: 'remove the shortcut at ' + tildify(link) + '. The real folder at ' + tildify(skill.realPath) + ' is left exactly where it is.',
            undo: 'ln -s ' + skill.realPath + ' ' + link,
          })
        }
        continue
      }
      if (skill.location === 'plugin-cache' || skill.editable === false) {
        refuse(name, action, skill.realPath, 'this folder is a copy the plugin system owns, so deleting it would come straight back on the next update. run: claude plugin uninstall ' + (skill.plugin || skill.name || name))
        continue
      }
      steps.push({
        name,
        action,
        path: skill.realPath,
        kind: 'trash',
        folder: basename(skill.realPath || name),
        detail: 'move the folder ' + tildify(skill.realPath) + ' into the trash folder. Nothing is erased.',
        undo: 'move the folder back out of the trash folder to ' + tildify(skill.realPath),
      })
      continue
    }

    // active and passive both edit one line at the top of SKILL.md
    const wantValue = action === 'active' ? 'true' : null
    const text = readText(skillMd)
    if (text === null) { refuse(name, action, skillMd, 'could not read ' + tildify(skillMd) + ', so nothing was changed'); continue }
    const trial = setFrontmatterKey(text, GATE_KEY, wantValue)
    if (!trial.ok) { refuse(name, action, skillMd, 'the settings block at the top of ' + tildify(skillMd) + ' cannot be edited safely: ' + trial.reason); continue }

    if (action === 'active') {
      if (String(skill.gateValue).toLowerCase() === 'true') {
        noop(name, action, skillMd, 'already set to run only when you ask for it by name, so there is nothing to change')
        continue
      }
      steps.push({
        name,
        action,
        path: skillMd,
        kind: 'set-gate',
        edit: { key: GATE_KEY, value: 'true', previous: skill.gateDeclared ? String(skill.gateValue) : null },
        detail: 'stop the agent picking this skill on its own, which takes its description out of the list sent at the start of every session. You can still run it by name.' + refreshNote,
        undo: skill.gateDeclared
          ? 'set the line ' + GATE_KEY + ': ' + skill.gateValue + ' in ' + tildify(skillMd)
          : 'delete the line ' + GATE_KEY + ': true from ' + tildify(skillMd),
      })
      continue
    }

    if (!skill.gateDeclared) {
      noop(name, action, skillMd, 'the agent can already pick this skill on its own, so there is nothing to change')
      continue
    }
    steps.push({
      name,
      action,
      path: skillMd,
      kind: 'unset-gate',
      edit: { key: GATE_KEY, value: null, previous: String(skill.gateValue) },
      detail: 'let the agent pick this skill on its own again, which puts its description back into the list sent at the start of every session.' + refreshNote,
      undo: 'add the line ' + GATE_KEY + ': ' + skill.gateValue + ' back to ' + tildify(skillMd),
    })
  }

  return { steps, worklist, refused }
}

export function firstName (skill) {
  const names = Array.isArray(skill.names) && skill.names.length ? skill.names : [skill.name]
  return String(names[0] || skill.name || 'unknown')
}

/**
 * Which SKILL.md an edit should land in, and what to say about it.
 *
 * A plugin-cache row edits its source copy when one is on this machine, so the
 * change survives the next plugin update. Without a source copy the cache file
 * itself is edited, with a warning that an update overwrites it.
 */
export function editTarget (skill) {
  const viaSource = Boolean(skill.location === 'plugin-cache' && skill.sourcePath)
  const path = viaSource
    ? join(skill.sourcePath, 'SKILL.md')
    : (skill.skillMd || join(skill.realPath || '', 'SKILL.md'))
  const refreshNote = viaSource
    ? ' Edits the source copy at ' + tildify(skill.sourcePath) + '; the installed copy picks it up on the next plugin update' + (skill.installKey ? ' (claude plugin update ' + skill.installKey + ')' : '') + '.'
    : (skill.location === 'plugin-cache' ? ' This is the plugin cache copy: the next plugin update overwrites it, so make the same change in the plugin\'s repo too.' : '')
  return { path, viaSource, refreshNote }
}

export function buildIndex (skills) {
  const byReal = new Map()
  const byName = new Map()
  const ambiguous = new Set()
  for (const skill of skills || []) {
    if (!skill) continue
    if (skill.realPath) {
      byReal.set(safeReal(skill.realPath) || skill.realPath, skill)
      byReal.set(skill.realPath, skill)
    }
    const names = Array.isArray(skill.names) && skill.names.length ? skill.names : [skill.name]
    for (const n of names) {
      const key = str(n)
      if (!key) continue
      if (byName.has(key) && byName.get(key) !== skill) { ambiguous.add(key); continue }
      byName.set(key, skill)
    }
  }
  return { byReal, byName, ambiguous }
}

/** A leading ~ means the home directory this run is pointed at, not the shell's. */
export function expandHome (p) {
  const s = str(p)
  if (!s) return null
  if (s === '~') return homeDir()
  if (s.startsWith('~/')) return join(homeDir(), s.slice(2))
  return isAbsolute(s) ? s : resolve(s)
}

export function matchSkill (d, index) {
  const expanded = expandHome(d && d.path)
  if (expanded) {
    let real = safeReal(expanded)
    if (real && basename(real) === 'SKILL.md') real = dirname(real)
    if (real && index.byReal.has(real)) return { skill: index.byReal.get(real), reason: null }
    if (index.byReal.has(expanded)) return { skill: index.byReal.get(expanded), reason: null }
  }
  const name = str(d && d.name)
  if (name) {
    if (index.ambiguous.has(name)) {
      return { skill: null, reason: 'more than one installed skill answers to the name "' + name + '", so add its folder path to the decision and run this again' }
    }
    if (index.byName.has(name)) return { skill: index.byName.get(name), reason: null }
  }
  const looked = [name && 'the name "' + name + '"', str(d && d.path) && 'the folder ' + str(d.path)].filter(Boolean).join(' or ')
  return { skill: null, reason: 'no installed skill matches ' + (looked || 'this entry') + '. It may already be gone, or the report may be out of date.' }
}

/* ------------------------------------------------------------------ */
/* applying                                                            */
/* ------------------------------------------------------------------ */

/** The dated folder name deleted skills are moved into: YYYYMMDD-HHMMSS, local time. */
export function trashStamp (date) { return timeStamp(date) }

/**
 * Carry out a plan. With `yes` false nothing at all is written: the same plan
 * comes back with `dryRun: true` and every trash step showing exactly where it
 * would land, so a person can read the whole thing before agreeing to it.
 */
export function applyPlan (plan, { yes = false, trashDir = null, now = null } = {}) {
  const root = trashDir || defaultTrashDir()
  const stamp = trashStamp(now || new Date())
  const bucket = join(root, stamp)
  const dryRun = !yes

  const steps = []
  let applied = 0

  for (const step of (plan && plan.steps) || []) {
    const out = Object.assign({}, step, { done: false, error: null })
    if (out.kind === 'trash') {
      out.to = join(bucket, out.folder || basename(out.path || out.name))
      out.undo = 'mv ' + out.to + ' ' + out.path
    }
    if (!dryRun) runStep(out)
    if (out.done) applied++
    steps.push(out)
  }

  return {
    applied,
    skipped: steps.length - applied,
    dryRun,
    trashDir: root,
    stamp,
    steps,
    worklist: (plan && plan.worklist) || [],
    refused: (plan && plan.refused) || [],
  }
}

function runStep (out) {
  try {
    if (out.kind === 'set-gate' || out.kind === 'unset-gate') {
      const text = readText(out.path)
      if (text === null) { out.error = 'could not read ' + tildify(out.path); return }
      const res = setFrontmatterKey(text, out.edit.key, out.edit.value)
      if (!res.ok) { out.error = res.reason; return }
      writeFileSync(out.path, res.text)
      out.done = true
      return
    }
    if (out.kind === 'unlink') {
      if (!isSymlink(out.path)) { out.error = 'the shortcut at ' + tildify(out.path) + ' is not there any more'; return }
      unlinkSync(out.path)
      out.done = true
      return
    }
    if (out.kind === 'trash') {
      let dest = out.to
      let n = 2
      while (existsSync(dest)) { dest = out.to + '-' + n; n++ }
      out.to = dest
      out.undo = 'mv ' + dest + ' ' + out.path
      mkdirSync(dirname(dest), { recursive: true })
      try {
        renameSync(out.path, dest)
      } catch {
        // rename cannot move across disks, so copy the folder and remove the original
        cpSync(out.path, dest, { recursive: true })
        rmSync(out.path, { recursive: true, force: true })
      }
      out.done = true
    }
    // worklist, noop and refuse steps write nothing, so they stay done: false
  } catch (e) {
    out.error = e && e.message ? e.message : String(e)
  }
}

/* ------------------------------------------------------------------ */
/* printing                                                            */
/* ------------------------------------------------------------------ */

/** A short plain block the CLI can print as is. No color, no tables, no jargon. */
export function summarizeApply (result) {
  const r = result || {}
  const steps = r.steps || []
  const worklist = r.worklist || []
  const refused = r.refused || []
  const lines = []

  if (r.dryRun) {
    lines.push('Plan only. Nothing on your disk was changed. Run the same command again with --yes to carry it out.')
  } else {
    lines.push('Carried out ' + r.applied + ' of ' + steps.length + ' step' + (steps.length === 1 ? '' : 's') + '.')
  }
  if (r.trashDir && steps.some((s) => s.kind === 'trash')) {
    lines.push('Deleted folders are moved to ' + tildify(join(r.trashDir, r.stamp || '')) + ', so nothing is erased.')
  }
  lines.push('')

  if (!steps.length) {
    lines.push('Nothing to do.')
  } else {
    lines.push('Steps')
    for (const s of steps) {
      lines.push('  [' + stateOf(s, r) + '] ' + s.kind + '  ' + s.name)
      if (s.detail) lines.push('      ' + s.detail)
      if (s.error) lines.push('      problem: ' + s.error)
      lines.push('      undo: ' + (s.undo || 'nothing to undo'))
    }
  }

  if (worklist.length) {
    lines.push('')
    lines.push('Rewrite these descriptions')
    for (const w of worklist) {
      lines.push('  ' + w.name + ': ' + w.currentChars + ' characters now, aim for about ' + w.targetChars + ' characters')
      lines.push('      ' + tildify(w.path))
    }
  }

  if (refused.length) {
    lines.push('')
    lines.push('Refused')
    for (const f of refused) lines.push('  ' + f.name + ' (' + f.action + '): ' + f.reason)
  }

  const note = cacheNote(r)
  if (note) { lines.push(''); lines.push(note) }

  return lines.join('\n') + '\n'
}

/**
 * Changing a skill changes the skill listing, and the listing sits in the
 * system prompt at the very front of the saved prompt. Claude Code picks skill
 * edits up inside a running session, so the next message in any session open on
 * this machine re-sends its whole conversation at full price instead of the
 * cheap cached price. Saying so is the difference between a tool that saves
 * tokens and one that quietly spends them.
 */
export function cacheNote (result) {
  const r = result || {}
  const steps = (r.steps || []).filter((s) => s.kind === 'set-gate' || s.kind === 'unset-gate' || s.kind === 'unlink' || s.kind === 'trash')
  if (!steps.length) return ''
  if (r.dryRun) {
    return 'One thing to know before you run this with --yes: changing a skill changes the list that rides at the front of\n' +
      'every message, and Claude Code notices the change inside a running chat. The next message in any chat you have open\n' +
      'will re-send its whole conversation at full price instead of the cheap saved price. It is a one-off, and the cheapest\n' +
      'moment to take it is right after a /clear or at the end of a chat.'
  }
  return 'The skill list has changed. Any chat you have open on this machine pays one full re-send on its next message,\n' +
    'because the list rides at the front of every message and Claude Code picked the change up. Run /clear (or start a\n' +
    'fresh chat) to take that cost now on an empty conversation rather than a long one.'
}

function stateOf (step, result) {
  if (step.kind === 'refuse') return 'refused'
  if (step.kind === 'noop') return 'no change needed'
  if (step.error) return 'failed'
  if (step.done) return 'done'
  if (step.kind === 'worklist') return 'to rewrite'
  return result.dryRun ? 'planned' : 'skipped'
}
