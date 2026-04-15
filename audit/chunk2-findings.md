# Audit Report: index.html Lines 2161–4320

**Scope:** HTML markup, Trend/Freemium billing, Supabase auth, Stripe checkout, i18n, GDPR, global error handlers  
**Date:** 2026-04-15 | **Auditor:** Agent Zero

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 5     |
| HIGH     | 10    |
| MEDIUM   | 8     |
| LOW      | 5     |
| INFO     | 3     |

---

## CRITICAL

### C-01: localStorage without try/catch in `_checkTrendLocal()`
- **Lines:** 2437–2447
- **Problem:** `localStorage.getItem/setItem` called outside try/catch.
- **Impact:** Crashes in private browsing (Safari/Firefox). Function never returns, `trendAccess` stays at optimistic default → permanent free access.
- **Fix:** Wrap body in try/catch, return trial fallback on error.

### C-02: localStorage.removeItem without try/catch in `checkTrendAccess()`
- **Line:** 2476
- **Problem:** `localStorage.removeItem('ik_trend_active')` without try/catch when grace expires.
- **Impact:** In private browsing, throws before returning `{access:false,mode:'expired'}` → user keeps grace access.
- **Fix:** `try{localStorage.removeItem('ik_trend_active');}catch{}`

### C-03: localStorage without try/catch in auth state listener
- **Lines:** 3135, 3146, 3148–3151
- **Problem:** `localStorage.getItem('ik_auth_origin')` and `getItem('ik_pending_checkout_plan')` in `_initAuthListener` callback.
- **Impact:** Auth state change handler crashes → user signs in via Google but app never processes sign-in. Stuck on auth screen.
- **Fix:** Wrap all localStorage reads with try/catch or use helper.

### C-04: localStorage without try/catch in `_resumePostOnboardingOrBoot()`
- **Lines:** 3162, 3174
- **Problem:** localStorage reads at boot without try/catch.
- **Impact:** In private browsing, boot sequence crashes → black screen. No fallback.
- **Fix:** Wrap function body in try/catch falling back to `_bootAfterGates()`.

### C-05: Silent failures in Stripe success redirect polling
- **Lines:** 3214, 3235
- **Problem:** IIFE polling loop has empty catches. If Supabase queries fail repeatedly, user sees "Payment still processing" after 60s with no actionable error.
- **Impact:** User pays but app never confirms activation. No Sentry, no toast, no retry.
- **Fix:** Log errors in catch, show toast after loop exhausts.

---

## HIGH

### H-01: Race condition — `initTrend()` and `_bootAfterGates()` concurrent
- **Lines:** 3134, 3139, 3142
- **Problem:** Auth listener calls both `_bootAfterGates()` and `initTrend()` without awaiting the latter.
- **Impact:** UI renders before trend access resolved → flash of incorrect paywall state. `updateSubManagementCard()` may not fire.
- **Fix:** Await `initTrend()` before `_bootAfterGates()`.

### H-02: Silent DB error swallowing in `syncUserAfterLogin()`
- **Lines:** 3107, 3116
- **Problem:** `.catch(()=>({data:null}))` converts all DB errors to "no data".
- **Impact:** Paid user's subscription misread as missing → new trial created instead. No error logged.
- **Fix:** Log error before fallback: `.catch(e=>{console.warn('[IK] syncUser error:', e?.message); return {data:null};})`

### H-03: Empty catch in `_prefetchSession()`
- **Line:** 2840
- **Problem:** `.catch(()=>{})` silently discards session refresh failure.
- **Impact:** `_cachedSession` stays null → checkout proceeds without valid session → login gate loop.
- **Fix:** `.catch(e=>{console.warn('[IK] session prefetch failed:', e?.message);})`

### H-04: Empty catch blocks on Sentry calls
- **Lines:** 2889, 2893, 2904, 2992, 3248, 3253
- **Problem:** `try{Sentry.captureException(...);}catch{}` with empty catches throughout billing code.
- **Impact:** If Sentry consistently fails, no one knows. Acceptable pattern but worth adding console.warn fallback.
- **Fix:** Low priority. Add `console.warn` in catches.

### H-05: `updateTrendBadge()` side effect — shows toast repeatedly
- **Line:** 2700
- **Problem:** `showToast(...)` called every time badge updates during grace period.
- **Impact:** Repeated "⚠️ Pagamento in ritardo" toasts on every tab switch/settings render.
- **Fix:** Remove toast from `updateTrendBadge()`. Show once in `initTrend()` when grace first detected.

### H-06: `_clientSideCheckout()` is dead code failing in live mode
- **Lines:** 2937–2996
- **Problem:** Uses `stripe.redirectToCheckout({lineItems:...})` disabled in live mode. Comment acknowledges this (L2940–2945).
- **Impact:** If called, user sees Stripe error page instead of checkout.
- **Fix:** Remove or add guard: `console.error('[IK] deprecated'); return;`

