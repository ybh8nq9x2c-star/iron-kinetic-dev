# CLAUDE.md — Iron Kinetic persistent context

Reference this file before every patch. All values are extracted from the real code.

---

## 1. Stack & Architecture

| Layer | Detail |
|---|---|
| **Type** | Single-file PWA — everything in `index.html` |
| **SW** | `sw.js` — cache-first, currently **v15** (`const CACHE = 'iron-kinetic-v15'`) |
| **Fonts** | Manrope (body), Space Grotesk (numbers/headings) via Google Fonts |
| **Charts** | Chart.js 4.4.0 CDN, no SRI hash — `typeof Chart` guard before use |
| **Icons** | Material Symbols Outlined (variable font, FILL axis) |
| **i18n** | `LANG.it` / `LANG.en` object, `t(key, vars)` helper |
| **State** | `localStorage` only — no server, no IndexedDB |
| **Tabs** | `TABS = ['oggi','prog','set','info']` — screens `#scr-{name}` |
| **Dirty flags** | `_tabDirty = {oggi, prog, set, info}` — set by `lsS()` automatically |

---

## 2. CSS Variables (`:root`)

```css
/* Brand */
--p:#4ddcc6          --p-dim:rgba(77,220,198,.15)
--p-glow:0 0 24px rgba(77,220,198,.22)
--p-glow-s:0 0 12px rgba(77,220,198,.16)
--neon:var(--p)      --neon-12:var(--p-dim)
--neon-06:rgba(77,220,198,.06)
--neon-glow:var(--p-glow)   --neon-glow-s:var(--p-glow-s)
--neon-20:rgba(77,220,198,.20)
--sec:#c0c1ff        --sec-dim:rgba(192,193,255,.12)

/* Semantic colours */
--red:#FF3B30   --orange:#FF9F0A   --blue:#0A84FF   --purple:#BF5AF2

/* Backgrounds (dark→light) */
--bg:#0e0e0e   --s0:#131313   --s1:#1c1b1b   --s2:#201f1f
--s3:#2a2a2a   --s4:#353534

/* Text */
--on:#e5e2e1          --on-v:rgba(199,196,216,.85)
--muted:rgba(199,196,216,.55)   --dim:rgba(199,196,216,.28)

/* Borders */
--line:rgba(255,255,255,.06)   --line-hi:rgba(255,255,255,.10)
--glass:rgba(255,255,255,.04)  --glass-stroke:rgba(255,255,255,.08)
--glass-hi:inset 0 1px 1px rgba(255,255,255,.05)
--glass-shadow:0 8px 32px rgba(0,0,0,.32),var(--glass-hi)

/* Radii */
--r:16px   --r2:12px   --r3:8px   --r-pill:999px   --rbox:var(--r)

/* Safe areas & layout */
--sat:env(safe-area-inset-top,0px)
--sab:env(safe-area-inset-bottom,0px)
--sal:env(safe-area-inset-left,0px)
--sar:env(safe-area-inset-right,0px)
--hdr:52px   --hdr-top:max(8px,var(--sat))
--nav-h:64px   --nav-bottom:max(10px,var(--sab))
--page-top:calc(var(--hdr-top) + var(--hdr) + 6px)
--page-bottom:calc(var(--nav-bottom) + var(--nav-h) + 4px)
--kb-offset:0px
```

---

## 3. Storage Helpers (exact signatures)

```js
// Parse JSON, return fallback on miss/error
const lsG = (k, fb=null) => { try { const v=localStorage.getItem(k); return v!==null?JSON.parse(v):fb; } catch { return fb; } };

// Stringify + set dirty flags (oggi, prog, set)
const lsS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); _tabDirty.oggi=true; _tabDirty.prog=true; _tabDirty.set=true; } catch(e) { /* QuotaExceededError toast */ } };

// Raw string read (no JSON parse)
const lsR = k => { try { return localStorage.getItem(k); } catch { return null; } };

// Raw string write (no dirty flags, no parse)
const lsW = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
```

**Rules:**
- Use `lsS` for structured data (objects/arrays) — it also marks tabs dirty
- Use `lsR`/`lsW` for simple strings (dates, flags, single values)
- Use `lsG` for reading structured data with a fallback
- **Never** call `localStorage.getItem/setItem` directly

---

## 4. SK Keys (all values)

```js
const SK = {
  diet:      'app_diet_data',
  phase:     'ik_phase',
  mod:       'ik_modifier',
  refeed:    'ik_refeed_date',
  wLog:      'ik_weight_log',
  progStart: 'ik_prog_start',
  p4Start:   'ik_p4_start',
  profile:   'ik_user_profile',
  prefs:     'ik_user_prefs',
};

// Extra keys NOT in SK (used directly by key string):
'ik_checkins'   // check-in log array  — used by lsG/localStorage.getItem directly
'ik_lang'       // 'it' or 'en'
'ikadaptive'    // SK_ADAPTIVE — today's ISO date if banner dismissed
'ikweeklyreport'// SK_REPORT
```

