# Iron Kinetic Source Audit — Chunk 3
## Lines 4321–6480 of index.html

**Auditor:** Agent Zero (Master Developer)
**Date:** 2026-04-15
**Scope:** i18n translation engine, storage helpers, macro calculation engine, advanced features (adaptive/auto-adjust/circadian/fingerprint/prediction/weekly-report), visualViewport handler, nutrition engine (TDEE/macros/MILP/TEF/BMR), food database, food label localization

---

## CRITICAL

### C1. Body composition shift computed but discarded
- **Location:** Lines 5302–5304
- **Problem:** `calcMacros()` computes `_k` (final kcal) on line 5302, then on line 5303 calls `getBodyCompShift()` and adds `bcs.shift` to the local `kcal` variable. However, the returned `_result` object uses the stale `_k` value, not the updated `kcal`. The shift is computed and immediately lost. Additionally, `_bcMsg` is declared but never used.
- **Impact:** Users entitled to a body-composition calorie adjustment (e.g., after significant LBM change) never see it reflected in their daily macros or meal plan.
- **Fix:**
```js
// Line 5302-5304: replace with:
const _s = getDayMacroShift();
let _c = Math.round(Math.max(carbFloor, carbs * _s.carbMult));
let _f = Math.round(Math.max(fatFloor, fat * _s.fatMult));
let _k = Math.max(kcalFloor, Math.round(pro * 4 + _c * 4 + _f * 9));
const bcs = getBodyCompShift();
if (bcs) { _k = Math.max(kcalFloor, _k + bcs.shift); }
const _result = { kcal: _k, pro, carbs: _c, fat: _f, modified, refeedActive: ref, reverseWeeks: rev, dayType: _s.label };
```

### C2. Adaptive engine uses oldest checkins instead of most recent
- **Location:** Line 5370
- **Problem:** `const recent = arr.slice(0, 5);` takes the **first** 5 elements of the checkins array. Checkins are appended over time, so the oldest entries are at index 0. The adaptive engine therefore bases its hunger/energy/adherence decisions on the user's earliest checkins, not their current state.
- **Impact:** Adaptive suggestions (add/remove calories) are based on stale data from the user's first week, not recent trends. Users may receive inappropriate calorie adjustments.
- **Fix:**
```js
// Line 5370: change to:
const recent = arr.slice(-5);
```

---

## HIGH

### H1. Auto-adjust banner icon lookup uses wrong map keys
- **Location:** Lines 5450, 5455, 5465
- **Problem:** `_autoAdjIconMap` is keyed by emoji strings (`'bolt'`, `'warning'`, `'check_circle'`, `'bar_chart'`, `'water_drop'`), but the `icons` object maps reason strings to different Material Symbol names (`'trending_down'`, `'bolt'`, `'balance'`). On line 5465, `_autoAdjIconMap[ico]` looks up `'trending_down'` and `'balance'` in the emoji-keyed map, finds nothing, and falls back to `'tune'`. Only `'bolt'` (for `fast_loss`) works correctly.
- **Impact:** `slow_loss` shows generic "tune" icon instead of "trending_down"; `maintain_drift` shows "tune" instead of "balance".
- **Fix:**
```js
// Line 5465: use the icon name directly since it IS a valid Material Symbol:
if (iconEl) { iconEl.className = 'material-symbols-outlined'; iconEl.textContent = ico; }
```

### H2. `lsS()` reads localStorage outside try/catch
- **Location:** Line 5214
- **Problem:** `const _prev = localStorage.getItem(k);` is executed before the `try` block. In private browsing mode or when storage is corrupted, this throws an uncaught exception that crashes the entire `lsS` function.
- **Impact:** Any state save operation (profile, preferences, weight log, checkins) crashes silently, causing data loss in private browsing scenarios.
- **Fix:**
```js
const lsS = (k, v) => {
  let _prev = null;
  try { _prev = localStorage.getItem(k); } catch {}
  try {
    localStorage.setItem(k, JSON.stringify(v));
    // ... rest of dirty-tab logic
  } catch (e) {
    // ... existing quota handling
  }
};
```

