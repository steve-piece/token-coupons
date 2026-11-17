// token-coupons, as a mod: the same report, where you are already looking.
//
// Three things, all optional and none of them the tool itself:
//
//   a line under the prompt   what the skills list costs on every message, shown
//                             only while there is something to act on
//   /coupons                  opens a pane with the numbers, the first rows worth
//                             acting on, and one line per other tool
//   two buttons in that pane  measure again, and start the skill's own loop
//
// This file decides nothing. Every number comes from `token-coupons panel`,
// the skill's own CLI, which prints the report cut down to a few kilobytes of
// JSON (skills/token-coupons/src/render-panel.mjs). The mod finds that CLI,
// runs it, and draws what comes back. So the skill stays whole on its own: a
// standalone install never loads this file and loses nothing, and a plugin
// install gets a view of the same report rather than a second opinion.
//
// A session start reads only the record the last run left, which is one small
// file and takes no measuring. Measuring reads every tool's chat history and
// can take a while, so it happens when the pane is opened or Refresh is
// pressed, never unasked. Neither writes anything: the panel command leaves no
// run record, so a glance from here never becomes the baseline the next report
// compares against.

const PANE = 'token-coupons'
const COMMAND = 'coupons'
const PANEL_VERSION = 1

/** The skill's own slash command, under a plugin install and on its own. */
const SKILL_COMMANDS = ['token-coupons:token-coupons', 'token-coupons']

// The values the drawing reads, held by the host for the session so a hot
// reload keeps them. Read and written through $.state directly rather than the
// state library's helpers: builds before 2.1.286 refuse a module that hands $
// to an imported function, and these five need nothing the helpers add.
const PANEL = { plugin: 'token-coupons', key: 'panel' }
const PHASE = { plugin: 'token-coupons', key: 'phase' }
const PROBLEM = { plugin: 'token-coupons', key: 'problem' }
const QUIET = { plugin: 'token-coupons', key: 'isQuiet' }
const AUDIT = { plugin: 'token-coupons', key: 'audit' }
const AUDITING = { plugin: 'token-coupons', key: 'isAuditing' }

/** @type {import('claude-code').Register} */
export const register = (on) => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // The command exists in every session. `isInteractive` is no test for
    // that: it is true only under the terminal's own prompt, and false in the
    // desktop app, which hosts the session the way an SDK caller does.
    await $.command.register({
      name: COMMAND,
      description: 'What your skills list costs on every message, in a pane',
      argumentHint: '[refresh | quiet | loud]',
    })
    // Read the last run in every session too, for the same reason: nothing at
    // a start tells the desktop app from a headless run, and a line that is
    // missing where people work costs more than one small file read where
    // nobody is looking. Unawaited on purpose: the first prompt never waits.
    void wake($)

    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'quiet' || arg === 'loud') {
      const quiet = arg === 'quiet'
      await $.store.set('quiet', quiet)
      await $.state.set(QUIET, quiet)
      await showStatus($)

      return {
        text: quiet
          ? 'The skills list line under the prompt is off. /coupons loud brings it back.'
          : 'The skills list line under the prompt is back on.',
      }
    }
    if (arg !== '' && arg !== 'refresh') {
      return { text: '/coupons takes nothing, or one of: refresh, quiet, loud.' }
    }

    const opened = await $.ui.open({ id: PANE, title: 'Skills list' })
    const names = (await $.command.list()).map((c) => c.name)
    const found = SKILL_COMMANDS.find((name) => names.includes(name)) ?? null
    await $.state.set(AUDIT, found)

    const { value: held = null } = await $.state.get(PANEL)
    if (arg === 'refresh' || held === null || held.state !== 'measured') void measure($).catch(() => {})

    return {
      text: opened.isPlaced
        ? 'Skills list pane opened.'
        : 'Skills list pane is open but not drawn yet: ' + opened.reason,
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // Each read subscribes this drawing, so a later write draws it again.
    const { value: held = null } = await $.state.get(PANEL)
    const { value: now = 'idle' } = await $.state.get(PHASE)
    const { value: why = null } = await $.state.get(PROBLEM)
    const { value: start = null } = await $.state.get(AUDIT)
    const { value: auditing = false } = await $.state.get(AUDITING)
    const view = { panel: held, phase: now, problem: why, audit: start, auditing }
    const rows = [
      ...report({ Box, Text }, view.panel),
      ...footer({ Box, Text, Button }, $, view),
    ]

    return Box({ flexDirection: 'column', children: rows })
  })
}

/* ------------------------------------------------------------------ reading */

