# Iron Kinetic — Bugs, Runtime Errors & Performance Audit

**Date:** 2026-04-15  
**Scope:** index.html (10,798 lines), sw.js (81 lines), server.js (31 lines)  
**Auditor:** Agent Zero 'Master Developer'

---

## Executive Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 15 |
| HIGH | 28 |
| MEDIUM | 39 |
| LOW | 26 |
| INFO | 16 |
| **TOTAL** | **124** |

> Deduplication note: Chunk 1 #2 and Chunk 2 C-01 describe the same localStorage issue at lines 2437-2447 (merged). Chunk 1 #3 and Chunk 2 I-01 reference the same Supabase init at line 2430 (merged). All other findings are unique.

### Top 5 Most Critical Issues Requiring Immediate Attention

1. **CRIT-07 — Adaptive engine uses oldest checkins** (line 5370). One-line fix (`slice(0,5)` → `slice(-5)`). All adaptive calorie adjustments based on stale first-week data.
2. **CRIT-06 — Body composition shift computed but discarded** (lines 5302-5304). Users entitled to calorie adjustments never receive them.
3. **CRIT-12/13/14/15 — Null dereferences across entire boot path** (lines 9680, 9690, 10247, 9739, 9807). If any gate element missing, permanent black screen.
4. **CRIT-11 — Notification timer chain memory leak** (lines 9348-9362). Unbounded recursive setTimeout drains battery on mobile.
5. **CRIT-09 — IBS breakfast includes high-FODMAP hummus** (line 7045). Nutrition safety: contradicts clinical constraint.

### Overall Risk Assessment

**Risk Level: HIGH** — Significant issues across three dimensions:
- **Data Integrity:** Body comp shift discarded, adaptive engine using wrong data, render functions mutating persisted state, paywall bypass.
- **Stability:** Pervasive localStorage without try/catch crashes in private browsing. Null dereferences in boot path cause black screens. Memory leaks in notification system.
- **Performance:** 10,798-line monolithic HTML with ~880 lines inline CSS, synchronous SDK loading, repeated DOM queries slow first-paint on mobile.

The codebase shows sophisticated nutrition science (evidence-based BMR hierarchy, TEF-aware distribution, FODMAP filtering, coprime meal rotation) but is undermined by defensive coding gaps and the monolithic architecture.
---

## CRITICAL Findings