### H3. `renderRealTDEE()` missing `requireTrend()` paywall gate
- **Location:** Lines 5717–5741
- **Problem:** `renderRealTDEE()` calculates and displays real TDEE data without wrapping in `requireTrend()`. Every other trend feature (`renderPredictionChart`, `renderFingerprint`, `renderWeeklyReport`, `runAdaptiveEngine`) is gated behind `requireTrend()`. This function bypasses the paywall.
- **Impact:** Free-tier users can see their real TDEE estimate and weight trend rate — premium feature data exposed without subscription.
- **Fix:**
```js
function renderRealTDEE() {
  requireTrend(() => {
    const card = document.getElementById('real-tdee-card');
    if (!card) return;
    // ... existing body unchanged
  }, 'Real TDEE', true);
}
```

### H4. Multiple empty catch blocks silently swallow errors
- **Location:** Lines 4535–4536 (`lsR`/`lsW`), 5229, 5230, 5353, 5368, 5673
- **Problem:** At least 6 `catch{}` blocks with no logging or error handling. Examples:
  - Line 4536: `lsW` silently fails on storage write — no quota warning
  - Line 5229: `try{showToast(...)}catch{}` — toast failure swallowed
  - Line 5230: Rollback attempt `try{localStorage.setItem(k,_prev)}catch{}` — rollback failure swallowed
  - Line 5353: `getHungerDistributionBias()` — `JSON.parse` failure swallowed
  - Line 5368: `runAdaptiveEngine()` — checkin parse failure swallowed
  - Line 5673: `try{bodyChart.destroy()}catch(e){}` — chart destroy errors swallowed
- **Impact:** Storage errors, chart rendering failures, and data corruption are invisible to both user and developer. No Sentry breadcrumbs captured.
- **Fix:** At minimum, log to console or Sentry in each catch block:
```js
catch (e) { console.warn('[lsS] quota error:', e); }
```

---

## MEDIUM

### M1. Hardcoded i18n strings bypass `t()` function
- **Location:** Lines 5482, 5748–5752
- **Problem:** `applyAutoAdj()` uses `lang==='en'?'...':'...'` and `shareProgress()` builds English/Italian strings inline with ternary operators instead of using the `t()` i18n system.
- **Impact:** Inconsistent translations if strings are updated later. No support for future languages. Fragile to maintain.
- **Fix:** Add translation keys to both LANG dictionaries and use `t()`.

### M2. `localizeMealRest()` sorts 150+ keys on every call — O(n log n) per invocation
- **Location:** Lines 6321–6326
- **Problem:** Every call to `localizeMealRest()` sorts ~150+ translation keys by length, then iterates all of them doing `String.split().join()` replacements. This function is called for every meal on every render.
- **Impact:** Noticeable CPU cost during meal rendering, especially on low-end devices. With 3–5 meals per day and frequent re-renders, this adds up.
- **Fix:** Pre-sort the keys once at module load time into a module-level constant.

### M3. Duplicate food label localization maps
- **Location:** Lines 6178–6207 (`localizeFoodLabel`) and 6213–6319 (`localizeMealRest`)
- **Problem:** Two separate maps contain largely the same Italian→English translations. `localizeFoodLabel()` has ~40 entries, `localizeMealRest()` has ~150+ entries including all entries from the first map plus many more. Any update must be synchronized across both.
- **Impact:** Maintenance burden and risk of translation drift between the two maps. If a food label is updated in one map but not the other, different parts of the UI show different translations.
- **Fix:** Extract a single shared map and derive both functions from it.

### M4. `applyLang()` schedules redundant renders
- **Location:** Lines 4544–4554
- **Problem:** `applyLang()` calls `scheduleRender(renderMacros,renderTrackers,renderMeals,renderKcalRing,renderCoach,renderSettings,renderCheckinAnalytics,renderFingerprint)` on line 4545, then `setLang()` calls `applyLang()` on line 4553 followed by ANOTHER `scheduleRender(renderCoach,renderMeals,renderMacros,renderSettings,renderCheckinAnalytics,renderTrackers)` on line 4554. Many of the same renderers are scheduled twice.
- **Impact:** Double rendering of macros, meals, settings, coach, trackers on every language switch. Wastes CPU and can cause visual flicker.
- **Fix:** Remove the duplicate `scheduleRender` call in `setLang()` since `applyLang()` already schedules all needed renders.

