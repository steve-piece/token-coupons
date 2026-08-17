// The share card. One dark scorecard a person can post in Slack or on a
// timeline, plus the button that turns it into a PNG.
//
// It is authored as a single inline SVG rather than HTML, for one reason: an
// SVG can be serialized, drawn onto a canvas, and saved as a PNG with no
// library and no network. Everything here therefore avoids the things that
// break that path: no external fonts, no <foreignObject>, no remote images.
//
// The card commits to one dark look on purpose. It is meant to land in other
// people's apps, where it cannot know the surrounding theme, so it carries its
// own ground rather than borrowing one.

import { fmt, money } from './lib/util.mjs'
import { scoreReport } from './score.mjs'

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 1540

const IN = {
  ink: '#070A12',
  panel: '#0E1422',
  panelUp: '#131B2C',
  line: '#1E2739',
  text: '#E8EEF9',
  muted: '#7E8CA6',
  cyan: '#4DD8FF',
  rose: '#FF6B8A',
  emerald: '#35E3A1',
  amber: '#FFC069',
}

const GRADE_COLOR = { A: IN.emerald, B: IN.emerald, C: IN.amber, D: IN.rose, F: IN.rose }

const MONO = "'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"

/** Monospace advance width, near enough for pill and bar geometry. */
const w = (text, size) => String(text).length * size * 0.6

/**
 * @param report a Report from report.mjs
 * @returns {string} the card as one <svg> element
 */
