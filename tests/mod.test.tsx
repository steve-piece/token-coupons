// The mod, run inside the engine itself: `claude plugin test .` from the repo
// root. This is not part of `node --test` (the file is .tsx on purpose, which
// Node's runner never picks up) because it needs Claude Code, and the tool's
// own suite must keep running on a bare Node with nothing installed.
//
// What it holds the mod to: a session start reads the last run and measures
// nothing, the line under the prompt is quiet when the list is healthy, the
// pane draws on every surface, and every number on it comes from the CLI.

import { describe, expect, mock, test } from 'claude-code/testing'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const HOME = '/home/me'

const LAST = {
  version: 1,
  tool: '0.1.0',
  state: 'last-run',
  generatedOn: '2026-09-24',
  ranAt: '2026-09-24T22:39:28.257Z',
  cwd: '~/work',
  listing: { skills: 121, notListed: 612, tokens: 14771, allowanceTokens: null, alsoElsewhere: null, overRatio: 1.48, fits: false },
  counts: { neverUsed: 76, neverUsedTokens: null, outOfReach: 26, typedOnly: 6, typedOnlyTokens: null },
  wastedTokens: 9648,
  saving: { tokens: 9140, fitsAfter: true },
  money: { model: 'Claude Opus 5', wastedPerWeek: 19.9454, wastedPerMonth: 86.4302, savedPerMonth: 81.8793 },
  actions: { command: 45, delete: 12, optimize: 12, review: 0, keep: 52, context: 0 },
  score: { score: 35, grade: 'F' },
  installed: null,
  top: [],
  more: 0,
  tools: [],
  drift: [],
}

const MEASURED = {
  ...LAST,
  state: 'measured',
  generatedOn: '2026-10-05',
  listing: { skills: 119, notListed: 713, tokens: 14517, allowanceTokens: 10000, alsoElsewhere: 69, overRatio: 1.45, fits: false },
  counts: { neverUsed: 86, neverUsedTokens: 10436, outOfReach: 24, typedOnly: 4, typedOnlyTokens: 326 },
  wastedTokens: 10762,
  saving: { tokens: 10178, fitsAfter: true },
  installed: 320,
  top: [
    { rank: 1, action: 'command', saves: 263, name: 'library-app-parity', why: 'Never used in these sessions.' },
    { rank: 8, action: 'optimize', saves: 146, name: 'future-recommendations', why: 'The agent picks it, but it is long.' },
    { rank: 10, action: 'delete', saves: 137, name: 'on-page-seo-auditor', why: 'Never used, last edited 203 days ago.' },
    { rank: 12, action: 'review', saves: 0, name: 'dormant-command', why: 'Already a command, never used.' },
  ],
  more: 49,
  tools: [
    { id: 'codex', label: 'Codex', skills: 57, alsoInClaude: 36, tokens: 6731, allowanceTokens: 5168, over: true, chats: 23, uses: 35, readsGate: false, notes: [] },
    { id: 'cursor', label: 'Cursor', skills: 243, alsoInClaude: 63, tokens: 23356, allowanceTokens: null, over: null, chats: 3187, uses: 1271, readsGate: true, notes: [] },
    { id: 'gemini', label: 'Gemini CLI', skills: 1, alsoInClaude: 0, tokens: 58, allowanceTokens: null, over: null, chats: 0, uses: 0, readsGate: false, notes: ['no Gemini CLI chats found under ~/.gemini/tmp'] },
  ],
  drift: ['2 skills added since the last run (alpha, beta).'],
}

const HEALTHY = {
  ...LAST,
  listing: { skills: 12, notListed: 0, tokens: 900, allowanceTokens: null, overRatio: 0.09, fits: true },
  counts: { neverUsed: 0, neverUsedTokens: null, outOfReach: 0, typedOnly: 0, typedOnlyTokens: null },
  wastedTokens: 0,
  saving: { tokens: 0, fitsAfter: true },
  money: null,
}

const SKILL = { name: 'token-coupons:token-coupons', description: 'Audit your skills.', source: 'plugin' }