### CRIT-01: localStorage without try/catch in `_checkTrendLocal()`
- **Location:** Lines 2437-2447
- **Source:** Chunk 1 (#2) / Chunk 2 (C-01) — merged
- **Problem:** `localStorage.getItem/setItem` outside try/catch. In Safari private browsing or quota exceeded, throws `SecurityError`/`QuotaExceededError`.
- **Impact:** Crashes trend access check. `trendAccess` stays at optimistic default → permanent free premium access. Can cause white screen at boot.
- **Fix:** Wrap body in try/catch, return trial fallback on error.

### CRIT-02: localStorage.removeItem without try/catch in `checkTrendAccess()`
- **Location:** Line 2476
- **Source:** Chunk 2 (C-02)
- **Problem:** `localStorage.removeItem('ik_trend_active')` without try/catch when grace expires.
- **Impact:** In private browsing, throws before returning expired state → user keeps grace access indefinitely.
- **Fix:** `try{localStorage.removeItem('ik_trend_active');}catch{}`

### CRIT-03: localStorage without try/catch in auth state listener
- **Location:** Lines 3135, 3146, 3148-3151
- **Source:** Chunk 2 (C-03)
- **Problem:** `localStorage.getItem('ik_auth_origin')` and `getItem('ik_pending_checkout_plan')` in `_initAuthListener`.
- **Impact:** Auth handler crashes → user signs in via Google but app never processes it. Stuck on auth screen.
- **Fix:** Wrap all localStorage reads with try/catch or use `lsR()` helper.

### CRIT-04: localStorage without try/catch in `_resumePostOnboardingOrBoot()`
- **Location:** Lines 3162, 3174
- **Source:** Chunk 2 (C-04)
- **Problem:** localStorage reads at boot without try/catch.
- **Impact:** In private browsing, boot sequence crashes → black screen. No fallback.
- **Fix:** Wrap function body in try/catch falling back to `_bootAfterGates()`.

### CRIT-05: Silent failures in Stripe success redirect polling
- **Location:** Lines 3214, 3235
- **Source:** Chunk 2 (C-05)
- **Problem:** IIFE polling loop has empty catches. Supabase queries fail repeatedly, user sees "Payment still processing" after 60s.
- **Impact:** User pays but app never confirms activation. No Sentry, no toast, no retry.
- **Fix:** Log errors in catch, show toast after loop exhausts.

### CRIT-06: Body composition shift computed but discarded
- **Location:** Lines 5302-5304
- **Source:** Chunk 3 (C1)
- **Problem:** `calcMacros()` computes `_k`, calls `getBodyCompShift()` and adds `bcs.shift` to local `kcal`, but `_result` uses stale `_k`. Shift computed and immediately lost. `_bcMsg` declared but never used.
- **Impact:** Users entitled to body-composition calorie adjustment never see it in macros/meal plan.
- **Fix:** Apply `bcs.shift` to `_k` before constructing `_result`.

### CRIT-07: Adaptive engine uses oldest checkins instead of most recent
- **Location:** Line 5370
- **Source:** Chunk 3 (C2)
- **Problem:** `arr.slice(0, 5)` takes first 5 elements (oldest). Checkins appended over time.
- **Impact:** Adaptive suggestions based on first-week data, not recent trends. Inappropriate calorie adjustments throughout user journey.
- **Fix:** Change to `arr.slice(-5)` — one-line fix.

### CRIT-08: FOOD_ALIASES typo breaks tonno lookup
- **Location:** Line 6593
- **Source:** Chunk 4 (C1)
- **Problem:** Alias target `'tonno sott olio'` missing apostrophe. Should match FOOD_DB key `'tonno sott'olio'` at line 6535.
- **Impact:** Italian users typing "tonno olio" get unrecognized food classification.
- **Fix:** Change to `'tonno olio':'tonno sott\'olio'` or directly to `'tonno'`.

### CRIT-09: IBS breakfast includes high-FODMAP hummus
- **Location:** Line 7045
- **Source:** Chunk 4 (C2)
- **Problem:** IBS-safe breakfast path includes hummus (marked `fodmap:true` in FOOD_DB line 6506). `buildBreakfast` does not FODMAP-filter hardcoded templates.
- **Impact:** IBS users receive dietary advice contradicting their clinical constraint.
- **Fix:** Replace hummus with FODMAP-safe alternative (tofu spread, olive tapenade without garlic).

### CRIT-10: `_renderProfileCard` mutates persisted state during render
- **Location:** Lines 8474-8482
- **Source:** Chunk 4 (C3)
- **Problem:** Render function mutates `prof` object and writes to `localStorage`. If `calculateUserMacros` returns stale values, silently corrupts profile. Non-idempotent.
- **Impact:** Silent profile corruption. Calling render twice produces different results.
- **Fix:** Extract BMR migration logic to separate function called once during `mountApp()`.

### CRIT-11: Notification timer chain memory leak
- **Location:** Lines 9348-9362 (`scheduleLocalReminder`)
- **Source:** Chunk 5 (C1)
- **Problem:** `setTimeout` callback re-invokes `scheduleLocalReminder()` after firing, creating unbounded recursive chain. Boot IIFE re-arms all schedules on every page load.
- **Impact:** Memory leak grows. Orphaned timers on long-lived PWA sessions. Battery drain on mobile.
- **Fix:** Store timeout IDs in module-level map, clear before re-arming.

### CRIT-12: Null dereference in `showOnb()` / `mountApp()` boot path
- **Location:** Lines 9680, 9690
- **Source:** Chunk 5 (C2)
- **Problem:** `getElementById` results used without null checks during boot.
- **Impact:** Complete app failure — black screen. Watchdog may recover after 4s blank.
- **Fix:** Guard each `getElementById` with null check.

### CRIT-13: Null dereference in entry point IIFE
- **Location:** Line 10247
- **Source:** Chunk 5 (C3)
- **Problem:** `getElementById('lang-gate')` without null check in main entry point.
- **Impact:** Complete black screen on first launch. No watchdog recovery.
- **Fix:** Guard with null check before `classList.add('on')`.

### CRIT-14: Null dereference in `toast()` / `showToast()`
- **Location:** Lines 9739, 9740
- **Source:** Chunk 5 (C4)
- **Problem:** `getElementById('toast')` used without null check. Toast is global error reporting mechanism.
- **Impact:** Calling `toast()` when element missing throws uncaught exception, masking original error.
- **Fix:** Add `if(!t)return;` guard.

### CRIT-15: `gdprAccept()` null dereference
- **Location:** Line 9807
- **Source:** Chunk 5 (C5)
- **Problem:** `getElementById('gdpr-gate')` without null check on GDPR acceptance path — every new user.
- **Impact:** If element missing, user stuck on consent screen forever.
- **Fix:** Guard with null check.
---

## HIGH Findings

### HIGH-01: Duplicate element ID `notif-perm-btn`
- **Location:** Lines 1854 and 2162
- **Source:** Chunk 1 (#1)
- **Problem:** Two `<button>` elements share `id="notif-perm-btn"`. HTML spec requires unique IDs.
- **Impact:** Notification permission targets wrong button (hidden one), no visible feedback.
- **Fix:** Remove hidden duplicate or give unique ID.

### HIGH-02: Supabase SDK loaded synchronously in `<head>`
- **Location:** Line 929
- **Source:** Chunk 1 (#8)
- **Problem:** Supabase SDK (~200KB) loaded WITHOUT `async` or `defer`. Blocks first paint.
- **Impact:** ~200KB synchronous download + parse on critical path. 1-3s delay on slow 3G.
- **Fix:** Add `defer`, restructure `sb` init to run after `DOMContentLoaded`.

### HIGH-03: Race condition — `initTrend()` and `_bootAfterGates()` concurrent
- **Location:** Lines 3134, 3139, 3142
- **Source:** Chunk 2 (H-01)
- **Problem:** Auth listener calls both without awaiting `initTrend()`.
- **Impact:** UI renders before trend access resolved → flash of incorrect paywall state.
- **Fix:** Await `initTrend()` before `_bootAfterGates()`.

### HIGH-04: Silent DB error swallowing in `syncUserAfterLogin()`
- **Location:** Lines 3107, 3116
- **Source:** Chunk 2 (H-02)
- **Problem:** `.catch(()=>({data:null}))` converts all DB errors to "no data".
- **Impact:** Paid user's subscription misread as missing → new trial created instead.
- **Fix:** Log error before fallback.

### HIGH-05: Empty catch in `_prefetchSession()`
- **Location:** Line 2840
- **Source:** Chunk 2 (H-03)
- **Problem:** `.catch(()=>{})` silently discards session refresh failure.
- **Impact:** `_cachedSession` stays null → checkout proceeds without valid session → login gate loop.
- **Fix:** Add console.warn logging.

### HIGH-06: Empty catch blocks on Sentry calls
- **Location:** Lines 2889, 2893, 2904, 2992, 3248, 3253
- **Source:** Chunk 2 (H-04)
- **Problem:** `try{Sentry.captureException(...);}catch{}` throughout billing code.
- **Impact:** If Sentry consistently fails, no one knows.
- **Fix:** Add `console.warn` fallback in catches.

### HIGH-07: `updateTrendBadge()` shows toast repeatedly
- **Location:** Line 2700
- **Source:** Chunk 2 (H-05)
- **Problem:** `showToast(...)` called every time badge updates during grace period.
- **Impact:** Repeated warning toasts on every tab switch/settings render.
- **Fix:** Show once in `initTrend()` when grace first detected.

### HIGH-08: `_clientSideCheckout()` is dead code failing in live mode
- **Location:** Lines 2937-2996
- **Source:** Chunk 2 (H-06)
- **Problem:** Uses deprecated `stripe.redirectToCheckout` disabled in live mode.
- **Impact:** If called, user sees Stripe error page.
- **Fix:** Remove or add guard.

### HIGH-09: `openAuthModal()` uses `prompt()`, lacks error handling
- **Location:** Lines 3025-3032
- **Source:** Chunk 2 (H-07)
- **Problem:** Browser `prompt()` blocked in iframe. `signInWithOtp` exceptions uncaught.
- **Impact:** Silent failure in iframe contexts.
- **Fix:** Wrap in try/catch, replace `prompt()` with modal.

### HIGH-10: Empty catches swallow session errors in `_resumePostOnboardingOrBoot()`
- **Location:** Lines 3185, 3199
- **Source:** Chunk 2 (H-08)
- **Problem:** Two empty catches: OAuth session resumption and `getSession`.
- **Impact:** Transient network error → user shown onboarding again or auth gate.
- **Fix:** Check for network errors, show toast, retry.

### HIGH-11: Race in `initTrend()` — badge flicker between two async calls
- **Location:** Lines 2500-2525
- **Source:** Chunk 2 (H-09)
- **Problem:** `getUser()` → badge update → `checkTrendAccess()` → badge update again.
- **Impact:** Visible flash of incorrect trial state before server response.
- **Fix:** Skip first badge update if user is logged in.

### HIGH-12: `syncUserAfterLogin()` calls `updateTrendBadge()` outside try/catch
- **Location:** Line 3124
- **Source:** Chunk 2 (H-10)
- **Problem:** Called after the try/catch block. If `trendAccess` partially set, badge may reference undefined properties.
- **Impact:** Potential null dereference.
- **Fix:** Move inside the try block.

### HIGH-13: Auto-adjust banner icon lookup uses wrong map keys
- **Location:** Lines 5450, 5455, 5465
- **Source:** Chunk 3 (H1)
- **Problem:** `_autoAdjIconMap` keyed by emoji strings, but `icons` object maps reason strings to different Material Symbol names. Only 'bolt' works correctly.
- **Impact:** `slow_loss` shows generic "tune" icon, `maintain_drift` shows "tune" instead of "balance".
- **Fix:** Use icon name directly since it IS a valid Material Symbol.

### HIGH-14: `lsS()` reads localStorage outside try/catch
- **Location:** Line 5214
- **Source:** Chunk 3 (H2)
- **Problem:** `const _prev = localStorage.getItem(k)` executed before the try block.
- **Impact:** Any state save operation crashes silently in private browsing — data loss.
- **Fix:** Move into try/catch block.

### HIGH-15: `renderRealTDEE()` missing `requireTrend()` paywall gate
- **Location:** Lines 5717-5741
- **Source:** Chunk 3 (H3)
- **Problem:** Displays real TDEE data without `requireTrend()` gate. Every other trend feature is gated.
- **Impact:** Free-tier users can see premium TDEE data without subscription.
- **Fix:** Wrap in `requireTrend(() => { ... }, 'Real TDEE', true)`.

### HIGH-16: Multiple empty catch blocks silently swallow errors
- **Location:** Lines 4535-4536, 5229, 5230, 5353, 5368, 5673
- **Source:** Chunk 3 (H4)
- **Problem:** At least 6 `catch{}` blocks with no logging: `lsW` write failure, toast failure, rollback failure, checkin parse, adaptive engine, chart destroy.
- **Impact:** Storage errors, chart failures, data corruption invisible to user and developer.
- **Fix:** Add `console.warn` or Sentry breadcrumb in each.

### HIGH-17: Duplicate FOOD_ALIASES keys — last-wins silent overrides
- **Location:** Lines 6540 vs 6597, 6558 vs 6627, 6490 vs 6667, 6526
- **Source:** Chunk 4 (H1)
- **Problem:** JavaScript object literals silently overwrite duplicate keys. `'ceci'` and `'banana'` have conflicting mappings (generic vs specific).
- **Impact:** Currently works (last-wins is correct) but fragile — reordering could break behavior.
- **Fix:** Remove generic mappings for keys with specific entries. Remove self-mapping aliases.

### HIGH-18: Hardcoded Italian strings despite i18n system
- **Location:** Lines 7491-7494, 7957, 8000-8001, 8248, 8331, 8403, 8417, 8429, 8457, 8535
- **Source:** Chunk 4 (H2)
- **Problem:** Multiple UI-visible strings hardcoded in Italian/English instead of using `t()` function.
- **Impact:** English-language users see Italian text in these locations.
- **Fix:** Systematic i18n pass to add translation keys for all listed lines.

### HIGH-19: Meal distribution map duplicated 3× (DRY violation)
- **Location:** Lines 6815-6820, 8260, 8283
- **Source:** Chunk 4 (H3)
- **Problem:** `const dist={2:[0.45,0.55],3:[0.25,0.40,0.35],...}` defined identically in three places.
- **Impact:** Any change must be applied in all three locations.
- **Fix:** Extract to shared constant: `const MEAL_DIST = {...}`.

### HIGH-20: `buildBreakfast` has no FODMAP/allergen filtering on hardcoded meals
- **Location:** Lines 7031-7085
- **Source:** Chunk 4 (H4)
- **Problem:** Hardcoded meal templates bypass the CSP filter used in `generatePersonalizedPlan()`. None check individual `excluded` allergens.
- **Impact:** Users with specific allergen exclusions may receive breakfasts containing excluded foods.
- **Fix:** Add runtime filter validating hardcoded breakfast ingredients against user's exclusion list.

### HIGH-21: Onboarding trial start bypasses storage helpers
- **Location:** Line 7575
- **Source:** Chunk 4 (H5)
- **Problem:** `localStorage.setItem('ik_trial_start', Date.now().toString())` uses direct call instead of `lsS()`/`lsW()`.
- **Impact:** Bypasses storage abstraction, no error handling for private browsing.
- **Fix:** Use `lsW('ik_trial_start', Date.now().toString())`.

### HIGH-22: Unguarded `localStorage.setItem` in `acknowledgedPWA()`
- **Location:** Line 10043
- **Source:** Chunk 5 (H1)
- **Problem:** `localStorage.setItem('ik_pwa_seen','1')` has no try/catch.
- **Impact:** Safari private browsing crashes on PWA gate, cannot proceed.
- **Fix:** Wrap in try/catch.

### HIGH-23: Null dereference in `selectLang()` boot gate
- **Location:** Line 10186
- **Source:** Chunk 5 (H2)
- **Problem:** `getElementById('lang-gate')` without null check during language selection.
- **Impact:** Crashes on language selection if element missing.
- **Fix:** Guard with null check.

### HIGH-24: Null dereference in `acknowledgedPWA()` boot path
- **Location:** Line 10044
- **Source:** Chunk 5 (H3)
- **Problem:** `getElementById('pwa-gate')` without null check in boot path.
- **Impact:** Boot sequence crash if element missing.
- **Fix:** Guard with null check.

### HIGH-25: `runAutoAdjustEngine()` silent failure
- **Location:** Lines 8693, 9714
- **Source:** Chunk 5 (H4)
- **Problem:** `try{runAutoAdjustEngine();}catch(e){}` — error silently swallowed with no logging.
- **Impact:** Silent macro adjustment failure. Users may eat wrong calories for weeks.
- **Fix:** Log the error: `catch(e){console.warn('[IK] autoAdjust error',e);}`

### HIGH-26: `JSON.parse` without try/catch in `regenSingleMeal`
- **Location:** Line 9080
- **Source:** Chunk 5 (H5)
- **Problem:** `JSON.parse(localStorage.getItem(SK.checkins)||'[]')` — no try/catch.
- **Impact:** Corrupted checkins data crashes entire meal regeneration.
- **Fix:** Wrap in try/catch with fallback to `[]`.

### HIGH-27: `JSON.parse` without try/catch in `updateNotifUI()`
- **Location:** Line 9375
- **Source:** Chunk 5 (H6)
- **Problem:** `JSON.parse(localStorage.getItem('ik_notif_schedule')||'{}')` — no try/catch.
- **Impact:** Corrupted schedule data crashes notification UI.
- **Fix:** Wrap in try/catch.

### HIGH-28: Referral `refreshSession` error silently swallowed
- **Location:** Line 9570
- **Source:** Chunk 5 (H8)
- **Problem:** `try{...await sb.auth.refreshSession();...}catch{}` — stale token used on failure.
- **Impact:** Referral section shows generic error instead of prompting re-login.
- **Fix:** Log refresh failure and handle 401 in fetch response.
---

## MEDIUM Findings

### MED-01: Supabase client creation silently swallows errors
- **Location:** Line 2430
- **Source:** Chunk 1 (#3) / Chunk 2 (I-01) — merged
- **Problem:** `const sb=(()=>{try{return supabase.createClient(...);}catch{return null;}})();` — bare catch with no logging.
- **Impact:** If Supabase CDN blocked, auth/sync/billing fail silently with no debug info.
- **Fix:** Add error logging: `catch(e){console.error('[IK] Supabase init failed:',e);return null;}`

### MED-02: Stripe live publishable key hardcoded without env toggle
- **Location:** Line 2427
- **Source:** Chunk 1 (#4)
- **Problem:** `const STRIPE_PK='pk_live_...';` hardcoded. No environment-based switching.
- **Impact:** Real Stripe API calls with live keys during development.
- **Fix:** Use environment detection to switch between `pk_live_` and `pk_test_`.

### MED-03: Sentry SDK loaded synchronously in `<head>`
- **Location:** Line 932
- **Source:** Chunk 1 (#9)
- **Problem:** Sentry SDK loaded without `async` or `defer`. Non-critical for UX.
- **Impact:** Adds ~50-100ms to first paint.
- **Fix:** Add `defer` attribute.

### MED-04: Material Symbols icon font render-blocking
- **Location:** Line 19
- **Source:** Chunk 1 (#10)
- **Problem:** Google Material Symbols CSS loaded synchronously. Main fonts use async pattern but icon font doesn't.
- **Impact:** Icon font download blocks rendering on slow connections.
- **Fix:** Apply async pattern: `media="print" onload="this.media='all'"`.

### MED-05: Large inline CSS bloat (~880 lines)
- **Location:** Lines 22-900
- **Source:** Chunk 1 (#11)
- **Problem:** Entire design system inlined. ~30KB re-downloaded on every page load.
- **Impact:** No browser cache benefit. Increases TTFB and page weight.
- **Fix:** Extract CSS to external file. Keep small critical-above-fold subset inline.

### MED-06: `sanitize()` creates DOM element on every call
- **Location:** Line 3268
- **Source:** Chunk 2 (M-01)
- **Problem:** `document.createElement('div')` on every call. No reuse.
- **Impact:** Minor GC pressure on frequent calls.
- **Fix:** Cache the element at module level.

### MED-07: `updateSubManagementCard()` thrashes innerHTML
- **Location:** Lines 2546-2547, 2589-2602, 2617-2622, 2638-2643, 2656-2669
- **Source:** Chunk 2 (M-02)
- **Problem:** `ctaWrap.innerHTML=...` with template literals containing inline SVG and onclick handlers.
- **Impact:** Expensive DOM recalculation. Event listeners not properly cleaned.
- **Fix:** Use `createElement` + `appendChild` or cache rendered states.

### MED-08: `_applyCheckoutPreviewLang()` queries DOM 20+ times sequentially
- **Location:** Lines 2793-2830
- **Source:** Chunk 2 (M-03)
- **Problem:** 20+ individual `getElementById()` calls in sequence.
- **Impact:** Unnecessary layout thrash.
- **Fix:** Cache element references or use querySelectorAll.

### MED-09: Multiple `getElementById` calls in `initTrend()` without caching
- **Location:** Lines 2505-2518
- **Source:** Chunk 2 (M-04)
- **Problem:** 6 separate `getElementById` calls.
- **Impact:** Minor perf hit on every trend init.
- **Fix:** Cache references at module level.

### MED-10: `openBillingPortal()` sequential awaits fail silently
- **Location:** Lines 2998-3023
- **Source:** Chunk 2 (M-05)
- **Problem:** Each step can fail. `res.json().catch(()=>({}))` silently returns empty object.
- **Impact:** Server error message lost. User sees generic error.
- **Fix:** Log parsed error body before throwing.

### MED-11: `_doStartCheckout` fallback `window.open` in setTimeout
- **Location:** Line 2901
- **Source:** Chunk 2 (M-06)
- **Problem:** Fallback `window.open` after `location.href`. Could open duplicate tab.
- **Impact:** Duplicate tab or empty catch hides popup blocker errors.
- **Fix:** Remove setTimeout fallback or use `window.location.assign()`.

### MED-12: `selectCheckoutPlan()` doesn't handle lifetime plan in UI toggle
- **Location:** Lines 2769-2781
- **Source:** Chunk 2 (M-07)
- **Problem:** Only toggles monthly and annual elements. No lifetime element toggled.
- **Impact:** Lifetime plan selection may not show visual feedback.
- **Fix:** Add `cpo-lifetime` element toggle.

### MED-13: `closePaywall()` uses fixed setTimeout delays
- **Location:** Lines 2734-2738, 2762-2766
- **Source:** Chunk 2 (M-08)
- **Problem:** `setTimeout(()=>{...},350)` assumes CSS transition timing.
- **Impact:** Overlay disappears before animation completes, or feels sluggish.
- **Fix:** Listen for `transitionend` event.

### MED-14: Hardcoded i18n strings in `applyAutoAdj()` and `shareProgress()`
- **Location:** Lines 5482, 5748-5752
- **Source:** Chunk 3 (M1)
- **Problem:** Inline ternary operators for translations instead of `t()`.
- **Impact:** Inconsistent translations, no future language support.
- **Fix:** Add translation keys to dictionaries.

### MED-15: `localizeMealRest()` sorts 150+ keys on every call
- **Location:** Lines 6321-6326
- **Source:** Chunk 3 (M2)
- **Problem:** O(n log n) sort per invocation. Called for every meal on every render.
- **Impact:** CPU cost during meal rendering on low-end devices.
- **Fix:** Pre-sort keys once at module load.

### MED-16: Duplicate food label localization maps
- **Location:** Lines 6178-6207 and 6213-6319
- **Source:** Chunk 3 (M3)
- **Problem:** Two maps with largely the same translations.
- **Impact:** Maintenance burden, risk of translation drift.
- **Fix:** Extract single shared map.

### MED-17: `applyLang()` schedules redundant renders
- **Location:** Lines 4544-4554
- **Source:** Chunk 3 (M4)
- **Problem:** Many renderers scheduled twice on every language switch.
- **Impact:** Double rendering wastes CPU, causes visual flicker.
- **Fix:** Remove duplicate `scheduleRender` call in `setLang()`.

### MED-18: `getAdaptedMealDistribution()` fragile single-line function
- **Location:** Lines 5357-5359
- **Source:** Chunk 3 (M5)
- **Problem:** 1500+ char single-line function. Rounding drift can produce negative values.
- **Impact:** Edge cases may produce invalid distributions.
- **Fix:** Break into sub-functions, validate after each pass, clamp to min 0.05.

### MED-19: `t()` creates RegExp on every substitution
- **Location:** Line 4540
- **Source:** Chunk 3 (M6)
- **Problem:** `new RegExp(...)` compiled hundreds of times during translation pass.
- **Impact:** Unnecessary CPU overhead.
- **Fix:** Use `String.replaceAll()` or split/join.

### MED-20: Repeated `getElementById()` for same elements
- **Location:** Lines 4637-4641
- **Source:** Chunk 3 (M7)
- **Problem:** Same elements queried twice per line.
- **Fix:** Use `getEl()` helper.

### MED-21: `_logKey()` reads entire weight log on every cache check
- **Location:** Line 5261
- **Source:** Chunk 3 (M8)
- **Problem:** Expensive operation on every `getCachedPrediction()` call.
- **Fix:** Cache log key, invalidate on `saveLog`.

### MED-22: Inline CSS duplication in coach badge rendering
- **Location:** Lines 7810-7824, 7831-7834
- **Source:** Chunk 4 (M1)
- **Problem:** 5+ inline style properties set each render cycle.
- **Fix:** Extract to CSS classes.

### MED-23: `renderCoach` re-parses localStorage on every call
- **Location:** Line 7801
- **Source:** Chunk 4 (M2)
- **Problem:** `JSON.parse(localStorage.getItem(...))` on every render.
- **Fix:** Cache parsed data, invalidate on write.

### MED-24: Fragile button selector in `runCalcAndGenerate`
- **Location:** Line 7460
- **Source:** Chunk 4 (M3)
- **Problem:** Selector depends on exact onclick attribute string.
- **Fix:** Use an `id` instead.

### MED-25: PHASE_HINTS recreated on every `renderSettings()`
- **Location:** Line 8457
- **Source:** Chunk 4 (M4)
- **Problem:** Large inline object allocated every call.
- **Fix:** Extract to module scope.

### MED-26: `resetT()` builds HTML from parameter
- **Location:** Line 8004
- **Source:** Chunk 4 (M5)
- **Problem:** Interpolates `tp` into onclick string. Currently safe but fragile.
- **Fix:** Use `createElement` with `addEventListener`.

### MED-27: kcal Ring constants potentially inconsistent
- **Location:** Lines 8300, 8325
- **Source:** Chunk 4 (M6)
- **Problem:** `KCAL_CIRC = 552.9` seems very large for SVG ring.
- **Fix:** Verify against actual SVG `r` attribute.

### MED-28: Check-in feedback overlapping conditions
- **Location:** Lines 7658-7679
- **Source:** Chunk 4 (M7)
- **Problem:** Condition 6d is superset of 6c. Intentional but unclear.
- **Fix:** Use explicit range checks.

### MED-29: Two separate confirm modal implementations
- **Location:** Lines 8543-8556 vs 8565-8585
- **Source:** Chunk 4 (M8)
- **Problem:** Overlapping naming (`openConfirmModal` vs `showConfirm`).
- **Fix:** Consolidate into one.

### MED-30: `_doResetProfile` doesn't reset all in-memory state
- **Location:** Lines 8619-8624
- **Source:** Chunk 4 (M9)
- **Problem:** Missing reset of `selDay`, `_mealRenderCache`, `_regenSeed`, `_tabDirty`, `activeTab`.
- **Impact:** Stale values persist after reset.
- **Fix:** Reset all in-memory state variables.

### MED-31: Silent catches in import backup (multiple)
- **Location:** Lines 8848-8856, 8876, 8886, 8894
- **Source:** Chunk 5 (M2)
- **Problem:** Empty catches during import. Partial writes possible.
- **Impact:** App crash on next boot with half-imported data.
- **Fix:** Track failed writes and report.

### MED-32: `renderChart` double requestAnimationFrame
- **Location:** Line 8744
- **Source:** Chunk 5 (M3)
- **Problem:** Double-nested RAF delays rendering by ~33ms.
- **Fix:** Use single RAF.

### MED-33: Shopping list category detection fragile
- **Location:** Lines 9160-9187
- **Source:** Chunk 5 (M4)
- **Problem:** Italian-language string matching. English names default to 'altro'.
- **Fix:** Use FOOD_DB metadata.

### MED-34: Tab switch race condition
- **Location:** Lines 9494-9496
- **Source:** Chunk 5 (M5)
- **Problem:** Async operations not awaited during rapid tab switch.
- **Fix:** Use `scheduleRender` batch consistently.

### MED-35: `updateAdherenceCalendar` reads `selDay` without guard
- **Location:** Line 9462
- **Source:** Chunk 5 (M6)
- **Problem:** Global `selDay` could be undefined before mount.
- **Fix:** Guard: `const day=selDay||1;`

### MED-36: Onboarding slideshow innerHTML from textContent
- **Location:** Line 10147
- **Source:** Chunk 5 (M7)
- **Problem:** Takes safe textContent, sets as innerHTML.
- **Fix:** Use split/join approach.

### MED-37: Silent catches in Chart.js destroy
- **Location:** Lines 8734, 8760, 8778
- **Source:** Chunk 5 (M8)
- **Problem:** Chart destroy errors swallowed.
- **Fix:** Add minimal logging.

### MED-38: `changeDiet()` doesn't clear all state
- **Location:** Lines 8670-8674
- **Source:** Chunk 5 (M9)
- **Problem:** Doesn't reset `prefState`/`profState` in memory.
- **Impact:** Old onboarding values shown after diet change.
- **Fix:** Reset in-memory state.

### MED-39: `renderProgressStats` sort unreliable
- **Location:** Lines 8697, 8699, 8719, 8773
- **Source:** Chunk 5 (M10)
- **Problem:** String comparison on ISO dates. No `return 0` for equal dates.
- **Impact:** Wrong delta if dates malformed.
- **Fix:** Use `localeCompare` for proper date comparison.
### MED-40: `_bootAfterLangGate` called twice on watchdog recovery
- **Location:** Lines 10280-10281
- **Source:** Chunk 5 (M11)
- **Problem:** Watchdog resets `booted=false` then calls `_bootAfterLangGate()` again. Also removes `ik_pwa_seen` forcing PWA gate to show again.
- **Impact:** User may see PWA gate again after watchdog recovery.
- **Fix:** Don't remove `ik_pwa_seen` in watchdog.

### MED-41: Adherence calendar division by zero
- **Location:** Line 9432
- **Source:** Chunk 5 (M12)
- **Problem:** `(dayData.meals||0)/(dayData.total||3)` — if `total` is explicitly `0`, result is `Infinity` or `NaN`.
- **Impact:** Calendar CSS class logic fails.
- **Fix:** Guard denominator: `const adherence=(dayData.total||3)>0?(dayData.meals||0)/(dayData.total||3):0;`

### MED-42: Privacy Policy / FAQ HTML not internationalized
- **Location:** Lines 10294-10679 (Privacy), 10551-10658 (FAQ)
- **Source:** Chunk 5 (M13)
- **Problem:** Hardcoded Italian text in HTML. No `data-i18n` attributes on most elements.
- **Impact:** English users see Italian privacy policy and FAQ.
- **Fix:** Add `data-i18n` attributes or generate dynamically from i18n dictionaries.

---

## LOW Findings

### LOW-01: CSS `.scr` class defined twice with conflicting properties
- **Location:** Lines 61 and 750-753
- **Source:** Chunk 1 (#5)
- **Problem:** `.scr` declared at line 61 (positioning) and again at line 750 (opacity/transition).
- **Impact:** Maintainability issue. No runtime bug.
- **Fix:** Merge into one declaration.

### LOW-02: CSS `.btn-xs` defined twice
- **Location:** Lines 102 and 784-794
- **Source:** Chunk 1 (#7)
- **Problem:** First definition at line 102 is effectively dead CSS; second is a superset.
- **Impact:** Wastes bytes, confuses maintainers.
- **Fix:** Remove first declaration.

### LOW-03: Inline `onclick` handlers throughout HTML
- **Location:** Lines 955-2160 (50+ inline handlers)
- **Source:** Chunk 1 (#14)
- **Problem:** All buttons use inline `onclick` instead of `addEventListener`. Functions must be globally scoped.
- **Impact:** Maintainability and debugging difficulty. Harder to detect duplicate bindings.
- **Fix:** Long-term: migrate to `addEventListener` with delegated events.

### LOW-04: `onerror` handler on avatar images doesn't handle re-attachment
- **Location:** Lines 1076 and 1875
- **Source:** Chunk 1 (#15)
- **Problem:** `onerror="this.style.display='none'"` permanently hides image if initial load fails. No retry mechanism.
- **Impact:** Avatar stays hidden until full page reload.
- **Fix:** Show fallback icon and allow re-attempt when URL changes.

### LOW-05: `APP_VERSION` mismatch
- **Location:** Line 2416
- **Source:** Chunk 2 (L-01)
- **Problem:** `const APP_VERSION='1.5.0'` but HTML shows "Versione 2.0.0".
- **Impact:** Version confusion in debugging/support.
- **Fix:** Align versions or use APP_VERSION in display.

### LOW-06: `SUPABASE_KEY` (anon/public key) hardcoded in source
- **Location:** Line 2425
- **Source:** Chunk 2 (L-02)
- **Problem:** Anon key embedded in client-side HTML. Expected for Supabase.
- **Impact:** Informational — Supabase anon keys are designed to be public.
- **Fix:** Ensure RLS policies are strict.

### LOW-07: `STRIPE_PK` (publishable key) hardcoded
- **Location:** Line 2427
- **Source:** Chunk 2 (L-03)
- **Problem:** Stripe publishable key embedded in HTML.
- **Impact:** Informational — publishable keys are designed to be public.
- **Fix:** No action required.

### LOW-08: i18n dictionaries ~1000 lines inline data
- **Location:** Lines 3279-4320
- **Source:** Chunk 2 (L-04)
- **Problem:** Massive inline objects parsed at script load time.
- **Impact:** Slight delay in script parsing.
- **Fix:** Consider extracting to separate JSON files loaded on demand.

### LOW-09: Double `requestAnimationFrame` in `setRing()`
- **Location:** Line 2567
- **Source:** Chunk 2 (L-05)
- **Problem:** `requestAnimationFrame(()=>{requestAnimationFrame(()=>{...})})` — unnecessary double wrapping.
- **Impact:** Unnecessary frame delay.
- **Fix:** Use single RAF.

### LOW-10: localStorage accessed directly without helpers
- **Location:** Line 5056
- **Source:** Chunk 3 (L1)
- **Problem:** `localStorage.getItem('ik_notif_perm')` called directly without try/catch.
- **Impact:** Crashes in private browsing.
- **Fix:** Use `lsR('ik_notif_perm')`.

### LOW-11: `_offscreen` defer uses `requestIdleCallback` without proper timeout fallback
- **Location:** Line 5174
- **Source:** Chunk 3 (L2)
- **Problem:** `setTimeout` fallback receives `{timeout:300}` object as second arg instead of delay number.
- **Impact:** Immediate execution instead of 300ms delay on browsers without rIC.
- **Fix:** Use conditional scheduling function.

### LOW-12: `Notification` permission checked without feature detection
- **Location:** Line 5056
- **Source:** Chunk 3 (L3)
- **Problem:** No validation of stored permission value against known states.
- **Fix:** Validate against 'granted', 'denied', 'default'.

### LOW-13: `calcSynergyScore` keyword matching assumes lowercase
- **Location:** Lines 5517-5528
- **Source:** Chunk 3 (L4)
- **Problem:** Depends on all keywords being lowercase. Defensive coding issue.
- **Fix:** Add `.toLowerCase()` or document invariant.

### LOW-14: `generateWeeklyReport()` iterates 7 days calling lsR in loop
- **Location:** Lines 5770-5776
- **Source:** Chunk 3 (L5)
- **Problem:** 35 localStorage reads per weekly report generation.
- **Impact:** Minor performance overhead.
- **Fix:** Accept as reasonable for weekly frequency.

### LOW-15: Dead code: `chartRealEl` assigned but never used
- **Location:** Line 5044
- **Source:** Chunk 3 (L6)
- **Problem:** Unused variable.
- **Fix:** Remove.

### LOW-16: Self-referencing FOOD_ALIASES add noise
- **Location:** Lines 6526, 6531, 6532, 6537, 6538, etc.
- **Source:** Chunk 4 (L1)
- **Problem:** Many aliases map to themselves (`'platessa':'platessa'`).
- **Impact:** Unnecessary bytes.
- **Fix:** Remove self-mapping aliases.

### LOW-17: `_regenSeed` used but not defined in visible scope
- **Location:** Lines 7019, 7028
- **Source:** Chunk 4 (L2)
- **Problem:** Referenced in `buildSnack()` and `buildBreakfast()` but declaration outside chunk.
- **Fix:** Verify initialization before first use.

### LOW-18: CSS.escape usage without polyfill check
- **Location:** Line 8123
- **Source:** Chunk 4 (L3)
- **Problem:** Not supported in all browsers.
- **Fix:** Add polyfill or fallback.

### LOW-19: `_mealRenderCache` invalidation incomplete
- **Location:** Lines 7899, 8032
- **Source:** Chunk 4 (L4)
- **Problem:** Not reset when modifier changes or refeed toggled.
- **Impact:** Stale meal content after changes.
- **Fix:** Reset cache on modifier/refeed change.

### LOW-20: Salt tracker hardcoded SMAX=6g
- **Location:** Line 7964
- **Source:** Chunk 4 (L5)
- **Problem:** DASH users have lower sodium target.
- **Fix:** Adjust based on `prof.sodiumMax`.

### LOW-21: `getBodyCompShift` direction inconsistent with `analyzeState`
- **Location:** Line 7762
- **Source:** Chunk 4 (L7)
- **Problem:** Two functions use opposite sign conventions for waist delta.
- **Impact:** Maintenance hazard.
- **Fix:** Add comment block explaining convention.

### LOW-22: No-op Service Worker message listener
- **Location:** Line 9975
- **Source:** Chunk 5 (L1)
- **Problem:** `navigator.serviceWorker.addEventListener('message',()=>{})` — empty listener.
- **Fix:** Remove or implement handling.

### LOW-23: `localStorage.getItem` iteration in `updateConsentUI` may be slow
- **Location:** Lines 9880-9884
- **Source:** Chunk 5 (L2)
- **Problem:** Iterates all localStorage keys to calculate storage size on every modal open.
- **Fix:** Cache result, recalculate on data change.

### LOW-24: `lazyLoadChartJs` doesn't handle load errors
- **Location:** Lines 9933-9940
- **Source:** Chunk 5 (L3)
- **Problem:** No `onerror` handler on dynamically created script. CDN failure = charts never render.
- **Fix:** Add `s.onerror=()=>console.warn('Chart.js CDN failed');`

### LOW-25: Entry-point IIFE stale checkout cleanup is aggressive
- **Location:** Lines 10235-10242
- **Source:** Chunk 5 (L4)
- **Problem:** Removes checkout state unconditionally. If user refreshes during Stripe redirect window, state lost.
- **Impact:** Rare — user might need to re-initiate checkout.
- **Fix:** Add timestamp check before removing.

### LOW-26: Service Worker `controllerchange` may cause infinite reload loop
- **Location:** Lines 9970-9973
- **Source:** Chunk 5 (L5)
- **Problem:** If broken SW triggers claim-reload loop, `_swReady` prevents first 2s but after that infinite reloads.
- **Impact:** User cannot use app.
- **Fix:** Add reload counter in sessionStorage to break after 3 rapid reloads.

### LOW-27: Referral CTA uses innerHTML with unsanitized i18n strings
- **Location:** Lines 9601, 9603, 9606
- **Source:** Chunk 5 (L6)
- **Problem:** Translation string interpolated into innerHTML.
- **Impact:** Low risk — translations controlled. Defense-in-depth recommends sanitization.
- **Fix:** Use `textContent` or sanitize.

---

## INFO / Positive Observations

### INFO-01: Empty CSS rule `#scr-prog.locked-trend{}`
- **Location:** Line 295
- **Source:** Chunk 1 (#6)
- **Note:** Dead code. No runtime impact. Remove for cleanliness.

### INFO-02: Splash fallback timer may conflict with main JS
- **Location:** Lines 923-926
- **Source:** Chunk 1 (#12)
- **Note:** Redundant but harmless 4s safety timer. Minor inefficiency.

### INFO-03: Chart.js lazy-loaded correctly
- **Location:** Line 21 (comment)
- **Source:** Chunk 1 (#13)
- **Note:** Good practice — no performance penalty for users who don't view charts.

### INFO-04: Supabase client graceful null pattern
- **Location:** Line 2430
- **Source:** Chunk 2 (I-01)
- **Note:** Good defensive pattern. All functions check `if(!sb)` before use.

### INFO-05: `trendInitPromise` used as gate
- **Location:** Lines 2499, 2709
- **Source:** Chunk 2 (I-02)
- **Note:** Functional but fragile. Consider async/await with explicit state tracking.

### INFO-06: Global unhandled rejection handler
- **Location:** Line 3246
- **Source:** Chunk 2 (I-03)
- **Note:** Good practice. Catches uncaught async errors. Sends to Sentry.

### INFO-07: `renderHelpFeatures()` uses `innerHTML` with `sanitize()`
- **Location:** Lines 4579-4588
- **Source:** Chunk 3 (I1)
- **Note:** Correctly sanitizes user-facing data. Good practice.

### INFO-08: GDPR gate i18n uses `innerHTML` with `sanitize()`
- **Location:** Lines 5161-5167
- **Source:** Chunk 3 (I2)
- **Note:** Properly uses `sanitize(t(...))` for rich content.

### INFO-09: visualViewport handler correctly uses RAF throttling
- **Location:** Lines 5875-5893
- **Source:** Chunk 3 (I3)
- **Note:** Well-implemented IIFE with RAF debounce for keyboard handling.

### INFO-10: TDEE engine follows evidence-based hierarchy
- **Location:** Lines 5981-6163
- **Source:** Chunk 3 (I4)
- **Note:** Proper 3-tier BMR hierarchy with sport-specific modulation, EA safety gate, clinical protocol overrides.

### INFO-11: Macro caching prevents unnecessary recomputation
- **Location:** Lines 5255-5306
- **Source:** Chunk 3 (I5)
- **Note:** `_macroCache`, `_predCache`, `_fpCache`, `_tdeeCache` with cache key validation. Good pattern.

### INFO-12: Privacy Policy HTML is ~200 lines static content
- **Location:** Lines 10294-10510
- **Source:** Chunk 5 (I1)
- **Note:** ~8KB added to initial load. Could be lazy-loaded.

### INFO-13: FAQ content hardcoded Italian
- **Location:** Lines 10551-10658
- **Source:** Chunk 5 (I2)
- **Note:** Only last FAQ item has `data-i18n`. Others rely on static HTML.

### INFO-14: Paywall/checkout HTML adds page weight
- **Location:** Lines 10702-10783, 10760-10783, 10787-10798
- **Source:** Chunk 5 (I3)
- **Note:** ~4KB for subscribed users who never see it.

### INFO-15: `sanitizeHistRow` generates inline HTML per entry
- **Location:** Lines 8714-8717
- **Source:** Chunk 5 (I4)
- **Note:** Could use event delegation for 100+ entry scenarios.

### INFO-16: `weeklyRate` sign convention is confusing
- **Location:** Lines 7128, 7131, 7185, 7238, 7255, 7268
- **Source:** Chunk 4 (H6)
- **Note:** Positive = weight LOSS. Counter-intuitive. Add comment block or rename to `weeklyLossRate`.
---

## Service Worker & Server Review

### sw.js (81 lines) — Service Worker v27

**Architecture:** Navigation-first with stale-while-revalidate for assets. No pre-caching during install.

**Positive observations:**
- Correctly avoids pre-caching (learned from v26 bug where slow installs caused black screens)
- Clean cache versioning strategy (`iron-kinetic-v27`)
- Proper `skipWaiting` + `clients.claim()` flow
- Removed problematic `SW_ACTIVATED` postMessage that caused reload loops
- External resources (CDN, Supabase, Stripe) correctly excluded from interception
- Offline fallback returns cached `index.html` as last resort

**Findings:**

| ID | Severity | Location | Problem |
|----|----------|----------|--------|
| SW-01 | LOW | L17 | `caches.open(CACHE).then(() => ...)` — empty cache opened but never used during install. The `then` resolves but the cache reference is discarded. No impact but wastes a microtask. |
| SW-02 | LOW | L57 | Navigation cache `put` is fire-and-forget (`caches.open(CACHE).then(c => c.put(req, res.clone()))`) — if the cache write fails, no error handling. Could leave cache stale. |
| SW-03 | LOW | L74 | Same fire-and-forget pattern for asset caching. |
| SW-04 | INFO | L62-63 | `caches.match('./index.html').then(r => r || caches.match('/'))` — double fallback is good but `caches.match('/')` returns the same entry as `./index.html` in most configurations. Redundant but safe. |
| SW-05 | MEDIUM | L38-47 | No request timeout — if origin server hangs, the fetch promise never resolves. Navigation request could hang indefinitely. Consider adding AbortController with 10s timeout. |

### server.js (31 lines) — Express static server

**Architecture:** Minimal Express server with cache headers and SPA fallback.

**Positive observations:**
- Correct no-cache headers for `sw.js` and `index.html` (prevents stale SW)
- `Service-Worker-Allowed: /` header correctly set
- Long-term cache (1 year, immutable) for static assets
- SPA fallback to `index.html` for all unmatched routes

**Findings:**

| ID | Severity | Location | Problem |
|----|----------|----------|--------|
| SRV-01 | MEDIUM | L16 | `max-age=31536000, immutable` for ALL non-index/sw assets — if a JS, CSS, or image file changes, users won't see the update until cache expires or they hard-refresh. Since the app is a single `index.html`, this only affects `manifest.webmanifest` and icons, which rarely change. Acceptable but should be documented. |
| SRV-02 | LOW | L25-26 | SPA fallback sends `index.html` for ALL unmatched routes, including paths like `/favicon.ico` or `/robots.txt`. Should exclude known static file extensions. |
| SRV-03 | INFO | — | No compression middleware (gzip/brotli). The 10,798-line `index.html` would benefit significantly from gzip (~70% reduction). |
| SRV-04 | INFO | — | No security headers (CSP, X-Frame-Options, HSTS, X-Content-Type-Options). These should be added for production. |
| SRV-05 | INFO | — | No rate limiting. Stripe webhook endpoint and auth flows unprotected against abuse. |

---

## Performance Summary

### File Size Analysis for Mobile Networks

| Component | Approx. Size | Impact |
|-----------|-------------|--------|
| index.html (total) | ~380KB uncompressed, ~50-60KB gzipped | Single monolithic file. First load downloads everything. |
| Inline CSS (lines 22-900) | ~30KB | Cannot be cached independently. Re-downloaded every navigation. |
| Inline JS (lines 2414-10798) | ~250KB | All application logic in one script block. Blocking parse. |
| i18n dictionaries (lines 3279-4320) | ~35KB | Parsed at load time even if user's language is already set. |
| Privacy Policy HTML (lines 10294-10510) | ~8KB | Only visible when modal opened. Could be lazy-loaded. |
| Paywall/checkout HTML | ~4KB | Only for unsubscribed users. |
| **Total effective first-load** | **~380KB** | On 3G (~400kbps): ~7.6s download. On 4G (~10Mbps): ~0.3s. |

### Startup Blocking Analysis

The critical rendering path is blocked by:

1. **Supabase SDK (~200KB)** — synchronous `<script>` at line 929. **HIGH-02**
2. **Sentry SDK (~50-100KB)** — synchronous `<script>` at line 932. **MED-03**
3. **Material Symbols CSS** — synchronous `<link>` at line 19. **MED-04**
4. **Inline JS parsing (~250KB)** — cannot be deferred as it's inline.

**Estimated blocking time on 3G:** 3-5 seconds before first meaningful paint.

### Chart.js Loading Assessment

Chart.js is **correctly lazy-loaded** via `lazyLoadChartJs()` (line 9933). It creates a dynamic `<script>` element only when charts are needed. This is a good pattern.

**Minor gap:** No `onerror` handler on the dynamic script element (LOW-24). If CDN fails, charts silently never appear.

### Supabase Call Patterns

- **Initialization:** Synchronous SDK load + IIFE client creation (line 2430). Graceful null fallback.
- **Auth state listener:** Single listener at `_initAuthListener` with multiple side effects.
- **Session management:** `_prefetchSession()` with empty catch (HIGH-05).
- **Billing queries:** Sequential `getSession()` → `fetch()` patterns without proper error chaining.
- **Data sync:** `syncUserAfterLogin()` swallows DB errors (HIGH-04).

**Recommendation:** Add centralized error handling for Supabase operations. Consider a wrapper function that logs errors before returning fallback values.

### Debouncing Status

| Operation | Debounced? | Notes |
|-----------|-----------|-------|
| Tab switch | Partial (200ms `_tabInFlight`) | Not awaited. Overlapping renders possible. **MED-34** |
| Render cycle | Yes (`scheduleRender` with RAF) | Good pattern. Batched properly. |
| Language switch | No | Double render cycle. **MED-17** |
| Meal toggle | No | Direct onclick → render. |
| Tracker update | No | Direct onclick → render. |
| Search/filter | N/A | Not applicable in current UI. |
| Weight log entry | No | Direct save → re-render. |

**Missing debouncing opportunities:** `renderCoach` (re-parses localStorage on every call), `updateSubManagementCard` (thrashes innerHTML), and tab switch async operations.
---

## Appendix: Empty Catch Block Inventory

All empty `catch{}` / `catch(()=>{})` blocks found across the codebase:

| Line | Context | Severity Risk | Finding Ref |
|------|---------|---------------|-------------|
| 2430 | Supabase `sb` init | LOW — intentional graceful degradation | MED-01 |
| 2452 | `getUser()` | LOW — returns null on failure | — |
| 2840 | `_prefetchSession` | HIGH — silent session failure | HIGH-05 |
| 2872 | localStorage set (pending plan) | MEDIUM — checkout resume may fail | — |
| 2889 | Sentry in checkout | LOW — Sentry fallback | HIGH-06 |
| 2893 | Sentry in checkout | LOW — Sentry fallback | HIGH-06 |
| 2901 | window.open fallback | MEDIUM — duplicate tab risk | MED-11 |
| 2904 | Sentry in checkout error | LOW — Sentry fallback | HIGH-06 |
| 2932 | localStorage set (auth origin) | MEDIUM — auth flow may break | — |
| 2992 | Sentry in Stripe redirect | LOW — Sentry fallback | HIGH-06 |
| 3047-3049 | signOut localStorage cleanup | LOW — intentional | — |
| 3069 | localStorage set (auth origin) | MEDIUM — auth flow | — |
| 3102-3103 | localStorage set (user name/avatar) | MEDIUM — profile sync | — |
| 3137 | localStorage remove (auth origin) | MEDIUM — auth cleanup | — |
| 3149-3151 | localStorage remove (checkout) | MEDIUM — checkout cleanup | — |
| 3168 | localStorage remove (auth origin) | MEDIUM — auth cleanup | — |
| 3177-3179 | localStorage remove (checkout) | MEDIUM — checkout cleanup | — |
| 3185 | OAuth session resumption | HIGH — masks real errors | HIGH-10 |
| 3199 | getSession | HIGH — masks real errors | HIGH-10 |
| 3214 | localStorage remove (checkout cleanup) | MEDIUM — cleanup | — |
| 3235 | Trend activation poll | CRITICAL — payment confirmation lost | CRIT-05 |
| 3248 | Sentry in error handler | LOW — Sentry fallback | HIGH-06 |
| 3249 | showToast in error handler | LOW — toast fallback | — |
| 3253 | Sentry in onerror | LOW — Sentry fallback | HIGH-06 |
| 4535-4536 | `lsR`/`lsW` | MEDIUM — storage error silent | HIGH-16 |
| 5229 | showToast failure | MEDIUM — toast error swallowed | HIGH-16 |
| 5230 | Rollback attempt | MEDIUM — rollback failure swallowed | HIGH-16 |
| 5353 | `getHungerDistributionBias()` | MEDIUM — JSON parse failure | HIGH-16 |
| 5368 | `runAdaptiveEngine()` | MEDIUM — checkin parse failure | HIGH-16 |
| 5673 | `bodyChart.destroy()` | MEDIUM — chart destroy error | HIGH-16 |
| 8693 | `runAutoAdjustEngine()` | HIGH — macro adjustment failure | HIGH-25 |
| 8734 | Chart.js destroy | MEDIUM — chart cleanup | MED-37 |
| 8760 | Chart.js destroy | MEDIUM — chart cleanup | MED-37 |
| 8778 | Chart.js destroy | MEDIUM — chart cleanup | MED-37 |
| 8818 | `exportData()` outer catch | LOW — shows toast but no logging | — |
| 8848-8856 | Import backup (multiple) | MEDIUM — partial import possible | MED-31 |
| 8876 | Import backup | MEDIUM — partial import | MED-31 |
| 8886 | Import backup | MEDIUM — partial import | MED-31 |
| 8894 | Import backup | MEDIUM — partial import | MED-31 |
| 9570 | Referral `refreshSession` | HIGH — stale token used | HIGH-28 |
| 9714 | `runAutoAdjustEngine()` | HIGH — macro adjustment failure | HIGH-25 |

**Total empty catch blocks: 41**

---

## Recommended Fix Priority (Top 15)

Ordered by impact × effort ratio (highest impact, lowest effort first):

| Priority | Finding | Effort | Impact | Description |
|----------|---------|--------|--------|-------------|
| **1** | CRIT-07 | 1 line | CRITICAL | Fix `slice(0,5)` → `slice(-5)` in adaptive engine (line 5370). Currently uses oldest checkins for adaptive adjustments. |
| **2** | CRIT-08 | 1 line | CRITICAL | Fix FOOD_ALIASES typo for tonno (line 6593). Missing apostrophe breaks common food lookup. |
| **3** | CRIT-06 | 3 lines | CRITICAL | Apply body composition shift to `_k` before constructing result (lines 5302-5304). Shift computed but discarded. |
| **4** | CRIT-12-15 | ~10 lines | CRITICAL | Add null guards to all boot-path `getElementById` calls (lines 9680, 9690, 10247, 9739, 9807). Prevents black screens. |
| **5** | CRIT-01 | ~5 lines | CRITICAL | Wrap `_checkTrendLocal()` localStorage in try/catch (lines 2437-2447). Prevents white screen in private browsing. |
| **6** | CRIT-11 | ~10 lines | CRITICAL | Fix notification timer chain memory leak (lines 9348-9362). Add timeout ID tracking. |
| **7** | CRIT-09 | ~3 lines | CRITICAL | Replace hummus with FODMAP-safe alternative in IBS breakfast (line 7045). Nutrition safety. |
| **8** | HIGH-02 | 1 attr | HIGH | Add `defer` to Supabase SDK script tag (line 929). Biggest single performance win. |
| **9** | HIGH-15 | ~5 lines | HIGH | Wrap `renderRealTDEE()` in `requireTrend()` (lines 5717-5741). Paywall bypass. |
| **10** | CRIT-02-04 | ~10 lines | CRITICAL | Wrap remaining boot-path localStorage calls in try/catch (lines 2476, 3135-3151, 3162-3174). |
| **11** | HIGH-01 | 1 line | HIGH | Remove duplicate `notif-perm-btn` ID (line 2162). |
| **12** | HIGH-14 | 2 lines | HIGH | Move `lsS()` localStorage read into try block (line 5214). Prevents data loss in private browsing. |
| **13** | MED-04 | 1 attr | MEDIUM | Add async pattern to Material Symbols CSS link (line 19). |
| **14** | HIGH-25 | 1 line | HIGH | Add logging to `runAutoAdjustEngine()` catch blocks (lines 8693, 9714). |
| **15** | CRIT-05 | ~5 lines | CRITICAL | Add error logging to Stripe polling catches (lines 3214, 3235). Payment confirmation lost on failure. |

### Quick Wins Summary (≤3 lines each, can be batched in one commit)

These 7 fixes require minimal code changes and address the highest-impact issues:

1. `slice(0,5)` → `slice(-5)` (line 5370)
2. Fix tonno alias apostrophe (line 6593)
3. Apply `bcs.shift` to `_k` (lines 5302-5304)
4. Add `defer` to Supabase SDK `<script>` (line 929)
5. Remove duplicate `notif-perm-btn` (line 2162)
6. Add async pattern to Material Symbols `<link>` (line 19)
7. Wrap `_checkTrendLocal()` in try/catch (lines 2437-2447)

---

*End of audit report. Generated 2026-04-15 by Agent Zero 'Master Developer'.*
