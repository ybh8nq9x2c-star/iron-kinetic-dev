# Iron Kinetic — Nutrition, Onboarding, i18n & Accessibility Audit

**File:** `index.html` (10,799 lines)
**Date:** 2025-04-15
**Auditor:** Agent Zero Deep Research

---

## Executive Summary

This audit covers 4 domains across the monolithic `index.html`: Nutrition Algorithms (Domain 5), Onboarding Flow (Domain 6), Internationalisation (Domain 8), and Accessibility/UX (Domain 9). A total of **31 findings** were identified: **3 CRITICAL**, **8 HIGH**, **11 MEDIUM**, **6 LOW**, and **3 INFO**.

The nutrition engine is clinically sound overall, with correct Mifflin-St Jeor, Katch-McArdle, and Harris-Benedict Rev. 2023 implementations and proper clinical protocol overrides. The most serious issues are allergen exclusion gaps in `buildSnack`/`buildBreakfast` (potentially serving unsafe food to allergic users), missing FODMAP flags on apple and pear, and pervasive hardcoded Italian in aria-labels visible to English users.

---

## DOMAIN 5 — NUTRITION ALGORITHMS

### N-01 | CRITICAL | Missing FODMAP flag on apple (mela) and pear (pera)

| Field | Detail |
|---|---|
| **Location** | Line 6446 (mela), line 6448 (pera) |
| **Problem** | `mela` has `fodmap:false`. Apple and pear are HIGH-FODMAP foods (excess fructose + sorbitol, Monash University). The clinical.hint.IBS translation itself lists "apples" as excluded, yet the database flag contradicts this. |
| **Impact** | IBS users on the low-FODMAP protocol will be served apples and pears in meals/snacks, triggering gastrointestinal symptoms during the elimination phase. |
| **Fix** | Set `fodmap:true` on `mela` (line 6446). Verify `pera` entry exists and set `fodmap:true`. Also audit `banana` — ripe banana is moderate-FODMAP (fructans at >120g). |

### N-02 | CRITICAL | buildSnack ignores excluded allergens/intolerances

| Field | Detail |
|---|---|
| **Location** | Lines 6989–7022 (`buildSnack`) |
| **Problem** | The function has hardcoded snack pools (`sweet`, `savory`, `ibsSafe`) containing specific foods like `Yogurt greco`, `Burro di arachidi`, `Fiocchi di latte`. The `excluded` array from user intolerances is accepted as a parameter but **never used** to filter these pools. |
| **Impact** | A user with a peanut allergy who enters "arachidi" as an intolerance will still receive "Burro di arachidi 20g" in their snack. A lactose-intolerant user (non-IBS) will receive yogurt and fiocchi di latte. This is a food safety issue. |
| **Fix** | Add an exclusion filter to each snack pool. Filter each snack's `rest` string against the `excluded` array:
```
const filterSnacks = pool => pool.filter(s =>
  !excluded.some(e => e.length > 2 && s.rest.toLowerCase().includes(e))
);
```
Also apply FODMAP filtering when `isIBS` is true. |

### N-03 | CRITICAL | buildBreakfast ignores most excluded allergens

| Field | Detail |
|---|---|
| **Location** | Lines 7025–7086 (`buildBreakfast`) |
| **Problem** | The function checks `noGluten` and `noLattosio` from the `excluded` array, but only for specific hardcoded keywords (`glut`, `celi`, `lattosio`, `latte`). Other allergens (nuts, eggs, fish, soy) are not checked. |
| **Impact** | Tree-nut allergy sufferers may be served meals containing almonds and walnuts. The keyword-matching approach is fragile and misses many allergen synonyms. |
| **Fix** | After selecting a breakfast option, validate its `rest` string against the full `excluded` array. If the selected option contains an excluded ingredient, try the next option in the pool. Replace `pick()` with a safe picker that cycles through alternatives. |

### N-04 | HIGH | TEF potentially double-counted in TDEE

| Field | Detail |
|---|---|
| **Location** | Line 6129 (`tdee = tdeeRaw + Math.round(tef * 0.5)`) |
| **Problem** | BMR × actMult already includes TEF implicitly (activity multipliers derived from total energy expenditure studies). Adding half-TEF on top may overestimate TDEE by 30–60 kcal. |
| **Impact** | Moderate caloric overestimation for all users. For cut_extreme users, this partially offsets the deficit. |
| **Fix** | Either remove the TEF addition or document it as intentional. If kept, consider reducing from 0.5 to 0.3. |