### M5. `getAdaptedMealDistribution()` is overly complex and fragile
- **Location:** Lines 5357–5359 (single-line function)
- **Problem:** This function is a 1500+ character single-line function with multiple sequential transformations: skip rate adjustment, hunger bias, training time peri-workout bias, and multiple renormalization passes. The rounding at each step accumulates floating-point drift, and the final `a[a.length-1]` rounding hack can produce negative values.
- **Impact:** Edge cases (2-meal plans, extreme skip rates, boundary training times) may produce invalid distributions (negative percentages, sums ≠ 1.0).
- **Fix:** Break into sub-functions with clear naming, validate distribution sum after each pass, and clamp individual values to a minimum of 0.05.

### M6. `t()` function creates RegExp on every substitution
- **Location:** Line 4540
- **Problem:** `new RegExp(\\{${k}\\},'g')` is compiled for every variable in every call to `t()`. This is called hundreds of times during `applyTranslations()`.
- **Impact:** Unnecessary CPU overhead during language switches and initial translation pass.
- **Fix:** Use `String.replaceAll()` (available in all modern browsers) or a simple `split/join` approach instead of RegExp.

### M7. Repeated `document.getElementById()` calls for same element
- **Location:** Lines 4637–4641
- **Problem:** `document.getElementById('btn-export-data')` is called twice on line 4637 (once for the check, once for the assignment). Same pattern for `btn-import-data` (line 4638) and `btn-change-diet` (line 4640).
- **Impact:** Minor performance waste. More importantly, the `&&` short-circuit pattern is fragile — if the element is somehow re-added to DOM between checks, the second lookup returns a different element.
- **Fix:** Use the `getEl()` helper already defined on line 5200.

### M8. `_logKey()` reads entire weight log on every cache invalidation check
- **Location:** Line 5261
- **Problem:** `_logKey()` calls `getLog().map(e=>e.isoDate+e.weight).join('|')` which reads from localStorage, parses JSON, maps, and joins — on every call to `getCachedPrediction()` and `getCachedFingerprint()`.
- **Impact:** For users with extensive weight logs (100+ entries), this is an expensive operation called frequently during renders.
- **Fix:** Cache the log key and invalidate only when `saveLog` is called.

---

## LOW

### L1. `localStorage` accessed directly without `lsR`/`lsW` helpers
- **Location:** Line 5212 (`lsG` uses `localStorage.getItem` — correct, wrapped in try/catch), Line 5056 (`localStorage.getItem('ik_notif_perm')` — NOT wrapped)
- **Problem:** Line 5056: `localStorage.getItem('ik_notif_perm')` is called directly without try/catch, inconsistent with the `lsR` pattern used everywhere else.
- **Impact:** Crashes in private browsing mode, though unlikely since the surrounding code handles `Notification` permission.
- **Fix:** Use `lsR('ik_notif_perm')` instead.

### L2. `_offscreen` defer uses `requestIdleCallback` without proper timeout fallback
- **Location:** Line 5174
- **Problem:** `(window.requestIdleCallback||window.setTimeout)(_offscreen,{timeout:300})` — if `requestIdleCallback` is used, the second argument is `{timeout:300}` which is correct. But if `setTimeout` is the fallback, the second argument `{timeout:300}` is passed as the unused options parameter to `setTimeout`, not the delay. `setTimeout` expects the delay as the second positional argument, not an object.
- **Impact:** On browsers without `requestIdleCallback` (rare), the offscreen translations execute with `setTimeout(fn, {timeout:300})` which is equivalent to `setTimeout(fn, 0)` — immediate execution instead of 300ms delay.
- **Fix:**
```js
const _sched = window.requestIdleCallback
  ? (cb) => requestIdleCallback(cb, {timeout:300})
  : (cb) => setTimeout(cb, 300);
_sched(_offscreen);
```