export function renderCardSvg (report) {
  const r = report || {}
  const s = r.summary || {}
  const eco = r.economics || {}
  const cost = r.cost || {}
  const vol = cost.volume || {}
  const scored = scoreReport(r)

  const listing = scored.tokens.listing
  const wasted = scored.tokens.wasted
  const earning = scored.tokens.earning
  const wastedShare = listing > 0 ? wasted / listing : 0
  const gradeColor = GRADE_COLOR[scored.grade] || IN.rose

  const yours = s.wastedPerWeekOnYourModel
  const perMonth = yours && typeof yours.dollarsPerMonth === 'number' ? yours.dollarsPerMonth : null
  const perWeek = yours && typeof yours.dollars === 'number' ? yours.dollars : null
  const modelName = (yours && yours.model) || null

  const P = 76                       // page padding
  const CW = CARD_WIDTH - P * 2      // content width
  const out = []

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" role="img" aria-label="${esc(cardAlt(s, scored, perMonth, modelName))}">`)
  out.push(defs(gradeColor))
  out.push(`<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${IN.ink}"/>`)
  out.push(`<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#grid)"/>`)
  out.push(`<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#wash)"/>`)
  out.push(`<rect x="0.5" y="0.5" width="${CARD_WIDTH - 1}" height="${CARD_HEIGHT - 1}" rx="0" fill="none" stroke="${IN.line}"/>`)

  /* ---------------------------------------------------------- masthead */
  out.push(`<circle cx="${P + 6}" cy="82" r="6" fill="${IN.cyan}" filter="url(#soft)"/>`)
  out.push(text('token-coupons', P + 26, 90, { size: 25, weight: 700, fill: IN.text, spacing: 0.5 }))
  out.push(text(r.generatedOn || '', CARD_WIDTH - P, 90, { size: 19, fill: IN.muted, anchor: 'end' }))
  out.push(rule(P, 126, CW))

  /* ------------------------------------------------------------- score */
  out.push(text('SKILL LISTING SCORE', P, 236, { size: 17, fill: IN.muted, spacing: 4.2 }))

  out.push(`<text x="${P - 8}" y="396" font-family="${MONO}" font-size="196" font-weight="700" fill="${gradeColor}" filter="url(#bigglow)">${scored.score}</text>`)
  const scoreW = w(String(scored.score), 196)
  out.push(text('/100', P - 8 + scoreW + 18, 396, { size: 46, fill: IN.muted, weight: 500 }))

  // grade chip, right aligned on the same optical line
  const chipW = 128
  const chipX = CARD_WIDTH - P - chipW
  out.push(`<rect x="${chipX}" y="268" width="${chipW}" height="128" rx="26" fill="${IN.panelUp}" stroke="${gradeColor}" stroke-width="1.5" filter="url(#soft)"/>`)
  out.push(`<text x="${chipX + chipW / 2}" y="370" text-anchor="middle" font-family="${MONO}" font-size="86" font-weight="700" fill="${gradeColor}">${scored.grade}</text>`)

  headline(s, eco, scored).forEach((line, i) => {
    out.push(text(line, P, 458 + i * 38, { size: 27, fill: IN.text }))
  })

  /* --------------------------------------------------------- split bar */
  const barY = 562
  out.push(text(`WHERE ${fmt(listing)} TOKENS GO, EVERY MESSAGE`, P, barY, { size: 16, fill: IN.muted, spacing: 3.6 }))
  const bh = 36
  const bt = barY + 26
  const wastedW = Math.round(CW * wastedShare)
  out.push(`<rect x="${P}" y="${bt}" width="${CW}" height="${bh}" rx="10" fill="${IN.panel}" stroke="${IN.line}"/>`)
  if (wastedW > 12) {
    out.push(`<path d="${leftRounded(P, bt, wastedW, bh, 10)}" fill="${IN.rose}" opacity="0.92" filter="url(#soft)"/>`)
  }
  if (CW - wastedW > 12) {
    out.push(`<path d="${rightRounded(P + wastedW, bt, CW - wastedW, bh, 10)}" fill="${IN.emerald}" opacity="0.55"/>`)
  }
  const legendY = bt + bh + 40
  out.push(dot(P + 5, legendY - 6, IN.rose))
  out.push(text(`${fmt(wasted)} buy nothing`, P + 22, legendY, { size: 21, fill: IN.text }))
  out.push(text(`${Math.round(wastedShare * 100)}% of every message`, P + 22, legendY + 28, { size: 18, fill: IN.muted }))
  const rightCol = P + Math.round(CW / 2) + 40
  out.push(dot(rightCol + 5, legendY - 6, IN.emerald))
  out.push(text(`${fmt(earning)} earn it`, rightCol + 22, legendY, { size: 21, fill: IN.text }))
  out.push(text('read by the agent at least once', rightCol + 22, legendY + 28, { size: 18, fill: IN.muted }))

  /* -------------------------------------------------------- stat tiles */
  const tiles = [
    { n: fmt(s.skills || 0), k: 'in the listing', sub: `${fmt(s.notListed || 0)} more on disk, not listed`, c: IN.text },
    { n: fmt(s.neverCalledPassive || 0), k: 'never once used', sub: 'described on every message', c: IN.amber },
    { n: fmt(s.unroutable || 0), k: 'out of reach', sub: 'dropped, with no error', c: IN.rose },
  ]
  const tileY = 740
  const gap = 22
  const tw = Math.round((CW - gap * 2) / 3)
  tiles.forEach((t, i) => {
    const x = P + i * (tw + gap)
    out.push(`<rect x="${x}" y="${tileY}" width="${tw}" height="164" rx="18" fill="${IN.panel}" stroke="${IN.line}"/>`)
    out.push(`<text x="${x + 26}" y="${tileY + 78}" font-family="${MONO}" font-size="60" font-weight="700" fill="${t.c}">${t.n}</text>`)
    out.push(text(t.k, x + 26, tileY + 112, { size: 20, fill: IN.text }))
    for (const [j, line] of wrap(t.sub, 29).entries()) {
      out.push(text(line, x + 26, tileY + 138 + j * 22, { size: 16, fill: IN.muted }))
    }
  })

  /* ------------------------------------------------------------- money */
  const mY = 946
  out.push(`<rect x="${P}" y="${mY}" width="${CW}" height="170" rx="18" fill="${IN.panel}" stroke="${IN.line}"/>`)
  out.push(`<rect x="${P}" y="${mY}" width="5" height="170" rx="2.5" fill="${IN.rose}" filter="url(#soft)"/>`)
  out.push(text('THE BILL FOR SKILLS NOBODY USED', P + 34, mY + 44, { size: 16, fill: IN.muted, spacing: 3.4 }))
  if (perMonth !== null) {
    out.push(`<text x="${P + 34}" y="${mY + 116}" font-family="${MONO}" font-size="66" font-weight="700" fill="${IN.rose}" filter="url(#soft)">${esc(money(perMonth))}</text>`)
    out.push(text('a month', P + 34 + w(money(perMonth), 66) + 18, mY + 116, { size: 26, fill: IN.muted }))
    const detail = perWeek !== null ? `${money(perWeek)} a week${modelName ? ' on ' + modelName : ''}, at cached prices` : 'at cached prices'
    out.push(text(detail, P + 34, mY + 148, { size: 19, fill: IN.muted }))
  } else {
    out.push(`<text x="${P + 34}" y="${mY + 112}" font-family="${MONO}" font-size="46" font-weight="700" fill="${IN.rose}">${fmt(vol.wastedTokensPerMonth || 0)}</text>`)
    out.push(text('wasted tokens a month', P + 34, mY + 148, { size: 19, fill: IN.muted }))
  }
  if (vol.wastedTokensPerWeek) {
    out.push(text(`${bigNum(vol.wastedTokensPerWeek)} tokens a week`, CARD_WIDTH - P - 34, mY + 116, { size: 26, fill: IN.muted, anchor: 'end' }))
  }

  /* ------------------------------------------------------------ saving */
  const gY = 1146
  const saved = Number(s.savedTokensPerCallIfApplied) || 0
  out.push(`<rect x="${P}" y="${gY}" width="${CW}" height="170" rx="18" fill="${IN.panel}" stroke="${IN.line}"/>`)
  out.push(`<rect x="${P}" y="${gY}" width="5" height="170" rx="2.5" fill="${IN.emerald}" filter="url(#soft)"/>`)
  out.push(text('WHAT ONE PASS GIVES BACK', P + 34, gY + 44, { size: 16, fill: IN.muted, spacing: 3.4 }))
  out.push(`<text x="${P + 34}" y="${gY + 116}" font-family="${MONO}" font-size="66" font-weight="700" fill="${IN.emerald}" filter="url(#soft)">${fmt(saved)}</text>`)
  out.push(text('tokens a message', P + 34 + w(fmt(saved), 66) + 18, gY + 116, { size: 26, fill: IN.muted }))
  const acts = s.recommendedActions || {}
  out.push(text(`gate ${fmt(acts.active || 0)}  ·  delete ${fmt(acts.delete || 0)}  ·  shorten ${fmt(acts.optimize || 0)}  ·  keep ${fmt(acts.keep || 0)}`, P + 34, gY + 148, { size: 19, fill: IN.muted }))
  if (s.fitsAfter) {
    out.push(text('back inside the allowance', CARD_WIDTH - P - 34, gY + 116, { size: 22, fill: IN.emerald, anchor: 'end' }))
  }

  /* ------------------------------------------------------------ footer */
  out.push(rule(P, 1392, CW))
  const cmd = 'npx token-coupons'
  const pw = Math.round(w(cmd, 22)) + 44
  out.push(`<rect x="${P}" y="1430" width="${pw}" height="50" rx="12" fill="${IN.panelUp}" stroke="${IN.cyan}" stroke-opacity="0.5"/>`)
  out.push(text(cmd, P + 22, 1462, { size: 22, fill: IN.cyan }))
  out.push(text('measure your own', CARD_WIDTH - P, 1462, { size: 19, fill: IN.muted, anchor: 'end' }))

  out.push('</svg>')
  return out.join('\n')
}

