#!/usr/bin/env node
// Fails the build if any forbidden dash appears anywhere in the repo. The
// characters are referenced by code point so this file stays clean itself.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CODES = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212]
const CHARS = CODES.map((c) => String.fromCodePoint(c))
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'tmp'])
const EXTS = new Set(['.mjs', '.js', '.json', '.md', '.html', '.css', '.txt', '.yml', '.yaml'])

function walk (dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (EXTS.has(extname(name)) || name === 'LICENSE') out.push(full)
  }
  return out
}

let bad = 0
for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8')
  text.split('\n').forEach((line, i) => {
    for (const ch of CHARS) {
      const at = line.indexOf(ch)
      if (at !== -1) {
        bad++
        process.stdout.write(file.slice(ROOT.length + 1) + ':' + (i + 1) + ':' + (at + 1) + '  U+' + ch.codePointAt(0).toString(16).toUpperCase() + '\n')
      }
    }
  })
}
if (bad) { process.stdout.write(bad + ' forbidden dash(es)\n'); process.exit(1) }
process.stdout.write('no forbidden dashes\n')