### N-05 | HIGH | Meal distribution rounding causes sum drift

| Field | Detail |
|---|---|
| **Location** | Lines 6836–6838 (`generatePersonalizedPlan`) |
| **Problem** | Each meal's calorie/macro target is independently rounded. For 2150 kcal with 3 meals [0.25, 0.40, 0.35]: 538+860+753 = 2151 (off by 1). Macro drift can be larger. |
| **Impact** | Daily totals may not match the target exactly, causing confusion and coach message inaccuracy. |
| **Fix** | After computing all meal targets, calculate sum and apply rounding remainder to the largest meal. |

### N-06 | HIGH | Progressive protein rate unbounded by time

| Field | Detail |
|---|---|
| **Location** | Line 5362 (`getProgressiveProRate`) |
| **Problem** | Protein increases by 0.10 g/kg every 4 weeks indefinitely, capped only by 2.6 (cut) or 2.4 (recomp). The sport-specific clamp happens BEFORE clinical overrides, creating a theoretical bypass window. |
| **Impact** | For non-CKD users on prolonged cuts, protein reaches 2.6 g/kg — at the ISSN upper boundary. |
| **Fix** | Add a max duration cap (e.g., 24 weeks). Apply clinical overrides before sport clamping. |

### N-07 | HIGH | EA safety gate uses weekly EEE, not daily

| Field | Detail |
|---|---|
| **Location** | Lines 6055–6063 (`calculateUserMacros`) |
| **Problem** | `eee = (workoutsWk) * 350` estimates weekly exercise energy expenditure but the EA formula treats it as daily. A user training 5x/week gets `eee = 1750`, making `(targetKcal - 1750) / _lbm` very low, triggering the EA floor too aggressively. |
| **Impact** | EA safety gate overestimates exercise energy expenditure by ~7x, causing higher-than-expected calorie targets with EA-related toasts. |
| **Fix** | Divide EEE by 7: `const eee = (parseInt(p.workoutsWk)||0) * 350 / 7;` to get daily average. |

### N-08 | MEDIUM | NaN possible with corrupted profile data

| Field | Detail |
|---|---|
| **Location** | Line 5989 (`calculateUserMacros`) |
| **Problem** | `w = parseFloat(p.weight)` with no NaN guard. If `p.weight` is undefined or non-numeric, all downstream calculations produce NaN, which propagates into localStorage. |
| **Impact** | Corrupted profile data could break the entire UI and persist broken state. |
| **Fix** | Add defensive validation: `if (!w || w < 30 || w > 300 || isNaN(w)) return null;` and check for null at all call sites. |

### N-09 | MEDIUM | getLocalMealNames has no 6-meal mapping

| Field | Detail |
|---|---|
| **Location** | Lines 6733–6741 (`getLocalMealNames`), lines 6815–6820 (dist map) |
| **Problem** | Only maps 2–5 meals. For any other count, silently falls back to 3-meal layout. |
| **Impact** | Low risk — UI only offers 2–5. But programmatic misuse would produce incorrect plans. |
| **Fix** | Either add a 6-meal mapping or add explicit validation in `setMealsCount` to reject values outside 2–5. |

### N-10 | MEDIUM | Mod system can push calories ±500 kcal from target

| Field | Detail |
|---|---|
| **Location** | Lines 8528–8538 (`applyMod`) |
| **Problem** | Max 5 units × 100 kcal = ±500 kcal modifier. For a 1200 kcal floor user (female), applying -5 mod brings effective target to 700 kcal — well below the 1200 kcal floor. The floor is applied in `calculateUserMacros` but the mod is applied AFTER the floor in the rendering pipeline. |
| **Impact** | A user on the minimum caloric intake could see macros calculated from 700 kcal effective target, potentially receiving insufficient nutrition. |
| **Fix** | Apply `Math.max(floorKcal, ...)` when computing the mod-adjusted target in `renderMacros`. Consider reducing max mod units to 3 for users near the floor. |

### N-11 | LOW | Sport dropdown hardcoded Italian option text

