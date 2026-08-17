#!/usr/bin/env node
// token-coupons: what your installed agent skills cost on every message, which
// ones the agent never reads, and what to do about it.
//
//   token-coupons report [--since=YYYY-MM-DD] [--window=N] [--fraction=F] [--budget=CHARS]
//                        [--pricing=FILE] [--uncached] [--json] [--html=FILE] [--card=FILE] [--out=FILE] [--open] [--no-color] [--cwd=DIR]
//   token-coupons apply <decisions.json | -> [--yes] [--trash=DIR] [--json]
//   token-coupons describe <descriptions.json | -> [--yes] [--trash=DIR] [--json]
//   token-coupons pricing [--pricing=FILE] [--json]
//   token-coupons help

import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, relative, sep } from 'node:path'
import { spawn } from 'node:child_process'

import { VERSION } from '../src/version.mjs'
import { buildReport } from '../src/report.mjs'
import { renderText } from '../src/render-text.mjs'
import { renderCardPage } from '../src/render-card.mjs'
import { renderList } from '../src/render-list.mjs'
import { discoverSkills } from '../src/discover.mjs'
import { parseDecisions, planApply, applyPlan, summarizeApply } from '../src/apply.mjs'
import { parseEdits, planDescribe, applyDescribe, summarizeDescribe } from '../src/describe.mjs'
import { loadPricing } from '../src/pricing.mjs'
import { DEFAULT_THRESHOLDS } from '../src/recommend.mjs'
import { fmt, money } from '../src/lib/util.mjs'
import { tildify } from '../src/paths.mjs'

export function version () { return VERSION }

/* ------------------------------------------------------------------ args */

const VALUE_FLAGS = new Set(['since', 'window', 'fraction', 'budget', 'pricing', 'html', 'out', 'trash', 'today', 'top', 'cwd', 'cache-ttl', 'card'])
const BOOL_FLAGS = new Set(['uncached', 'json', 'open', 'no-color', 'color', 'yes', 'help', 'version', 'h', 'v'])

/** Parse argv into { command, positional, flags }. Accepts --k=v and --k v. */
export function parseArgs (argv) {
  const flags = {}
  const positional = []
  const errors = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') { positional.push(...argv.slice(i + 1)); break }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const key = eq === -1 ? a.slice(2) : a.slice(2, eq)
      if (VALUE_FLAGS.has(key)) {
        if (eq !== -1) flags[key] = a.slice(eq + 1)
        else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[key] = argv[++i]
        else errors.push('--' + key + ' needs a value, for example --' + key + '=...')
      } else if (BOOL_FLAGS.has(key)) {
        flags[key] = eq === -1 ? true : !/^(0|false|no)$/i.test(a.slice(eq + 1))
      } else {
        errors.push('unknown flag --' + key)
      }
      continue
    }
    if (a === '-h') { flags.help = true; continue }
    if (a === '-v') { flags.version = true; continue }
    positional.push(a)
  }
  const command = positional.length && !positional[0].endsWith('.json') && !positional[0].includes('/') && positional[0] !== '-' ? positional.shift() : 'report'
  return { command, positional, flags, errors }
}

/* ------------------------------------------------------------------ help */

export function helpText () {
  return [
    'token-coupons v' + version(),
    'Find out what your installed Claude Code skills cost on every message, which ones the agent never reads, and what to do about it.',
    '',
    'Usage',
    '  token-coupons report [--since=YYYY-MM-DD] [--window=N] [--fraction=F] [--budget=CHARS]',
    '                       [--pricing=FILE] [--uncached] [--json] [--html=FILE] [--card=FILE]',
    '                       [--out=FILE] [--open] [--no-color] [--cwd=DIR]',
    '  token-coupons apply <decisions.json | -> [--yes] [--trash=DIR] [--json]',
    '  token-coupons describe <descriptions.json | -> [--yes] [--trash=DIR] [--json]',
    '  token-coupons pricing [--pricing=FILE] [--json]',
    '  token-coupons help',
    '',
    'report (the default) reads the skills on this machine and your session history, then prints what the skill list costs,',
    'which skills have never been used, and one recommendation per skill. Nothing is changed.',
    '  --since=DATE     only read sessions on or after this day (YYYY-MM-DD)',
    '  --cwd=DIR        count project skills as listed from this folder (default: where you run it)',
    '  --cache-ttl=MIN  minutes the saved prompt survives with no messages (default 60, the',
    '                   Claude subscription behaviour; use 5 on a plain API key)',
    '  --window=N       size of the model context window in tokens, instead of reading it from your settings',
    '  --fraction=F     share of the window the skill list may use (default 0.01)',
    '  --budget=CHARS   a fixed allowance for the list in characters, which wins over --fraction',
    '  --pricing=FILE   a price list to use instead of the bundled data/pricing.json',
    '  --uncached       price the worst case, where nothing is cached',
    '  --json           print the whole report as JSON instead of text',
    '  --html=FILE      also write the interactive page to FILE',
    '  --out=FILE       also write the report JSON to FILE',
    '  --open           open the HTML page in your browser after writing it',
    '  --no-color       plain text without colors',
    '',
    'apply carries out the decisions you exported from the HTML page. Without --yes it only prints the plan.',
    '  --yes            actually make the changes (deletes go to a trash folder, never erased)',
    '  --trash=DIR      where deleted skill folders are moved (default ~/.token-coupons/trash)',
    '  --json           print the plan or result as JSON',
    '',
    'describe writes rewritten descriptions into the SKILL.md files they belong to, one key each, leaving every other',
    'line alone. Feed it {"version": 1, "descriptions": [{"name": "...", "description": "..."}]}, or the worklist block',
    'from apply --json with a description added to each row. Without --yes it only prints the plan.',
    '  --yes            actually write them (the file as it stands is copied to the trash folder first)',
    '  --trash=DIR      where those copies are kept (default ~/.token-coupons/trash)',
    '  --json           print the plan or result as JSON',
    '',
    'pricing prints the price table the dollar figures come from, with the date it was checked.',
    '',
  ].join('\n')
}

