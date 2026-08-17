#!/usr/bin/env node
// The repo's social preview: the picture LinkedIn, Slack and X draw when
// someone shares the GitHub link.
//
// Left to itself GitHub renders that image from the repo name, the owner
// avatar and the description, which reads as a screenshot of a settings page.
// This replaces it with something on brand, drawn from the same palette as the
// scorecard so the two are recognisably the same project.
//
// It is deliberately generic. The scorecard carries one person's numbers and
// changes every run; this is the project, and it has to stay true for as long
// as it sits on the repo.
//
// This is a build time asset, not part of the skill. It is here so the image
// can be redrawn when the branding moves, rather than living as a mystery PNG.
//
//   node tools/og-image.mjs [out.svg]
//
// GitHub wants 1280x640, under 1 MB. The upload is a web form: Settings,
// General, Social preview. There is no REST endpoint and no gh flag for it.

import { writeFileSync } from 'node:fs'

import { INK as IN, MONO, REPO } from '../skills/token-coupons/src/render-card.mjs'

export const OG_WIDTH = 1280
export const OG_HEIGHT = 640

const P = 84
const w = (text, size) => String(text).length * size * 0.6
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function text (value, x, y, { size = 24, fill = IN.text, weight = 400, spacing = 0, anchor = 'start' } = {}) {
  const sp = spacing ? ` letter-spacing="${spacing}"` : ''
  const an = anchor !== 'start' ? ` text-anchor="${anchor}"` : ''
  return `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="${weight}" fill="${fill}"${an}${sp}>${esc(value)}</text>`
}

export function renderOgSvg () {
  const out = []
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" width="${OG_WIDTH}" height="${OG_HEIGHT}" role="img" aria-label="token-coupons: every skill you install rides along in every message you send.">`)
  out.push(`<defs>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${IN.line}" stroke-width="1" stroke-opacity="0.35"/>
  </pattern>
  <radialGradient id="wash" cx="22%" cy="12%" r="70%">
    <stop offset="0%" stop-color="${IN.emerald}" stop-opacity="0.15"/>
    <stop offset="100%" stop-color="${IN.emerald}" stop-opacity="0"/>
  </radialGradient>
  <filter id="soft" x="-80%" y="-80%" width="260%" height="260%">
    <feGaussianBlur stdDeviation="7" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>`)
  out.push(`<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${IN.ink}"/>`)
  out.push(`<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#grid)"/>`)
  out.push(`<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="url(#wash)"/>`)

  /* masthead, the same mark the scorecard opens with */
  out.push(`<circle cx="${P + 6}" cy="${P + 8}" r="6" fill="${IN.cyan}" filter="url(#soft)"/>`)
  out.push(text('token-coupons', P + 26, P + 16, { size: 26, weight: 700, spacing: 0.5 }))
  out.push(text('CLAUDE CODE', OG_WIDTH - P, P + 16, { size: 15, fill: IN.muted, spacing: 3.4, anchor: 'end' }))
  out.push(`<rect x="${P}" y="${P + 44}" width="${OG_WIDTH - P * 2}" height="1" fill="${IN.line}"/>`)

  /* the claim, in two lines, because one would run off the edge at this size */
  out.push(text('Every skill you install rides along', P, 296, { size: 50, weight: 700 }))
  out.push(text('in every message you send.', P, 362, { size: 50, weight: 700, fill: IN.emerald }))
  out.push(text('See what that costs. Cut what is never read.', P, 424, { size: 25, fill: IN.muted }))

  /* the one command, drawn as the pill the scorecard uses */
  const cmd = 'npx skills add steve-piece/token-coupons'
  const pw = Math.round(w(cmd, 22)) + 44
  out.push(`<rect x="${P}" y="490" width="${pw}" height="52" rx="12" fill="${IN.panelUp}" stroke="${IN.cyan}" stroke-opacity="0.5"/>`)
  out.push(text(cmd, P + 22, 523, { size: 22, fill: IN.cyan }))
  out.push(text('MIT, zero dependencies, reads local files only', OG_WIDTH - P, 523, { size: 17, fill: IN.muted, anchor: 'end' }))

  out.push('</svg>')
  return out.join('\n')
}

const outPath = process.argv[2] || 'og.svg'
writeFileSync(outPath, renderOgSvg() + '\n')
process.stdout.write('wrote ' + outPath + ' (' + OG_WIDTH + 'x' + OG_HEIGHT + ') for ' + REPO + '\n')