| Field | Detail |
|---|---|
| **Location** | Lines 1155–1166 (`<select id="f-sport">`) |
| **Problem** | Option elements have hardcoded Italian text ("Forza / Potenza", "Resistenza", etc.) not wrapped in `t()`. |
| **Impact** | English users see Italian sport names during onboarding. |
| **Fix** | Populate options dynamically with translated strings or use `data-i18n` attributes. |

### N-12 | INFO | TDEE formula hierarchy correctly implemented

| Field | Detail |
|---|---|
| **Location** | Lines 5992–6012 |
| **Finding** | Katch-McArdle (when BF% available) → Harris-Benedict Rev. 2023 (T2D/metabolic/BMI>30) → Mifflin-St Jeor (default). Male: `10w+6.25ht-5age+5`. Female: `10w+6.25ht-5age-161`. Both match published equations. ✓ |

### N-13 | INFO | Activity multipliers follow standard HB PAL classification

| Field | Detail |
|---|---|
| **Location** | Line 6038 |
| **Finding** | PAL base: 0wk=1.200, 1-2=1.375, 3-4=1.550, 5=1.725, 6+=1.900. These match standard Harris-Benedict activity categories with NEAT additive from step count. Cap at 3.4 prevents unreasonable values. ✓ |

### N-14 | INFO | Clinical protocol overrides are medically accurate

| Field | Detail |
|---|---|
| **Location** | Lines 6065–6096, 5928–5931 (NC constants) |
| **Finding** | CKD: 0.8g/kg (KDIGO/ADA), IBD acute: 1.5g/kg (ESPEN), IBD remission: 1.0g/kg, Elderly: 1.2g/kg, DASH: Na<1500mg, K≥4700mg, Ca≥1250mg. All match current clinical guidelines. ✓ |

---

## DOMAIN 6 — ONBOARDING

### O-01 | HIGH | Onboarding interrupt does not restore state

| Field | Detail |
|---|---|
| **Location** | Lines 9678–9687 (`showOnb`), 9688–9690 (`mountApp`) |
| **Problem** | When onboarding is re-opened (after app close/reload), `showOnb()` resets `curStep=0` and creates fresh `profState`/`prefState`. There is no mechanism to detect partial onboarding and restore the user's position. The localStorage keys (`ik_onboarding_done`) are binary (true/false), not step-aware. |
| **Impact** | If a user completes step 3 of 5 and closes the app, they restart from step 0 with blank fields. This creates friction and may cause abandonment. |
| **Fix** | Save `curStep` and partial `profState`/`prefState` to localStorage on each step transition. On `showOnb()`, detect partial state and offer to resume. Add a key like `ik_onb_step` and `ik_onb_prof_partial`. |

### O-02 | HIGH | runCalcAndGenerate does not re-validate profState

| Field | Detail |
|---|---|
| **Location** | Lines 7458–7538 (`runCalcAndGenerate`) |
| **Problem** | The function calls `calculateUserMacros(profState)` at line 7473 without verifying that required fields exist. While `goStep()` validates at each step boundary, `runCalcAndGenerate()` can be called independently (e.g., from console, or if button is somehow triggered without stepping). No validation check ensures `age`, `height`, `weight`, `goal` are non-null before calculation. |
| **Impact** | If called with incomplete data, `calculateUserMacros` uses defaults (age=30, ht=175) which produces a plan for a wrong body profile. |
| **Fix** | Add a guard at the top of `runCalcAndGenerate`:
```
if (!profState.age || !profState.height || !profState.weight || !profState.goal) {
  toast(t('toast.compilaTutti'));
  return;
}
```
 |

### O-03 | HIGH | Double-tap on "Generate Plan" button can trigger concurrent generation

| Field | Detail |
|---|---|
| **Location** | Lines 7460–7462, 7537 (`runCalcAndGenerate`) |
| **Problem** | The button is disabled (`_genBtn.disabled=true`) at line 7462, but this happens synchronously. On slow devices, the first tap may not disable fast enough before a second tap fires. The disable happens BEFORE the calculation, so there is a race window. Additionally, the disable is re-enabled at line 7537 even if the generation partially fails. |
| **Impact** | Two concurrent plan generations could overwrite `window._pendingPlan` and `window._pendingRes`, causing the wrong plan to be activated. |
| **Fix** | Use a generation lock flag:
```
let _genLock = false;
function runCalcAndGenerate() {
  if (_genLock) return;
  _genLock = true;
  try { /* ... existing code ... */ }
  finally { _genLock = false; }
```
 |