/* ------------------------------------------------------------------ commands */

function wantColor (flags, stream) {
  if (flags['no-color']) return false
  if (flags.color) return true
  if (process.env.NO_COLOR) return false
  return Boolean(stream && stream.isTTY)
}

function writeFile (path, text) {
  const full = resolve(path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, text)
  return full
}

/** Open a file with the desktop default app. Never throws, never blocks. */
export function openFile (path, platform = process.platform) {
  try {
    let cmd, args
    if (platform === 'darwin') { cmd = 'open'; args = [path] } else if (platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', path] } else { cmd = 'xdg-open'; args = [path] }
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => { /* no desktop opener here, the file is still on disk */ })
    child.unref()
    return true
  } catch {
    return false
  }
}

function num (v) {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export async function runReport (flags, io) {
  const budgetOpts = {}
  if (num(flags.window)) budgetOpts.contextWindow = num(flags.window)
  if (num(flags.fraction)) budgetOpts.fraction = num(flags.fraction)
  if (num(flags.budget)) budgetOpts.fixedChars = num(flags.budget)

  const report = buildReport({
    since: flags.since || null,
    budgetOpts,
    pricingPath: flags.pricing || null,
    cached: !flags.uncached,
    today: flags.today || null,
    cwd: flags.cwd || process.cwd(),
    cacheTtlMinutes: num(flags['cache-ttl']) || undefined,
  })

  const notes = []
  if (flags.card) {
    const full = writeFile(flags.card, renderCardPage(report))
    notes.push('wrote the share card to ' + tildify(full))
    if (flags.open && !flags.html) openFile(full)
  }
  if (flags.html) {
    const cardHref = flags.card ? relativeHref(flags.html, flags.card) : null
    const full = writeFile(flags.html, renderList(report, { cardHref }))
    notes.push('wrote the interactive page to ' + tildify(full))
    if (flags.open) {
      openFile(full)
      notes.push('asked your desktop to open it')
    }
  } else if (flags.open) {
    notes.push('--open needs --html=FILE, so nothing was opened')
  }
  if (flags.out) {
    const full = writeFile(flags.out, JSON.stringify(report, null, 2) + '\n')
    notes.push('wrote the report JSON to ' + tildify(full))
  }

  if (flags.json) {
    io.out(JSON.stringify(report, null, 2) + '\n')
  } else {
    io.out(renderText(report, { color: wantColor(flags, io.stream), top: num(flags.top) || 15 }))
    for (const n of notes) io.out(n + '\n')
  }
  return 0
}

/** The href that reaches `to` from the folder holding `from`. */
export function relativeHref (from, to) {
  const rel = relative(dirname(resolve(from)), resolve(to))
  return rel.split(sep).map(encodeURIComponent).join('/')
}

/**
 * The JSON a command was pointed at, from a file or from stdin. Returns null
 * after saying why on stderr, so the caller can just exit 1.
 *
 * `-` matters because the page says "paste it into your next message": the
 * agent usually holds the JSON as text, not as a file, and piping it in beats
 * writing a file only to read it straight back.
 */
function readInput (file, io, what) {
  try {
    return file === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(file), 'utf8')
  } catch (e) {
    const where = file === '-' ? 'the ' + what + ' JSON from stdin' : file
    io.err('could not read ' + where + ': ' + (e && e.message ? e.message : e) + '\n')
    return null
  }
}