/**
 * What a session start does: remember the quiet switch, read the last run,
 * pin the line. It never rejects: it runs unawaited, and a session that ends
 * while it is in flight (a short headless run) takes $ away under it.
 */
function wake ($) {
  return readLastRun($).catch(() => {})
}

async function readLastRun ($) {
  try {
    const quiet = (await $.store.get('quiet')) === true
    await $.state.set(QUIET, quiet)
    // A hot reload keeps the state, and a measured panel beats the last record.
    const { value: held = null } = await $.state.get(PANEL)
    if (held === null) await $.state.set(PANEL, await runCli($, ['panel', '--last'], 20000))
  } catch (err) {
    // Said in the pane when it is opened, never at the start of a session.
    await $.state.set(PROBLEM, reasonOf(err))
  }
  await showStatus($)
}

/** A fresh measurement, started by the person: opening the pane, or Refresh. */
async function measure ($) {
  const { value: now = 'idle' } = await $.state.get(PHASE)
  if (now === 'measuring') return
  await $.state.set(PHASE, 'measuring')
  try {
    const fresh = await runCli($, ['panel'], 240000)
    await $.state.set(PANEL, fresh)
    await $.state.set(PROBLEM, null)
    await $.state.set(PHASE, 'idle')
  } catch (err) {
    await $.state.set(PROBLEM, reasonOf(err))
    await $.state.set(PHASE, 'failed')
  }
  await showStatus($)
}

/**
 * Runs the skill's CLI and returns the panel it printed. Rejects with one
 * plain sentence, because that sentence is what the pane shows.
 */
async function runCli ($, args, timeoutMs) {
  const cli = await findCli($)
  if (cli === null) throw new Error('The token-coupons skill this pane reads from was not found.')

  let ran
  try {
    ran = await $.process.run(['node', cli, ...args], { timeoutMs })
  } catch (err) {
    throw new Error('Could not run node, which the skill needs (20 or newer): ' + reasonOf(err))
  }
  if (ran.exitCode !== 0) {
    throw new Error(firstLine(ran.stderr) || 'The report stopped with exit code ' + ran.exitCode + '.')
  }

  let parsed
  try {
    parsed = JSON.parse(ran.stdout)
  } catch {
    throw new Error('The skill printed something this pane could not read. Updating both usually fixes it.')
  }
  if (!parsed || parsed.version !== PANEL_VERSION) {
    throw new Error('This pane and the token-coupons skill it found are different versions. Update the plugin.')
  }

  return parsed
}

/**
 * Where the CLI is: beside this plugin first, then the two places a skill
 * installed on its own lands. The last two make a copy of this mod loaded from
 * a bare folder work on a machine that has the standalone skill.
 */
async function findCli ($) {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  const tail = '/skills/token-coupons/bin/token-coupons.mjs'
  const places = [$.plugin.root + tail]
  if (home) places.push(home + '/.claude' + tail, home + '/.agents' + tail)

  for (const place of places) {
    if (await $.fs.exists(place)) return place
  }

  return null
}

/**
 * Starts the skill's own loop, once. Each press of the button used to queue a
 * whole run of the audit, and a button that showed nothing after a press got
 * pressed six times in five seconds. Now the first press claims the run with
 * a compare and set, the label says it started, and every press until the
 * run finishes does nothing.
 */
async function startAudit ($, command) {
  const held = await $.state.get(AUDITING)
  if (held.value === true) return
  const claimed = await $.state.set(AUDITING, true, { ifVersion: held.version })
  if (!claimed.isSet) return
  try {
    await $.command.run({ command })
  } catch (err) {
    await $.state.set(PROBLEM, reasonOf(err))
  } finally {
    await $.state.set(AUDITING, false)
  }
}

/* ------------------------------------------------------------------ the line */

async function showStatus ($) {
  const { value: quiet = false } = await $.state.get(QUIET)
  const { value: held = null } = await $.state.get(PANEL)
  $.ui.status(quiet ? undefined : statusText(held))
}

/**
 * The line under the prompt, or nothing. Quiet when the list is healthy: a
 * line that is always there stops being read.
 */
export function statusText (p) {
  if (!p || !p.listing) return undefined
  const wasted = Number(p.wastedTokens) || 0
  const lost = p.counts ? Number(p.counts.outOfReach) || 0 : 0
  if (wasted <= 0 && lost <= 0 && p.listing.fits !== false) return undefined

  const parts = ['skills list: ' + fmt(p.listing.tokens) + ' tokens a message']
  if (wasted > 0) parts.push(fmt(wasted) + ' unused')
  if (lost > 0) parts.push(fmt(lost) + ' out of reach')

  return parts.join(', ') + ' (/coupons)'
}

/* ------------------------------------------------------------------ the pane */