### H-07: `openAuthModal()` uses `prompt()`, lacks error handling
- **Lines:** 3025–3032
- **Problem:** Browser `prompt()` blocked in iframe/some browsers. `signInWithOtp` exceptions uncaught.
- **Impact:** Silent failure in iframe contexts. Uncaught exception on network failure.
- **Fix:** Wrap in try/catch, replace `prompt()` with proper modal.

### H-08: Empty catches swallow session errors in `_resumePostOnboardingOrBoot()`
- **Lines:** 3185, 3199
- **Problem:** Two empty catches: OAuth session resumption (L3185) and `getSession` (L3199).
- **Impact:** Transient network error → user shown onboarding again or auth gate, both wrong.
- **Fix:** Check for network errors, show toast, retry. Only gate on genuine "no session".

### H-09: Race in `initTrend()` — badge update between two async calls
- **Lines:** 2500–2525
- **Problem:** `getUser()` → badge update (L2504) → `checkTrendAccess()` → badge update again (L2513). Badge flickers between optimistic and real state.
- **Impact:** Visible flash of incorrect trial state before server response resolves.
- **Fix:** Skip first badge update if user is logged in (server response will arrive shortly).

### H-10: `syncUserAfterLogin()` calls `updateTrendBadge()` outside try/catch
- **Line:** 3124
- **Problem:** `updateTrendBadge()` called after the try/catch block. If trendAccess was partially set, badge may reference undefined properties.
- **Impact:** Potential null dereference if `trendAccess` is in inconsistent state.
- **Fix:** Move inside the try block.

---

## MEDIUM

### M-01: `sanitize()` creates DOM element on every call
- **Line:** 3268
- **Problem:** `document.createElement('div')` called every time `sanitize()` runs. No reuse.
- **Impact:** Minor GC pressure on frequent calls (meal rendering, coach messages).
- **Fix:** Cache the element: `const _sanDiv=document.createElement('div'); function sanitize(s){...use _sanDiv...}`

### M-02: `updateSubManagementCard()` thrashes innerHTML
- **Lines:** 2546–2547, 2589–2602, 2617–2622, 2638–2643, 2656–2669
- **Problem:** `ctaWrap.innerHTML=...` with template literals containing inline SVG, onclick handlers, and i18n calls. Destroys and recreates DOM on every call.
- **Impact:** Expensive DOM recalculation. Event listeners not properly cleaned (onclick in string = re-parsed each time).
- **Fix:** Use `createElement` + `appendChild` or cache rendered states to avoid redundant updates.

### M-03: `_applyCheckoutPreviewLang()` queries DOM 20+ times sequentially
- **Lines:** 2793–2830
- **Problem:** 20+ individual `document.getElementById()` calls in sequence.
- **Impact:** Unnecessary layout thrash. Could be batched.
- **Fix:** Cache element references or use single querySelectorAll with data attribute mapping.

### M-04: Multiple `document.getElementById` calls in `initTrend()` without caching
- **Lines:** 2505–2518
- **Problem:** 6 separate `getElementById` calls for elements like `set-sub-manage`, `set-sub-status`, `trend-lock-banner`, `scr-prog`, `scr-set`.
- **Impact:** Minor perf hit on every trend init.
- **Fix:** Cache references at module level.

### M-05: `openBillingPortal()` makes sequential await calls that could fail silently
- **Lines:** 2998–3023
- **Problem:** `sb.auth.getSession()` then `fetch()` then `res.json()` — each can fail. The `res.json().catch(()=>({}))` at L3010 silently returns empty object.
- **Impact:** Error message from server is lost. User sees generic "Errore portale" instead of specific error.
- **Fix:** Log the parsed error body before throwing.

### M-06: `_doStartCheckout` fallback `window.open` in setTimeout
- **Line:** 2901
- **Problem:** `setTimeout(()=>{if(document.visibilityState!=='hidden')try{window.open(body.url,'_blank','noopener');}catch{}},600)` — fallback window.open after location.href. If the redirect already happened, this fires in the new page context.
- **Impact:** Could open duplicate tab. Empty catch hides popup blocker errors.
- **Fix:** Remove the setTimeout fallback or use `window.location.assign()` which is more reliable.

### M-07: `selectCheckoutPlan()` doesn't handle lifetime plan in UI toggle
- **Lines:** 2769–2781
- **Problem:** Only toggles `cpo-monthly` and `cpo-annual` elements. No `cpo-lifetime` element toggled, but price calculation at L2777 handles all three.
- **Impact:** Lifetime plan selection may not show visual feedback in the plan selector.
- **Fix:** Add `cpo-lifetime` element toggle if the UI supports it, or verify the HTML handles it.