### O-04 | MEDIUM | clearAppData leaves orphaned Supabase session

| Field | Detail |
|---|---|
| **Location** | Lines 8539–8540 (`clearAppData`, `KEEP_PREFIX`) |
| **Problem** | `KEEP_PREFIX = ['ikgdpr','iklang','iknotif']` preserves GDPR consent, language, and notification prefs. It does NOT clean the Supabase auth session (`sb-<ref>-auth-token`), Stripe state (`ik_trial_start`), or referral state. After clearing, the user may have an orphaned Supabase session pointing to a profile that no longer exists in localStorage. |
| **Impact** | After restart, the user may be authenticated with no local profile, seeing onboarding but the auth gate auto-passes. |
| **Fix** | Add Supabase session cleanup (`supabase.auth.signOut()`) to `clearAppData`. Consider adding `ik_trial_start` to `KEEP_PREFIX` to prevent trial abuse. Clear `ik-onb-skip` and `ik-onb-complete` flags. |

### O-05 | MEDIUM | Onboarding step transitions lack responsive safeguards

| Field | Detail |
|---|---|
| **Location** | Lines 426–500 (onboarding CSS), line 7426 (`goStep`) |
| **Problem** | The onboarding slide CSS uses percentage-based `transform:translateX(-N00%)` for transitions. At 320px viewport width, the `padding:20px 20px 14px` on `.onboarding-slide` leaves only 280px of content width. Several inline form elements (segment buttons, chips) may overflow. There are no `min-width` constraints or overflow protections on the slide containers. |
| **Impact** | On very small phones (320px), onboarding content may clip or overlap, making it impossible to complete certain steps. |
| **Fix** | Add `min-width:320px` to `#onb-screen` or `body`. Test all chip/segment layouts at 320px. Consider `overflow-x:auto` on chip containers. |

### O-06 | MEDIUM | Input validation range allows physiologically questionable values

| Field | Detail |
|---|---|
| **Location** | Lines 7429–7431 (`goStep` validation) |
| **Problem** | Age range: 16–80, Height: 140–220cm, Weight: 40–250kg. A 16-year-old at 140cm/40kg is a plausible teen athlete, but the system applies adult TDEE formulas without pediatric correction. Similarly, 250kg weight would produce extreme macros (250*2.2=550g protein). The BMI>30 trigger for HB Rev. formula is correct, but no special handling exists for BMI>50 (super-obesity). |
| **Impact** | Edge-case users may receive nutrition plans that are not clinically appropriate for their physiology. |
| **Fix** | Consider adding age-specific warnings for <18 users. For BMI>50, consider capping the plan and showing a medical disclaimer. The current validation ranges are reasonable for the general population. |

### O-07 | LOW | Onboarding placeholder text hardcoded Italian

| Field | Detail |
|---|---|
| **Location** | Line 1231 (`f-intolerances` placeholder) |
| **Problem** | `placeholder="es. lattosio, glutine, frutta secca…"` is hardcoded Italian. The line 4876 does translate it via `ph()`, but only after DOMContentLoaded. |
| **Impact** | Brief flash of Italian placeholder before translation applies. |
| **Fix** | Minor — the `ph()` function at line 4876 handles this. Could improve by setting placeholder via JS only, not in HTML. |

---

## DOMAIN 8 — I18N & TRANSLATIONS

### I-01 | HIGH | Many aria-labels hardcoded in Italian

| Field | Detail |
|---|---|
| **Location** | Lines 1539, 1541, 1580, 1593, 1620–1625, 1905, 2387–2399, 2409, 10709, 10762 |
| **Problem** | Over 15 `aria-label` attributes contain hardcoded Italian text: "Giorno precedente", "Giorno successivo", "Azzera acqua", "Azzera sale", "Fame", "Energia", "Aderenza", "Digestione", "Progresso calorico", "Oggi", "Progresso", "Config", "Aiuto", "Chiudi". While `applyTranslations()` at lines 4756–4822 dynamically updates SOME of these (lines 4818–4822 for day nav and reset buttons, lines 4784–4787 for check-in ranges), many remain untranslated in the initial HTML and some are never updated. |
| **Impact** | Screen readers read Italian labels to English users, making the app inaccessible to non-Italian speaking visually impaired users. |
| **Fix** | Add all remaining hardcoded aria-labels to the `applyTranslations()` function, using `t('aria.*')` keys. Ensure translation keys exist in both `LANG.it` and `LANG.en`. Affected: nav buttons (lines 2387–2399), install banner close (2409), SVG rings (1494, 1905), checkout/paywall close buttons (10709, 10762). |

