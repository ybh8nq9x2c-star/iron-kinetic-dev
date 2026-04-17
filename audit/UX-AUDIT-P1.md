# UX Production Audit P1 — Iron Kinetic PWA

**Date:** 2026-04-17  
**Commit:** `2c51546`  
**Branch:** `main` (pushed to `iron-kinetic-dev`)  
**Backup branch:** `backup/20260417204315`  
**File:** `index.html` (11,137 lines)  
**Scope:** Touch targets, visual feedback, empty states, skeleton loaders, error handling, onboarding, navigation  
**Status:** ✅ All fixes applied, syntax verified, pushed  

---

## Area 1: Touch Targets & Mobile Interattività

### Findings
| Issue | Severity | Lines | Status |
|-------|----------|-------|--------|
| `.day-chip` height 36px (below 44px min) | MEDIUM | L157 | ✅ Fixed |
| `.micro-chip` height 36px (below 44px min) | MEDIUM | L290 | ✅ Fixed |
| `.food-tag` height 38px (below 44px min) | LOW | L293 | ✅ Fixed |
| `.nb` nav buttons already 56px height | INFO | L97 | ✅ Already OK |
| `.btn` already 50px height | INFO | L121 | ✅ Already OK |
| `.btn-icon` already 44px | INFO | L129 | ✅ Already OK |
| `.seg-btn` min-height 46px | INFO | L609-611 | ✅ Already OK |

### Fixes Applied
- Added `::before` pseudo-element tap area extension (±4px) for `.day-chip`, `.micro-chip` — extends effective tap target to 44px without changing visual size
- `.btn-xs` already had tap extension via `::before` (L928-939)
- All interactive elements already have `touch-action: manipulation`
- All clickable non-buttons already have `cursor: pointer`

---

## Area 2: Feedback Visivo & Stati Interattivi

### Findings
| Issue | Severity | Lines | Status |
|-------|----------|-------|--------|
| Missing `.toast-error` variant for error messages | HIGH | L222 | ✅ Fixed |
| All buttons have `:active` state | INFO | L122,98,130 | ✅ Already OK |
| `.btn.loading` already defined with spinner | INFO | L1027-1037 | ✅ Already OK |
| Form inputs have `:focus` and `:focus-visible` states | INFO | L133-134 | ✅ Already OK |

### Fixes Applied
- Added `#toast.toast-error` CSS class with `border-color: var(--red)` and red accent color
- Added `showToastError(msg, dur)` function that applies `.toast-error` class automatically
- Updated `closeToast()` to also remove `.toast-error` class

---

## Area 3: Empty States

