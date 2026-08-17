import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeFixtureHome } from './helpers.mjs'
import { VERSION } from '../skills/token-coupons/src/version.mjs'
import { parseFrontmatter } from '../skills/token-coupons/src/lib/util.mjs'
import { DEFAULT_THRESHOLDS } from '../skills/token-coupons/src/recommend.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// The tool lives entirely inside its skill directory, because `skills add`
// copies that directory and nothing else.
const SKILL = join(ROOT, 'skills', 'token-coupons')
const BIN = join(SKILL, 'bin', 'token-coupons.mjs')

function run (args, home, extraEnv = {}) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { TOKEN_COUPONS_HOME: home, NO_COLOR: '1' }, extraEnv),
  })
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' }
}

function fixture () {
  return makeFixtureHome({
    skills: [
      { name: 'alpha', description: 'Alpha does the alpha thing whenever anyone asks for it, and it is well used.' },
      { name: 'beta', description: 'Beta has never been used by anyone at all, and sits in the user folder.' },
      { name: 'gamma', description: 'Gamma lives in a plugin cache.', where: 'plugin-cache', plugin: 'plug' },
      { name: 'delta', description: 'Delta is gated already.', gate: 'true' },
    ],
    transcripts: [{
      session: 's1', date: '2026-08-10T10:00:00Z',
      turns: [{ user: 'do alpha' }, { skill: 'alpha' }, { user: 'again' }, { skill: 'alpha' }, { assistant: 'ok' }],
    }],
    settings: { model: 'claude-opus-5' },
  })
}

describe('cli: help and version', () => {
  test('help prints usage and exits 0, with or without the word help', () => {
    const fx = fixture()
    try {
      for (const args of [['help'], ['--help'], ['-h']]) {
        const r = run(args, fx.home)
        assert.equal(r.code, 0, args.join(' '))
        assert.match(r.out, /Usage/)
        assert.match(r.out, /token-coupons report/)
        assert.match(r.out, /token-coupons apply/)
      }
    } finally { fx.cleanup() }
  })

  test('--version prints the tool version', () => {
    const fx = fixture()
    try {
      const r = run(['--version'], fx.home)
      assert.equal(r.code, 0)
      assert.equal(r.out.trim(), VERSION)
    } finally { fx.cleanup() }
  })

  test('an unknown flag or command explains itself and exits 2', () => {
    const fx = fixture()
    try {
      const a = run(['report', '--bogus'], fx.home)
      assert.equal(a.code, 2)
      assert.match(a.err, /unknown flag --bogus/)
      const b = run(['dance'], fx.home)
      assert.equal(b.code, 2)
      assert.match(b.err, /unknown command "dance"/)
    } finally { fx.cleanup() }
  })
})