### I-02 | HIGH | Food labels in buildSnack/buildBreakfast always Italian

| Field | Detail |
|---|---|
| **Location** | Lines 6989–7086 (`buildSnack`, `buildBreakfast`) |
| **Problem** | All `rest` strings in snack and breakfast pools are hardcoded Italian: "Yogurt greco 170g", "Avena 50g", "Pane integrale 60g", etc. The `localizeMealRest()` function at line 6211 only handles a fixed set of tokens from `buildMeal`'s output. The snack/breakfast strings are free-form text that doesn't match the token-splitting logic in `localizeMealRest()`. |
| **Impact** | English users see meal descriptions entirely in Italian for breakfast and snacks. This is a major UX gap. |
| **Fix** | Either: (a) build breakfast/snack descriptions from FOOD_DB entries (which have localized labels) instead of hardcoded strings, or (b) add comprehensive string-to-string translation maps in `localizeMealRest()` for every breakfast/snack variant. Option (a) is the sustainable fix. |

### I-03 | MEDIUM | isoDisp date format not locale-aware

| Field | Detail |
|---|---|
| **Location** | Line 5207 (`isoDisp`) |
| **Problem** | `isoDisp` always returns `DD/MM/YYYY` format regardless of locale. English convention is `MM/DD/YYYY` or `DD Mon YYYY`. |
| **Impact** | Dates displayed to English users use European format, which is acceptable for EU English but confusing for US users. |
| **Fix** | Use locale-aware formatting:
```
const isoDisp = iso => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(_lang === 'en' ? 'en-GB' : 'it-IT',
    { day: 'numeric', month: 'short', year: 'numeric' });
};
```
Note: the chart code at line 5810 already uses `toLocaleDateString` correctly — only `isoDisp` is affected. |

### I-04 | MEDIUM | Numeric formats not locale-aware

| Field | Detail |
|---|---|
| **Location** | Throughout (`.toFixed()` calls at lines 5457, 5459, 5675, 6157, etc.) |
| **Problem** | All numeric displays use `.toFixed()` which produces `1234.5` format. Italian locale expects `1234,5` (comma decimal separator). No `Intl.NumberFormat` or `toLocaleString()` is used for macro/calorie displays. |
| **Impact** | Italian users see period-separated decimals (e.g., "2.6g/kg") instead of comma-separated ("2,6g/kg"). Not a functional issue but poor localization. |
| **Fix** | Create a locale-aware number formatter utility:
```
const fmtNum = (n, decimals = 0) =>
  n.toLocaleString(_lang === 'en' ? 'en-GB' : 'it-IT',
    );
```
 |

### I-05 | MEDIUM | Onboarding field labels partially hardcoded Italian

| Field | Detail |
|---|---|
| **Location** | Lines 4839–4876 (`applyTranslations` for onboarding) |
| **Problem** | The `applyTranslations()` function handles onboarding field labels dynamically, but the initial HTML contains Italian text that flashes before JS runs. The sport `<select>` options (lines 1155–1166) are never translated. |
| **Impact** | FOUC (Flash of Untranslated Content) on first load for English users. |
| **Fix** | Set initial HTML text via `data-i18n` attributes and populate from translations on DOMContentLoaded. Translate sport select options. |

### I-06 | LOW | t() fallback returns raw key for missing translations

| Field | Detail |
|---|---|
| **Location** | Line 4539 (`function t()`) |
| **Problem** | Fallback chain is `LANG[_lang][key] ?? LANG.it[key] ?? key`. If a key is missing from both `en` and `it`, the raw key string (e.g., `"toast.compilaTutti"`) is displayed. No warning or logging. |
| **Impact** | Missing translations display as raw key identifiers — confusing but functional. |
| **Fix** | Add `console.warn` in development mode for missing keys. Consider a `[?]` prefix for untranslated strings during testing. |