// One colour, one meaning, the same wherever it appears:
//
//   red        skills nobody uses: their count, and delete, the action for them
//   yellow     the allowance: being over it, and the skills that drops out of reach
//   gray       skills you start yourself by typing the name
//   dark blue  command, the action that makes a skill wait for its name
//   purple     shorten, the action that rewrites a description
//   teal       review and context, the two actions that are a judgement call
//   green      what comes back: tokens saved, and a list that fits
//
// The values are the engine's own theme keys, never raw names. A raw name is
// one fixed shade (plain yellow could not be read on a light theme); a theme
// key is the shade that theme chose, so dark blue is a deep blue on a light
// background and a pale one on a dark background. Coloured text is always bold
// as well, which is why nothing below sets a colour except through `tint`.
const COLOR = {
  unused: 'error',
  allowance: 'warning',
  typed: 'inactive',
  command: 'remember',
  shorten: 'skill',
  judgement: 'planMode',
  saved: 'success',
  problem: 'error',
}
const ACTION_COLOR = { command: COLOR.command, optimize: COLOR.shorten, delete: COLOR.unused, review: COLOR.judgement, context: COLOR.judgement, keep: COLOR.saved }
const ACTION_WORD = { command: 'command', optimize: 'shorten', delete: 'delete', review: 'review', context: 'context', keep: 'keep' }

/** The names a tool goes by in the short list. */
const SHORT = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', gemini: 'Gemini' }

/** Coloured text, bold by construction. */
function tint (Text, color, children, more = {}) {
  return Text({ ...more, color, bold: true, children })
}

/** The report half of the pane: a list of rows, top to bottom. */
function report ({ Box, Text }, p) {
  const row = (parts) => Box({ flexDirection: 'row', children: parts })
  const gap = () => Text({ children: ' ' })

  if (p === null || p.state === 'empty' || !p.listing) {
    return [
      Text({ bold: true, children: 'Your skills list' }),
      Text({ dimColor: true, children: 'Nothing measured on this machine yet.' }),
      gap(),
    ]
  }

  const { listing, counts, saving, money, score } = p
  const out = []

  out.push(row([
    Text({ bold: true, children: 'Your skills list' }),
    Text({ dimColor: true, children: '  measured ' + (p.generatedOn || 'earlier') + (p.state === 'last-run' ? ', by your last report' : '') }),
  ]))
  out.push(Text({ bold: true, children: fmt(listing.tokens) + ' tokens with every message' }))
  if (listing.fits === false) {
    out.push(row([
      tint(Text, COLOR.allowance, trim(listing.overRatio) + 'x its allowance'),
      Text({ dimColor: true, children: listing.allowanceTokens ? ' of ' + fmt(listing.allowanceTokens) + ' tokens' : '' }),
    ]))
    out.push(Text({ dimColor: true, wrap: 'wrap', children: 'Past it, descriptions are dropped quietly, least used first.' }))
  } else if (listing.fits === true) {
    out.push(tint(Text, COLOR.saved, 'Fits inside its allowance.'))
  }
  out.push(gap())

  const count = (n, label, tokens, tone) => row([
    n > 0 ? tint(Text, tone, String(fmt(n)).padStart(5) + '  ') : Text({ children: String(fmt(n)).padStart(5) + '  ' }),
    Text({ children: label }),
    Text({ dimColor: true, children: tokens ? '  ' + fmt(tokens) + ' tokens' : '' }),
  ])
  out.push(count(counts.neverUsed, 'never used, still described', counts.neverUsedTokens, COLOR.unused))
  out.push(count(counts.outOfReach, 'out of reach, description dropped', null, COLOR.allowance))
  out.push(count(counts.typedOnly, 'nearly always started by you', counts.typedOnlyTokens, COLOR.typed))
  out.push(gap())

  if (saving && saving.tokens > 0) {
    // One bold sentence in the text colour, with only the number in green: a
    // Text inside a Text, so the sentence still wraps as one.
    out.push(Text({
      bold: true,
      wrap: 'wrap',
      children: [
        'Take the suggestions and ',
        tint(Text, COLOR.saved, fmt(saving.tokens) + ' tokens'),
        ' come off every message' + (saving.fitsAfter === true && listing.fits === false ? ', and the list fits again.' : '.'),
      ],
    }))
  } else {
    out.push(tint(Text, COLOR.saved, 'Nothing here is wasted: every description has earned its place.', { wrap: 'wrap' }))
  }
  if (money) {
    out.push(row([
      Text({ children: 'On ' + money.model + ': ' + dollars(money.wastedPerWeek) + ' a week unread' }),
      Text({ dimColor: true, children: '  API prices, cached' }),
    ]))
  }
  if (score) out.push(Text({ dimColor: true, children: 'Score ' + score.score + ' of 100, grade ' + score.grade }))
  out.push(gap())

  if (p.state !== 'measured') {
    out.push(Text({ dimColor: true, wrap: 'wrap', children: 'The rows worth acting on and the other tools appear once this is measured again.' }))
    out.push(gap())

    return out
  }

  if (p.top.length > 0) {
    out.push(Text({ bold: true, children: 'WORTH ACTING ON' }))
    for (const item of p.top) {
      out.push(row([
        Text({ dimColor: true, children: fmt(item.saves).padStart(6) + '  ' }),
        tint(Text, ACTION_COLOR[item.action] || COLOR.judgement, (ACTION_WORD[item.action] || item.action).padEnd(9)),
        Text({ wrap: 'truncate-end', children: item.name }),
      ]))
    }
    if (p.more > 0) out.push(Text({ dimColor: true, children: '        and ' + fmt(p.more) + ' more in the full report' }))
    out.push(gap())
  }

  out.push(...installed({ Box, Text }, p))

  if (p.drift.length > 0) {
    out.push(Text({ bold: true, children: 'SINCE YOUR LAST REPORT' }))
    for (const note of p.drift) out.push(Text({ dimColor: true, wrap: 'wrap', children: note }))
    out.push(gap())
  }

  return out
}

