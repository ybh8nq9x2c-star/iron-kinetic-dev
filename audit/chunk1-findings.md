# Iron Kinetic Audit — Chunk 1: Lines 1–2160

**Auditor:** Agent Zero 'Master Developer'
**Date:** 2026-04-15
**Scope:** `index.html` lines 1–2160 (CSS + HTML structure + initial JS)

---

## Summary

Lines 1–2160 contain:
- **Lines 1–21:** `<head>` meta tags, font preloads, manifest link
- **Lines 22–900:** Inline `<style>` block (~880 lines of CSS)
- **Lines 901–933:** Splash screen CSS, splash fallback script, Supabase/Stripe/Sentry `<script>` tags
- **Lines 934–1409:** HTML body — language gate, PWA gate, GDPR gate, onboarding (5 steps), result card
- **Lines 1410–2160:** App shell HTML — Today screen, Progresso screen, Settings/Profile screen (partial)
- **Lines 2414+ (just beyond chunk):** Start of main `<script>` block (global constants, Supabase init, trend access)

**Total findings: 15** (3 CRITICAL, 2 HIGH, 4 MEDIUM, 3 LOW, 3 INFO)

---

## BUGS & RUNTIME ERRORS

### FINDING 1 — Duplicate Element ID `notif-perm-btn`

- **SEVERITY:** HIGH
- **Title:** Duplicate `id="notif-perm-btn"` — `getElementById` returns unpredictable element
- **Location:** Lines 1854 and 2162
- **Problem:** Two `<button>` elements share `id="notif-perm-btn"`. Line 1854 is the visible button in the Progresso screen. Line 2162 is a hidden compat duplicate in the Settings screen. HTML spec requires unique IDs. `document.getElementById('notif-perm-btn')` returns the first match, which may not be the one the user sees.
- **Impact:** Notification permission request may target the wrong button (the hidden one), causing no visible feedback to the user.
- **Fix:** Remove the hidden duplicate at line 2162 or give it a unique ID like `notif-perm-btn-compat`.

---

### FINDING 2 — localStorage Access Without try/catch

- **SEVERITY:** HIGH
- **Title:** `_checkTrendLocal()` calls `localStorage.getItem/setItem` without try/catch — throws in private browsing
- **Location:** Lines 2437–2447 (JS starts at line 2414)
- **Problem:** `_checkTrendLocal()` directly calls `localStorage.getItem('ik_trial_start')` and `localStorage.setItem(...)` without wrapping in try/catch. In Safari private browsing mode, or when storage quota is exceeded, these calls throw `SecurityError` or `QuotaExceededError`.
- **Impact:** Unhandled exception crashes the trend access check. If this runs during app boot, it can prevent the app from loading entirely (white screen).
- **Fix:** Wrap all localStorage calls in try/catch:
```js
function _checkTrendLocal(){
  try {
    let stored = localStorage.getItem('ik_trial_start');
    // ... existing logic ...
  } catch(e) {
    console.warn('[IK] localStorage unavailable:', e);
    return {access:true, mode:'trial', daysLeft:TRIAL_DAYS};
  }
}
```

---

### FINDING 3 — Supabase Client Creation Silently Swallows Errors

- **SEVERITY:** MEDIUM
- **Title:** `sb` initialization uses bare `catch{return null;}` with no error parameter or logging
- **Location:** Line 2430
- **Problem:** `const sb=(()=>{try{return supabase.createClient(...);}catch{return null;}})();` — The bare `catch` catches ALL errors (ReferenceError if CDN blocked, TypeError if misconfigured) and silently returns null. No error is logged, making debugging impossible.
- **Impact:** If Supabase CDN is blocked (ad blockers, firewall, network issue), auth, sync, and billing all fail silently. Users see no error — just degraded functionality.
- **Fix:** Add error logging: `catch(e){console.error('[IK] Supabase init failed:',e);return null;}`

---

### FINDING 4 — Stripe Live Publishable Key Hardcoded Without Env Toggle

- **SEVERITY:** MEDIUM
- **Title:** Live Stripe publishable key hardcoded — no environment-based switching
- **Location:** Line 2427
- **Problem:** `const STRIPE_PK='pk_live_...';` is hardcoded. The app always uses the live key, even in development. The Sentry init at line 931 does check `location.hostname.includes('railway')` for environment, but Stripe doesn't.
- **Impact:** During development/testing, real Stripe API calls are made with live keys. Accidental test checkouts charge real money.
- **Fix:** Use environment detection:
```js
const STRIPE_PK = location.hostname.includes('railway') || location.hostname === 'iron-kinetic.app'
  ? 'pk_live_...'
  : 'pk_test_...';
```