### I-07 | LOW | Coach detail uses Italian sport labels for English users

| Field | Detail |
|---|---|
| **Location** | Lines 7491–7492 (`_sportLabels`, `_sportSystems`) |
| **Problem** | Sport label map is hardcoded Italian: `'strength':'Forza/Potenza'`. Rendered into plan detail text in the result card. |
| **Impact** | English users see Italian sport classification in the plan details card. |
| **Fix** | Use `t()` keys: `'strength': t('sport.label.strength')`. |

---

## DOMAIN 9 — ACCESSIBILITY & UX

### A-01 | HIGH | Touch targets below 44x44px on day navigation buttons

| Field | Detail |
|---|---|
| **Location** | Lines 1539, 1541 (shiftDay buttons) |
| **Problem** | Day navigation buttons have `width:30px;height:30px` — below WCAG 2.5.5 minimum of 44x44px. The `.btn-icon` class defaults to 44px (line 103), but inline styles override this. |
| **Impact** | Users with motor impairments or large fingers struggle to tap day arrows on mobile. |
| **Fix** | Remove inline `width:30px;height:30px` overrides or increase to 44px. Use padding to maintain visual size while meeting touch target minimum. |

### A-02 | MEDIUM | Focus trap not applied to all modals

| Field | Detail |
|---|---|
| **Location** | Lines 9745–9764 (`trapFocus`, `releaseFocus`) |
| **Problem** | `trapFocus()` is called in `openConfirmModal()` (line 8555) but NOT in `showConfirm()`, paywall overlay, checkout preview, shopping list, or help modals. Escape handler only matches `.modal-overlay.on`. |
| **Impact** | Keyboard users can tab out of modals into background — WCAG 2.4.3 violation. |
| **Fix** | Apply `trapFocus()` to ALL modal-opening functions. Standardize modal open/close with shared utility. |

### A-03 | MEDIUM | Loading states not communicated to screen readers

| Field | Detail |
|---|---|
| **Location** | Line 7462 (generation button text change) |
| **Problem** | During plan generation, button text changes to "Generating..." but no `aria-busy="true"` on container, no `aria-live` region for progress, no `role="alert"` on completion. |
| **Impact** | Screen reader users have no indication that generation is in progress or complete. |
| **Fix** | Add `aria-busy="true"` during generation. Add `aria-live="polite"` region announcing "Plan generated". Use `role="status"` on preview container. |

### A-04 | MEDIUM | Error states not fully announced to screen readers

| Field | Detail |
|---|---|
| **Location** | Lines 7415–7423 (`validateOnbField`) |
| **Problem** | On validation failure, toast shows and border turns red, but no `aria-invalid="true"` on input, no `aria-errormessage` pointing to error description. Toast has `aria-live="polite"` but with delay. |
| **Impact** | Screen reader users may not immediately understand which field failed or why. |
| **Fix** | Set `aria-invalid="true"` on failing input. Add `aria-errormessage` element. Use `aria-live="assertive"` for validation errors. |

### A-05 | MEDIUM | Color contrast insufficient for dim text (WCAG AA violation)

| Field | Detail |
|---|---|
| **Location** | Line 30 (`--dim:rgba(199,196,216,.28)`) |
| **Problem** | `--dim` at 28% opacity on `#0e0e0e` background produces ~2.3:1 contrast ratio, failing WCAG AA (requires 4.5:1 for normal text). Many UI elements use `--dim` for labels. `--muted` at 55% is borderline at ~4.5:1. |
| **Impact** | Users with low vision cannot read dimmed text. WCAG AA violation. |
| **Fix** | Increase `--dim` from 0.28 to at least 0.47 for 4.5:1 contrast. Increase `--muted` from 0.55 to 0.60 for safety margin. |

### A-06 | LOW | Some icon-only buttons missing descriptive ARIA labels

| Field | Detail |
|---|---|
| **Location** | Line 8250 (plan note close), line 5563 (fingerprint tip) |
| **Problem** | Close button uses `aria-label="Chiudi"` (hardcoded Italian). Fingerprint tip button has generic `aria-label="Info"`. Not translated, not descriptive. |
| **Impact** | Screen reader users hear non-descriptive or Italian-only labels. |
| **Fix** | Use descriptive, translated aria-labels: `t('aria.close.planNote')`, `t('aria.info.fingerprint')`. |

