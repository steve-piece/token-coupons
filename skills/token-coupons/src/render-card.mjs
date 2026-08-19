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
export const CARD_HEIGHT = 1080

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
  out.push(text('I SAVED', P, 182, { size: 17, fill: IN.muted, spacing: 4.2 }))

  const hero = savedMonth !== null ? money(savedMonth) : fmt(savedTokens)
  const heroSize = hero.length > 7 ? 150 : 178
  out.push(`<text x="${P - 6}" y="366" font-family="${MONO}" font-size="${heroSize}" font-weight="700" fill="${IN.emerald}" filter="url(#bigglow)">${esc(hero)}</text>`)
  out.push(text(savedMonth !== null ? '/ month' : 'tokens a message', P - 6 + w(hero, heroSize) + 20, 366, { size: 42, fill: IN.muted, weight: 500 }))

  const line = savedMonth !== null
    ? `${fmt(savedTokens)} tokens off every message you send, from ${fmt(touched)} skills.`
    : `${fmt(touched)} skills are no longer described in every message you send.`
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
    // Active is the mode where a skill waits to be named, so its description
    // leaves the listing. The decision list defines the two words the same way,
    // and the two documents are read side by side.
    { n: fmt(acts.active || 0), k: 'skills set to active', c: IN.emerald },
    { n: fmt(acts.delete || 0), k: 'unused skills removed', c: IN.rose },
    { n: fmt(acts.optimize || 0), k: 'descriptions optimized', c: IN.text },
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

  /* ------------------------------------------------------------ footer */
  out.push(rule(P, 902, CW))
  // The install line, not the slash command. A card is read by people who do
  // not have this yet, and `/token-coupons` means nothing to them. Verified to
  // resolve straight from GitHub, so it needs no registry entry to work.
  const cmd = 'npx skills add steve-piece/token-coupons'
  const pw = Math.round(w(cmd, 22)) + 44
  out.push(`<rect x="${P}" y="940" width="${pw}" height="50" rx="12" fill="${IN.panelUp}" stroke="${IN.cyan}" stroke-opacity="0.5"/>`)
  out.push(text(cmd, P + 22, 972, { size: 22, fill: IN.cyan }))
  if (savedMonth !== null) {
    // Wrapped to a set column so it stays on the left and never runs under the
    // GitHub link on the right. SVG text does not wrap on its own.
    wrap('Savings estimates based on your most used models API pricing.', 46)
      .forEach((l, i) => out.push(text(l, P, 1018 + i * 20, { size: 15, fill: IN.muted })))
  }
  // The mark, the label and the URL are one target. An SVG anchor carries no
  // styling of its own, so this changes nothing about how the footer looks, and
  // it is inert once the card is a PNG.
  const label = 'View on GitHub'
  // Dropped so its last line sits on the same baseline as the footnote opposite,
  // which is what makes the two halves of the footer read as one row.
  out.push(`<a href="${attr(repoUrl)}" target="_blank" rel="noreferrer noopener">`)
  out.push(githubMark(CARD_WIDTH - P - Math.round(w(label, 20)) - 34, 996, 22, IN.text))
  out.push(text(label, CARD_WIDTH - P, 1012, { size: 20, fill: IN.text, anchor: 'end' }))
  out.push(text(repoUrl.replace(/^https?:\/\//, ''), CARD_WIDTH - P, 1038, { size: 16, fill: IN.muted, anchor: 'end' }))
  out.push('</a>')

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
  <filter id="bigglow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="11" result="b"/>
    <feComponentTransfer in="b" result="dim"><feFuncA type="linear" slope="0.55"/></feComponentTransfer>
    <feMerge><feMergeNode in="dim"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="soft" x="-80%" y="-80%" width="260%" height="260%">
    <feGaussianBlur stdDeviation="7" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>`
}

/**
 * The GitHub mark, so the link at the bottom reads as a link rather than a
 * sentence. The path is the Simple Icons glyph (CC0), authored on its own 24
 * unit grid and scaled here, since an exported PNG cannot fetch an icon font.
 */
function githubMark (x, y, size, fill) {
  return `<g transform="translate(${x} ${y}) scale(${size / 24})" aria-hidden="true"><path fill="${fill}" d="${GITHUB_PATH}"/></g>`
}

const GITHUB_PATH = 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'

/** Stroke glyphs for the controls. Inline, because the page fetches nothing. */
const ICON_DOWNLOAD = '<svg class="ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5"></path><path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"></path></svg>'
/** Simple Icons, CC0, drawn rather than fetched like every other mark here. */
const ICON_LINKEDIN = '<svg class="ico" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="currentColor">' +
  '<path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z"></path></svg>'

/**
 * The LinkedIn composer, opened with the words already in it.
 *
 * Text only, and that is the whole of what the platform accepts from a link:
 * there is no way to attach the PNG from here, so the page says out loud that
 * the image has to be dropped in by hand. A button that quietly posted without
 * the picture would be worse than no button.
 */
export function linkedinHref (report) {
  const s = (report || {}).summary || {}
  const saved = s.savedOnYourModel || null
  const month = saved && typeof saved.dollarsPerMonth === 'number' ? saved.dollarsPerMonth : null
  const tokens = Number(s.savedTokensPerCallIfApplied) || 0
  const acts = s.recommendedActions || {}
  const touched = (acts.active || 0) + (acts.delete || 0) + (acts.optimize || 0)

  const lines = [
    `I cut ${fmt(tokens)} tokens off every message I send in Claude Code.`,
    '',
    `Every skill you install puts its description in the system prompt, and that goes out again on every single API call. ${fmt(touched)} of mine were described in every message without ever being read.` +
      (month !== null ? ` That is ${money(month)} a month at API prices.` : ''),
    '',
    `Measured with token-coupons: ${REPO}`,
  ]
  return 'https://www.linkedin.com/feed/?shareActive=true&text=' + encodeURIComponent(lines.join('\n'))
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

function attr (v) { return esc(v) }

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
    '<title>Saved With Token Coupons</title>',
    '<style>' + pageStyles() + '</style>',
    '</head>',
    '<body>',
    '<main class="stage">',
    '<div class="card" id="card">' + svg + '</div>',
    '<div class="bar">',
    '<button type="button" id="png" class="go">' + ICON_DOWNLOAD + 'Save image</button>',
    '<a class="btn alt" id="li" href="' + attr(linkedinHref(report)) + '" target="_blank" rel="noreferrer noopener">' +
      ICON_LINKEDIN + 'Draft a LinkedIn post</a>',
    '</div>',
    '<p class="msg" id="msg" role="status" aria-live="polite"></p>',
    '<p class="fine">Save the image first: LinkedIn takes the words from a link but not the picture, so the draft opens written and you attach the card yourself. ' +
      'Measured on ' + esc(day) + ' from the skills and session transcripts already on this machine. Nothing left the machine to make it.</p>',
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
/* One rule for both controls: the second is a link rather than a button,
   because opening the composer is navigation and an anchor survives a sandbox
   that blocks scripted navigation. It should not look like anything else. */
button, a.btn {
  font: inherit; font-size: 15px; cursor: pointer; border-radius: 12px; padding: 12px 20px; min-height: 46px;
  display: inline-flex; align-items: center; gap: 9px; text-decoration: none;
  border: 1px solid ${IN.line}; background: ${IN.panelUp}; color: ${IN.text};
  transition: border-color 150ms ease, background-color 150ms ease, color 150ms ease;
}
.go { background: ${IN.cyan}; border-color: ${IN.cyan}; color: #04202B; font-weight: 700; }
.go:hover { filter: brightness(1.08); }
.ico { flex: 0 0 auto; }
.alt:hover { border-color: ${IN.cyan}; color: ${IN.cyan}; }
button:disabled { opacity: .55; cursor: default; }

button:focus-visible, a.btn:focus-visible { outline: 2px solid ${IN.cyan}; outline-offset: 3px; }
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
  var liBtn = document.getElementById('li');
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

  /* the composer carries the words only, so say what is still to do */
  liBtn && liBtn.addEventListener('click', function () {
    say('Composer opening. Attach the image you saved, then post.');
  });
})();
`
}