/** Everything beneath the mod: the file system, the CLI, the command list. */
function world (on: any, given: { hasCli?: boolean; last?: unknown; fresh?: unknown; commands?: unknown[]; exitCode?: number; stderr?: string } = {}) {
  // The mod starts its reading unawaited, so a session never waits on it.
  // `clock.settle()` is the step between starting that and looking at it.
  const seen = { runs: [] as string[][], status: [] as (string | undefined)[], registered: [] as string[], clock: mock.clock(on) }
  mock.store(on)
  mock.env(on, { HOME })
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('fs.exists', (_$: any, e: any) => ({
    // Only the copy beside the plugin exists: the standalone places do not.
    value: given.hasCli !== false && e.path.endsWith('/skills/token-coupons/bin/token-coupons.mjs') && !e.path.startsWith(HOME),
  }))
  on('process.run', (_$: any, e: any) => {
    seen.runs.push([...e.argv])
    const panel = e.argv.includes('--last') ? (given.last ?? LAST) : (given.fresh ?? MEASURED)

    return {
      value: {
        exitCode: given.exitCode ?? 0,
        stdout: given.exitCode ? '' : JSON.stringify(panel),
        stderr: given.stderr ?? '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('command.list', () => ({ value: given.commands ?? [SKILL] }))
  on('command.register', (_$: any, e: any) => {
    seen.registered.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.status', (_$: any, e: any) => {
    seen.status.push(e.text)

    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  // The skill's own command, as the button runs it. It answers late, the way a
  // queued run does, so presses can land while it is still going.
  const audits = [] as number[]
  on('command.run', { command: 'token-coupons:token-coupons' }, async () => {
    audits.push(audits.length + 1)
    await seen.clock.sleep(30000)

    return { text: '' }
  })
  Object.assign(seen, { audits })

  return seen
}

async function start ($: any, seen: { clock: { settle: () => Promise<void> } }, isInteractive = true) {
  await $.session.start({ surface: isInteractive ? 'terminal' : null, isInteractive, cwd: '/work' })
  await seen.clock.settle()
}

async function coupons ($: any, seen: { clock: { settle: () => Promise<void> } }, args = '') {
  const ran = await $.command.run({ command: 'coupons', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
  await seen.clock.settle()

  return ran
}

const pane = ($: any, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({
    plugin: 'token-coupons',
    surface,
    component: 'Pane',
    requestId: 'token-coupons',
    props: { title: 'Skills list', isFocused: false, bodyColumns: 60, placement: 'dock' },
  } as any)

describe('a session start', () => {
  test('reads the last run, pins the line, and measures nothing', async ($, on) => {
    const seen = world(on)
    await start($, seen)

    expect(seen.registered).toEqual(['coupons'])
    expect(seen.runs).toHaveLength(1)
    expect(seen.runs[0]?.slice(-2)).toEqual(['panel', '--last'])
    expect(seen.runs[0]?.[0]).toBe('node')
    expect(seen.runs[0]?.[1]).toMatch(/\/skills\/token-coupons\/bin\/token-coupons\.mjs$/)
    expect(seen.status.at(-1)).toBe('skills list: 14,771 tokens a message, 9,648 unused, 26 out of reach (/coupons)')
  })

  test('pins nothing when the list is healthy, because a line that is always there stops being read', async ($, on) => {
    const seen = world(on, { last: HEALTHY })
    await start($, seen)

    expect(seen.status.at(-1)).toBeUndefined()
  })

  test('pins nothing before the tool has ever run on the machine', async ($, on) => {
    const seen = world(on, { last: { ...LAST, state: 'empty', listing: null, counts: null, wastedTokens: null } })
    await start($, seen)

    expect(seen.status.at(-1)).toBeUndefined()
  })

  test('a headless run gets the command and the same one small read, and nothing more', async ($, on) => {
    const seen = world(on)
    await start($, seen, false)

    expect(seen.registered).toEqual(['coupons'])
    expect(seen.runs).toHaveLength(1)
    expect(seen.runs[0]?.slice(-2)).toEqual(['panel', '--last'])
  })
})

// The desktop app hosts a session the way an SDK caller does: at the start it
// reports no surface and `isInteractive: false`, exactly like `claude -p`. The
// first version of this mod took that to mean headless and registered nothing,
// so /coupons did not exist in the one place most people would type it.
describe('in the desktop app', () => {
  test('/coupons exists and works though the session never calls itself interactive', async ($, on) => {
    const seen = world(on)
    await start($, seen, false)
    const ran = await coupons($, seen)

    expect(seen.registered).toEqual(['coupons'])
    expect(ran.text).toBe('Skills list pane opened.')
    const ui = await pane($, 'desktop')
    expect(await ui.find({ type: 'Text', text: '14,517 tokens with every message' })).toBeDefined()
    await ui.unmount()
  })

  test('the line is pinned at the start, before any surface has attached', async ($, on) => {
    const seen = world(on)
    await start($, seen, false)

    expect(seen.status.at(-1)).toBe('skills list: 14,771 tokens a message, 9,648 unused, 26 out of reach (/coupons)')
  })
})

describe('/coupons', () => {
  test('opens the pane, measures once, and draws the same numbers on every surface', async ($, on) => {
    const seen = world(on)
    await start($, seen)
    const ran = await coupons($, seen)

    expect(ran.text).toBe('Skills list pane opened.')
    expect(seen.runs).toHaveLength(2)
    expect(seen.runs[1]?.slice(2)).toEqual(['panel'])
    expect(seen.status.at(-1)).toBe('skills list: 14,517 tokens a message, 10,762 unused, 24 out of reach (/coupons)')

    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      expect(await ui.find({ type: 'Text', text: '14,517 tokens with every message' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '1.45x its allowance' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'never used, still described' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /Take the suggestions and 10,178 tokens come off every message, and the list fits again/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /On Claude Opus 5: \$19\.95 a week unread/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'WORTH ACTING ON' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'library-app-parity' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /and 49 more in the full report/ })).toBeDefined()
      // One total, then one line per tool, largest first. A shared skill is
      // counted once in the total and once per tool, so the lines add up to more.
      expect(await ui.find({ type: 'Text', text: '320  Skills Installed' })).toBeDefined()
      const bullets = (await ui.findAll({ type: 'Text', text: /^• / })).map((found: any) => found.text)
      expect(bullets).toEqual(['• Cursor: 243', '• Claude: 119', '• Codex: 57', '• Gemini: 1'])
      expect(await ui.find({ type: 'Text', text: 'OTHER TOOLS' })).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /2 skills added since the last run/ })).toBeDefined()
      expect(await ui.find({ key: 'refresh' })).toBeDefined()
      expect((await ui.find({ key: 'audit' }))?.props.label).toBe('Decide what to change')
      await ui.unmount()
    }
  })

  test('a panel from before the total was counted still draws the list, just without the number', async ($, on) => {
    // A hot reload keeps the panel the session already held, so the mod meets
    // the shape of the version before it. Missing is drawn as missing.
    const { installed: _dropped, ...older } = MEASURED
    const seen = world(on, { fresh: older })
    await start($, seen)
    await coupons($, seen)
    const ui = await pane($, 'terminal')

    expect(await ui.find({ type: 'Text', text: /^Skills Installed$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '• Cursor: 243' })).toBeDefined()
    await ui.unmount()
  })

  test('each colour means one thing, comes from the theme, and is always bold', async ($, on) => {
    const seen = world(on)
    await start($, seen)
    await coupons($, seen)
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      const texts = await ui.findAll({ type: 'Text' })
      const coloured = texts.filter((found: any) => found.props.color !== undefined)

      expect(coloured.length).toBeGreaterThan(6)
      for (const found of coloured) {
        // A raw name is one fixed shade (the yellow that could not be read on
        // white); a theme key is the shade the theme chose for the job.
        expect(['error', 'warning', 'inactive', 'remember', 'skill', 'planMode', 'success']).toContain(found.props.color)
        expect(found.props.bold).toBe(true)
      }
      const colourOf = (text: string) => texts.find((found: any) => found.text.trim() === text)?.props.color
      // the actions: command is always dark blue, and no two actions share a colour
      expect(colourOf('command')).toBe('remember')
      expect(colourOf('shorten')).toBe('skill')
      expect(colourOf('delete')).toBe('error')
      expect(colourOf('review')).toBe('planMode')
      // the three counts: red for never used, yellow for out of reach, gray for started by you
      expect(colourOf('86')).toBe('error')
      expect(colourOf('24')).toBe('warning')
      expect(colourOf('4')).toBe('inactive')
      // over the allowance is the same yellow as what it drops out of reach
      expect(colourOf('1.45x its allowance')).toBe('warning')
      await ui.unmount()
    }
  })

  test('the saving is one bold sentence in the text colour, with only the tokens in green', async ($, on) => {
    const seen = world(on)
    await start($, seen)
    await coupons($, seen)
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      const sentence = await ui.find({ type: 'Text', text: /^Take the suggestions and / })
      const number = await ui.find({ type: 'Text', text: /^10,178 tokens$/ })

      expect(sentence?.props.bold).toBe(true)
      expect(sentence?.props.color).toBeUndefined()
      expect(sentence?.text).toBe('Take the suggestions and 10,178 tokens come off every message, and the list fits again.')
      expect(number?.props.color).toBe('success')
      expect(number?.props.bold).toBe(true)
      await ui.unmount()
    }
  })

  test('the count of skills started by you says nearly always, since it is no longer only ever', async ($, on) => {
    const seen = world(on)
    await start($, seen)
    await coupons($, seen)
    const ui = await pane($, 'terminal')

    expect(await ui.find({ type: 'Text', text: 'nearly always started by you' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /only ever started/ })).toBeUndefined()
    await ui.unmount()
  })

  test('a wait is not painted as a warning, and a failure is', async ($, on) => {
    const seen = world(on, { exitCode: 1, stderr: 'token-coupons could not finish: the price list is unreadable' })
    await start($, seen)
    await coupons($, seen)
    const ui = await pane($, 'terminal')
    const failure = await ui.find({ type: 'Text', text: /could not finish/ })

    expect(failure?.props.color).toBe('error')
    expect(failure?.props.bold).toBe(true)
    await ui.unmount()
  })

  // Six presses in five seconds once queued six whole audits: the button showed
  // nothing after a press, and its letter hotkey fired on typed letters.
  test('the audit button starts one run however often it is pressed, and says it started', async ($, on) => {
    const seen: any = world(on)
    await start($, seen)
    await coupons($, seen)
    const ui = await pane($, 'terminal')

    for (let i = 0; i < 6; i++) void ui.press({ key: 'audit' })
    await seen.clock.settle()
    expect(seen.audits).toEqual([1])
    expect((await ui.find({ key: 'audit' }))?.props.label).toBe('Audit started')

    await seen.clock.advance(30000)
    expect((await ui.find({ key: 'audit' }))?.props.label).toBe('Decide what to change')
    void ui.press({ key: 'audit' })
    await seen.clock.settle()
    expect(seen.audits).toEqual([1, 2], 'once the run is done, the next press starts another')
    await seen.clock.advance(30000)
    await ui.unmount()
  })

  test('no button carries a hotkey, so typing into a focused pane presses nothing', async ($, on) => {
    const seen = world(on)
    await start($, seen)
    await coupons($, seen)
    const ui = await pane($, 'terminal')

    for (const button of await ui.findAll({ type: 'Button' })) expect(button.props.hotkey).toBeUndefined()
    await ui.unmount()
  })

  test('Refresh measures again and never asks for a saved run', async ($, on) => {
    const seen = world(on)
    await start($, seen)
    await coupons($, seen)
    const ui = await pane($, 'terminal')
    await ui.press({ key: 'refresh' })

    expect(seen.runs).toHaveLength(3)
    expect(seen.runs[2]?.slice(2)).toEqual(['panel'])
    expect(seen.runs.flat().some((arg) => arg === 'report' || arg.startsWith('--out') || arg.startsWith('--html'))).toBe(false)
    await ui.unmount()
  })

  test('without a fresh measurement the pane shows the last run and says what is missing', async ($, on) => {
    const seen = world(on, { fresh: LAST })
    await start($, seen)
    await coupons($, seen)
    const ui = await pane($, 'desktop')

    expect(await ui.find({ type: 'Text', text: /measured 2026-09-24, by your last report/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /appear once this is measured again/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'WORTH ACTING ON' })).toBeUndefined()
    expect(seen.runs.length).toBeGreaterThan(1)
    await ui.unmount()
  })

  test('quiet turns the line off, loud brings it back, and anything else is explained', async ($, on) => {
    const seen = world(on)
    await start($, seen)

    expect((await coupons($, seen, 'quiet')).text).toMatch(/is off/)
    expect(seen.status.at(-1)).toBeUndefined()
    expect((await coupons($, seen, 'loud')).text).toMatch(/back on/)
    expect(seen.status.at(-1)).toMatch(/^skills list: /)
    expect((await coupons($, seen, 'sideways')).text).toMatch(/refresh, quiet, loud/)
    expect(seen.runs).toHaveLength(1)
  })

  test('the button that starts the skill is only there when the skill is', async ($, on) => {
    const seen = world(on, { commands: [] })
    await start($, seen)
    await coupons($, seen)
    const ui = await pane($, 'terminal')

    expect(await ui.find({ key: 'audit' })).toBeUndefined()
    expect(await ui.find({ key: 'refresh' })).toBeDefined()
    await ui.unmount()
  })
})

describe('when something is missing', () => {
  test('no CLI beside the plugin: nothing is run, and the pane says so in one sentence', async ($, on) => {
    const seen = world(on, { hasCli: false })
    await start($, seen)
    await coupons($, seen)
    const ui = await pane($, 'terminal')

    expect(seen.runs).toEqual([])
    expect(seen.status.at(-1)).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /skill this pane reads from was not found/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Nothing measured on this machine yet.' })).toBeDefined()
    await ui.unmount()
  })

  test('a report that fails shows its own first line, not a stack', async ($, on) => {
    const seen = world(on, { exitCode: 1, stderr: '\ntoken-coupons could not finish: the price list is unreadable\n    at somewhere\n' })
    await start($, seen)
    await coupons($, seen)
    const ui = await pane($, 'terminal')

    expect(await ui.find({ type: 'Text', text: 'token-coupons could not finish: the price list is unreadable' })).toBeDefined()
    await ui.unmount()
  })

  test('a skill of another version is named as that, not drawn as zeros', async ($, on) => {
    const seen = world(on, { fresh: { ...MEASURED, version: 2 }, last: { ...LAST, version: 2 } })
    await start($, seen)
    await coupons($, seen)
    const ui = await pane($, 'terminal')

    expect(await ui.find({ type: 'Text', text: /different versions/ })).toBeDefined()
    await ui.unmount()
  })
})