**Note:** `SK` has NO `.checkins` key. All check-in reads use the hardcoded string `'ik_checkins'`.

---

## 5. Critical DOM IDs

### `renderMacros()`
`m-kcal`, `m-pro`, `m-carbs`, `m-fat`, `b-kcal`, `b-pro`, `b-carbs`, `b-fat`, `m-mod-badge`

### `renderTrackers()`
`water-val`, `water-target`, `water-bar`, `water-ring`,
`salt-val`, `salt-bar`, `salt-ring`,
`steps-val`, `steps-tgt`, `steps-bar`,
`wk-ratio`, `wk-status`, `wk-bar`, `wk-btn`

### `renderKcalRing()`
`kcal-ring-oggi` (r=17, circ=106.8), `oggi-kcal-pct`

### `renderKcalRing()` — profile ring in `renderSettings()`
`kcal-ring` (r=88, circ=552.9), `set-hero-tdee`, `set-hero-bmr`

### `renderMeals()`
`meals-list`, `meals-done`, `meals-total`, `oggi-pasti-bar`,
`day-sel`, `refeed-card`, `oggi-date-label`

### `renderRefeed()`
`refeed-card`, `refeed-oggi-btn`

### `renderCoach()`
`coach-card`, `coach-ico-wrap`, `coach-ico`, `coach-lbl`, `coach-msg`, `coach-streak-badge`

### `renderSettings()`
`set-plan-name`, `set-plan-meta`, `set-phases`, `set-hero-tdee`, `set-hero-bmr`,
`set-profile-text`, `set-prefs-text`, `set-prefs-content`,
`mod-units-label`, `hdr-plan`,
`acc-fase`, `acc-mod`, `acc-dati`, `acc-danger`, `acc-lingua`

### `renderPersonalInsight()`
`personal-insight-card`, `personal-insight-content`

### `renderCheckinAnalytics()`
`an-hunger`, `an-hunger-v`, `an-energy`, `an-energy-v`,
`an-adherence`, `an-adherence-v`, `an-digestion`, `an-digestion-v`,
`checkin-analytics-note`

### `renderProgressStats()`
`st-w`, `st-wdiff`, `st-wst`, `st-wstdiff`, `chart-monthly-delta`

### `renderHistList()`
`hist-list`

### `renderChart()` / `renderPredictionChart()`
`wChart`, `wChart-wrap`, `chart-empty`, `chart-mode-label`,
`prediction-summary`, `prediction-text`

### `renderFingerprint()`
`fingerprint-card`, `fingerprint-content`

### `renderWeeklyReport()`
`weekly-report-card`, `weekly-report-content`

### Adaptive banner
`adaptive-banner`, `adaptive-msg`

---

## 6. All `onclick` Handlers in HTML

```
acknowledgedPWA()          activateGeneratedPlan()     addSalt(.5)
addSalt(1)                 addSteps(1000)              addSteps(2500)
addWater(.25)              addWater(.5)                applyAdaptiveSuggestion()
applyMod(-1)               applyMod(0)                 applyMod(1)
changeDiet()               closeConfirm()              closeModal()
closeModalOnOverlay()      deleteEntry()               dismissAdaptive()
exportData()               gdprAccept()                gdprWithdraw()
goStep()                   logMetric()                 openModal()
openShoppingList()         regenSingleMeal(d,n)        requestNotifPermission()
resetProfile()             resetT('water')             resetT('salt')
runCalcAndGenerate()       saveDailyCheckin()          setCheckTag(this,tag)
setClinical(v)             setDietStyle(v)             setGoal(v)
setLang('it')              setLang('en')               setMealsCount(n)
setSex(v)                  setSt(v)                    setTaste(v)
setWk(v)                   shareWeeklyReport()         shiftDay(-1)
shiftDay(1)                switchChart('weight',this)  switchChart('waist',this)
switchChart('prediction',this)  switchTab('oggi')      switchTab('prog')
switchTab('set')           switchTab('info')           swapMealComponent(d,n,t)
toggleAccordion('fase')    toggleAccordion('mod')      toggleAccordion('dati')
toggleAccordion('danger')  toggleAccordion('lingua')   toggleFaq()
toggleFood(v)              toggleInsight()             toggleMeal(d,n)
toggleRefeed()             toggleTrackers()            toggleWk()
updateWeight()
```

---

## 7. `#scr-oggi` DOM Section Order

