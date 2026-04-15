# Chunk 4 Audit Findings: Lines 6481–8640

**Auditor:** Agent Zero 'Master Developer'  
**Date:** 2026-04-15  
**File:** `/a0/usr/projects/iron_kninetic/index.html`  
**Lines:** 6481–8640 (2,160 lines)  
**Scope:** FOOD_DB completion, FOOD_ALIASES, resolveExtraFoods(), generatePersonalizedPlan(), buildMeal(), buildSnack(), buildBreakfast(), AI Coach analyzeState(), onboarding setters, goStep(), runCalcAndGenerate(), activateGeneratedPlan(), trend lock/paywall, check-in system, coach rendering, accordion UI, macros, trackers, meal rendering, kcal ring, refeed, settings, profile, confirm modals, reset profile

---

## Summary

| Severity | Count | Key Issues |
|----------|-------|------------|
| 🔴 Critical | 3 | Alias target typo breaks tonno lookup; IBS breakfast includes FODMAP food; render function mutates persisted state |
| 🟠 High | 6 | Duplicate alias keys with conflicting targets; hardcoded IT strings in i18n app; distribution map duplicated 3× |
| 🟡 Medium | 9 | Inline style duplication; aria-label hardcoded; fragile selectors; side-effects in render; DRY violations |
| 🔵 Low | 7 | Cosmetic / minor code quality issues |

---

## 🔴 Critical Findings

### C1. FOOD_ALIASES Typo Breaks 'tonno sott'olio' Lookup
**Lines:** 6593  
**Category:** Bug  

```js
'tonno olio':'tonno sott olio',  // ← MISSING apostrophe
```

The alias target `'tonno sott olio'` should be `'tonno sott\'olio'` to match the FOOD_DB key on line 6535 (`'tonno sott\'olio':'tonno'`). As-is, any user typing "tonno olio" will map to a non-existent FOOD_DB key, causing the food to be classified as `unrecognized` instead of resolving to `tonno`.

**Fix:** Change to `'tonno olio':'tonno sott\'olio'` (or directly to `'tonno'` since the FOOD_DB key is `tonno`).

---

### C2. IBS Breakfast Includes High-FODMAP Hummus
**Lines:** 7045  
**Category:** Bug / Nutrition Safety  

```js
// Inside isIBS → vegano → salato breakfast
{carbSource:'pane',baseAmount:60,
  rest:'Pane di segale 60g, Hummus 80g, Cetrioli, Olio EVO 8g, Semi di lino 10g'},
```

`hummus` is marked `fodmap:true` in FOOD_DB (line 6506), yet it appears in an IBS-safe breakfast path. The `buildBreakfast` function does not apply FODMAP filtering to its hardcoded meal templates.

**Impact:** IBS users receive dietary advice that contradicts their clinical constraint.  
**Fix:** Replace hummus with a FODMAP-safe alternative (e.g., tofu spread, olive tapenade without garlic).

---

### C3. _renderProfileCard Mutates Persisted State During Render
**Lines:** 8474–8482  
**Category:** Bug / Side-Effect  

```js
function _renderProfileCard(prof){
  // ...
  if(typeof calculateUserMacros==='function'&&(!_bmr||_bmr<500)){
    try{
      const m=calculateUserMacros(prof);
      // ...mutates prof object in-place...
      if(_targetKcal)prof.targetKcal=_targetKcal;
      if(_bmr)prof.bmr=_bmr;
      try{lsS(SK.profile,prof);}catch(e){}  // ← WRITES TO localStorage DURING RENDER
    }
  }
}
```

A render function should be a pure read-only operation. This function mutates the `prof` object and writes to `localStorage` as a side effect. If `calculateUserMacros` returns stale or incorrect values, this silently corrupts the user's profile. It also makes the render non-idempotent — calling it twice may produce different results.

**Fix:** Extract the BMR migration logic to a separate function called once during `mountApp()`, not during render.

---

## 🟠 High Findings

