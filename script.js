(function () {
  'use strict';

  /* ================================================================
     Calculation logic (ported from the original Node.js program)
     ================================================================ */
  var M = 1000000; // mm² per m²

  // Passenger capacity bands: area range in m², and the area from which
  // the cabin depth is trimmed (in 10 mm steps) from the back side.
  var BANDS = [
    { p: 1,  min: 0.17, max: 0.34, from: 0.20 },
    { p: 2,  min: 0.34, max: 0.51, from: 0.40 },
    { p: 3,  min: 0.51, max: 0.68, from: 0.59 },
    { p: 4,  min: 0.68, max: 0.85, from: 0.77 },
    { p: 5,  min: 0.85, max: 1.00, from: 0.95 },
    { p: 6,  min: 1.00, max: 1.16, from: 1.12 },
    { p: 7,  min: 1.16, max: 1.31, from: 1.28 },
    { p: 8,  min: 1.31, max: 1.46, from: 1.45 },
    { p: 9,  min: 1.46, max: 1.61, from: 1.60 },
    { p: 10, min: 1.61, max: 1.77, from: 1.76 },
    { p: 11, min: 1.77, max: 1.92, from: 1.91 },
    { p: 12, min: 1.92, max: 2.06, from: 2.05 },
    { p: 13, min: 2.06, max: 2.23, from: 2.20 },
    { p: 14, min: 2.23, max: 2.35, from: 2.34 },
    { p: 15, min: 2.35, max: 2.47, from: null }
  ];
  var DOOR_SIZES = [900, 800, 700, 650, 600];

  function compute(i) {
    var tol;
    if (i.mr === 2 || (i.mr === 1 && i.counter === 2)) {
      tol = { left: 185 + 30, right: 365 + 30, back: 80 + 30, front: 140 + 60 };
    } else {
      tol = { left: 180 + 30, right: 180 + 30, back: 130 + 130 + 30, front: 140 + 60 };
    }
    var doorAllow = i.door === 1 ? 80 : 110;
    tol.frontBase = tol.front;
    tol.doorAllow = doorAllow;
    tol.front += doorAllow;

    var cabinW = i.shaftW - (tol.left + tol.right);
    var cabinD0 = i.shaftD - (tol.back + tol.front);

    var r = {
      tol: tol, cabinW: cabinW, cabinD0: cabinD0, cabinD: cabinD0,
      area0: cabinW * cabinD0, area1: cabinW * cabinD0,
      reduced: 0, persons: null, capacityError: null, invalid: false,
      doors: { label: '', sizes: [], message: '' }, hint: false
    };

    // Shaft too small to fit any cabin at all
    if (cabinW <= 0 || cabinD0 <= 0) { r.invalid = true; return r; }

    // Door sizes
    var factor = i.door === 1 ? 2 : 1.5;
    r.doors.label = i.door === 1 ? 'Center opening door sizes' : 'Telescopic door sizes';
    if (cabinW > 600) {
      DOOR_SIZES.forEach(function (s) {
        if (i.shaftW >= (s * factor + 200) && cabinW > s) r.doors.sizes.push(s);
      });
      if (!r.doors.sizes.length) {
        r.doors.message = i.door === 1
          ? 'Shaft width is too small for center opening door.'
          : 'Shaft width is too small for standard door sizes.';
      }
    } else {
      r.doors.message = 'No standard door size fits. The cabin width must be more than 600 mm.';
    }

    // Passenger capacity
    var area = cabinW * cabinD0;
    if (area < 0.17 * M) {
      r.capacityError = 'small';
    } else if (area >= 2.47 * M) {
      r.capacityError = 'large';
    } else {
      var band = null;
      for (var b = 0; b < BANDS.length; b++) {
        if (area >= BANDS[b].min * M && area < BANDS[b].max * M) { band = BANDS[b]; break; }
      }
      if (band) {
        var d = cabinD0, j = 0;
        if (band.from !== null && area >= band.from * M && area < band.max * M) {
          while ((cabinW * d) >= band.from * M && (cabinW * d) < band.max * M) { d -= 10; j += 10; }
        }
        r.cabinD = d;
        r.reduced = j;
        r.area1 = cabinW * d;
        r.persons = band.p;
      }
    }

    // Layout suggestion (same condition as the original program)
    var counterType = i.mr === 1 ? i.counter : undefined;
    if (counterType !== 2 && i.door !== 1 && i.shaftW >= (600 * 2 + 200)) r.hint = true;

    return r;
  }

  /* ================================================================
     UI
     ================================================================ */
  var $ = function (s) { return document.querySelector(s); };
  var form = $('#form');
  var elW = $('#shaft-width'), elD = $('#shaft-depth');
  var lastSummary = '';

  function fmt(n) { return String(Number(n.toFixed(2))); }
  function sqm(n) { return (n / M).toFixed(2); }

  function readInputs() {
    var out = { ok: true };
    [[elW, '#w-err', 'shaftW'], [elD, '#d-err', 'shaftD']].forEach(function (f) {
      var raw = f[0].value.trim(), err = $(f[1]);
      var v = parseFloat(raw);
      if (raw === '') { out.ok = false; err.textContent = ''; f[0].removeAttribute('aria-invalid'); }
      else if (!isFinite(v) || v <= 0) { out.ok = false; err.textContent = 'Enter a number greater than 0.'; f[0].setAttribute('aria-invalid', 'true'); }
      else { err.textContent = ''; f[0].removeAttribute('aria-invalid'); out[f[2]] = v; }
    });
    out.mr = parseInt(form.elements.mr.value, 10);
    out.counter = parseInt(form.elements.counter.value, 10);
    out.door = parseInt(form.elements.door.value, 10);
    return out;
  }

  function planSVG(sw, sd, r) {
    var VW = 640, VH = 480, ml = 48, mr = 64, mt = 50, mb = 34;
    var pw = VW - ml - mr, ph = VH - mt - mb;
    var s = Math.min(pw / sw, ph / sd);
    var W = sw * s, H = sd * s;
    var x0 = ml + (pw - W) / 2, y0 = mt + (ph - H) / 2, x1 = x0 + W, y1 = y0 + H;
    var t = r.tol, g = '';

    g += '<defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="hatch-line" x1="0" y1="0" x2="0" y2="7"/></pattern></defs>';
    g += '<rect class="svg-shaft" x="' + x0 + '" y="' + y0 + '" width="' + W + '" height="' + H + '"/>';

    // Dimension lines
    var dy = y0 - 16;
    g += '<path class="svg-dimline" d="M' + x0 + ' ' + (dy - 5) + 'V' + (dy + 5) + 'M' + x1 + ' ' + (dy - 5) + 'V' + (dy + 5) + 'M' + x0 + ' ' + dy + 'H' + x1 + '"/>';
    g += '<text class="svg-txt" x="' + (x0 + x1) / 2 + '" y="' + (dy - 8) + '" text-anchor="middle">Shaft width ' + fmt(sw) + ' mm</text>';
    var dx = x1 + 16;
    g += '<path class="svg-dimline" d="M' + (dx - 5) + ' ' + y0 + 'H' + (dx + 5) + 'M' + (dx - 5) + ' ' + y1 + 'H' + (dx + 5) + 'M' + dx + ' ' + y0 + 'V' + y1 + '"/>';
    g += '<text class="svg-txt" transform="translate(' + (dx + 18) + ' ' + (y0 + y1) / 2 + ') rotate(90)" text-anchor="middle">Shaft depth ' + fmt(sd) + ' mm</text>';

    if (!r.invalid) {
      var cx = x0 + t.left * s;
      var cyTop = y0 + t.back * s;
      var cy = cyTop + r.reduced * s;
      var cw = r.cabinW * s, ch = r.cabinD * s;
      var cyBottom = cy + ch;

      if (r.reduced > 0) {
        g += '<rect class="svg-cut" x="' + cx + '" y="' + cyTop + '" width="' + cw + '" height="' + (r.reduced * s) + '"/>';
      }
      g += '<rect class="svg-cabin" x="' + cx + '" y="' + cy + '" width="' + cw + '" height="' + ch + '"/>';
      g += '<line class="svg-front" x1="' + cx + '" y1="' + cyBottom + '" x2="' + (cx + cw) + '" y2="' + cyBottom + '"/>';

      // Cabin label
      var midX = cx + cw / 2, midY = cy + ch / 2;
      g += '<text class="svg-big" x="' + midX + '" y="' + (midY + 2) + '" text-anchor="middle">' + fmt(r.cabinW) + ' × ' + fmt(r.cabinD) + '</text>';
      g += '<text class="svg-sub" x="' + midX + '" y="' + (midY + 20) + '" text-anchor="middle">Cabin, mm</text>';

      // Clearance labels where there is room
      if (t.left * s >= 26) g += '<text class="svg-gap" x="' + (x0 + t.left * s / 2) + '" y="' + (midY + 4) + '" text-anchor="middle">' + t.left + '</text>';
      if (t.right * s >= 26) g += '<text class="svg-gap" x="' + (x1 - t.right * s / 2) + '" y="' + (midY + 4) + '" text-anchor="middle">' + t.right + '</text>';
      if (t.back * s >= 15) g += '<text class="svg-gap" x="' + midX + '" y="' + (y0 + t.back * s / 2 + 4) + '" text-anchor="middle">' + t.back + '</text>';
      if (t.front * s >= 32) {
        g += '<text class="svg-gap" x="' + midX + '" y="' + (cyBottom + (y1 - cyBottom) / 2 - 2) + '" text-anchor="middle">' + t.front + '</text>';
        g += '<text class="svg-gap" x="' + midX + '" y="' + (cyBottom + (y1 - cyBottom) / 2 + 11) + '" text-anchor="middle">Door side</text>';
      } else if (t.front * s >= 15) {
        g += '<text class="svg-gap" x="' + midX + '" y="' + (cyBottom + (y1 - cyBottom) / 2 + 4) + '" text-anchor="middle">' + t.front + '</text>';
      }
    }
    return '<svg viewBox="0 0 ' + VW + ' ' + VH + '" role="img" aria-label="Plan view of the shaft ' + fmt(sw) + ' by ' + fmt(sd) + ' millimeters' + (r.invalid ? '' : ' with a cabin of ' + fmt(r.cabinW) + ' by ' + fmt(r.cabinD)) + '">' + g + '</svg>' +
      '<figcaption>Plan view drawn to scale, door side at the bottom. Numbers in the gaps are clearances in mm.' + (r.reduced > 0 ? ' The hatched strip is the depth removed from the back side.' : '') + '</figcaption>';
  }

  function render() {
    var counterField = $('#counter-field');
    var mrVal = parseInt(form.elements.mr.value, 10);
    counterField.hidden = mrVal !== 1;

    var inp = readInputs();
    if (!inp.ok) {
      $('#empty').hidden = false;
      $('#out').hidden = true;
      lastSummary = '';
      return;
    }
    $('#empty').hidden = true;
    $('#out').hidden = false;

    var r = compute(inp);
    var notes = [];
    var typeText = (inp.mr === 1 ? 'MR, ' + (inp.counter === 1 ? 'back counter' : 'side counter') : 'MRL') + ', ' + (inp.door === 1 ? 'center opening door' : 'telescopic door');

    // ----- Plan
    $('#plan').innerHTML = planSVG(inp.shaftW, inp.shaftD, r);

    if (r.invalid) {
      notes.push(['error', 'This shaft is too small for a cabin. After clearances, the cabin would be ' + fmt(r.cabinW) + ' mm wide and ' + fmt(r.cabinD0) + ' mm deep. Increase the shaft width or depth.']);
      $('#notices').innerHTML = notes.map(function (n) { return '<div class="note ' + n[0] + '">' + n[1] + '</div>'; }).join('');
      $('#readouts').innerHTML = '';
      $('#doors').innerHTML = '';
      $('#clear').innerHTML = clearanceHTML(r, inp);
      lastSummary = '';
      return;
    }

    // ----- Notices
    if (r.capacityError === 'small') notes.push(['error', 'The provided shaft size is too small.']);
    if (r.capacityError === 'large') notes.push(['error', 'The provided shaft size is too large for a standard cabin.']);
    if (r.reduced > 0) notes.push(['info', 'Cabin depth is reduced by ' + fmt(r.reduced) + ' mm from the back side.']);
    if (r.hint) notes.push(['info', 'Choose Side Counter and Center Opening Door for a bigger cabin inside area.']);
    $('#notices').innerHTML = notes.map(function (n) { return '<div class="note ' + n[0] + '">' + n[1] + '</div>'; }).join('');

    // ----- Readouts
    var off = r.persons === null;
    var metrics =
      '<div class="metric"><dt>Cabin width</dt><dd>' + fmt(r.cabinW) + '<small>mm</small></dd></div>' +
      '<div class="metric"><dt>Cabin depth</dt><dd>' + fmt(r.cabinD) + '<small>mm</small></dd></div>' +
      '<div class="metric"><dt>Cabin inside area</dt><dd>' + sqm(r.area0) + '<small>m²</small></dd></div>' +
      (r.reduced > 0 ? '<div class="metric"><dt>Reduced inside area</dt><dd>' + sqm(r.area1) + '<small>m²</small></dd></div>' : '');
    $('#readouts').innerHTML =
      '<div class="led" role="img" aria-label="' + (off ? 'Passenger capacity not available' : 'Passenger capacity ' + r.persons + (r.persons === 1 ? ' person' : ' persons')) + '">' +
        '<span class="led-cap">Passenger capacity</span>' +
        '<span class="led-num' + (off ? ' off' : '') + '">' + (off ? '--' : r.persons) + '</span>' +
        '<span class="led-unit">' + (r.persons === 1 ? 'person' : 'persons') + '</span>' +
      '</div>' +
      '<dl class="metrics">' + metrics + '</dl>';

    // ----- Doors
    var dh = '<h3>' + r.doors.label + '</h3>';
    if (r.doors.sizes.length) {
      dh += '<div class="chips">' + r.doors.sizes.map(function (s) { return '<span class="chip">' + s + ' mm</span>'; }).join('') + '</div>';
    } else {
      dh += '<p class="none">' + r.doors.message + '</p>';
    }
    $('#doors').innerHTML = dh;

    // ----- Clearances
    $('#clear').innerHTML = clearanceHTML(r, inp);

    // ----- Summary text for copy
    lastSummary = [
      'Lift cabin size',
      'Shaft: ' + fmt(inp.shaftW) + ' × ' + fmt(inp.shaftD) + ' mm (width × depth)',
      'Setup: ' + typeText,
      'Cabin: ' + fmt(r.cabinW) + ' × ' + fmt(r.cabinD) + ' mm (width × depth)',
      'Cabin inside area: ' + sqm(r.area0) + ' m²',
      r.reduced > 0 ? 'Cabin depth reduced by ' + fmt(r.reduced) + ' mm from the back side; reduced inside area: ' + sqm(r.area1) + ' m²' : null,
      'Passenger capacity: ' + (off ? (r.capacityError === 'large' ? 'shaft too large for a standard cabin' : 'shaft too small') : r.persons + (r.persons === 1 ? ' person' : ' persons')),
      r.doors.label + ': ' + (r.doors.sizes.length ? r.doors.sizes.join(', ') + ' mm' : 'none')
    ].filter(Boolean).join('\n');
  }

  function clearanceHTML(r, inp) {
    var t = r.tol;
    return '<h3>Clearances used</h3><table><tbody>' +
      '<tr><th scope="row">Left</th><td>' + t.left + ' mm</td></tr>' +
      '<tr><th scope="row">Right</th><td>' + t.right + ' mm</td></tr>' +
      '<tr><th scope="row">Back</th><td>' + t.back + ' mm</td></tr>' +
      '<tr><th scope="row">Front <small>(' + t.frontBase + ' + ' + t.doorAllow + ' door)</small></th><td>' + t.front + ' mm</td></tr>' +
      '</tbody></table>' +
      '<p class="formula">Cabin width = shaft width − (left + right). Cabin depth = shaft depth − (back + front).</p>';
  }

  /* ---------- Events ---------- */
  form.addEventListener('input', render);
  form.addEventListener('change', render);
  form.addEventListener('submit', function (e) { e.preventDefault(); });

  function loadExample() {
    elW.value = 1800; elD.value = 2200;
    render();
  }
  $('#example').addEventListener('click', loadExample);
  $('#example-2').addEventListener('click', loadExample);
  $('#reset').addEventListener('click', function () {
    form.reset();
    render();
    elW.focus();
  });

  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1800);
  }
  function copyText(text) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', '');
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) { return false; }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }
  $('#copy').addEventListener('click', function () {
    if (!lastSummary) { toast('Nothing to copy yet'); return; }
    copyText(lastSummary).then(function (ok) { toast(ok ? 'Summary copied' : 'Copy failed. Select the result and copy it manually.'); });
  });

  /* ---------- Theme ---------- */
  var root = document.documentElement;
  var themeBtn = $('#theme');
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function effective() { return root.getAttribute('data-theme') || (mq.matches ? 'dark' : 'light'); }
  function syncTheme() {
    var mode = effective();
    themeBtn.setAttribute('data-mode', mode);
    var label = mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
  }
  themeBtn.addEventListener('click', function () {
    var next = effective() === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('cabin-theme', next); } catch (e) {}
    syncTheme();
  });
  if (mq.addEventListener) mq.addEventListener('change', syncTheme);
  syncTheme();

  render();
})();