```
#scr-oggi > .pg
  1. #coach-card              (.card-neon) — coach-ico, coach-lbl, coach-msg, coach-streak-badge
  2. #adaptive-banner         (display:none by default) — adaptive-msg, Applica/Ignora btns
  3. #oggi-date-label         (t-xxs, centered date string)
  4. .card (macro+kcal)       — m-kcal (44px), m-mod-badge, kcal-ring-oggi (72px SVG r=17),
                                oggi-kcal-pct, m-pro/b-pro, m-carbs/b-carbs, m-fat/b-fat, b-kcal(hidden)
  5. .card (pasti)            — oggi-pasti-bar, meals-done, meals-total,
                                day-sel (with shiftDay arrows),
                                #refeed-card (display:none until phase=2),
                                #meals-list, shopping button
  6. .card (trackers)         — collapsible, CLOSED by default (max-height:0)
                                trackers-toggle-btn (aria-expanded="false"),
                                trackers-chevron (rotate 180° when closed),
                                #trackers-body: acqua, sale, passi+workout
  7. #daily-check-card        (.check-card) — ci-hunger, ci-energy, ci-adherence, ci-digestion,
                                context chips, checkin-feedback
  8. #maintain-card           (.maintain-card, display:none) — shown on goal=maintain
  9. .card (profilo)          — collapsible, closed by default
                                insight-toggle-btn, insight-chevron,
                                #personal-insight-card > #personal-insight-content
```

---

## 8. `mountApp()` Render Pipeline

```js
// ── Critical path (before first paint) ──
initLang();
applyTranslations();
renderMacros(); renderTrackers(); renderMeals(); renderKcalRing();

// ── Deferred (requestAnimationFrame) ──
renderCoach?.();
renderRefeed?.();
renderPersonalInsight?.();
updateAdherenceCalendar?.();
renderCalendar?.();
renderCheckinAnalytics?.();
runAdaptiveEngine?.();          // Feature 1
updateConsentUI?.();
updateStreaks?.();
updateNotifUI?.();
migrateTargetKcal?.();
try { restoreTodayCheckin?.(); } catch {}

// ── Idle (requestIdleCallback or 80ms timeout) ──
renderSettings?.();
buildDaySelector?.();
renderFingerprint?.();          // Feature 3
renderWeeklyReport?.();         // Feature 6
```

**`switchTab()` also triggers:**
- `prog` tab → `renderProgress()`, `updateAdherenceCalendar()`, `renderCalendar()`, `updateNotifUI()`, `renderFingerprint()`, `renderWeeklyReport()`
- `set` tab → `renderSettings()`, `renderKcalRing()`
- `info` tab → `updateConsentUI()`

---

## 9. Six Advanced Features (active)

| # | Name | Key function(s) | Trigger |
|---|---|---|---|
| 1 | **Adaptive Macro Engine** | `runAdaptiveEngine()`, `showAdaptiveBanner()`, `applyAdaptiveSuggestion()`, `dismissAdaptive()` | mountApp deferred; reads `'ik_checkins'`; guard key `SK_ADAPTIVE='ikadaptive'` |
| 2 | **Circadian Nutrition Timing** | `getCircadianTips(n, idx, total)` | Inside `renderMeals()` per meal row; badges ⚡🔄🌙 |
| 3 | **Metabolic Fingerprint** | `calcMetabolicFingerprint()`, `renderFingerprint()` | mountApp idle + switchTab prog; card `#fingerprint-card`; needs ≥5 weight entries |
| 4 | **Predictive Weight Curve** | `calcPredictiveCurve()`, `renderPredictionChart()` | `switchChart('prediction', btn)`; tab `#ctab-pred`; 12-week dashed overlay |
| 5 | **Meal Synergy Score** | `SYNERGY_RULES[]`, `calcSynergyScore(desc)` | Inside `renderMeals()` per meal row; badge 🟢🔴; skipped if `checked === true` |
| 6 | **Weekly Metabolic Report** | `generateWeeklyReport()`, `generateReportInsight()`, `renderWeeklyReport()`, `shareWeeklyReport()` | mountApp idle + switchTab prog; card `#weekly-report-card` |

---

## 10. Absolute Rules for Every Patch

### Never do
- No Tailwind classes — only existing CSS vars and utility classes
- No new external libraries — Chart.js 4.4.0 is the only allowed runtime dep
- No `innerHTML` without `sanitize()` on all user-supplied strings
- No direct `localStorage.getItem/setItem` — always `lsG`/`lsS`/`lsR`/`lsW`
- No touching tabs not involved in the task (dirty flag side-effects)
- No bumping SW version (`sw.js`) unless the change affects visible UI
- No inventing i18n keys — every new UI string needs a key in **both** `LANG.it` and `LANG.en`

### Always do
- Use `sanitize(str)` before any `innerHTML` insertion
- Use `toISO()` (it's a **function**: `const toISO=()=>new Date().toISOString().slice(0,10)`) — never treat it as a string
- Use `isRefeed()` with `()` — it's an arrow function, not a property
- Check `typeof Chart !== 'undefined'` before creating any Chart.js instance
- Keep `KCAL_CIRC=552.9` for the profile ring (r=88) and `KCAL_CIRC2=106.8` for the oggi ring (r=17)
- Match existing code style: minified, no semicolons after function declarations, arrow functions for helpers

### Output format for patches
- Show only changed lines with ±3 lines of context
- No full-file diffs
- State which function(s) were changed