/**
 * The line under the score. Not an adjective for the grade: the two facts a
 * person would want, which skills are buying nothing and what they cost, taken
 * straight from the counts. Two lines at 27px, each inside the 64 character
 * column.
 */
export function headline (summary, economics, scored) {
  const never = Number((economics.neverCalledPassive || {}).count) || 0
  const summoned = Number((economics.summonedOnlyPassive || {}).count) || 0
  const wasted = scored.tokens.wasted

  if (wasted <= 0 || (never === 0 && summoned === 0)) {
    return ['Every description in your listing has been read at least once.']
  }
  const first = []
  if (never > 0) first.push(`${fmt(never)} skill${never === 1 ? ' has' : 's have'} never been used.`)
  if (summoned > 0) first.push(`${fmt(summoned)} more you only type yourself.`)
  return [
    first.join(' '),
    `Their descriptions cost ${fmt(wasted)} tokens in every message you send.`,
  ]
}

/* ------------------------------------------------------------- pieces */

function defs (gradeColor) {
  return `<defs>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${IN.line}" stroke-width="1" stroke-opacity="0.35"/>
  </pattern>
  <radialGradient id="wash" cx="26%" cy="16%" r="62%">
    <stop offset="0%" stop-color="${gradeColor}" stop-opacity="0.16"/>
    <stop offset="100%" stop-color="${gradeColor}" stop-opacity="0"/>
  </radialGradient>
  <filter id="bigglow" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="22" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="soft" x="-80%" y="-80%" width="260%" height="260%">
    <feGaussianBlur stdDeviation="7" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>`
}

