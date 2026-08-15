import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeFixtureHome } from './helpers.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(ROOT, 'bin', 'token-coupons.mjs')
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

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

  test('--version prints the package.json version', () => {
    const fx = fixture()
    try {
      const r = run(['--version'], fx.home)
      assert.equal(r.code, 0)
      assert.equal(r.out.trim(), PKG_VERSION)
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

describe('cli: apply', () => {
  test('without a file it explains and exits 1', () => {
    const fx = fixture()
    try {
      const r = run(['apply'], fx.home)
      assert.equal(r.code, 1)
      assert.match(r.err, /decisions file/)
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
      assert.equal(r.stdout.trim(), PKG_VERSION)
    } finally { fx.cleanup() }
  })

  test('parseArgs accepts --k=v and --k v and treats a .json positional as the apply target', async () => {
    const { parseArgs } = await import('../bin/token-coupons.mjs')
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
