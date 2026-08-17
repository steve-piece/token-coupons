// Describe: write rewritten descriptions back into SKILL.md files.
//
// Everything else this tool changes is mechanical, so `apply` does it: flipping
// the gate line, unlinking a shortcut, moving a folder. Rewriting a description
// is the one job that needs a model, because it is writing. That job should
// therefore be the only expensive part of the loop, and once the new text
// exists, putting it on disk should cost nothing.
//
// So the agent writes the words and hands them here as JSON, and this module
// does the filing: find the skill, check the new text against the per entry cap,
// keep a copy of the file it is about to change, and replace exactly one key.
// No reading whole SKILL.md files into a conversation, no hand edits, no risk of
// a stray change to the body.
//
// The same three rules as apply hold: nothing without `--yes`, nothing
// unrecoverable, every step carries its own undo line.

import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

import { readText, setFrontmatterText } from './lib/util.mjs'
import { DEFAULT_PER_ENTRY_CAP, toTokens } from './budget.mjs'
import { buildIndex, matchSkill, firstName, editTarget, trashStamp } from './apply.mjs'
import { trashDir as defaultTrashDir, tildify } from './paths.mjs'

/**
 * Read an edits file. Returns { ok, edits, reason }.
 *
 * Accepts the shape this tool documents, a bare array, and the `worklist` block
 * that `apply --json` prints, so an agent can add a `description` to each
 * worklist row and send the block straight back without reshaping it.
 */
export function parseEdits (text) {
  const fail = (reason) => ({ ok: false, edits: [], reason })
  const raw = text == null ? '' : String(text)
  if (raw.trim() === '') return fail('the descriptions file is empty')

  let value
  try { value = JSON.parse(raw) } catch (e) {
    return fail('the descriptions file is not valid JSON: ' + e.message)
  }

  const wrapped = value && typeof value === 'object' && !Array.isArray(value)
  if (wrapped && value.version !== undefined && Number(value.version) !== 1) {
    return fail('this file says version ' + value.version + ', and this version of the tool only reads version 1')
  }

  const list = Array.isArray(value)
    ? value
    : (wrapped ? (value.descriptions || value.worklist || null) : null)
  if (!Array.isArray(list)) {
    return fail('the file needs a "descriptions" list, each entry naming a skill and its new description')
  }

  const edits = []
  for (let i = 0; i < list.length; i++) {
    const d = list[i]
    const where = 'entry ' + (i + 1) + ' of the descriptions list'
    if (!d || typeof d !== 'object' || Array.isArray(d)) return fail(where + ' is not an object')
    const name = str(d.name)
    const path = str(d.path)
    if (!name && !path) return fail(where + ' has neither a name nor a path, so there is no way to tell which skill it means')
    edits.push({ name, path, description: str(d.description || d.newDescription) })
  }
  return { ok: true, edits, reason: null }
}

function str (v) { return v == null ? '' : String(v).trim() }

/**
 * Turn edits plus the discovered skills into a plan. Reads files, writes none.
 *
 * @param edits  the array, or the whole parsed file
 * @param skills discoverSkills() output
 * @param cap    the per entry cap descriptions are cut off at
 */
export function planDescribe (edits, { skills = [], cap = DEFAULT_PER_ENTRY_CAP } = {}) {
  const list = Array.isArray(edits)
    ? edits
    : (edits && Array.isArray(edits.descriptions || edits.worklist) ? (edits.descriptions || edits.worklist) : [])
  const index = buildIndex(skills)
  const limit = Number(cap) || DEFAULT_PER_ENTRY_CAP

  const steps = []
  const refused = []
  const refuse = (name, path, reason) => {
    refused.push({ name, reason })
    steps.push({ name, path: path || null, kind: 'refuse', detail: reason, undo: 'nothing to undo, nothing was changed' })
  }

  for (const d of list) {
    const label = str(d && d.name) || str(d && d.path) || '(unnamed)'
    const description = str(d && (d.description || d.newDescription))
    if (description === '') {
      refuse(label, str(d && d.path), 'no new description was given for this entry, and an empty description would make the skill unfindable')
      continue
    }
    if (description.length > limit) {
      refuse(label, str(d && d.path), 'the new description is ' + description.length + ' characters, past the ' + limit + ' character cap, so its tail would be thrown away unread. Cut it and send it again')
      continue
    }

    const match = matchSkill(d, index)
    if (!match.skill) { refuse(label, str(d && d.path), match.reason); continue }

    const skill = match.skill
    const name = firstName(skill)
    const { path, refreshNote } = editTarget(skill)
    const text = readText(path)
    if (text === null) { refuse(name, path, 'could not read ' + tildify(path) + ', so nothing was changed'); continue }

    const trial = setFrontmatterText(text, 'description', description)
    if (!trial.ok) { refuse(name, path, 'the settings block at the top of ' + tildify(path) + ' cannot be edited safely: ' + trial.reason); continue }

    const before = String(skill.description || '')
    if (before === description) {
      steps.push({
        name,
        path,
        kind: 'noop',
        before,
        after: description,
        beforeChars: before.length,
        afterChars: description.length,
        savedTokens: 0,
        detail: 'the description on disk already says this, so there is nothing to change',
        undo: 'nothing to undo, nothing was changed',
      })
      continue
    }

    steps.push({
      name,
      path,
      kind: 'write-description',
      before,
      after: description,
      beforeChars: before.length,
      afterChars: description.length,
      savedTokens: Math.max(0, toTokens(before.length) - toTokens(description.length)),
      detail: 'replace the description, ' + before.length + ' characters today, ' + description.length + ' after.' + refreshNote,
      undo: 'the file as it is now is kept, so undo is one copy back over it',
    })
  }

  return { steps, refused }
}