/**
 * How many skills are installed, then how many each tool lists, largest
 * first. The total counts a skill once however many tools it is linked into,
 * so the lines under it add up to more: that difference is the sharing.
 */
function installed ({ Box, Text }, p) {
  const tools = [{ id: 'claude', label: 'Claude Code', skills: p.listing.skills }, ...p.tools]
    .map((tool) => ({ name: SHORT[tool.id] || tool.label, skills: Number(tool.skills) || 0 }))
    .sort((a, b) => b.skills - a.skills || (a.name < b.name ? -1 : 1))
  if (tools.length < 2) return []

  // A panel held from before the total was counted has no number to lead with.
  const total = typeof p.installed === 'number' ? fmt(p.installed) + '  ' : ''
  const out = [Text({ bold: true, children: total + 'Skills Installed' }), Text({ children: ' ' })]
  for (const tool of tools) out.push(Text({ children: '• ' + tool.name + ': ' + fmt(tool.skills) }))
  out.push(Text({ children: ' ' }))

  return out
}

/** What is happening now, then the two things to do about it. */
function footer ({ Box, Text, Button }, $, view) {
  const out = []
  if (view.phase === 'measuring') {
    // No colour: yellow means the allowance here, and this is only a wait.
    out.push(Text({ bold: true, wrap: 'wrap', children: 'Measuring now. It reads every tool\'s chat history, so give it a moment.' }))
  } else if (view.problem) {
    out.push(tint(Text, COLOR.problem, view.problem, { wrap: 'wrap' }))
  }

  // No hotkeys. A letter hotkey fires on that letter typed anywhere while the
  // pane holds the keyboard, so typing into a focused pane pressed these.
  const buttons = [
    Button({
      key: 'refresh',
      label: view.phase === 'measuring' ? 'Measuring' : 'Refresh',
      onPress: () => { void measure($).catch(() => {}) },
    }),
  ]
  if (view.audit) {
    const command = view.audit
    buttons.push(Button({
      key: 'audit',
      label: view.auditing ? 'Audit started' : 'Decide what to change',
      variant: 'primary',
      onPress: () => { void startAudit($, command).catch(() => {}) },
    }))
  }
  out.push(Box({ flexDirection: 'row', gap: 2, children: buttons }))
  out.push(Text({ dimColor: true, wrap: 'wrap', children: view.audit ? '/' + view.audit + ' walks you through it and changes nothing until you say so.' : 'The token-coupons skill carries out the changes; this pane only shows them.' }))

  return out
}

/* ------------------------------------------------------------------ helpers */

/** 14517 as 14,517. Written out because this environment promises no locale data. */
function fmt (n) {
  const v = Math.round(Number(n) || 0)

  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function dollars (n) {
  const v = Number(n) || 0

  return '$' + (v < 0.1 && v > 0 ? v.toFixed(3) : v.toFixed(2))
}

function trim (n) {
  return String(+(Number(n) || 0).toFixed(2))
}

function firstLine (text) {
  return String(text || '').split('\n').map((line) => line.trim()).find((line) => line !== '') || ''
}

function reasonOf (err) {
  const text = err && typeof err.message === 'string' ? err.message : String(err)

  return text.length > 240 ? text.slice(0, 237) + '...' : text
}
