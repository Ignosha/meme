(function () {
  'use strict';
  const S = window.PBStats;
  // Free public Socrata endpoint (NY State Gaming Commission). CORS-enabled, no API key.
  const API = 'https://data.ny.gov/resource/d6yy-54nr.json?$select=draw_date,winning_numbers,multiplier&$order=draw_date%20ASC&$limit=50000';

  const $ = (id) => document.getElementById(id);
  const fmt = (x, d = 2) => Number(x).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtP = (p) => (p < 0.0001 ? '< 0.0001' : p.toFixed(4));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const randInt = (k) => {
    // Unbiased integer in [0, k) from crypto.getRandomValues.
    const buf = new Uint32Array(1), lim = Math.floor(0x100000000 / k) * k;
    do { crypto.getRandomValues(buf); } while (buf[0] >= lim);
    return buf[0] % k;
  };

  // ---------- Tooltip ----------
  const tip = $('tip');
  function showTip(evt, html) {
    tip.innerHTML = html; tip.hidden = false;
    const pad = 14, r = tip.getBoundingClientRect();
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { tip.hidden = true; }

  // ---------- Minimal SVG chart ----------
  const NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function niceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v || 1)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  /**
   * bars: [{ label, value, tip, color? }]
   * opts: { color, ref: {value, label} | line: [values], band: [lo, hi], tickEvery, yLabel, legend: [{kind, color, label}], min }
   */
  function barChart(container, bars, opts) {
    container.innerHTML = '';
    const W = 900, H = opts.height || 240, m = { t: 12, r: 8, b: 26, l: 44 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const vals = bars.map((b) => b.value).concat(opts.line || [], opts.ref ? [opts.ref.value] : [], opts.band || []);
    const hasNeg = vals.some((v) => v < 0);
    const top = niceMax(Math.max(...vals.map(Math.abs)) * 1.05);
    const lo = hasNeg ? -top : 0;
    const y = (v) => m.t + ih - ((v - lo) / (top - lo)) * ih;
    const bw = iw / bars.length;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.aria || '' }, container);

    const grid = el('g', { class: 'grid' }, svg);
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((top - lo) * i) / 4, yy = y(v);
      el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy }, grid);
      el('text', { x: m.l - 6, y: yy + 4, 'text-anchor': 'end' }, svg).textContent = Math.abs(top) < 1 ? v.toFixed(2) : Math.round(v).toLocaleString();
    }
    if (opts.band) {
      el('rect', { x: m.l, width: iw, y: y(opts.band[1]), height: y(opts.band[0]) - y(opts.band[1]), fill: 'var(--band)' }, svg);
    }

    const gap = bw > 6 ? 2 : bw > 3 ? 1 : 0;
    bars.forEach((b, i) => {
      const x = m.l + i * bw, h = Math.abs(y(b.value) - y(0));
      const yy = b.value >= 0 ? y(b.value) : y(0);
      const w = Math.max(1, bw - gap);
      const r = Math.min(4, w / 2, h);
      // Bar with rounded data-end, square at the baseline.
      const path = b.value >= 0
        ? `M${x},${yy + h}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + w - r}Q${x + w},${yy} ${x + w},${yy + r}V${yy + h}Z`
        : `M${x},${yy}V${yy + h - r}Q${x},${yy + h} ${x + r},${yy + h}H${x + w - r}Q${x + w},${yy + h} ${x + w},${yy + h - r}V${yy}Z`;
      el('path', { d: path, fill: b.color || opts.color }, svg);
      if (opts.tickEvery && (i % opts.tickEvery === 0 || i === bars.length - 1)) {
        el('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle' }, svg).textContent = b.label;
      }
      const hit = el('rect', { x, y: m.t, width: bw, height: ih, fill: 'transparent' }, svg);
      hit.addEventListener('mousemove', (e) => showTip(e, b.tip));
      hit.addEventListener('mouseleave', hideTip);
    });
    el('line', { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), stroke: 'var(--border)' }, svg);

    if (opts.line) {
      const pts = opts.line.map((v, i) => `${m.l + i * bw + bw / 2},${y(v)}`).join(' ');
      el('polyline', { points: pts, fill: 'none', stroke: 'var(--ref)', 'stroke-width': 2, 'pointer-events': 'none' }, svg);
    }
    if (opts.ref) {
      const yy = y(opts.ref.value);
      el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, stroke: 'var(--ref)', 'stroke-width': 2, 'stroke-dasharray': '6 4', 'pointer-events': 'none' }, svg);
    }
    if (opts.legend) {
      const lg = document.createElement('div');
      lg.className = 'legend';
      lg.innerHTML = opts.legend.map((l) => {
        const style = l.kind === 'dash'
          ? `background: repeating-linear-gradient(90deg, ${l.color} 0 6px, transparent 6px 10px)`
          : `background:${l.color}`;
        return `<span><i class="${l.kind === 'bar' || l.kind === 'band' ? '' : 'line'}" style="${style}"></i>${esc(l.label)}</span>`;
      }).join('');
      container.appendChild(lg);
    }
  }

  // ---------- Rendering ----------
  const balls = (white, pb, hits) =>
    `<span class="balls">${white.map((n) => `<span class="ball${hits && hits.has(n) ? ' hit' : ''}">${n}</span>`).join('')}<span class="ball pb">${pb}</span></span>`;

  function render(all) {
    const draws = S.currentEra(all);
    const N = S.CURRENT.white, PB = S.CURRENT.pb, n = draws.length;
    if (n < 150) throw new Error(`Only ${n} draws in the current game format were returned, which is too few to analyse.`);

    const uni = S.uniformityTests(draws);
    const sum = S.sumTest(draws);
    const par = S.parityTest(draws);
    const mem = S.memoryTests(draws);
    const bt = S.backtest(draws);
    const gp = S.gaps(draws);
    const first = all[0], last = all[all.length - 1];

    $('data-range').textContent = `Feed covers ${all.length.toLocaleString()} draws, ${first.date} to ${last.date}.`;

    // KPIs
    $('kpis').innerHTML = [
      [all.length.toLocaleString(), 'draws fetched (all formats)'],
      [n.toLocaleString(), 'draws in current 5/69 + 1/26 game'],
      [last.date, 'latest draw in feed'],
      ['1 in ' + S.jackpotOdds().toLocaleString(), 'jackpot odds, any ticket'],
    ].map(([v, l]) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('');

    // 1. White balls
    const wf = uni.freq.white;
    const wMax = wf.indexOf(Math.max(...wf.slice(1))), wMin = wf.slice(1).indexOf(Math.min(...wf.slice(1))) + 1;
    $('white-sub').innerHTML = `Expected ${fmt(uni.white.expected, 1)} appearances each if the draw is fair. Most drawn: <strong>${wMax}</strong> (${wf[wMax]}×), least drawn: <strong>${wMin}</strong> (${wf[wMin]}×). Chi-square = ${fmt(uni.white.stat)}, df ${uni.white.df}, <strong>p = ${fmtP(uni.white.p)}</strong>. This spread is ${uni.white.p < 0.05 ? 'wider than' : 'typical of'} pure chance.`;
    barChart($('chart-white'), wf.slice(1).map((v, i) => ({
      label: String(i + 1), value: v,
      tip: `<strong>Ball ${i + 1}</strong><br>${v} times (${v - uni.white.expected >= 0 ? '+' : ''}${fmt(v - uni.white.expected, 1)} vs expected)`,
    })), { color: 'var(--white-ball)', ref: { value: uni.white.expected }, tickEvery: 4, aria: 'White ball frequency 1 to 69',
      legend: [{ kind: 'bar', color: 'var(--white-ball)', label: 'Times drawn' }, { kind: 'dash', color: 'var(--ref)', label: 'Expected if fair' }] });

    // 2. Powerball
    const pf = uni.freq.pb;
    $('pb-sub').innerHTML = `Expected ${fmt(uni.pb.expected, 1)} each. Chi-square = ${fmt(uni.pb.stat)}, df ${uni.pb.df}, <strong>p = ${fmtP(uni.pb.p)}</strong>.`;
    barChart($('chart-pb'), pf.slice(1).map((v, i) => ({
      label: String(i + 1), value: v,
      tip: `<strong>Powerball ${i + 1}</strong><br>${v} times (${v - uni.pb.expected >= 0 ? '+' : ''}${fmt(v - uni.pb.expected, 1)} vs expected)`,
    })), { color: 'var(--power-ball)', ref: { value: uni.pb.expected }, tickEvery: 1, aria: 'Powerball frequency 1 to 26',
      legend: [{ kind: 'bar', color: 'var(--power-ball)', label: 'Times drawn' }, { kind: 'dash', color: 'var(--ref)', label: 'Expected if fair' }] });

    // 3. Sums (bins of 10)
    const width = 10, lo = 15, hi = 335;
    const bins = [], exp = [];
    for (let s = Math.floor(lo / width) * width; s <= hi; s += width) {
      const c = sum.sums.filter((x) => x >= s && x < s + width).length;
      let e = 0; for (let k = s; k < s + width && k < sum.dist.length; k++) e += sum.dist[k] * n;
      bins.push({ label: String(s), value: c, tip: `<strong>Sum ${s}–${s + width - 1}</strong><br>Observed ${c}<br>Expected ${fmt(e, 1)}` });
      exp.push(e);
    }
    $('sum-sub').innerHTML = `Sum of the five white balls. Average ${fmt(sum.mean, 1)} vs ${fmt(sum.theoMean, 1)} theoretical (SD ${fmt(sum.sd, 1)} vs ${fmt(sum.theoSd, 1)}), p = ${fmtP(sum.pMean)}. Shape vs exact distribution: <strong>p = ${fmtP(sum.gof.p)}</strong>.`;
    barChart($('chart-sum'), bins, { color: 'var(--white-ball)', line: exp, tickEvery: 4, aria: 'Distribution of white-ball sums',
      legend: [{ kind: 'bar', color: 'var(--white-ball)', label: 'Observed draws' }, { kind: 'line', color: 'var(--ref)', label: 'Exact probability for a fair draw' }] });

    // 4. Memory
    const outside = mem.autocorr.lags.filter((l) => Math.abs(l.sum) > mem.autocorr.band).length;
    $('mem-sub').innerHTML = `On average ${fmt(mem.overlap.mean, 3)} white balls repeat from the previous draw. Chance predicts ${fmt(mem.overlap.expectedMean, 3)} (p = ${fmtP(mem.overlap.p)}). The Powerball repeated ${mem.pbRepeat.count} times vs ${fmt(mem.pbRepeat.expected, 1)} expected (p = ${fmtP(mem.pbRepeat.p)}). The chart shows correlation between each draw's sum and the sum 1–20 draws earlier. ${outside} of 20 lags leave the shaded 95% noise band, and about 1 is expected by chance.`;
    barChart($('chart-acf'), mem.autocorr.lags.map((l) => ({
      label: String(l.lag), value: l.sum, tip: `<strong>Lag ${l.lag}</strong><br>Correlation ${fmt(l.sum, 3)}`,
    })), { color: 'var(--white-ball)', band: [-mem.autocorr.band, mem.autocorr.band], tickEvery: 1, height: 200, aria: 'Autocorrelation of sums',
      legend: [{ kind: 'bar', color: 'var(--white-ball)', label: 'Correlation of sum with N draws earlier' }, { kind: 'band', color: 'var(--band)', label: '95% range for pure noise' }] });

    // 5. Parity
    const ptab = (t, name) => `<table><thead><tr><th>${name}</th>${t.observed.map((_, k) => `<th class="num">${k}</th>`).join('')}<th class="num">p</th></tr></thead><tbody>
      <tr><td>Observed</td>${t.observed.map((v) => `<td class="num">${v}</td>`).join('')}<td class="num" rowspan="2">${fmtP(t.p)}</td></tr>
      <tr><td>Expected</td>${t.expected.map((v) => `<td class="num">${fmt(v, 1)}</td>`).join('')}</tr></tbody></table>`;
    $('parity').innerHTML = `<div class="table-scroll">${ptab(par.odd, 'Odd balls in draw')}</div><br><div class="table-scroll">${ptab(par.low, `Low balls (1–${par.low.lowMax}) in draw`)}</div>`;

    // 6. Backtest
    $('bt-exp').textContent = fmt(25 / N, 3);
    $('backtest').innerHTML = `<thead><tr><th>Strategy</th><th class="num">Tickets</th><th class="num">Avg white matches</th><th class="num">Chance</th><th class="num">PB hits</th><th class="num">PB chance</th><th class="num">p</th><th>Beats chance?</th></tr></thead><tbody>` +
      Object.values(bt).map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${r.trials}</td><td class="num">${fmt(r.meanHits, 3)}</td><td class="num">${fmt(r.expected, 3)}</td>
        <td class="num">${r.pbHits}</td><td class="num">${fmt(r.pbExpected, 1)}</td><td class="num">${fmtP(r.p)}</td>
        <td class="${r.p < 0.05 && r.meanHits > r.expected ? 'flagged' : 'pass'}">${r.p < 0.05 && r.meanHits > r.expected ? 'Flag (check)' : 'No'}</td></tr>`).join('') + '</tbody>';

    // Summary
    const tests = [
      ['White-ball frequency (uniform?)', uni.white.p],
      ['Powerball frequency (uniform?)', uni.pb.p],
      ['Sum average', sum.pMean],
      ['Sum distribution shape', sum.gof.p],
      ['Odd/even split', par.odd.p],
      ['Low/high split', par.low.p],
      ['Repeats from previous draw', mem.overlap.p],
      ['Powerball repeats', mem.pbRepeat.p],
      ...Object.values(bt).map((r) => [`Backtest: ${r.label}`, r.p]),
    ];
    const bonf = 0.05 / tests.length;
    const flags = tests.filter(([, p]) => p < bonf);
    $('tests').innerHTML = `<thead><tr><th>Test</th><th class="num">p-value</th><th>p &lt; 0.05</th><th>Bonferroni (p &lt; ${bonf.toFixed(4)})</th></tr></thead><tbody>` +
      tests.map(([name, p]) => `<tr><td>${esc(name)}</td><td class="num">${fmtP(p)}</td><td class="${p < 0.05 ? 'flagged' : 'pass'}">${p < 0.05 ? 'yes' : 'no'}</td><td class="${p < bonf ? 'flagged' : 'pass'}">${p < bonf ? 'SIGNIFICANT' : 'consistent with random'}</td></tr>`).join('') + '</tbody>';

    const v = $('verdict');
    v.classList.toggle('flag', flags.length > 0);
    v.innerHTML = flags.length === 0
      ? `<h2>Verdict: no exploitable pattern</h2><p>${n.toLocaleString()} real draws ran through ${tests.length} tests, and every result is consistent with a fair random draw after correcting for multiple testing. No formula produces these numbers. The "hot", "cold", "overdue" and "repeat" strategies do no better than random guessing.</p>`
      : `<h2>Verdict: ${flags.length} test(s) flagged</h2><p>${flags.map(([t]) => esc(t)).join(', ')} came out significant after multiple-testing correction. This is worth a closer look, but a statistical flag isn't a way to predict a draw: the backtest shows whether any strategy actually turns it into more matches.</p>`;

    // Next draw
    const nd = S.nextDrawDate();
    const when = new Date(nd.iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    $('next-title').textContent = nd.isToday ? `Tonight's draw: ${when} (10:59 PM ET)` : `Next draw: ${when} (10:59 PM ET)`;
    $('odds').textContent = '1 in ' + S.jackpotOdds().toLocaleString();
    const ticketHtml = (t, tag) => `<div class="ticket"><span class="tag">${esc(tag)}</span>${balls(t.white, t.pb)}</div>`;
    const renderTickets = (kind) => {
      const make = kind === 'smart' ? S.lessPopularTicket : S.randomTicket;
      const label = kind === 'smart' ? 'Less-popular random pick' : 'Uniform random pick';
      $('tickets').innerHTML = [1, 2, 3].map((i) => ticketHtml(make(randInt), `${label} #${i}`)).join('');
    };
    renderTickets('smart');
    $('btn-random').onclick = () => renderTickets('random');
    $('btn-smart').onclick = () => renderTickets('smart');
    $('strategy-tickets').innerHTML = Object.keys(S.STRATEGIES).map((k) => ticketHtml(S.predict(draws, k), S.STRATEGIES[k].label.split(' (')[0])).join('');

    // Gaps
    barChart($('chart-gap'), gp.white.map((g) => ({
      label: String(g.n), value: g.since, tip: `<strong>Ball ${g.n}</strong><br>${g.since} draws since last seen`,
    })), { color: 'var(--white-ball)', tickEvery: 4, aria: 'Draws since each white ball last appeared',
      legend: [{ kind: 'bar', color: 'var(--white-ball)', label: 'Draws since last seen' }] });

    // Search
    const allDesc = all.slice().reverse();
    const search = () => {
      const want = ($('q').value.match(/\d+/g) || []).map(Number);
      const pb = $('qpb').value ? Number($('qpb').value) : null;
      const from = $('qfrom').value, to = $('qto').value;
      const rows = allDesc.filter((d) =>
        want.every((x) => d.white.includes(x) || d.pb === x) &&
        (pb === null || d.pb === pb) && (!from || d.date >= from) && (!to || d.date <= to));
      const set = new Set(want);
      $('search-count').textContent = `${rows.length.toLocaleString()} matching draw(s)${rows.length > 500 ? ', showing the newest 500' : ''}.`;
      $('draws').innerHTML = '<thead><tr><th>Date</th><th>Numbers</th><th class="num">Multiplier</th><th>Format</th></tr></thead><tbody>' +
        rows.slice(0, 500).map((d) => `<tr><td>${d.date}</td><td>${balls(d.white, d.pb, set)}</td><td class="num">${d.multiplier ? d.multiplier + '×' : '–'}</td><td>${esc(d.era)}</td></tr>`).join('') + '</tbody>';
    };
    ['q', 'qpb', 'qfrom', 'qto'].forEach((id) => $(id).addEventListener('input', search));
    search();
  }

  async function load() {
    const status = $('status');
    try {
      const res = await fetch(API, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`data.ny.gov answered HTTP ${res.status}`);
      const draws = S.parseRows(await res.json());
      if (!draws.length) throw new Error('The feed returned no draws.');
      render(draws);
      status.textContent = `Live data loaded ${new Date().toLocaleString()}.`;
      $('app').hidden = false;
    } catch (err) {
      status.classList.add('error');
      status.textContent = `Couldn't load live draw data: ${err.message}. This tool only uses real data, so nothing is shown. Check your connection and reload.`;
      console.error(err);
    }
  }
  load();
})();