export async function runApply (positional, flags, io) {
  const file = positional[0]
  if (!file) {
    io.err('apply needs the decisions JSON copied from the report page: a file path, or - to read it from stdin. For example: token-coupons apply decisions.json\n')
    return 1
  }
  const text = readInput(file, io, 'decisions')
  if (text === null) return 1
  const parsed = parseDecisions(text)
  if (!parsed.ok) {
    io.err('could not use ' + file + ': ' + parsed.reason + '\n')
    return 1
  }
  const skills = discoverSkills()
  const plan = planApply(parsed.decisions, { skills, thresholds: DEFAULT_THRESHOLDS })
  const result = applyPlan(plan, { yes: Boolean(flags.yes), trashDir: flags.trash || null })
  if (flags.json) io.out(JSON.stringify(result, null, 2) + '\n')
  else io.out(summarizeApply(result))
  const errored = result.steps.some((s) => s.error)
  return errored ? 1 : 0
}

export async function runDescribe (positional, flags, io) {
  const file = positional[0]
  if (!file) {
    io.err('describe needs the new descriptions as JSON: a file path, or - to read it from stdin. For example: token-coupons describe descriptions.json\n')
    return 1
  }
  const text = readInput(file, io, 'descriptions')
  if (text === null) return 1
  const parsed = parseEdits(text)
  if (!parsed.ok) {
    io.err('could not use ' + file + ': ' + parsed.reason + '\n')
    return 1
  }
  const skills = discoverSkills({ cwd: flags.cwd || process.cwd() })
  const plan = planDescribe(parsed.edits, { skills })
  const result = applyDescribe(plan, { yes: Boolean(flags.yes), trashDir: flags.trash || null })
  if (flags.json) io.out(JSON.stringify(result, null, 2) + '\n')
  else io.out(summarizeDescribe(result))
  return result.steps.some((s) => s.error) ? 1 : 0
}

export async function runPricing (flags, io) {
  const pricing = loadPricing(flags.pricing || null, { today: flags.today || null })
  if (flags.json) { io.out(JSON.stringify(pricing, null, 2) + '\n'); return pricing.error ? 1 : 0 }
  if (pricing.error) { io.err(pricing.error + '\n'); return 1 }
  const lines = []
  lines.push('Prices per ' + fmt(pricing.per) + ' tokens in ' + pricing.currency + ', verified on ' + (pricing.verifiedOn || 'an unknown date') +
    (pricing.stale ? ' (more than 60 days ago, so check them before quoting them)' : '') + ', from ' + tildify(pricing.path))
  lines.push('')
  const rows = [['model', 'vendor', 'tier', 'input', 'cache read', 'cache write', 'output']]
  for (const m of pricing.models) {
    rows.push([
      String(m.label || m.id), String(m.vendor || ''), String(m.tier || ''),
      money(m.input), money(m.cachedInput),
      m.cacheWrite === null || m.cacheWrite === undefined ? 'same as input' : money(m.cacheWrite),
      money(m.output),
    ])
  }
  const widths = []
  for (const r of rows) r.forEach((c, i) => { widths[i] = Math.max(widths[i] || 0, c.length) })
  for (const r of rows) lines.push('  ' + r.map((c, i) => i >= 3 ? c.padStart(widths[i]) : c.padEnd(widths[i])).join('  ').trimEnd())
  lines.push('')
  for (const m of pricing.models) {
    if (m.notes) lines.push('  ' + (m.label || m.id) + ': ' + m.notes)
  }
  io.out(lines.join('\n') + '\n')
  return 0
}

/**
 * Entry point. Returns the exit code instead of exiting so tests can call it.
 * `io` lets tests capture output; the default writes to stdout and stderr.
 */
export async function main (argv = process.argv.slice(2), io = null) {
  const o = io || {
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    stream: process.stdout,
  }
  const { command, positional, flags, errors } = parseArgs(argv)
  if (flags.version) { o.out(version() + '\n'); return 0 }
  if (flags.help || command === 'help') { o.out(helpText()); return 0 }
  if (errors.length) {
    for (const e of errors) o.err(e + '\n')
    o.err('run token-coupons help for the list of flags\n')
    return 2
  }
  try {
    if (command === 'report') return await runReport(flags, o)
    if (command === 'apply') return await runApply(positional, flags, o)
    if (command === 'describe') return await runDescribe(positional, flags, o)
    if (command === 'pricing') return await runPricing(flags, o)
    o.err('unknown command "' + command + '". Try report, apply, describe, pricing, or help.\n')
    return 2
  } catch (e) {
    o.err('token-coupons could not finish: ' + (e && e.stack ? e.stack : e) + '\n')
    return 1
  }
}

/* ------------------------------------------------------------------ entry */

function isEntryPoint () {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] || '')
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  main().then((code) => { process.exitCode = code }, (e) => {
    process.stderr.write(String(e && e.stack ? e.stack : e) + '\n')
    process.exitCode = 1
  })
}