### H1. Duplicate FOOD_ALIASES Keys — Last-Wins Causes Silent Overrides
**Lines:** 6540 vs 6597, 6558 vs 6627, 6490 vs 6667, 6526  
**Category:** Bug  

JavaScript object literals silently overwrite duplicate keys. The following aliases have conflicting mappings:

| Key | First Mapping | Second Mapping | Effective |
|-----|--------------|----------------|-----------|
| `'ceci'` | → `'legumi'` (L6540) | → `'ceci'` (L6597) | `'ceci'` ✓ |
| `'banana'` | → `'frutta'` (L6558) | → `'banana'` (L6627) | `'banana'` ✓ |
| `'arachidi'` | → `'arachidi'` (L6667, self-map) | FOOD_DB direct key (L6490) | Works but redundant |
| `'platessa'` | → `'platessa'` (L6526, self-map) | — | Redundant |

The `'ceci'` and `'banana'` overrides happen to be correct (specific > generic), but they're fragile — a future edit could reorder and break the intended behavior.

**Fix:** Remove the generic mappings from lines 6540/6558 for keys that have specific entries later, and remove self-mapping aliases.

---

### H2. Hardcoded Italian Strings Despite i18n System
**Lines:** 7491–7494, 7957, 8000–8001, 8248, 8331, 8403, 8417, 8429, 8457, 8535  
**Category:** i18n  

Multiple UI-visible strings are hardcoded in Italian or English instead of using the `t()` function:

| Line | Hardcoded String | Should Use |
|------|-----------------|------------|
| 7491–7494 | Sport labels ("Forza/Potenza", "Resistenza") | `t('sport.strength')`, etc. |
| 7957 | "GIORNO ALLENAMENTO" / "TRAINING DAY" | `t('macro.training')`, `t('macro.rest')` |
| 8000 | `+${a}L → ${n.toFixed(1)}L` (toast) | `t('toast.waterAdded', ...)` |
| 8001 | `+${a}g → ${n.toFixed(1)}g` (toast) | `t('toast.saltAdded', ...)` |
| 8248 | Plan update note message | `t('plan.update.note', ...)` |
| 8331 | `aria-label="...rimaste"` | `t('aria.kcalRemaining')` |
| 8403 | "Trial — X giorni", "Piano Base" | `t('sub.trial')`, `t('sub.base')` |
| 8417 | "days" / "giorni" | `t('prof.days')` |
| 8429 | "change" / "variaz." | `t('prof.change')` |
| 8457 | PHASE_HINTS inline object | Extract to i18n keys |
| 8535 | "Unità:" | `t('mod.units')` |

**Impact:** English-language users see Italian text in these locations.

---

### H3. Meal Distribution Map Duplicated 3× (DRY Violation)
**Lines:** 6815–6820, 8260, 8283  
**Category:** DRY / Maintainability  

The kcal distribution map is defined identically in three places:

```js
const dist={2:[0.45,0.55],3:[0.25,0.40,0.35],4:[0.20,0.35,0.10,0.35],5:[0.20,0.30,0.10,0.30,0.10]}
```

Any change to meal distribution logic must be applied in all three locations.

**Fix:** Extract to a shared constant: `const MEAL_DIST = {2:[0.45,0.55], ...};`

---

### H4. buildBreakfast Has No FODMAP/Allergen Filtering on Hardcoded Meals
**Lines:** 7031–7085  
**Category:** Bug / Nutrition Safety  

`buildBreakfast()` returns hardcoded meal objects that bypass the CSP filter (`cspFilter`) used in `generatePersonalizedPlan()`. While line 7031 checks `isIBS`, the `vegan→salato` path (line 7045) includes hummus. Additionally, none of the breakfast templates check for individual `excluded` allergens.

**Fix:** Add a runtime filter or post-check that validates hardcoded breakfast ingredients against the user's exclusion list and FODMAP flags.

---

### H5. Onboarding Trial Start Bypasses Storage Helpers
**Line:** 7575  
**Category:** Consistency / Data Integrity  

```js
localStorage.setItem('ik_trial_start', Date.now().toString());
```

