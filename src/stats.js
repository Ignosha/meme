/*
 * Powerball statistics engine.
 *
 * Pure functions only. No network or DOM access. Loaded as a classic
 * <script> in the browser (exposes window.PBStats) and via require() in Node
 * for the tests.
 */
(function (root) {
  'use strict';

  // Game-matrix eras. Tests only make sense within a single matrix, so the
  // analysis uses the current one (in effect since the 2015-10-07 draw).
  const ERAS = [
    { from: '2009-01-07', to: '2012-01-14', white: 59, pb: 39, label: '5/59 + 1/39' },
    { from: '2012-01-15', to: '2015-10-06', white: 59, pb: 35, label: '5/59 + 1/35' },
    { from: '2015-10-07', to: '9999-12-31', white: 69, pb: 26, label: '5/69 + 1/26 (current)' },
  ];
  const CURRENT = ERAS[ERAS.length - 1];
  const PICK = 5;

  function eraFor(date) {
    return ERAS.find((e) => date >= e.from && date <= e.to) || null;
  }

  // ---------- Parsing ----------

  // Rows from the NY Open Data "Lottery Powerball Winning Numbers" dataset:
  // { draw_date: "2024-01-01T00:00:00.000", winning_numbers: "1 2 3 4 5 6", multiplier: "2" }
  function parseRows(rows) {
    const draws = [];
    for (const r of rows) {
      if (!r || !r.draw_date || !r.winning_numbers) continue;
      const nums = String(r.winning_numbers).trim().split(/\s+/).map(Number);
      if (nums.length !== 6 || nums.some((n) => !Number.isInteger(n))) continue;
      const date = String(r.draw_date).slice(0, 10);
      const era = eraFor(date);
      if (!era) continue;
      const white = nums.slice(0, 5).sort((a, b) => a - b);
      const pb = nums[5];
      if (white.some((n) => n < 1 || n > era.white) || new Set(white).size !== 5) continue;
      if (pb < 1 || pb > era.pb) continue;
      draws.push({ date, white, pb, multiplier: r.multiplier ? Number(r.multiplier) : null, era: era.label });
    }
    draws.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return draws;
  }

  function currentEra(draws) {
    return draws.filter((d) => d.date >= CURRENT.from);
  }

  // ---------- Special functions ----------

  function lnGamma(x) {
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
      1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  // Regularized upper incomplete gamma Q(a, x).
  function gammaQ(a, x) {
    if (x <= 0) return 1;
    if (x < a + 1) {
      let sum = 1 / a, del = sum, ap = a;
      for (let n = 0; n < 1000; n++) {
        ap += 1; del *= x / ap; sum += del;
        if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
      }
      return 1 - sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
    }
    let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
    for (let i = 1; i < 1000; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
  }

  function chiSquareP(stat, df) {
    return gammaQ(df / 2, stat / 2);
  }

  function normalCdf(z) {
    // Abramowitz-Stegun 7.1.26 via erf.
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }

  function twoSidedP(z) {
    return 2 * (1 - normalCdf(Math.abs(z)));
  }

  function lnChoose(n, k) {
    if (k < 0 || k > n) return -Infinity;
    return lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
  }

  function choose(n, k) {
    return Math.round(Math.exp(lnChoose(n, k)));
  }

  // P(X = k) for X ~ Hypergeometric(population N, K successes, n draws).
  function hypergeom(N, K, n, k) {
    return Math.exp(lnChoose(K, k) + lnChoose(N - K, n - k) - lnChoose(N, n));
  }

  // Goodness-of-fit chi-square. Adjacent cells are merged until each expected
  // count is >= 5 so the chi-square approximation holds.
  function chiSquareGof(observed, expected) {
    const o = [], e = [];
    let accO = 0, accE = 0;
    for (let i = 0; i < observed.length; i++) {
      accO += observed[i]; accE += expected[i];
      if (accE >= 5) { o.push(accO); e.push(accE); accO = 0; accE = 0; }
    }
    if (accE > 0) {
      if (e.length) { o[o.length - 1] += accO; e[e.length - 1] += accE; } else { o.push(accO); e.push(accE); }
    }
    let stat = 0;
    for (let i = 0; i < o.length; i++) stat += (o[i] - e[i]) ** 2 / e[i];
    const df = Math.max(1, o.length - 1);
    return { stat, df, p: chiSquareP(stat, df), cells: o.length };
  }

  function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
  function sd(xs) {
    const m = mean(xs);
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  }

  function autocorr(xs, lag) {
    const n = xs.length, m = mean(xs);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) den += (xs[i] - m) ** 2;
    for (let i = lag; i < n; i++) num += (xs[i] - m) * (xs[i - lag] - m);
    return num / den;
  }

  // ---------- Theory for the current matrix ----------

  // Exact distribution of the sum of 5 distinct numbers drawn from 1..N.
  function sumDistribution(N, k) {
    // ways[j][s] = number of j-subsets with sum s, built number by number.
    const maxS = k * N;
    let ways = Array.from({ length: k + 1 }, () => new Float64Array(maxS + 1));
    ways[0][0] = 1;
    for (let v = 1; v <= N; v++) {
      for (let j = Math.min(k, v); j >= 1; j--) {
        const prev = ways[j - 1], cur = ways[j];
        for (let s = maxS; s >= v; s--) cur[s] += prev[s - v];
      }
    }
    const total = choose(N, k);
    return Array.from(ways[k], (w) => w / total);
  }

  // ---------- Analyses ----------

  function frequencies(draws, N, PB) {
    const white = new Array(N + 1).fill(0);
    const pb = new Array(PB + 1).fill(0);
    for (const d of draws) { d.white.forEach((n) => white[n]++); pb[d.pb]++; }
    return { white, pb };
  }

  function uniformityTests(draws, N = CURRENT.white, PB = CURRENT.pb) {
    const f = frequencies(draws, N, PB);
    const n = draws.length;
    const wObs = f.white.slice(1), pObs = f.pb.slice(1);
    const wExp = new Array(N).fill((n * PICK) / N);
    const pExp = new Array(PB).fill(n / PB);
    return {
      freq: f,
      white: { ...chiSquareGof(wObs, wExp), expected: (n * PICK) / N },
      pb: { ...chiSquareGof(pObs, pExp), expected: n / PB },
    };
  }

  function sumTest(draws, N = CURRENT.white) {
    const sums = draws.map((d) => d.white.reduce((a, b) => a + b, 0));
    const dist = sumDistribution(N, PICK);
    const theoMean = (PICK * (N + 1)) / 2;
    const theoSd = Math.sqrt((PICK * ((N * N - 1) / 12) * (N - PICK)) / (N - 1));
    const m = mean(sums);
    const z = (m - theoMean) / (theoSd / Math.sqrt(sums.length));
    // Bin into width-10 buckets for a goodness-of-fit test against the exact distribution.
    const width = 10, nb = Math.ceil((PICK * N + 1) / width);
    const obs = new Array(nb).fill(0), exp = new Array(nb).fill(0);
    sums.forEach((s) => obs[Math.floor(s / width)]++);
    dist.forEach((p, s) => { exp[Math.floor(s / width)] += p * sums.length; });
    return { sums, dist, theoMean, theoSd, mean: m, sd: sd(sums), z, pMean: twoSidedP(z), gof: chiSquareGof(obs, exp) };
  }

  function parityTest(draws, N = CURRENT.white) {
    const odd = Math.ceil(N / 2), low = Math.floor(N / 2);
    const oddObs = new Array(6).fill(0), lowObs = new Array(6).fill(0);
    for (const d of draws) {
      oddObs[d.white.filter((x) => x % 2 === 1).length]++;
      lowObs[d.white.filter((x) => x <= low).length]++;
    }
    const oddExp = oddObs.map((_, k) => hypergeom(N, odd, PICK, k) * draws.length);
    const lowExp = lowObs.map((_, k) => hypergeom(N, low, PICK, k) * draws.length);
    return {
      odd: { observed: oddObs, expected: oddExp, ...chiSquareGof(oddObs, oddExp) },
      low: { observed: lowObs, expected: lowExp, ...chiSquareGof(lowObs, lowExp), lowMax: low },
    };
  }

  // Does a draw "remember" the previous one?
  function memoryTests(draws, N = CURRENT.white, PB = CURRENT.pb) {
    const overlaps = [];
    let pbRepeat = 0;
    for (let i = 1; i < draws.length; i++) {
      const prev = new Set(draws[i - 1].white);
      overlaps.push(draws[i].white.filter((x) => prev.has(x)).length);
      if (draws[i].pb === draws[i - 1].pb) pbRepeat++;
    }
    const n = overlaps.length;
    const ovObs = new Array(6).fill(0);
    overlaps.forEach((k) => ovObs[k]++);
    const ovExp = ovObs.map((_, k) => hypergeom(N, PICK, PICK, k) * n);
    const pbExpRate = 1 / PB;
    const pbZ = (pbRepeat - n * pbExpRate) / Math.sqrt(n * pbExpRate * (1 - pbExpRate));
    const sums = draws.map((d) => d.white.reduce((a, b) => a + b, 0));
    const pbs = draws.map((d) => d.pb);
    const lags = [];
    for (let l = 1; l <= 20; l++) lags.push({ lag: l, sum: autocorr(sums, l), pb: autocorr(pbs, l) });
    return {
      overlap: { observed: ovObs, expected: ovExp, mean: mean(overlaps), expectedMean: (PICK * PICK) / N, ...chiSquareGof(ovObs, ovExp) },
      pbRepeat: { count: pbRepeat, expected: n * pbExpRate, z: pbZ, p: twoSidedP(pbZ) },
      autocorr: { lags, band: 1.96 / Math.sqrt(draws.length), n: draws.length },
    };
  }

  // ---------- Prediction strategies + honest backtest ----------

  // Every strategy only ever sees draws strictly before the draw it predicts.
  const STRATEGIES = {
    hot: { label: 'Hot numbers (most frequent in last 100 draws)' },
    cold: { label: 'Cold numbers (least frequent in last 100 draws)' },
    overdue: { label: 'Overdue numbers (longest since last drawn)' },
    repeat: { label: 'Repeat the previous draw' },
  };

  function rankPick(scores, count, desc) {
    return scores
      .map((s, n) => ({ n, s }))
      .filter((x) => x.n >= 1)
      .sort((a, b) => (desc ? b.s - a.s : a.s - b.s) || a.n - b.n)
      .slice(0, count)
      .map((x) => x.n);
  }

  function predict(history, strategy, N = CURRENT.white, PB = CURRENT.pb, window = 100) {
    const recent = history.slice(-window);
    if (strategy === 'repeat') {
      const last = history[history.length - 1];
      return { white: last.white.slice(), pb: last.pb };
    }
    if (strategy === 'overdue') {
      const lastW = new Array(N + 1).fill(-1), lastP = new Array(PB + 1).fill(-1);
      history.forEach((d, i) => { d.white.forEach((n) => { lastW[n] = i; }); lastP[d.pb] = i; });
      return { white: rankPick(lastW, PICK, false).sort((a, b) => a - b), pb: rankPick(lastP, 1, false)[0] };
    }
    const f = frequencies(recent, N, PB);
    const desc = strategy === 'hot';
    return { white: rankPick(f.white, PICK, desc).sort((a, b) => a - b), pb: rankPick(f.pb, 1, desc)[0] };
  }

  function backtest(draws, N = CURRENT.white, PB = CURRENT.pb, warmup = 100) {
    const expWhite = (PICK * PICK) / N;
    // Variance of white matches for a fixed ticket vs a random draw (hypergeometric).
    const varWhite = PICK * (PICK / N) * ((N - PICK) / N) * ((N - PICK) / (N - 1));
    const out = {};
    for (const key of Object.keys(STRATEGIES)) {
      let whiteHits = 0, pbHits = 0, trials = 0;
      const dist = new Array(6).fill(0);
      for (let i = warmup; i < draws.length; i++) {
        const guess = predict(draws.slice(0, i), key, N, PB);
        const actual = new Set(draws[i].white);
        const m = guess.white.filter((x) => actual.has(x)).length;
        whiteHits += m; dist[m]++;
        if (guess.pb === draws[i].pb) pbHits++;
        trials++;
      }
      const meanHits = whiteHits / trials;
      const z = (meanHits - expWhite) / Math.sqrt(varWhite / trials);
      out[key] = {
        label: STRATEGIES[key].label, trials, meanHits, expected: expWhite, z, p: twoSidedP(z),
        pbHits, pbExpected: trials / PB, dist,
      };
    }
    return out;
  }

  // ---------- Gaps / "due" numbers (descriptive only) ----------

  function gaps(draws, N = CURRENT.white, PB = CURRENT.pb) {
    const lastW = new Array(N + 1).fill(-1), lastP = new Array(PB + 1).fill(-1);
    draws.forEach((d, i) => { d.white.forEach((n) => { lastW[n] = i; }); lastP[d.pb] = i; });
    const end = draws.length - 1;
    return {
      white: lastW.map((i, n) => ({ n, since: i < 0 ? draws.length : end - i })).slice(1),
      pb: lastP.map((i, n) => ({ n, since: i < 0 ? draws.length : end - i })).slice(1),
    };
  }

  // ---------- Odds ----------

  function jackpotOdds(N = CURRENT.white, PB = CURRENT.pb) {
    return choose(N, PICK) * PB;
  }

  // ---------- Next draw (Mon / Wed / Sat, 10:59 PM Eastern) ----------

  function easternParts(date) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
    });
    const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute, wd: p.weekday };
  }

  function nextDrawDate(now = new Date()) {
    const DRAW_DAYS = new Set(['Mon', 'Wed', 'Sat']);
    for (let add = 0; add < 8; add++) {
      const t = new Date(now.getTime() + add * 86400000);
      const e = easternParts(t);
      if (!DRAW_DAYS.has(e.wd)) continue;
      if (add === 0 && (e.hh > 22 || (e.hh === 22 && e.mm >= 59))) continue;
      const iso = `${e.y}-${String(e.m).padStart(2, '0')}-${String(e.d).padStart(2, '0')}`;
      return { iso, weekday: e.wd, isToday: add === 0 };
    }
    return null;
  }

  // ---------- Ticket generation ----------

  // Uniform random ticket. randInt(k) must return an integer in [0, k).
  function randomTicket(randInt, N = CURRENT.white, PB = CURRENT.pb) {
    const pool = Array.from({ length: N }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return { white: pool.slice(0, PICK).sort((a, b) => a - b), pb: randInt(PB) + 1 };
  }

  // Still a uniformly random ticket among those that avoid the most commonly
  // played shapes (all numbers <= 31 "birthday" picks, long runs). Same odds of
  // winning; lower chance of splitting a jackpot with other players.
  function lessPopularTicket(randInt, N = CURRENT.white, PB = CURRENT.pb) {
    for (;;) {
      const t = randomTicket(randInt, N, PB);
      const over31 = t.white.filter((x) => x > 31).length;
      let run = 1, maxRun = 1;
      for (let i = 1; i < t.white.length; i++) {
        run = t.white[i] === t.white[i - 1] + 1 ? run + 1 : 1;
        maxRun = Math.max(maxRun, run);
      }
      const allSameDecade = new Set(t.white.map((x) => Math.floor(x / 10))).size === 1;
      if (over31 >= 2 && maxRun <= 2 && !allSameDecade) return t;
    }
  }

  const api = {
    ERAS, CURRENT, PICK, eraFor, parseRows, currentEra,
    lnGamma, gammaQ, chiSquareP, normalCdf, twoSidedP, choose, hypergeom, chiSquareGof, mean, sd, autocorr,
    sumDistribution, frequencies, uniformityTests, sumTest, parityTest, memoryTests,
    STRATEGIES, predict, backtest, gaps, jackpotOdds, nextDrawDate, randomTicket, lessPopularTicket,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PBStats = api;
})(typeof window !== 'undefined' ? window : globalThis);