describe('cli: report', () => {
  test('default command prints the text report and exits 0', () => {
    const fx = fixture()
    try {
      const r = run([], fx.home)
      assert.equal(r.code, 0, r.err)
      assert.match(r.out, /WHAT THE LISTING COSTS/)
      assert.match(r.out, /RECOMMENDED/)
      assert.match(r.out, /alpha/)
      assert.equal(/\x1b\[/.test(r.out), false, 'no color when NO_COLOR is set')
    } finally { fx.cleanup() }
  })

  test('--json prints the whole Report and --since and --today flow through', () => {
    const fx = fixture()
    try {
      const r = run(['report', '--json', '--since=2026-08-01', '--today=2026-08-15'], fx.home)
      assert.equal(r.code, 0, r.err)
      const report = JSON.parse(r.out)
      assert.equal(report.version, 1)
      assert.equal(report.since, '2026-08-01')
      assert.equal(report.generatedOn, '2026-08-15')
      assert.equal(report.summary.skills, 4)
      assert.equal(report.skills[0].recommendation.rank, 1)
      assert.ok(report.cost.perModel.length > 0)
      assert.ok(report.summary.wastedPerWeekOnYourModel)
    } finally { fx.cleanup() }
  })

  test('--html and --out write files, --window and --budget change the allowance', () => {
    const fx = fixture()
    try {
      const html = join(fx.home, 'out', 'nested', 'report.html')
      const out = join(fx.home, 'out', 'report.json')
      const r = run(['report', '--html=' + html, '--out=' + out, '--window=200000', '--no-color'], fx.home)
      assert.equal(r.code, 0, r.err)
      assert.match(r.out, /WHAT THE LISTING COSTS/, 'text report still prints alongside --html')
      assert.match(r.out, /wrote the interactive page/)
      assert.ok(existsSync(html))
      assert.ok(existsSync(out))
      const page = readFileSync(html, 'utf8')
      assert.equal(page.split('id="report-data"').length - 1, 1)
      assert.equal(page.split('<select').length - 1, 4, 'one select per skill')
      const report = JSON.parse(readFileSync(out, 'utf8'))
      assert.equal(report.budget.contextWindow, 200000)
      assert.equal(report.budget.windowSource, '--window flag')

      const b = run(['report', '--json', '--budget=100', '--fraction=0.5'], fx.home)
      const rb = JSON.parse(b.out)
      assert.equal(rb.budget.chars, 100)
      assert.equal(rb.budget.source, 'SLASH_COMMAND_TOOL_CHAR_BUDGET')
      assert.ok(rb.summary.unroutable > 0)
    } finally { fx.cleanup() }
  })

  test('--uncached and --pricing flow through, and a bad price list does not crash', () => {
    const fx = fixture()
    try {
      const un = JSON.parse(run(['report', '--json', '--uncached'], fx.home).out)
      assert.equal(un.cost.assumptions.cached, false)
      const bad = join(fx.home, 'bad.json')
      writeFileSync(bad, 'nope')
      const r = run(['report', '--json', '--pricing=' + bad], fx.home)
      assert.equal(r.code, 0)
      const report = JSON.parse(r.out)
      assert.equal(report.cost.perModel.length, 0)
      assert.equal(report.summary.wastedPerWeekOnYourModel, null)
    } finally { fx.cleanup() }
  })
})

describe('cli: run history', () => {
  test('a settings flag carries forward, and the report says what moved', () => {
    const fx = fixture()
    try {
      const runs = join(fx.home, 'runs')
      const first = run(['report', '--since=2026-08-01', '--runs=' + runs], fx.home)
      assert.equal(first.code, 0, first.err)
      assert.equal(/SINCE YOUR LAST RUN/.test(first.out), false, 'nothing to compare on the first run')
      assert.equal(readdirSync(runs).length, 1)

      const second = run(['report', '--runs=' + runs], fx.home)
      assert.match(second.out, /sessions since 2026-08-01/, '--since carried forward without being typed again')
      assert.match(second.out, /SINCE YOUR LAST RUN/)
      assert.match(second.out, /--since carried forward/)
      assert.equal(readdirSync(runs).length, 2, 'every run leaves its own record')

      const elsewhere = run(['report', '--runs=' + runs, '--cwd=' + fx.home], fx.home)
      assert.match(elsewhere.out, /different folder this time/)
    } finally { fx.cleanup() }
  })

  test('--fresh carries nothing forward and compares nothing', () => {
    const fx = fixture()
    try {
      const runs = join(fx.home, 'runs')
      run(['report', '--since=2026-08-01', '--runs=' + runs], fx.home)
      const r = run(['report', '--fresh', '--runs=' + runs], fx.home)
      assert.equal(/sessions since/.test(r.out), false)
      assert.equal(/SINCE YOUR LAST RUN/.test(r.out), false)
      assert.equal(readdirSync(runs).length, 2, 'it still leaves its own record for next time')
    } finally { fx.cleanup() }
  })

  test('a history folder that cannot be written is a note, not a failure', () => {
    const fx = fixture()
    try {
      const blocked = join(fx.home, 'blocked')
      writeFileSync(blocked, 'this is a file, not a folder')
      const r = run(['report', '--runs=' + blocked], fx.home)
      assert.equal(r.code, 0, 'the report is still worth having')
      assert.match(r.out, /WHAT THE LISTING COSTS/)
      assert.match(r.out, /could not write the run history/)
    } finally { fx.cleanup() }
  })
})

describe('cli: apply', () => {
  test('without a file it explains and exits 1', () => {
    const fx = fixture()
    try {
      const r = run(['apply'], fx.home)
      assert.equal(r.code, 1)
      assert.match(r.err, /decisions (file|JSON)/)
    } finally { fx.cleanup() }
  })

  test('a broken decisions file exits 1 with the reason', () => {
    const fx = fixture()
    try {
      const f = join(fx.home, 'd.json')
      writeFileSync(f, '{ "version": 1 }')
      const r = run(['apply', f], fx.home)
      assert.equal(r.code, 1)
      assert.match(r.err, /decisions/)
    } finally { fx.cleanup() }
  })

  test('without --yes it prints the plan, changes nothing, refuses plugin cache deletes, and exits 0', () => {
    const fx = fixture()
    try {
      const betaMd = join(fx.skillPath('beta'), 'SKILL.md')
      const before = readFileSync(betaMd, 'utf8')
      const f = join(fx.home, 'decisions.json')
      writeFileSync(f, JSON.stringify({
        version: 1,
        generatedOn: '2026-08-15',
        source: 'token-coupons html report',
        decisions: [
          { name: 'alpha', path: fx.skillPath('alpha'), action: 'keep', note: '' },
          { name: 'beta', path: fx.skillPath('beta'), action: 'active', note: '' },
          { name: 'plug:gamma', path: fx.skillPath('gamma'), action: 'delete', note: '' },
        ],
      }))
      const r = run(['apply', f], fx.home)
      assert.equal(r.code, 0, r.err)
      assert.match(r.out, /Plan only/)
      assert.match(r.out, /set-gate\s+beta/)
      assert.match(r.out, /claude plugin uninstall/)
      assert.equal(readFileSync(betaMd, 'utf8'), before, 'dry run wrote nothing')
      assert.equal(existsSync(join(fx.home, '.token-coupons')), false, 'no trash folder created')

      const j = run(['apply', f, '--json'], fx.home)
      assert.equal(j.code, 0)
      const result = JSON.parse(j.out)
      assert.equal(result.dryRun, true)
      assert.equal(result.applied, 0)
      assert.equal(result.steps.length, 2)
      assert.equal(result.refused.length, 1)
    } finally { fx.cleanup() }
  })

  test('with --yes it flips the gate and prints the undo line, and --trash is honoured', () => {
    const fx = fixture()
    try {
      const betaMd = join(fx.skillPath('beta'), 'SKILL.md')
      const trash = join(fx.home, 'my-trash')
      const f = join(fx.home, 'decisions.json')
      writeFileSync(f, JSON.stringify({
        version: 1,
        decisions: [
          { name: 'beta', path: fx.skillPath('beta'), action: 'active' },
          { name: 'alpha', path: fx.skillPath('alpha'), action: 'delete' },
        ],
      }))
      const r = run(['apply', f, '--yes', '--trash=' + trash], fx.home)
      assert.equal(r.code, 0, r.err + r.out)
      assert.match(r.out, /Carried out 2 of 2/)
      assert.match(r.out, /undo:/)
      assert.match(readFileSync(betaMd, 'utf8'), /disable-model-invocation: true/)
      assert.equal(existsSync(fx.skillPath('alpha')), false, 'alpha moved out')
      assert.ok(statSync(trash).isDirectory(), 'trash dir created where asked')
    } finally { fx.cleanup() }
  })
})

describe('cli: describe', () => {
  test('without a file it explains and exits 1', () => {
    const fx = fixture()
    try {
      const r = run(['describe'], fx.home)
      assert.equal(r.code, 1)
      assert.match(r.err, /new descriptions as JSON/)
    } finally { fx.cleanup() }
  })

  test('reads the new text from stdin, plans first, then writes on --yes', () => {
    const fx = fixture()
    try {
      const alphaMd = join(fx.skillPath('alpha'), 'SKILL.md')
      const before = readFileSync(alphaMd, 'utf8')
      const text = 'Alpha, rewritten: what it does, the words that reach for it, and where it stops.'
      const json = JSON.stringify({ version: 1, descriptions: [{ name: 'alpha', description: text }] })

      const dry = spawnSync(process.execPath, [BIN, 'describe', '-'], {
        encoding: 'utf8', input: json,
        env: Object.assign({}, process.env, { TOKEN_COUPONS_HOME: fx.home, NO_COLOR: '1' }),
      })
      assert.equal(dry.status, 0, dry.stderr)
      assert.match(dry.stdout, /Plan only/)
      assert.equal(readFileSync(alphaMd, 'utf8'), before, 'a plan writes nothing')

      const f = join(fx.home, 'descriptions.json')
      writeFileSync(f, json)
      const trash = join(fx.home, 'my-trash')
      const r = run(['describe', f, '--yes', '--trash=' + trash], fx.home)
      assert.equal(r.code, 0, r.err)
      assert.match(r.out, /Rewrote 1 of 1 description/)
      assert.match(r.out, /undo: cp /)
      assert.match(readFileSync(alphaMd, 'utf8'), /description: >-/)
      assert.match(readFileSync(alphaMd, 'utf8'), /Alpha, rewritten/)
      assert.ok(statSync(trash).isDirectory(), 'the copy it kept went where asked')
    } finally { fx.cleanup() }
  })

  test('a description past the cap is refused and the file is left alone', () => {
    const fx = fixture()
    try {
      const alphaMd = join(fx.skillPath('alpha'), 'SKILL.md')
      const before = readFileSync(alphaMd, 'utf8')
      const f = join(fx.home, 'descriptions.json')
      writeFileSync(f, JSON.stringify({ version: 1, descriptions: [{ name: 'alpha', description: 'x'.repeat(2000) }] }))
      const r = run(['describe', f, '--yes', '--json'], fx.home)
      assert.equal(r.code, 0)
      const result = JSON.parse(r.out)
      assert.equal(result.applied, 0)
      assert.equal(result.refused.length, 1)
      assert.equal(readFileSync(alphaMd, 'utf8'), before)
    } finally { fx.cleanup() }
  })
})

describe('the skill this tool ships as', () => {
  const skillMd = () => readFileSync(join(SKILL, 'SKILL.md'), 'utf8')

  test('obeys its own advice: gated, one line, and pointed at the opus family', () => {
    const fm = parseFrontmatter(skillMd())
    assert.equal(fm.data.name, 'token-coupons')
    assert.equal(fm.data['disable-model-invocation'], 'true')
    assert.equal(fm.data.model, 'opus')
    assert.equal(fm.data['allowed-tools'], undefined, 'this loop moves folders, so nothing is pre-approved')
    // A gated skill never routes, so trigger phrases in its description would be
    // paid for on every message and never read. Its own description-rewrite.md
    // says one line, and the tool cannot contradict the tool.
    const d = String(fm.data.description || '')
    assert.ok(d.length > DEFAULT_THRESHOLDS.thinChars, 'still says what it is')
    assert.ok(d.length < 200, 'one line, because it never routes: ' + d.length + ' characters')
  })

  test('names no package to install, because there is none', () => {
    assert.equal(/npm install|npx token-coupons/.test(skillMd()), false)
  })

  test('renders the scorecard only after the changes land', () => {
    const body = skillMd()
    const card = body.indexOf('--card=')
    const apply = body.indexOf('apply "$HOME/.token-coupons/decisions.json" --yes')
    assert.ok(apply > 0 && card > apply, 'the card is written in the last step, not the first')
  })

  test('the version the plugin installer reads matches the one the tool prints', () => {
    const plugin = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'))
    assert.equal(plugin.version, VERSION)
    const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'))
    assert.equal(market.metadata.version, VERSION)
    assert.equal(market.plugins[0].version, VERSION)
  })
})

describe('cli: pricing', () => {
  test('prints the price table with the verified date', () => {
    const fx = fixture()
    try {
      const r = run(['pricing'], fx.home)
      assert.equal(r.code, 0, r.err)
      assert.match(r.out, /verified on \d{4}-\d{2}-\d{2}/)
      assert.match(r.out, /Claude Opus 5/)
      const j = run(['pricing', '--json'], fx.home)
      const p = JSON.parse(j.out)
      assert.ok(Array.isArray(p.models) && p.models.length > 0)
    } finally { fx.cleanup() }
  })

  test('a missing price list exits 1', () => {
    const fx = fixture()
    try {
      const r = run(['pricing', '--pricing=' + join(fx.home, 'missing.json')], fx.home)
      assert.equal(r.code, 1)
      assert.match(r.err, /could not read/)
    } finally { fx.cleanup() }
  })
})

describe('cli: entry point guard', () => {
  test('importing the module runs nothing, and running through a symlink still works', () => {
    const fx = fixture()
    try {
      // the module path travels in the environment, because with -e the first extra argument becomes argv[1]
      const probe = spawnSync(process.execPath, ['--input-type=module', '-e',
        'import(process.env.TC_BIN).then((m) => process.stdout.write(typeof m.main + ":" + typeof m.parseArgs))'],
      { encoding: 'utf8', env: Object.assign({}, process.env, { TC_BIN: BIN, TOKEN_COUPONS_HOME: fx.home }) })
      assert.equal(probe.stdout, 'function:function', 'import runs nothing and exports main')

      const linkDir = join(fx.home, 'bin-link')
      mkdirSync(linkDir, { recursive: true })
      const link = join(linkDir, 'tc')
      symlinkSync(BIN, link)
      const r = spawnSync(process.execPath, [link, '--version'], { encoding: 'utf8', env: Object.assign({}, process.env, { TOKEN_COUPONS_HOME: fx.home }) })
      assert.equal(r.status, 0)
      assert.equal(r.stdout.trim(), VERSION)
    } finally { fx.cleanup() }
  })

  test('parseArgs accepts --k=v and --k v and treats a .json positional as the apply target', async () => {
    const { parseArgs } = await import('../skills/token-coupons/bin/token-coupons.mjs')
    const a = parseArgs(['report', '--since', '2026-01-01', '--json', '--html=x.html'])
    assert.equal(a.command, 'report')
    assert.equal(a.flags.since, '2026-01-01')
    assert.equal(a.flags.json, true)
    assert.equal(a.flags.html, 'x.html')
    const b = parseArgs(['apply', 'decisions.json', '--yes'])
    assert.equal(b.command, 'apply')
    assert.deepEqual(b.positional, ['decisions.json'])
    assert.equal(b.flags.yes, true)
    const c = parseArgs(['--json'])
    assert.equal(c.command, 'report')
  })
})