Direct `localStorage.setItem` instead of `lsS()` or `lsW()` used everywhere else. This bypasses any storage abstraction, potential error handling, or future migration path.

**Fix:** Use `lsW('ik_trial_start', Date.now().toString())` or `lsS('ik_trial_start', ...)`.

---

### H6. weeklyRate Sign Convention Is Confusing
**Lines:** 7128, 7131, 7185, 7238, 7255, 7268  
**Category:** Code Clarity  

The negation convention is counter-intuitive:
```js
weeklyRate = -(num/den*7);  // positive = weight LOSS
```

Later checks use:
```js
weeklyRate > 0.75   // means FAST weight loss (catabolism warning)
weeklyRate > 0      // means weight is decreasing (losing)
weeklyRate < -0.1   // means weight is INCREASING (gaining)
```

A developer unfamiliar with this convention could easily introduce sign errors. This is not a bug but a maintenance hazard.

**Fix:** Rename to `weeklyLossRate` or add a prominent comment block explaining the sign convention.

---

## 🟡 Medium Findings

### M1. Inline CSS Duplication in Coach Badge Rendering
**Lines:** 7810–7824, 7831–7834  
**Category:** Code Quality  

The micro-risk badge and body-comp badge set 5+ inline style properties each render cycle. These should use CSS classes (as was done for the coach card in FIX12, line 7781–7783).

---

### M2. renderCoach Re-Parses localStorage on Every Call
**Line:** 7801  
**Category:** Performance  

```js
const _cksCoach = JSON.parse(localStorage.getItem(SK.checkins)||'[]').slice(-3);
```

`renderCoach()` is called frequently (on meal toggle, tracker update, tab switch). Each call re-parses the full checkins array from localStorage.

**Fix:** Cache the parsed checkins data and invalidate on write.

---

### M3. Fragile Button Selector in runCalcAndGenerate
**Line:** 7460  
**Category:** Robustness  

```js
const _genBtn = document.querySelector('button[onclick="runCalcAndGenerate()"]');
```

This selector depends on the exact onclick attribute string matching, which could break if the HTML is reformatted or the function name changes. Use an `id` instead.

---

### M4. PHASE_HINTS Object Recreated on Every renderSettings() Call
**Line:** 8457  
**Category:** Performance  

A large inline object literal with IT/EN translations is allocated inside `renderSettings()` every time it's called. Extract to module scope.

---

### M5. resetT() Builds HTML from User-Controlled Parameter
**Line:** 8004  
**Category:** Security (Minor)  

```js
'<button onclick="sT(\''+tp+'\','+prev+');renderTrackers();closeToast()" ...'
```

The `tp` parameter comes from an `onclick` attribute in HTML. While currently only called with hardcoded tracker types, this pattern is fragile against future changes that might pass unsanitized input.

---

### M6. kcal Ring KCAL_CIRC Constants Potentially Inconsistent
**Lines:** 8300, 8325  
**Category:** Bug (Minor)  

Two different circumference constants are used:
- Line 8300: `KCAL_CIRC = 552.9` (main ring)
- Line 8325: `KCAL_CIRC2 = 106.8` (mini ring, comment: "2π × 17 ≈ 106.8")

Line 8300 has no matching SVG radius comment. The value 552.9 seems very large for a typical SVG ring. Verify against actual SVG `r` attribute and `viewBox`.

---

### M7. Check-In Feedback Logic Has Overlapping Conditions
**Lines:** 7658–7679  
**Category:** Logic  

```js
if(entry.hunger>=8 && entry.energy>=7 && entry.adherence>=7)  // 6a
else if(entry.hunger>=8 && entry.adherence<=5)                // 6b
else if(entry.energy<=3)                                      // 6c
else if(entry.energy<=5)                                      // 6d
```

Condition 6d (`energy<=5`) is a superset of 6c (`energy<=3`). If energy is 2, 6c fires; if 4–5, 6d fires. This is intentional but could be clearer with explicit range checks.

---