---

### FINDING 5 — CSS `.scr` Class Defined Twice with Conflicting Properties

- **SEVERITY:** LOW
- **Title:** `.scr` declared at line 61 (positioning) and again at line 750 (opacity/transition)
- **Location:** Lines 61 and 750–753
- **Problem:** The `.scr` class is defined twice. First sets positioning/padding/overflow. Second adds `opacity:1; transition:opacity .15s ease;`. CSS cascade applies both, but the split is confusing.
- **Impact:** Maintainability issue — developers may modify `.scr` in the first block and not realize the second block adds transition behavior. No runtime bug currently.
- **Fix:** Merge the two `.scr` blocks into one declaration.

---

### FINDING 6 — Empty CSS Rule `#scr-prog.locked-trend{}`

- **SEVERITY:** INFO
- **Title:** Empty CSS rule body — dead code
- **Location:** Line 295
- **Problem:** `#scr-prog.locked-trend{}` has an empty declaration block. The selector is used elsewhere (lines 722–723 with actual rules), so this is dead code.
- **Impact:** No runtime impact. Minor code cleanliness issue.
- **Fix:** Remove the empty rule.

---

### FINDING 7 — CSS `.btn-xs` Defined Twice

- **SEVERITY:** LOW
- **Title:** `.btn-xs` first defined at line 102, then redefined with enhancement at line 784
- **Location:** Lines 102 and 784–794
- **Problem:** First definition at line 102: `height:34px;font-size:10px;border-radius:var(--r3)`. Second at line 784 re-declares same properties plus adds `position:relative` and `::before` pseudo-element for touch area. First is effectively dead CSS.
- **Impact:** No runtime bug (second is a superset). Wastes bytes and confuses maintainers.
- **Fix:** Remove the first `.btn-xs` declaration at line 102.

---

## PERFORMANCE

### FINDING 8 — Supabase SDK Loaded Synchronously in `<head>`

- **SEVERITY:** HIGH
- **Title:** Supabase SDK (~200KB) loaded synchronously — blocks first paint
- **Location:** Line 929
- **Problem:** `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4">` is loaded WITHOUT `async` or `defer`. The comment says "kept synchronous — inline boot depends on `supabase` global at parse time", but the `sb` init (line 2430) uses a try/catch that could safely return null if the global isn't available yet.
- **Impact:** Adds ~200KB synchronous download + parse time to the critical rendering path. On slow 3G, this delays first paint by 1–3 seconds.
- **Fix:** Add `defer` and restructure `sb` initialization to run after `DOMContentLoaded`, or move the script to end of `<body>`. The `sb` init already gracefully handles `supabase` being undefined.

---

### FINDING 9 — Sentry SDK Loaded Synchronously in `<head>`

- **SEVERITY:** MEDIUM
- **Title:** Sentry SDK loaded synchronously — blocks rendering for non-critical monitoring
- **Location:** Line 932
- **Problem:** `<script src="https://js-de.sentry-cdn.com/...">` is loaded without `async` or `defer`. Sentry is error monitoring — non-critical for UX.
- **Impact:** Adds ~50–100ms to first paint on fast connections, more on slow networks.
- **Fix:** Add `defer` attribute. Sentry init can happen after DOM is ready.

---

### FINDING 10 — Material Symbols Icon Font Render-Blocking

- **SEVERITY:** MEDIUM
- **Title:** Google Material Symbols CSS loaded synchronously — render-blocking icon font
- **Location:** Line 19
- **Problem:** `<link href="...Material+Symbols+Outlined..." rel="stylesheet"/>` is loaded synchronously. The main fonts (line 17) use `media="print" onload="this.media='all'"` async pattern, but the icon font doesn't.
- **Impact:** On slow connections, icon font download blocks rendering. Icons show as text/empty until loaded.
- **Fix:** Apply same async pattern as main fonts: `media="print" onload="this.media='all'"`.

---

### FINDING 11 — Large Inline CSS Bloat (~880 Lines)