### L3. `Notification` permission checked without feature detection
- **Location:** Line 5056
- **Problem:** `('Notification' in window)` is checked, but the fallback accesses `localStorage.getItem('ik_notif_perm')` which could be stale or corrupted. No validation of the stored value.
- **Impact:** If the stored value is corrupted, the notification status text shows incorrect state.
- **Fix:** Validate the stored value against known permission states ('granted', 'denied', 'default').

### L4. `calcSynergyScore` keyword matching assumes lowercase
- **Location:** Lines 5517–5528
- **Problem:** `d.includes(k)` where `d` is lowercased but `rule.keywords` correctness depends on all keywords being lowercase. If any future rule adds mixed-case keywords, matching would break.
- **Impact:** Low — current rules are all lowercase. Defensive coding issue.
- **Fix:** Add `.toLowerCase()` to keyword matching or document the invariant.

### L5. `generateWeeklyReport()` iterates 7 days calling `lsR(mk(...))` in a loop
- **Location:** Lines 5770–5776
- **Problem:** For each of 7 days x N meals, `lsR(mk(dow,n))` calls `localStorage.getItem()` individually. Each call is wrapped in try/catch in `lsR`, so 7x5=35 localStorage reads per weekly report generation.
- **Impact:** Minor performance overhead.
- **Fix:** Accept the current approach as reasonable for weekly generation frequency.

### L6. Dead code: `chartRealEl` assigned but never used
- **Location:** Line 5044
- **Problem:** `const chartRealEl=document.querySelector('#scr-prog .t-xxs.muted[class]');` is assigned but never used in any subsequent code.
- **Impact:** Dead variable, minor memory waste, confusing for maintainers.
- **Fix:** Remove the unused variable.

---

## INFO

### I1. `renderHelpFeatures()` uses `innerHTML` with `sanitize()` — good pattern
- **Location:** Lines 4579–4588
- **Note:** Correctly sanitizes user-facing data via `sanitize()` helper. Good practice.

### I2. GDPR gate i18n uses `innerHTML` with `sanitize()` for rich content
- **Location:** Lines 5161–5167
- **Note:** Properly uses `sanitize(t(...))` for content that may contain HTML entities. Well implemented.

### I3. visualViewport handler correctly uses RAF throttling
- **Location:** Lines 5875–5893
- **Note:** Well-implemented IIFE with RAF debounce for keyboard handling. Clean pattern.

### I4. TDEE engine follows evidence-based hierarchy
- **Location:** Lines 5981–6163
- **Note:** Proper 3-tier BMR hierarchy (Katch-McArdle > Harris-Benedict Rev. > Mifflin-St Jeor) with sport-specific modulation, EA safety gate, clinical protocol overrides. Well-researched implementation.

### I5. Macro caching prevents unnecessary recomputation
- **Location:** Lines 5255–5306, 5258–5265
- **Note:** `_macroCache`, `_predCache`, `_fpCache`, `_tdeeCache` with cache key validation. Good optimization pattern.

---

## SUMMARY

| Severity | Count | Key Issues |
|----------|-------|------------|
| CRITICAL | 2     | Discarded body comp shift (C1), stale adaptive data (C2) |
| HIGH     | 4     | Icon map mismatch (H1), unguarded localStorage (H2), paywall bypass (H3), silent errors (H4) |
| MEDIUM   | 8     | Hardcoded i18n (M1), O(n log n) per meal sort (M2), duplicate maps (M3), double renders (M4), fragile distribution (M5), RegExp per substitution (M6), duplicate DOM queries (M7), expensive cache key (M8) |
| LOW      | 6     | Unguarded localStorage access (L1), setTimeout fallback bug (L2), permission validation (L3), case assumption (L4), loop reads (L5), dead code (L6) |
| INFO     | 5     | Good patterns noted |

**Total findings: 25**

### Top 3 Priority Fixes
1. **C2** — One-line fix (`slice(0,5)` → `slice(-5)`) with major impact on adaptive engine accuracy
2. **C1** — Body comp shift never applied; users miss calorie adjustments
3. **H3** — Paywall bypass exposes premium TDEE data to free users