### M8. Two Separate Confirm Modal Implementations
**Lines:** 8543–8556 (`openConfirmModal`/`closeConfirmModal`) vs 8565–8585 (`showConfirm`/`closeConfirm`)  
**Category:** DRY / Confusion  

Two different confirm dialog systems exist with overlapping naming. `openConfirmModal()` uses elements `confirm-modal-*`, while `showConfirm()` uses `modal-confirm` and `confirm-*`. This could confuse future developers.

**Fix:** Consolidate into a single confirm dialog implementation.

---

### M9. _doResetProfile Doesn't Reset All In-Memory State
**Lines:** 8619–8624  
**Category:** Bug (Minor)  

Resets `profState`, `prefState`, `curStep`, `dietData`, `_macroCache`, and charts, but does NOT reset: `selDay`, `_mealRenderCache`, `_regenSeed`, `_tabDirty`, `activeTab`, or `selectedCheckTag`. After a reset, stale values from the previous profile could persist.

---

## 🔵 Low Findings

### L1. Self-Referencing Aliases Add Noise
**Lines:** 6526, 6531, 6532, 6537, 6538, 6551, 6552, 6557, 6561, 6572, 6574, 6583, 6587, 6588, etc.  

Many aliases map to themselves (`'platessa':'platessa'`, `'orata':'orata'`, etc.). These are harmless but add unnecessary bytes and cognitive noise. They exist because the alias lookup precedes direct FOOD_DB lookup in `resolveExtraFoods()`.

---

### L2. `_regenSeed` Used But Not Defined in Visible Scope
**Lines:** 7019, 7028  

`_regenSeed` is referenced in `buildSnack()` and `buildBreakfast()` but its declaration is outside this chunk. Ensure it's properly initialized before first use.

---

### L3. CSS.escape Usage Without Polyfill Check
**Line:** 8123  

`CSS.escape()` is not supported in all browsers. If the PWA targets older mobile browsers, a polyfill or fallback should be added.

---

### L4. _mealRenderCache Invalidation Incomplete
**Lines:** 7899, 8032  

`_mealRenderCache` is reset in `shiftDay()` and day-chip click, but not when the modifier changes or when refeed is toggled — both of which change the rendered meal content.

---

### L5. Salt Tracker Hardcoded SMAX=6g
**Line:** 7964  

`const SMAX=6` is hardcoded. DASH users have a lower sodium target (typically <5g salt). Should be adjusted based on `prof.sodiumMax` if available.

---

### L6. localizeFoodLabel / localizeMealRest Not Defined in This Chunk
**Lines:** 8134, 8162  

These functions are called in `renderMeals()` but defined outside this chunk. Ensure they exist and handle edge cases (null labels, undefined food keys).

---

### L7. getBodyCompShift Direction May Be Inconsistent
**Line:** 7762  

```js
const wstDelta = (Number(wLogs[0].waist) - Number(wLogs[wLogs.length-1].waist)) / Number(wLogs[0].waist) * 100;
```

This computes `(oldest - newest) / oldest`. Positive means waist decreased (good for recomp). But `waistDelta` in `analyzeState()` (line 7136) uses `newest - oldest` (negative = waist decreased). The two functions use opposite conventions, which could confuse maintainers.

---

## Conclusion

This chunk contains the core nutrition engine: food database, plan generation, meal building, and the AI coaching waterfall. The architecture is sophisticated — coprime rotation for meal variety, TEF-aware calorie distribution, FODMAP filtering, and evidence-based coaching with literature citations.

**Priority fixes:**
1. **C1** (alias typo) — one-line fix, breaks food lookup
2. **C2** (IBS + hummus) — nutrition safety, replace with FODMAP-safe alternative
3. **C3** (render side-effect) — extract migration to mount-time
4. **H2** (hardcoded strings) — systematic i18n pass over listed lines
5. **H3** (DRY distribution map) — extract to shared constant

The codebase is well-structured for its scale but would benefit from: extracting the inline i18n strings, centralizing duplicated constants, and enforcing render-function purity.