function text (value, x, y, { size = 20, fill = IN.text, weight = 400, anchor = 'start', spacing = 0 } = {}) {
  const sp = spacing ? ` letter-spacing="${spacing}"` : ''
  const an = anchor !== 'start' ? ` text-anchor="${anchor}"` : ''
  return `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="${weight}" fill="${fill}"${an}${sp}>${esc(value)}</text>`
}

function rule (x, y, width) {
  return `<rect x="${x}" y="${y}" width="${width}" height="1" fill="${IN.line}"/>`
}

function dot (cx, cy, fill) {
  return `<circle cx="${cx}" cy="${cy}" r="5" fill="${fill}"/>`
}

/** A rounded-on-the-left slab, so the two halves of the bar meet flat. */
function leftRounded (x, y, width, height, r) {
  const rr = Math.min(r, width)
  return `M ${x + rr} ${y} H ${x + width} V ${y + height} H ${x + rr} A ${rr} ${rr} 0 0 1 ${x} ${y + height - rr} V ${y + rr} A ${rr} ${rr} 0 0 1 ${x + rr} ${y} Z`
}

function rightRounded (x, y, width, height, r) {
  const rr = Math.min(r, width)
  return `M ${x} ${y} H ${x + width - rr} A ${rr} ${rr} 0 0 1 ${x + width} ${y + rr} V ${y + height - rr} A ${rr} ${rr} 0 0 1 ${x + width - rr} ${y + height} H ${x} Z`
}

/** Break on words at a character budget, since SVG text does not wrap. */
export function wrap (value, chars) {
  const words = String(value || '').split(/\s+/).filter(Boolean)
  const lines = []
  let cur = ''
  for (const word of words) {
    if (!cur) { cur = word; continue }
    if ((cur + ' ' + word).length > chars) { lines.push(cur); cur = word } else cur += ' ' + word
  }
  if (cur) lines.push(cur)
  return lines
}

/** 15,732,252 -> 15.7M */
export function bigNum (n) {
  const v = Number(n) || 0
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e4) return Math.round(v / 1e3) + 'K'
  return fmt(v)
}

function cardAlt (s, scored, perMonth, modelName) {
  const bits = [
    `Skill listing score ${scored.score} out of 100, grade ${scored.grade}.`,
    `${fmt(scored.tokens.wasted)} of ${fmt(scored.tokens.listing)} tokens in every message buy no routing decision.`,
    `${fmt(s.neverCalledPassive || 0)} skills never used, ${fmt(s.unroutable || 0)} out of reach.`,
  ]
  if (perMonth !== null) bits.push(`${money(perMonth)} a month${modelName ? ' on ' + modelName : ''}.`)
  return bits.join(' ')
}

