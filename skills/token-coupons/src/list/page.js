(function () {
  var LABELS = __LABELS__;
  var report = {};
  try { report = JSON.parse(document.getElementById('report-data').textContent); } catch (e) { report = {}; }
  var skills = report.skills || [];
  // The skills the wasted figure counts, from the same two lists the report
  // prices: context skills never picked, and ones you mostly start by typing.
  var econ = report.economics || {};
  var wasteNames = {};
  [].concat((econ.neverCalledContext || {}).names || [], (econ.summonedOnlyContext || {}).names || [])
    .forEach(function (n) { wasteNames[n] = true; });
  function isWaste (s) { return !!wasteNames[(s.names || [])[0] || s.name]; }
  var target = (report.thresholds || {}).optimizeTargetChars || 350;
  var root = document.documentElement;
  var tbody = document.getElementById('rows');
  var rows = [].slice.call(tbody.querySelectorAll('tr[data-i]'));
  var search = document.getElementById('search');
  var openDetail = {};
  var scope = 'all';
  var flag = null;
  var sortKey = null;
  var sortDir = 'desc';
  var saves = {};

  function $ (id) { return document.getElementById(id); }
  function on (el, ev, fn) { if (el) el.addEventListener(ev, fn); }
  function money (n) { var v = Math.abs(n); return (n < 0 ? '-$' : '$') + v.toFixed(v > 0 && v < 1 ? 3 : 2); }
  function say (t) { var n = $('t-note'); if (n) n.textContent = t; }

  on($('theme-toggle'), 'click', function () {
    var now = root.getAttribute('data-theme');
    if (now === 'dark') root.setAttribute('data-theme', 'light');
    else if (now === 'light') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', 'dark');
  });

  /* the two controls on a row */
  function picked (tr, kind) {
    var el = tr.querySelector('.seg[data-kind="' + kind + '"] input:checked');
    return el ? { value: el.value, rec: el.getAttribute('data-rec'), today: el.getAttribute('data-today') } : null;
  }
  function setPick (tr, kind, value) {
    var el = tr.querySelector('.seg[data-kind="' + kind + '"] input[value="' + value + '"]');
    if (el && !el.disabled) el.checked = true;
  }

  /* tokens a row gives back under the current choices. Where the choice is
     the tool's own suggestion, its own figure is used, so the total starts
     exactly on the report's number. */
  function tokensFor (tr) {
    var s = skills[Number(tr.getAttribute('data-i'))] || {};
    var rec = s.recommendation || {};
    var impact = Number(rec.impactTokensPerCall) || 0;
    var desc = Number(s.descriptionTokens) || 0;
    var listing = Number(s.listingTokens) || desc;
    var t = picked(tr, 'type'); var a = picked(tr, 'action');
    if (!t || !a) return 0;
    if (a.value === 'delete') return rec.action === 'delete' ? impact : (t.today === 'command' ? Math.max(0, listing - desc) : desc);
    if (t.value === 'command' && t.today === 'context') return rec.action === 'command' ? impact : desc;
    if (t.value === 'context' && t.today === 'command') return -desc;
    if (a.value === 'optimize') {
      if (rec.action === 'optimize') return impact;
      var chars = Number(s.descriptionChars) || 0;
      return chars > target ? Math.round(desc * (1 - target / chars)) : 0;
    }
    return 0;
  }
  function rateOf (s) { var l = Number(s.listingTokens) || 0; return l > 0 ? (Number(s.dollarsPerMonth) || 0) / l : 0; }

  function decisions () {
    var out = [];
    rows.forEach(function (tr) {
      var s = skills[Number(tr.getAttribute('data-i'))] || {};
      var name = (s.names || [])[0] || s.name;
      var path = s.path || s.realPath || '';
      var t = picked(tr, 'type'); var a = picked(tr, 'action');
      if (t && t.value !== t.today) out.push({ name: name, path: path, action: t.value, note: '' });
      if (a && a.value !== 'keep') out.push({ name: name, path: path, action: a.value, note: '' });
    });
    return { version: 1, generatedOn: report.generatedOn || null, source: 'token-coupons html report', decisions: out };
  }

  /* where every wasted dollar sits under the current choices */
  var wasteEl = $('waste');
  var wasteTotal = wasteEl ? Number(wasteEl.getAttribute('data-total')) || 0 : 0;
  function drawWaste () {
    if (!wasteEl || !wasteTotal) return 0;
    var b = { back: 0, nameline: 0, fresh: 0, elsewhere: 0, left: 0, extra: 0 };
    var n = { back: 0, fresh: 0, elsewhere: 0, left: 0, extra: 0 };
    rows.forEach(function (tr) {
      var i = Number(tr.getAttribute('data-i'));
      var s = skills[i] || {};
      var got = saves[i] || 0;
      if (!isWaste(s)) { if (got) { b.extra += got; n.extra++; } return; }
      var d = Number(s.dollarsPerMonth) || 0;
      var flags = (s.recommendation || {}).flags || [];
      if (got > 0) { b.back += got; b.nameline += Math.max(0, d - got); n.back++; return; }
      var k = flags.indexOf('too-new') >= 0 ? 'fresh' : flags.indexOf('picked-elsewhere') >= 0 ? 'elsewhere' : 'left';
      b[k] += d; n[k]++;
    });
    Object.keys(b).forEach(function (k) {
      [].slice.call(wasteEl.querySelectorAll('[data-wv="' + k + '"]')).forEach(function (el) { el.textContent = money(b[k]); });
      [].slice.call(wasteEl.querySelectorAll('[data-wn="' + k + '"]')).forEach(function (el) { el.textContent = n[k]; });
      var seg = wasteEl.querySelector('[data-w="' + k + '"]');
      if (seg) seg.style.width = (b[k] / wasteTotal * 100).toFixed(2) + '%';
    });
    var left = wasteEl.querySelector('[data-wk="left"]');
    if (left) left.hidden = b.left < 0.005;
    var extra = $('w-extra');
    if (extra) extra.hidden = Math.abs(b.extra) < 0.005;
    if ($('k-total')) $('k-total').textContent = money(b.back + b.extra);
    return b.back;
  }
  var goflags = [].slice.call(document.querySelectorAll('[data-goflag]'));
  function pressGo () { goflags.forEach(function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-goflag') === flag); }); }
  goflags.forEach(function (btn) {
    on(btn, 'click', function () {
      var f = btn.getAttribute('data-goflag');
      flag = flag === f ? null : f;
      chips.forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
      pressGo();
      apply();
      var list = $('list');
      if (flag && list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  function refresh () {
    var total = 0; var mine = 0;
    rows.forEach(function (tr) {
      var i = Number(tr.getAttribute('data-i'));
      var s = skills[i] || {};
      var t = picked(tr, 'type'); var a = picked(tr, 'action');
      var changed = (t && t.value !== t.rec) || (a && a.value !== a.rec);
      var hasSug = (t && t.rec !== t.today) || (a && a.rec !== 'keep');
      tr.setAttribute('data-changed', changed ? 'yes' : 'no');
      tr.setAttribute('data-state', changed ? 'yours' : hasSug ? 'suggested' : '');
      [].slice.call(tr.querySelectorAll('.sg span')).forEach(function (sp) { sp.classList.remove('mine'); });
      if (changed) {
        [t, a].forEach(function (p, k) {
          if (p && p.value !== p.rec) {
            var el = tr.querySelector('.seg[data-kind="' + (k ? 'action' : 'type') + '"] input:checked + span');
            if (el) el.classList.add('mine');
          }
        });
        mine++;
      }
      var dollars = tokensFor(tr) * rateOf(s);
      saves[i] = dollars;
      total += dollars;
      var cell = tr.querySelector('[data-save]');
      if (cell) {
        cell.textContent = dollars === 0 ? '0' : money(dollars);
        cell.className = dollars === 0 ? 'zero' : dollars < 0 ? 'danger' : '';
      }
    });
    var d = decisions();
    $('t-count').textContent = d.decisions.length;
    $('t-save').textContent = money(total);
    var back = drawWaste();
    if ($('k-save')) $('k-save').textContent = money(back);
    $('t-mine').textContent = mine;
    $('n-changed').textContent = mine;
    $('decisions-json').value = JSON.stringify(d, null, 2);
    if (scope === 'changed') apply();
    if (sortKey === 'save') sortRows();
  }
  tbody.addEventListener('change', function (e) { if (e.target && e.target.type === 'radio') refresh(); });

  /* filtering */
  var tabs = [].slice.call(document.querySelectorAll('[data-scope]'));
  var chips = [].slice.call(document.querySelectorAll('[data-flag]'));
  tabs.forEach(function (b) {
    on(b, 'click', function () {
      scope = b.getAttribute('data-scope');
      tabs.forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
      apply();
    });
  });
  chips.forEach(function (c) {
    on(c, 'click', function () {
      var f = c.getAttribute('data-flag');
      flag = flag === f ? null : f;
      chips.forEach(function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-flag') === flag); });
      pressGo();
      apply();
    });
  });
  on(search, 'input', apply);
  var index = skills.map(function (s) {
    return [(s.names || []).join(' '), s.plugin, s.location, s.description].filter(Boolean).join(' ').toLowerCase();
  });

  function visibleRows () { return rows.filter(function (tr) { return !tr.hidden; }); }
  function apply () {
    var q = search ? search.value.trim().toLowerCase() : '';
    var shown = 0;
    rows.forEach(function (tr) {
      var i = Number(tr.getAttribute('data-i'));
      var flags = ' ' + (tr.getAttribute('data-flags') || '') + ' ';
      var st = tr.getAttribute('data-state');
      var okScope = scope === 'all' || (scope === 'changed' ? tr.getAttribute('data-changed') === 'yes' : (st === 'suggested' || (st === 'yours' && hadSuggestion(tr))));
      var okFlag = !flag || flags.indexOf(' ' + flag + ' ') !== -1;
      var okQ = !q || (index[i] || '').indexOf(q) !== -1;
      var vis = okScope && okFlag && okQ;
      tr.hidden = !vis;
      if (openDetail[i]) openDetail[i].hidden = !vis;
      if (vis) shown++;
    });
    $('empty').hidden = shown > 0;
    var bulk = $('bulk');
    var filtered = scope !== 'all' || flag || q;
    if (bulk) {
      bulk.classList.toggle('on', !!filtered && shown > 0);
      $('bulk-n').textContent = shown;
    }
  }
  function hadSuggestion (tr) {
    var t = picked(tr, 'type'); var a = picked(tr, 'action');
    return (t && t.rec !== t.today) || (a && a.rec !== 'keep');
  }
  on($('clear'), 'click', clearFilters);
  function clearFilters () {
    scope = 'all'; flag = null; if (search) search.value = '';
    tabs.forEach(function (x) { var on1 = x.getAttribute('data-scope') === 'all'; x.classList.toggle('on', on1); x.setAttribute('aria-pressed', on1); });
    chips.forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
    pressGo();
    apply();
  }

  /* bulk actions on whatever is showing */
  [].slice.call(document.querySelectorAll('[data-bulk]')).forEach(function (b) {
    on(b, 'click', function () {
      var what = b.getAttribute('data-bulk');
      var vis = visibleRows();
      vis.forEach(function (tr) {
        var t = picked(tr, 'type'); var a = picked(tr, 'action');
        if (what === 'command') setPick(tr, 'type', 'command');
        if (what === 'keep') { setPick(tr, 'type', t.today); setPick(tr, 'action', 'keep'); }
        if (what === 'suggested') { setPick(tr, 'type', t.rec); setPick(tr, 'action', a.rec); }
      });
      refresh();
      say(vis.length + ' rows set to ' + (what === 'suggested' ? 'the suggestion' : what === 'keep' ? 'as they are today' : 'command') + '.');
    });
  });

  /* sorting */
  var sorters = [].slice.call(document.querySelectorAll('[data-sort]'));
  sorters.forEach(function (b) {
    on(b, 'click', function () {
      var k = b.getAttribute('data-sort');
      if (sortKey === k) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
      else { sortKey = k; sortDir = (k === 'name' || k === 'rank') ? 'asc' : 'desc'; }
      sorters.forEach(function (x) { if (x === b) x.setAttribute('data-dir', sortDir); else x.removeAttribute('data-dir'); });
      sortRows();
    });
  });
  function keyOf (tr) {
    if (sortKey === 'save') return saves[Number(tr.getAttribute('data-i'))] || 0;
    var v = tr.getAttribute('data-' + sortKey);
    return sortKey === 'name' ? v : Number(v);
  }
  function sortRows () {
    if (!sortKey) return;
    var dir = sortDir === 'asc' ? 1 : -1;
    rows.slice().sort(function (a, b) {
      var x = keyOf(a); var y = keyOf(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    }).forEach(function (tr) {
      tbody.appendChild(tr);
      var d = openDetail[Number(tr.getAttribute('data-i'))];
      if (d) tbody.appendChild(d);
    });
  }

  /* detail drawer */
  tbody.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('button[data-detail]');
    if (!btn) return;
    var i = Number(btn.getAttribute('data-detail'));
    var tr = btn.closest('tr');
    if (openDetail[i]) {
      openDetail[i].parentNode.removeChild(openDetail[i]);
      delete openDetail[i];
      btn.setAttribute('aria-expanded', 'false');
      return;
    }
    var s = skills[i] || {};
    var rec = s.recommendation || {};
    var d = document.createElement('tr'); d.className = 'detail';
    var td = document.createElement('td'); td.colSpan = 8;
    var dl = document.createElement('dl');
    function add (k, v, cls) {
      if (!v) return;
      var dt = document.createElement('dt'); dt.textContent = k;
      var dd = document.createElement('dd'); dd.textContent = v; if (cls) dd.className = cls;
      dl.appendChild(dt); dl.appendChild(dd);
    }
    add('Why', rec.reason, 'why');
    add('Description', s.description || '(none)', 'desc');
    add('Length', (s.descriptionChars || 0) + ' characters, about ' + (s.descriptionTokens || 0) + ' tokens a message');
    add('Path', s.path || s.realPath);
    add('Source copy', s.sourcePath);
    var by = s.callsByClient || {};
    var el = Object.keys(by).filter(function (k) { return k !== 'claude' && by[k] && by[k].calls > 0; });
    add('Used elsewhere', el.map(function (k) {
      return (LABELS[k] || k) + ' ' + by[k].calls + ' (' + (by[k].contextCalls || 0) + ' picked, ' + (by[k].commandCalls || 0) + ' typed' + (by[k].lastSeen ? ', last ' + by[k].lastSeen : '') + ')';
    }).join('; '));
    var listed = (s.listedIn || []).filter(function (k) { return k !== 'claude'; });
    var um = s.unmeasuredClients || [];
    add('Also listed by', listed.map(function (k) { return LABELS[k] || k; }).join(', ') + (um.length ? '. Not read this run: ' + um.map(function (k) { return LABELS[k] || k; }).join(', ') : ''));
    td.appendChild(dl); d.appendChild(td);
    tr.parentNode.insertBefore(d, tr.nextSibling);
    openDetail[i] = d;
    btn.setAttribute('aria-expanded', 'true');
  });

  /* tray */
  var dlg = $('json-dialog');
  on($('view'), 'click', function () { if (dlg && dlg.showModal) dlg.showModal(); });
  on($('close'), 'click', function () { dlg.close(); });
  on($('reset'), 'click', function () {
    rows.forEach(function (tr) {
      var t = picked(tr, 'type'); var a = picked(tr, 'action');
      setPick(tr, 'type', t.rec); setPick(tr, 'action', a.rec);
    });
    clearFilters(); refresh();
    say('Back to the suggestions.');
  });
  on($('copy'), 'click', function () {
    var text = $('decisions-json').value;
    var ok = function () { say('Copied. Paste it into your next message and add: proceed with these decisions.'); };
    var fallback = function () {
      var box = $('decisions-json');
      if (dlg && dlg.showModal && !dlg.open) dlg.showModal();
      box.focus(); box.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (e) { done = false; }
      if (done) ok(); else say('Copying is blocked here. The text is selected, so copy it with your keyboard.');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
    else fallback();
  });

  /* tooltips sit in fixed position, so a table that scrolls sideways or a
     row at the page edge cannot clip them */
  function placeTip (box) {
    var tip = box.querySelector('.tip'); var btn = box.querySelector('.info-btn');
    if (!tip || !btn) return;
    tip.classList.add('fixed');
    tip.style.display = 'block';
    var r = btn.getBoundingClientRect(); var w = tip.offsetWidth; var h = tip.offsetHeight;
    tip.style.display = '';
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    var top = r.top - h - 8;
    if (top < 8) top = r.bottom + 8;
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
  }
  function tipFrom (e) { var box = e.target.closest && e.target.closest('.info'); if (box) placeTip(box); }
  document.addEventListener('mouseover', tipFrom);
  document.addEventListener('focusin', tipFrom);

  refresh(); apply();
})();