### M-08: `closePaywall()` and `closeCheckoutPreview()` use fixed setTimeout delays
- **Lines:** 2734–2738, 2762–2766
- **Problem:** `setTimeout(()=>{...},350)` and `setTimeout(()=>{...},380)` assume CSS transition timing. If transition is faster/slower, overlay hides too early/late.
- **Impact:** Visual glitch — overlay disappears before sheet finishes animating, or delay feels sluggish.
- **Fix:** Listen for `transitionend` event instead of fixed timeout.

---

## LOW

### L-01: `APP_VERSION` mismatch
- **Line:** 2416
- **Problem:** `const APP_VERSION='1.5.0'` but HTML shows "Versione 2.0.0 · PWA" at L2230.
- **Impact:** Version confusion in debugging/support.
- **Fix:** Align versions or use APP_VERSION in the display.

### L-02: `SUPABASE_KEY` (anon/public key) hardcoded in source
- **Line:** 2425
- **Problem:** Anon key is embedded in client-side HTML. While this is expected for Supabase anon keys (they're public), it's still visible to anyone viewing source.
- **Impact:** Informational — Supabase anon keys are designed to be public. RLS policies protect data.
- **Fix:** No action required. Ensure RLS policies are strict.

### L-03: `STRIPE_PK` (publishable key) hardcoded
- **Line:** 2427
- **Problem:** Stripe publishable key embedded in HTML.
- **Impact:** Informational — publishable keys are designed to be public.
- **Fix:** No action required.

### L-04: i18n dictionaries are ~1000 lines of inline data
- **Lines:** 3279–4320
- **Problem:** Both IT and EN dictionaries are massive inline objects. They're parsed at script load time.
- **Impact:** Slight delay in script parsing on first load. Could be deferred or loaded dynamically.
- **Fix:** Consider extracting to separate JSON files loaded on demand.

### L-05: Double `requestAnimationFrame` in `setRing()`
- **Line:** 2567
- **Problem:** `requestAnimationFrame(()=>{requestAnimationFrame(()=>{...})})` — double wrapping.
- **Impact:** Unnecessary frame delay. Single rAF sufficient for style change batching.
- **Fix:** Use single `requestAnimationFrame(()=>{...})`.

---

## INFO

### I-01: Supabase client graceful null pattern
- **Line:** 2430
- **Pattern:** `const sb=(()=>{try{return supabase.createClient(...);}catch{return null;}})();` — graceful no-op if CDN blocked.
- **Note:** Good defensive pattern. All functions check `if(!sb)` before use.

### I-02: `trendInitPromise` used as gate
- **Lines:** 2499, 2709
- **Pattern:** External promise pattern for initialization gate.
- **Note:** Functional but fragile. Consider using async/await with explicit state tracking.

### I-03: Global unhandled rejection handler at line 3246
- **Note:** Good practice. Catches uncaught async errors. Sends to Sentry if available.

---

## Empty Catch Blocks Inventory

All empty `catch{}` / `catch(()=>{})` blocks found in this chunk:

| Line | Context | Risk |
|------|---------|------|
| 2430 | sb init | LOW — intentional graceful degradation |
| 2452 | getUser() | LOW — returns null on failure |
| 2840 | _prefetchSession | HIGH — silent session failure |
| 2872 | localStorage set (pending plan) | MEDIUM — checkout resume may fail |
| 2893 | Sentry in checkout | LOW — Sentry fallback |
| 2901 | window.open fallback | MEDIUM — duplicate tab risk |
| 2904 | Sentry in checkout error | LOW |
| 2932 | localStorage set (auth origin) | MEDIUM — auth flow may break |
| 2992 | Sentry in Stripe redirect | LOW |
| 3047–3049 | signOut localStorage cleanup | LOW — intentional |
| 3069 | localStorage set (auth origin) | MEDIUM |
| 3102–3103 | localStorage set (user name/avatar) | MEDIUM |
| 3137 | localStorage remove (auth origin) | MEDIUM |
| 3149–3151 | localStorage remove (checkout) | MEDIUM |
| 3168 | localStorage remove (auth origin) | MEDIUM |
| 3177–3179 | localStorage remove (checkout) | MEDIUM |
| 3185 | OAuth session resumption | HIGH — masks real errors |
| 3199 | getSession | HIGH — masks real errors |
| 3214 | localStorage remove (checkout cleanup) | MEDIUM |
| 3235 | Trend activation poll | CRITICAL — payment confirmation lost |
| 3248 | Sentry in error handler | LOW |
| 3249 | showToast in error handler | LOW |
| 3253 | Sentry in onerror | LOW |