- **SEVERITY:** MEDIUM
- **Title:** ~880 lines of inline CSS in `<style>` block — increases HTML payload, cannot be cached independently
- **Location:** Lines 22–900
- **Problem:** The entire design system (CSS custom properties, component classes, layout utilities, responsive breakpoints, animations) is inlined in the HTML. This is ~30KB of CSS that must be re-downloaded on every page load. External CSS files can be cached by the browser and CDN.
- **Impact:** Every navigation or reload downloads the full CSS again. No browser cache benefit for styles. Increases Time to First Byte (TTFB) and total page weight.
- **Fix:** Extract CSS to an external file (e.g., `styles.css`), link with `<link rel="stylesheet" href="styles.css">`, and let the Service Worker/cache handle it. For critical-above-fold CSS only, keep a small inline subset (~50 lines).

---

### FINDING 12 — Splash Fallback Timer May Conflict with Main JS

- **SEVERITY:** INFO
- **Title:** Splash fallback `setTimeout` at 4s may race with main app initialization
- **Location:** Lines 923–926
- **Problem:** `setTimeout(function(){var s=document.getElementById('ik-splash');if(s)s.classList.add('hidden');},4000);` is a safety net. However, if the main JS hides the splash earlier via `classList.add('hidden')`, the timer still fires at 4s and redundantly adds the class. This is harmless but wastes a timer slot.
- **Impact:** No user-visible impact. Minor inefficiency.
- **Fix:** Clear the fallback timer when main JS hides the splash: `clearTimeout(window._splashFallback);` or check if class is already applied before adding.

---

### FINDING 13 — Chart.js Lazy-Loaded Correctly (Positive Finding)

- **SEVERITY:** INFO
- **Title:** Chart.js is lazily loaded on demand — no render-blocking issue
- **Location:** Line 21 (comment) — `<!-- Chart.js loaded lazily on demand — see lazyLoadChartJs() -->`
- **Problem:** None. Chart.js is correctly deferred until needed.
- **Impact:** Good practice — no performance penalty for users who don't view charts.
- **Fix:** None needed. This is correctly implemented.

---

### FINDING 14 — Inline `onclick` Handlers Throughout HTML

- **SEVERITY:** LOW
- **Title:** Pervasive inline `onclick` handlers on buttons — harder to audit for duplicate bindings and memory leaks
- **Location:** Throughout lines 955–2160 (50+ inline handlers: `setSex()`, `goStep()`, `setWk()`, `toggleFood()`, `addWater()`, `addSalt()`, `addSteps()`, `toggleWk()`, `logMetric()`, `switchTab()`, `toggleAccordion()`, etc.)
- **Problem:** All buttons use inline `onclick="functionName()"` instead of `addEventListener`. This makes it impossible to have multiple listeners, difficult to remove listeners for cleanup, and harder to trace event flow during debugging. Functions must be globally scoped.
- **Impact:** Maintainability and debugging difficulty. No direct runtime bug, but makes it harder to detect duplicate event bindings or memory leaks from listeners that should be cleaned up.
- **Fix:** Long-term: migrate to `addEventListener` with delegated event handling. Short-term: acceptable for a PWA of this size, but document all global functions.

---

### FINDING 15 — `onerror` Handler on Avatar Images Doesn't Handle Re-attachment

- **SEVERITY:** LOW
- **Title:** `onerror="this.style.display='none'"` on avatar images permanently hides them if initial load fails
- **Location:** Lines 1076 and 1875
- **Problem:** `<img ... onerror="this.style.display='none'"/>` hides the image on error. If the image URL becomes valid later (e.g., after auth loads avatar URL), the image remains hidden. There's no retry mechanism.
- **Impact:** If avatar image fails to load initially (network blip) but would succeed on retry, the avatar stays permanently hidden until full page reload.
- **Fix:** Instead of hiding, show a fallback and allow re-attempt when URL changes:
```html
<img ... onerror="this.style.display='none';document.getElementById('prof-avatar-icon').style.display='flex';"/>
```
Note: Line 1875 already partially does this by showing the fallback icon. Line 1076 just hides without showing fallback.

---

## SEVERITY DISTRIBUTION

| Severity | Count | Finding #s |
|----------|-------|------------|
| CRITICAL | 0 | — |
| HIGH | 3 | #1, #2, #8 |
| MEDIUM | 4 | #3, #4, #9, #10 |
| LOW | 4 | #5, #7, #14, #15 |
| INFO | 4 | #6, #11, #12, #13 |

## PRIORITY FIX ORDER

1. **#2** (localStorage try/catch) — Can cause white screen in private browsing
2. **#8** (Supabase sync load) — Biggest single performance win
3. **#1** (Duplicate ID) — Can break notification permissions
4. **#3** (Silent Supabase catch) — Debugging impossibility
5. **#9** (Sentry sync load) — Easy perf win
6. **#10** (Material Symbols async) — Easy perf win