function esc (v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export { esc }

/* --------------------------------------------------------------- page */

/**
 * The card wrapped in the smallest page that can hand it over as a PNG.
 *
 * Export path, deliberately dependency free: serialize the inline SVG, load it
 * as an image, draw it on a canvas at 2x, and read a PNG blob back. Saving then
 * goes one of two ways. Inside the claude.ai artifact viewer a page cannot
 * download on its own, so it asks the host through the `downloads` capability
 * and the viewer confirms. Opened from disk there is no host, so it falls back
 * to an anchor. Either way the same bytes.
 */
export function renderCardPage (report) {
  const svg = renderCardSvg(report)
  const day = (report && report.generatedOn) || 'today'
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Skill Listing Scorecard</title>',
    '<style>' + pageStyles() + '</style>',
    '</head>',
    '<body>',
    '<main class="stage">',
    '<div class="card" id="card">' + svg + '</div>',
    '<div class="bar">',
    '<button type="button" id="png" class="go">Save PNG</button>',
    '<button type="button" id="copy" class="alt">Copy image</button>',
    '<span class="msg" id="msg" role="status" aria-live="polite">' + CARD_WIDTH + ' by ' + CARD_HEIGHT + ', saved at 2x for a crisp post.</span>',
    '</div>',
    '<p class="fine">Measured from the skills and session transcripts already on this machine, on ' + esc(day) +
      '. Nothing left the machine to make it.</p>',
    '</main>',
    '<script>' + pageScript() + '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

function pageStyles () {
  return `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; background: ${IN.ink}; color: ${IN.text};
  font: 15px/1.55 ${MONO};
  display: flex; justify-content: center;
  padding: 32px 20px 64px;
}
.stage { width: 100%; max-width: 1200px; }
.card { line-height: 0; border-radius: 20px; overflow: hidden; box-shadow: 0 24px 80px rgba(0,0,0,.6), 0 0 0 1px ${IN.line}; }
.card svg { width: 100%; height: auto; display: block; }
.bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 22px; }
button {
  font: inherit; font-size: 15px; cursor: pointer; border-radius: 12px; padding: 12px 20px; min-height: 46px;
  border: 1px solid ${IN.line}; background: ${IN.panelUp}; color: ${IN.text};
  transition: border-color 150ms ease, background-color 150ms ease, color 150ms ease;
}
button.go { background: ${IN.cyan}; border-color: ${IN.cyan}; color: #04202B; font-weight: 700; }
button.go:hover { filter: brightness(1.08); }
button.alt:hover { border-color: ${IN.cyan}; color: ${IN.cyan}; }
button:disabled { opacity: .55; cursor: default; }
button:focus-visible { outline: 2px solid ${IN.cyan}; outline-offset: 3px; }
.msg { color: ${IN.muted}; font-size: 14px; }
.fine { color: ${IN.muted}; font-size: 13.5px; margin: 18px 0 0; max-width: 70ch; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
@media (max-width: 620px) { body { padding: 16px 12px 48px; } .bar { gap: 10px; } }
`
}

function pageScript () {
  return `
(function () {
  var msg = document.getElementById('msg');
  var pngBtn = document.getElementById('png');
  var copyBtn = document.getElementById('copy');
  var svg = document.querySelector('#card svg');
  function say (t) { if (msg) msg.textContent = t; }

  /* the SVG carries no external reference, so the canvas is never tainted */
  function toPng (scale) {
    return new Promise(function (resolve, reject) {
      var source = new XMLSerializer().serializeToString(svg);
      var url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = ${CARD_WIDTH} * scale;
        c.height = ${CARD_HEIGHT} * scale;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '${IN.ink}';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('the canvas produced no image')); }, 'image/png');
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('the card could not be rasterized here')); };
      img.src = url;
    });
  }

  function filename () { return 'skill-listing-scorecard.png'; }

  pngBtn && pngBtn.addEventListener('click', function () {
    pngBtn.disabled = true;
    say('Rendering at 2x...');
    toPng(2).then(function (blob) {
      /* inside the artifact viewer a page cannot download on its own; it asks
         the host, and the viewer confirms the save */
      if (typeof claude !== 'undefined' && claude && typeof claude.use === 'function') {
        return claude.use('downloads').then(function (d) {
          if (!d) return anchorSave(blob);
          return d.save({ filename: filename(), data: blob }).then(
            function () { say('Saved.'); },
            function (err) {
              var code = err && err.code;
              if (code === 'declined') say('Save cancelled. Nothing was written.');
              else if (code === 'rate_limited') say('A save prompt is already open. Try again in a moment.');
              else if (code === 'too_large') say('That image is too large to hand over here.');
              else say('This viewer will not save files. Right click the card and copy the image instead.');
            }
          );
        });
      }
      return anchorSave(blob);
    }).catch(function (e) {
      say((e && e.message) || 'The PNG could not be made here. Right click the card and copy the image instead.');
    }).then(function () { pngBtn.disabled = false; });
  });

  function anchorSave (blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename();
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    say('Saved to your downloads.');
  }

  copyBtn && copyBtn.addEventListener('click', function () {
    if (!navigator.clipboard || !window.ClipboardItem) {
      say('This browser cannot copy images. Use Save PNG instead.');
      return;
    }
    copyBtn.disabled = true;
    say('Rendering at 2x...');
    toPng(2).then(function (blob) {
      return navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]).then(
        function () { say('Copied. Paste it straight into Slack or a post.'); },
        function () { say('Copying is blocked here. Use Save PNG instead.'); }
      );
    }).catch(function () {
      say('The image could not be made here. Use Save PNG instead.');
    }).then(function () { copyBtn.disabled = false; });
  });
})();
`
}