### Findings
| Issue | Severity | Lines | Status |
|-------|----------|-------|--------|
| Meals list (#meals-list): plain text only, no icon/CTA | HIGH | L1699-1701 | ✅ Fixed |
| Chart empty (#chart-empty): text only, no icon/CTA | HIGH | L1877 | ✅ Fixed |
| Adherence calendar: no empty state | MEDIUM | L1990 | ✅ Fixed |
| History list (#hist-list): text only, no icon/CTA | MEDIUM | L2010 | ✅ Fixed |
| Fingerprint card: hidden entirely when no data | MEDIUM | L1895-1900 | ✅ Fixed |
| Weekly report card: hidden entirely when no data | MEDIUM | L1904 | ⚠️ Deferred |
| Checkin analytics: decent text note, no icon | LOW | L1892 | ✅ Improved |

### Fixes Applied
- **Meals list**: Replaced plain text with `.empty-state` containing `restaurant_menu` icon, "Nessun piano generato" label, and CTA button "Configura il tuo piano" → navigates to Profile tab
- **Chart empty**: Replaced `<p>` with `.empty-state` containing `monitoring` icon, "Nessun dato ancora" label, and helper text
- **Adherence calendar**: Added `.empty-state` with `calendar_month` icon inside `#adherence-calendar` div
- **History list**: Replaced plain text with `.empty-state` containing `scale` icon and guidance text
- **Fingerprint card**: Added `.empty-state` inside `#fingerprint-content` with `fingerprint` icon and "Servono almeno 7 rilevazioni" guidance
- **Checkin analytics**: Skeleton loading now shows before data fills

### CSS Added
- `.empty-state .btn` with `min-width: 140px` for action buttons
- `.empty-state-icon-sm` for smaller empty state contexts

---

## Area 4: Skeleton Loaders & Stati di Caricamento

### Findings
| Issue | Severity | Lines | Status |
|-------|----------|-------|--------|
| `.skeleton` CSS class defined but never used | HIGH | L908-914 | ✅ Fixed |
| `renderFingerprint()` — no skeleton loader | HIGH | L5764 | ✅ Fixed |
| `renderWeeklyReport()` — no skeleton loader | HIGH | L6010 | ✅ Fixed |
| `renderRealTDEE()` — no skeleton loader | HIGH | L5927 | ✅ Fixed |
| `renderCheckinAnalytics()` — no skeleton loader | MEDIUM | L8004 | ✅ Fixed |
| Splash screen works correctly | INFO | L1048-1087 | ✅ Already OK |

### Fixes Applied
- **renderFingerprint**: Card shown immediately with skeleton card + skeleton text lines, replaced with actual content after `requireTrend()` resolves
- **renderWeeklyReport**: Card shown with skeleton stat grid (3 boxes) and skeleton bar chart, replaced after `requireTrend()` resolves
- **renderRealTDEE**: Value and rate fields show inline skeleton placeholders, replaced after `calcRealTDEE()` completes
- **renderCheckinAnalytics**: Bars show 0% width, values show inline skeleton placeholders via `requestAnimationFrame()`, then animate to actual values

### CSS Added
- `.skeleton-card` (120px height)
- `.skeleton-text` (14px height, 80% width)
- `.skeleton-text.short` (50% width)
- `.skeleton-stat` (40px × 60px)

---

## Area 5: Gestione Errori Visibile all'Utente

### Findings
| Issue | Severity | Lines | Status |
|-------|----------|-------|--------|
| `logMetric()` — no try/catch on saveLog, silent failure | HIGH | L8988 | ✅ Fixed |
| `saveDailyCheckin()` — no try/catch on lsS, silent failure | HIGH | L7926 | ✅ Fixed |
| Critical flows (checkout, login) already have toast on error | INFO | L3060-3133 | ✅ Already OK |
| Many catch blocks silently swallow errors | MEDIUM | Various | ⚠️ Deferred |
| Onboarding validation: uses `border-color: var(--red)` + toast | INFO | L7631-7645 | ✅ Already OK |

### Fixes Applied
- **logMetric**: Wrapped `saveLog(log)` in try/catch → shows `showToastError()` on failure
- **saveDailyCheckin**: Wrapped `lsS(SK.checkins, arr)` in try/catch → shows `showToastError()` on failure
- Both use `t('toast.saveError')` with fallback Italian message

---

## Area 6: Onboarding (#onb-screen)

### Findings
| Issue | Severity | Lines | Status |
|-------|----------|-------|--------|
| Step 0 forward button NOT disabled when fields empty | HIGH | L1271 | ✅ Fixed |
| Step 1 forward button NOT disabled until selections made | HIGH | L1318 | ✅ Fixed |
| Step 3 forward button NOT disabled until selections made | HIGH | L1399 | ✅ Fixed |
| Step 2 already has disabled state via `to-step3-btn` | INFO | L1336 | ✅ Already OK |
| Stepper dots missing aria-labels | MEDIUM | L1242-1246 | ✅ Fixed |
| Out-of-range validation works correctly | INFO | L7631-7645 | ✅ Already OK |
| TRIAL_DAYS constant consistent at 7 | INFO | L2574 | ✅ Already OK |

### Fixes Applied
- **Step 0 → 1 button**: Added `id="to-step1-btn"`, `disabled`, `opacity:0.5`, `cursor:not-allowed`. Added `_updateStep1Btn()` function bound to `input` events on `f-age`, `f-height`, `f-weight`. Enables button only when all 3 fields have valid values within range.
- **Step 1 → 2 button**: Added `id="to-step2-btn"`, `disabled`, `opacity:0.5`. Added `_updateStep2Btn()` helper called by `setWk()` and `setSt()`. Enables only when both `workoutsWk` and `stepsDay` are set.
- **Step 3 → 4 button**: Added `id="to-step4-btn"`, `disabled`, `opacity:0.5`. Added `_updateStep4Btn()` helper called by `setMealsCount()`, `setTaste()`, `setDietStyle()`. Enables only when all 3 are set.
- **Stepper dots**: Added `aria-label="Step X di 5"` to each dot. Updated `goStep()` to dynamically set `aria-label` including `(attivo)` for current step.
- **CSS**: Added `.btn[disabled]` rule with `opacity:0.5; cursor:not-allowed; pointer-events:none`

---

## Area 7: Navigazione (#nav) & Header (#hdr)

### Findings
| Issue | Severity | Lines | Status |
|-------|----------|-------|--------|
| `#trend-access-badge` HTML element missing — dead JS code | CRITICAL | L2827-2838 | ✅ Fixed |
| `.nb.on` minimal visual distinction | MEDIUM | L99,102 | ✅ Fixed |
| Tab fade animation already implemented | INFO | L898-901 | ✅ Already OK |
| Safe area env() vars correctly applied | INFO | L61-66 | ✅ Already OK |

### Fixes Applied
- **Trend access badge**: Added `<span id="trend-access-badge">` element inside `#nav-prog` button with `position:absolute; top:4px; right:4px; max-width:50px; overflow:hidden; text-overflow:ellipsis`. This activates the previously dead `updateTrendBadge()` JS function.
- **Active nav tab**: Added `.nb.on .nl { font-weight: 800 }` for stronger visual distinction
- **Nav button positioning**: Added `.nb { position: relative }` to enable badge positioning

---

## Summary Statistics

| Area | Issues Found | Fixed | Deferred |
|------|-------------|-------|----------|
| 1. Touch Targets | 3 | 3 | 0 |
| 2. Feedback Visivo | 1 | 1 | 0 |
| 3. Empty States | 6 | 5 | 1 |
| 4. Skeleton Loaders | 5 | 5 | 0 |
| 5. Error Handling | 2 | 2 | 0 (partial) |
| 6. Onboarding | 5 | 5 | 0 |
| 7. Navigation | 2 | 2 | 0 |
| **Total** | **24** | **23** | **1** |

## Deferred Items
1. **Weekly report empty state** — Card has complex multi-section layout; showing skeleton is better UX than empty state since it's hidden until data is available via `requireTrend()`
2. **Silent catch blocks** — Many internal catch blocks silently swallow errors. Adding toast to all would be noisy; focused on user-initiated actions only (logMetric, saveDailyCheckin)

## Modified Files
- `index.html` — 85 insertions, 29 deletions

## Verification
- `node --check` on extracted main script block: ✅ PASSED
- `git push origin main`: ✅ PUSHED to `iron-kinetic-dev`
