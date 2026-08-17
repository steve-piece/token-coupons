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

export const CARD_WIDTH = 1200
export const CARD_HEIGHT = 1210

/** Printed bottom right, so a card that travels can be traced back. */
export const REPO = 'https://github.com/steve-piece/token-coupons'

export const INK = {
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

const IN = INK

export const MONO = "'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"

/** Monospace advance width, near enough for pill and bar geometry. */
const w = (text, size) => String(text).length * size * 0.6

/**
 * @param report a Report from report.mjs
 * @returns {string} the card as one <svg> element
 */
export function renderCardSvg (report, { repoUrl = REPO } = {}) {
  const r = report || {}
  const s = r.summary || {}
  const cost = r.cost || {}
  const vol = cost.volume || {}

  const saved = s.savedOnYourModel || null
  const savedMonth = saved && typeof saved.dollarsPerMonth === 'number' ? saved.dollarsPerMonth : null
  const savedTokens = Number(s.savedTokensPerCallIfApplied) || 0
  const listing = Number(s.listingTokensPerCall) || 0
  const after = Math.max(0, listing - savedTokens)
  const acts = s.recommendedActions || {}
  const touched = (acts.active || 0) + (acts.delete || 0) + (acts.optimize || 0)

  const P = 76                       // page padding
  const CW = CARD_WIDTH - P * 2      // content width
  const out = []

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" role="img" aria-label="${esc(cardAlt(savedMonth, savedTokens, touched, listing, after))}">`)
  out.push(defs(IN.emerald))
  out.push(`<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${IN.ink}"/>`)
  out.push(`<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#grid)"/>`)
  out.push(`<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#wash)"/>`)
  out.push(`<rect x="0.5" y="0.5" width="${CARD_WIDTH - 1}" height="${CARD_HEIGHT - 1}" rx="0" fill="none" stroke="${IN.line}"/>`)

  /* ---------------------------------------------------------- masthead */
  out.push(`<circle cx="${P + 6}" cy="82" r="6" fill="${IN.cyan}" filter="url(#soft)"/>`)
  out.push(text('token-coupons', P + 26, 90, { size: 25, weight: 700, fill: IN.text, spacing: 0.5 }))
  out.push(text(r.generatedOn || '', CARD_WIDTH - P, 90, { size: 19, fill: IN.muted, anchor: 'end' }))
  out.push(rule(P, 126, CW))

  /* --------------------------------------------------------------- won */
  out.push(text('SAVED, AT API PRICES', P, 182, { size: 17, fill: IN.muted, spacing: 4.2 }))

  const hero = savedMonth !== null ? money(savedMonth) : fmt(savedTokens)
  const heroSize = hero.length > 7 ? 150 : 178
  out.push(`<text x="${P - 6}" y="366" font-family="${MONO}" font-size="${heroSize}" font-weight="700" fill="${IN.emerald}" filter="url(#bigglow)">${esc(hero)}</text>`)
  out.push(text(savedMonth !== null ? 'a month' : 'tokens a message', P - 6 + w(hero, heroSize) + 20, 366, { size: 42, fill: IN.muted, weight: 500 }))

  const line = savedMonth !== null
    ? `${fmt(savedTokens)} tokens off every message you send, from ${fmt(touched)} skills.`
    : `${fmt(touched)} skills stopped riding along in every message you send.`
  out.push(text(line, P, 428, { size: 27, fill: IN.text }))

  /* ------------------------------------------------------- before after */
  const barY = 522
  out.push(text('EVERY MESSAGE, BEFORE AND AFTER', P, barY, { size: 16, fill: IN.muted, spacing: 3.6 }))
  const bh = 34
  const gapY = 20
  const beforeW = CW
  const afterW = listing > 0 ? Math.max(24, Math.round(CW * (after / listing))) : 0
  out.push(`<rect x="${P}" y="${barY + 26}" width="${beforeW}" height="${bh}" rx="9" fill="${IN.rose}" opacity="0.34"/>`)
  out.push(text(`${fmt(listing)} tokens`, P + 18, barY + 26 + 23, { size: 19, fill: IN.text }))
  out.push(text('before', CARD_WIDTH - P - 18, barY + 26 + 23, { size: 18, fill: IN.muted, anchor: 'end' }))
  const aY = barY + 26 + bh + gapY
  out.push(`<rect x="${P}" y="${aY}" width="${afterW}" height="${bh}" rx="9" fill="${IN.emerald}" opacity="0.9" filter="url(#soft)"/>`)
  out.push(text(`${fmt(after)} tokens`, P + 18, aY + 23, { size: 19, fill: '#052A1D', weight: 700 }))
  out.push(text('after', CARD_WIDTH - P - 18, aY + 23, { size: 18, fill: IN.muted, anchor: 'end' }))

  /* -------------------------------------------------------- what moved */
  const tiles = [
    { n: fmt(acts.active || 0), k: 'set to name only', c: IN.emerald },
    { n: fmt(acts.delete || 0), k: 'removed', c: IN.emerald },
    { n: fmt(acts.optimize || 0), k: 'descriptions cut', c: IN.emerald },
  ]
  const tileY = 720
  const gap = 22
  const tw = Math.round((CW - gap * 2) / 3)
  tiles.forEach((t, i) => {
    const x = P + i * (tw + gap)
    out.push(`<rect x="${x}" y="${tileY}" width="${tw}" height="132" rx="18" fill="${IN.panel}" stroke="${IN.line}"/>`)
    out.push(`<text x="${x + 26}" y="${tileY + 76}" font-family="${MONO}" font-size="58" font-weight="700" fill="${t.c}">${t.n}</text>`)
    out.push(text(t.k, x + 26, tileY + 108, { size: 19, fill: IN.muted }))
  })

  /* ------------------------------------------------------------- share */
  const sY = 894
  out.push(`<rect x="${P}" y="${sY}" width="${CW}" height="118" rx="18" fill="${IN.panel}" stroke="${IN.line}"/>`)
  out.push(`<rect x="${P}" y="${sY}" width="5" height="118" rx="2.5" fill="${IN.emerald}" filter="url(#soft)"/>`)
  // The hero already says what came back, so this line earns its place only by
  // saying what the bill was and what is left, which nothing else on the card does.
  const wastedMonth = (s.wastedPerWeekOnYourModel && typeof s.wastedPerWeekOnYourModel.dollarsPerMonth === 'number')
    ? s.wastedPerWeekOnYourModel.dollarsPerMonth : null
  out.push(text('WHAT THE UNUSED SKILLS WERE COSTING', P + 34, sY + 40, { size: 15, fill: IN.muted, spacing: 3 }))
  if (wastedMonth !== null && savedMonth !== null) {
    const left = Math.max(0, wastedMonth - savedMonth)
    const before = money(wastedMonth) + ' a month'
    out.push(text(before, P + 34, sY + 84, { size: 30, fill: IN.muted }))
    const arrowX = P + 34 + w(before, 30) + 22
    out.push(text('\u2192', arrowX, sY + 84, { size: 30, fill: IN.muted }))
    out.push(text(money(left), arrowX + 44, sY + 84, { size: 30, fill: IN.text, weight: 700 }))
    out.push(text('left, the name lines that stay whatever you do', CARD_WIDTH - P - 34, sY + 84, { size: 18, fill: IN.muted, anchor: 'end' }))
  } else if (vol.wastedTokensPerMonth) {
    out.push(text(`${bigNum(vol.wastedTokensPerMonth)} tokens a month`, P + 34, sY + 84, { size: 30, fill: IN.text }))
  }

  /* ------------------------------------------------------------ footer */
  out.push(rule(P, 1058, CW))
  const cmd = 'npx token-coupons'
  const pw = Math.round(w(cmd, 22)) + 44
  out.push(`<rect x="${P}" y="1096" width="${pw}" height="50" rx="12" fill="${IN.panelUp}" stroke="${IN.cyan}" stroke-opacity="0.5"/>`)
  out.push(text(cmd, P + 22, 1128, { size: 22, fill: IN.cyan }))
  out.push(text('View on GitHub', CARD_WIDTH - P, 1112, { size: 20, fill: IN.text, anchor: 'end' }))
  out.push(text(esc(repoUrl.replace(/^https?:\/\//, '')), CARD_WIDTH - P, 1138, { size: 16, fill: IN.muted, anchor: 'end' }))

  out.push('</svg>')
  return out.join('\n')
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
  <filter id="whiteglow" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="18" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
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

function cardAlt (savedMonth, savedTokens, touched, listing, after) {
  const bits = []
  if (savedMonth !== null) bits.push(`Saved ${money(savedMonth)} a month at API prices.`)
  bits.push(`${fmt(savedTokens)} tokens off every message, from ${fmt(touched)} skills.`)
  bits.push(`The skill list went from ${fmt(listing)} tokens a message to ${fmt(after)}.`)
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
export function renderCardPage (report, { listHref = null, listCount = 0 } = {}) {
  const svg = renderCardSvg(report)
  const day = (report && report.generatedOn) || 'today'
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Saved With Token Coupons</title>',
    '<style>' + pageStyles() + '</style>',
    '</head>',
    '<body>',
    '<main class="stage">',
    '<div class="card" id="card">' + svg + '</div>',
    '<div class="bar">',
    listHref
      ? '<a class="go" href="' + esc(listHref) + '"><span class="arrow" aria-hidden="true">\u2192</span>See suggestions' +
        (listCount ? ' (' + listCount + ')' : '') + '</a>'
      : '',
    '<button type="button" id="png" class="alt">Save image</button>',
    '<button type="button" id="copy" class="alt">Copy image</button>',
    '</div>',
    '<p class="msg" id="msg" role="status" aria-live="polite"></p>',
    '<p class="fine">Measured on ' + esc(day) + ' from the skills and session transcripts already on this machine. ' +
      'Nothing left the machine to make it.</p>',
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
  min-height: 100vh; padding: 24px 20px;
  display: flex; align-items: center; justify-content: center;
}
/* The card is portrait because that is what posts well, but it should still be
   readable whole on a desktop, so it scales to whatever height is left after
   the controls rather than forcing a scroll. The exported PNG is unaffected:
   it is always drawn at the authored size. */
.stage { display: flex; flex-direction: column; align-items: center; gap: 16px; max-width: 1200px; width: 100%; }
.card { line-height: 0; border-radius: 20px; overflow: hidden; box-shadow: 0 24px 80px rgba(0,0,0,.6), 0 0 0 1px ${IN.line}; max-width: 100%; }
.card svg { display: block; width: auto; height: auto; max-width: 100%; max-height: calc(100vh - 214px); }
.bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: center; }
.arrow { margin-right: 9px; font-size: 1.05em; line-height: 1; }
button {
  font: inherit; font-size: 15px; cursor: pointer; border-radius: 12px; padding: 12px 20px; min-height: 46px;
  border: 1px solid ${IN.line}; background: ${IN.panelUp}; color: ${IN.text};
  transition: border-color 150ms ease, background-color 150ms ease, color 150ms ease;
}
a.go, button.go { background: ${IN.cyan}; border-color: ${IN.cyan}; color: #04202B; font-weight: 700; }
a.go:hover, button.go:hover { filter: brightness(1.08); }
a.go { text-decoration: none; display: inline-flex; align-items: center; }
button.alt:hover { border-color: ${IN.cyan}; color: ${IN.cyan}; }
button:disabled { opacity: .55; cursor: default; }

button:focus-visible { outline: 2px solid ${IN.cyan}; outline-offset: 3px; }
.msg { color: ${IN.muted}; font-size: 13.5px; margin: 0; min-height: 20px; text-align: center; }
.fine { color: ${IN.muted}; font-size: 12.5px; margin: 0; max-width: 78ch; text-align: center; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
@media (max-width: 620px) { body { padding: 16px 12px 32px; align-items: flex-start; } .card svg { max-height: none; } }
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