/**
 * Carry out a plan. With `yes` false nothing is written at all: the same plan
 * comes back with `dryRun: true`, so the whole thing can be read first.
 *
 * Every file about to change is copied into the same dated trash folder deleted
 * skills go to, under `descriptions/<skill>/SKILL.md`, before it is written. A
 * description rewrite is the one step here that cannot be reversed from its own
 * description, so the copy is what makes the undo line true.
 */
export function applyDescribe (plan, { yes = false, trashDir = null, now = null } = {}) {
  const root = trashDir || defaultTrashDir()
  const stamp = trashStamp(now || new Date())
  const bucket = join(root, stamp, 'descriptions')
  const dryRun = !yes

  const steps = []
  let applied = 0
  for (const step of (plan && plan.steps) || []) {
    const out = Object.assign({}, step, { done: false, error: null })
    if (out.kind === 'write-description') {
      out.backup = join(bucket, out.name.replace(/[^A-Za-z0-9._-]+/g, '-'), 'SKILL.md')
      out.undo = 'cp ' + out.backup + ' ' + out.path
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
    refused: (plan && plan.refused) || [],
    savedTokens: steps.filter((s) => s.done).reduce((n, s) => n + (Number(s.savedTokens) || 0), 0),
  }
}

function runStep (out) {
  try {
    if (out.kind !== 'write-description') return
    const text = readText(out.path)
    if (text === null) { out.error = 'could not read ' + tildify(out.path); return }
    const res = setFrontmatterText(text, 'description', out.after)
    if (!res.ok) { out.error = res.reason; return }
    mkdirSync(join(out.backup, '..'), { recursive: true })
    copyFileSync(out.path, out.backup)
    writeFileSync(out.path, res.text)
    out.done = true
  } catch (e) {
    out.error = e && e.message ? e.message : String(e)
  }
}

/** A short plain block the CLI can print as is. */
export function summarizeDescribe (result) {
  const r = result || {}
  const steps = r.steps || []
  const refused = r.refused || []
  const lines = []

  if (r.dryRun) {
    lines.push('Plan only. No description was changed. Run the same command again with --yes to write them.')
  } else {
    lines.push('Rewrote ' + r.applied + ' of ' + steps.length + ' description' + (steps.length === 1 ? '' : 's') +
      (r.savedTokens ? ', about ' + r.savedTokens + ' tokens off every message.' : '.'))
  }
  if (steps.some((s) => s.kind === 'write-description')) {
    lines.push('The file as it stands is copied into ' + tildify(join(r.trashDir || '', r.stamp || '', 'descriptions')) + ' first, so every change can be put back.')
  }
  lines.push('')

  if (!steps.length) {
    lines.push('Nothing to do.')
  } else {
    lines.push('Descriptions')
    for (const s of steps) {
      // A refused entry never got as far as reading the file, so it has no
      // character counts to show and the line stops at the name.
      const span = Number.isFinite(s.beforeChars) && Number.isFinite(s.afterChars)
        ? '  ' + s.beforeChars + ' to ' + s.afterChars + ' characters'
        : ''
      lines.push('  [' + stateOf(s, r) + '] ' + s.name + span)
      if (s.detail) lines.push('      ' + s.detail)
      if (s.error) lines.push('      problem: ' + s.error)
      lines.push('      undo: ' + (s.undo || 'nothing to undo'))
    }
  }

  if (refused.length) {
    lines.push('')
    lines.push('Refused')
    for (const f of refused) lines.push('  ' + f.name + ': ' + f.reason)
  }

  return lines.join('\n') + '\n'
}

function stateOf (step, result) {
  if (step.kind === 'refuse') return 'refused'
  if (step.kind === 'noop') return 'no change needed'
  if (step.error) return 'failed'
  if (step.done) return 'done'
  return result.dryRun ? 'planned' : 'skipped'
}