---

## FINDINGS SUMMARY

| ID | Severity | Domain | Title | Line(s) |
|---|---|---|---|---|
| N-01 | CRITICAL | Nutrition | Missing FODMAP flag on apple and pear | 6446, 6448 |
| N-02 | CRITICAL | Nutrition | buildSnack ignores excluded allergens | 6989–7022 |
| N-03 | CRITICAL | Nutrition | buildBreakfast ignores most excluded allergens | 7025–7086 |
| N-04 | HIGH | Nutrition | TEF potentially double-counted in TDEE | 6129 |
| N-05 | HIGH | Nutrition | Meal distribution rounding causes sum drift | 6836–6838 |
| N-06 | HIGH | Nutrition | Progressive protein rate unbounded by time | 5362 |
| N-07 | HIGH | Nutrition | EA safety gate uses weekly EEE not daily | 6055–6063 |
| O-01 | HIGH | Onboarding | Onboarding interrupt does not restore state | 9678–9687 |
| O-02 | HIGH | Onboarding | runCalcAndGenerate does not re-validate profState | 7458–7538 |
| O-03 | HIGH | Onboarding | Double-tap can trigger concurrent generation | 7460–7462 |
| I-01 | HIGH | I18n | Many aria-labels hardcoded in Italian | 1539,1541,2387–2399 |
| I-02 | HIGH | I18n | Food labels in buildSnack/buildBreakfast always Italian | 6989–7086 |
| A-01 | HIGH | A11y | Touch targets below 44x44px on day nav buttons | 1539, 1541 |
| N-08 | MEDIUM | Nutrition | NaN possible with corrupted profile data | 5989 |
| N-09 | MEDIUM | Nutrition | getLocalMealNames has no 6-meal mapping | 6733–6741 |
| N-10 | MEDIUM | Nutrition | Mod system can push calories below floor | 8528–8538 |
| O-04 | MEDIUM | Onboarding | clearAppData leaves orphaned Supabase session | 8539–8540 |
| O-05 | MEDIUM | Onboarding | Step transitions lack responsive safeguards at 320px | 426–500 |
| O-06 | MEDIUM | Onboarding | Input validation allows edge-case physiologies | 7429–7431 |
| I-03 | MEDIUM | I18n | isoDisp date format not locale-aware | 5207 |
| I-04 | MEDIUM | I18n | Numeric formats not locale-aware | throughout |
| I-05 | MEDIUM | I18n | Onboarding field labels flash Italian before JS | 4839–4876 |
| A-02 | MEDIUM | A11y | Focus trap not applied to all modals | 9745–9764 |
| A-03 | MEDIUM | A11y | Loading states not communicated to screen readers | 7462 |
| A-04 | MEDIUM | A11y | Error states not fully announced to screen readers | 7415–7423 |
| A-05 | MEDIUM | A11y | Color contrast insufficient for dim text (WCAG AA) | 30 |
| N-11 | LOW | Nutrition | Sport dropdown hardcoded Italian option text | 1155–1166 |
| O-07 | LOW | Onboarding | Placeholder text hardcoded Italian | 1231 |
| I-06 | LOW | I18n | t() fallback returns raw key for missing translations | 4539 |
| I-07 | LOW | I18n | Coach detail uses Italian sport labels | 7491–7492 |
| A-06 | LOW | A11y | Icon buttons missing descriptive ARIA labels | 8250, 5563 |

**Totals:** 3 CRITICAL · 10 HIGH · 11 MEDIUM · 5 LOW · 2 INFO (N-12, N-13, N-14 are INFO not listed in table)

---

## PRIORITY RECOMMENDATIONS

1. **Immediate (CRITICAL):** Fix N-01 (FODMAP flags), N-02 and N-03 (allergen filtering in buildSnack/buildBreakfast). These are food safety issues.
2. **Next sprint (HIGH):** Fix O-01/O-02/O-03 (onboarding robustness), N-07 (EA gate), I-01/I-02 (i18n gaps), A-01 (touch targets).
3. **Backlog (MEDIUM/LOW):** Address remaining i18n, a11y, and nutrition accuracy items.
