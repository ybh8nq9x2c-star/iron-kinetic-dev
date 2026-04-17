# i18n CRITICAL / MEDIUM / MINOR Fixes Summary

**Commit:** `e398e61`  
**Branch:** `main` → `origin/main` (iron-kinetic-dev)  
**Date:** 2026-04-17  
**File:** `index.html`  
**Delta:** +36 / -65 lines (net -29 lines)  

---

## GROUP 1: CRITICAL (13 issues → 13 fixed)

### C1–C5: Missing Dictionary Keys (5 fixed)
These keys were already added in the prior HIGH commit `4d16d5d`. Verified present in both IT and EN dictionaries:
- `faq.a.10.html` — FAQ answer 10 (referral program)
- `prv.badge` — Privacy badge text
- `prv.s5b.h` — Privacy section 5b heading
- `prv.title` — Privacy modal title
- `weekly.report.label.energia` — Weekly report energy label

### C6–C12: Hardcoded Toasts (7 fixed)
Wrapped in `t()` with new dictionary keys:

| # | Location | Old | New Key |
---|----------|-----|---------|
| C6 | L2864 | `'⚠️ Pagamento in ritardo...'` | `t("toast.paymentLate",{gg:hours})` |
| C7 | L3158 | `'Auth non configurata'` | `t("toast.authNotConfigured")` |
| C8 | L3162 | `'✉️ Link di accesso inviato a...'` | `t("toast.loginLinkSent",{email:...})` |
| C9 | L3167 | `'⏱ Ultimo giorno di prova...'` | `t("toast.lastTrialDay")` |
| C10 | L3172 | `'Auth non configurata'` (dup) | `t("toast.authNotConfigured")` |
| C11 | L3195 | `'Auth non configurata'` (trip) | `t("toast.authNotConfigured")` |
| C12 | L9194 | `` `⚠️ ${importErrors} import error(s)...` `` | `t("toast.importErrors",{n:importErrors})` |

New keys added to **both IT and EN** dictionaries:
- `toast.paymentLate`
- `toast.authNotConfigured`
- `toast.loginLinkSent`
- `toast.lastTrialDay`
- `toast.importErrors`

### C13: Placeholder Mismatch (1 fixed)
EN `sub.trial.subtitle` was missing `{r}` placeholder used by IT for gendered suffix agreement.
- **Fix:** Added `{r}` to EN value — resolves to empty string since English doesn't need gendered agreement.

---

## GROUP 2: MEDIUM (10 issues → 10 fixed)

### M1–M10: Fragile Text-Matching Patches
Replaced brittle `textContent` comparisons with `data-i18n` attributes on HTML elements.

**HTML elements modified:**

| # | Element | data-i18n Key |
---|---------|---------------|
| M1 | `.check-card .field-label` (Contesto giornata) | `oggi.checkin.contesto` |
| M2 | `#wk-status` (Non fatto) | `oggi.workout.nonFatto` |
| M3 | `#wk-btn` (Fatto ✓) | `oggi.workout.fatto` |
| M4 | `#mod-status` (Base invariata) | `set.mod.base` |
| M5 | `[onclick="applyMod(0)"]` button | Already had data-i18n; simplified JS |
| M6 | `#acc-danger .sn.t-xxs.muted` | Already had data-i18n; removed fallback |
| M7 | scr-info `>Versione<` span | `info.app.versione` |
| M8 | scr-info `>Storage<` span | `info.app.storage` |
| M9 | scr-info `>Dati su server<` span | `info.app.server` |
| M10a | scr-info `>Cookie<` span | `info.app.cookie` |
| M10b | scr-info `>Tracking<` span | `info.app.tracking` |

**Patches removed from `applyTranslations()`:**
- M1: `check-card .field-label` text match (3 lines removed)
- M2: `wk-status` text match (2 lines removed)
- M3: `wk-btn` text match (2 lines removed)
- M4: `mod-status` text match (2 lines removed)
- M5: `applyMod(0)` text includes (simplified to unconditional)
- M6: `#acc-danger` text match (3 lines removed, 2 instances)
- M7–M10: `#scr-info .rowb` text match (9 lines removed)
- Second scr-info path (11 lines removed)

**Note:** M2/M3/M4 elements have dynamic state. The `data-i18n` attribute sets the default translation; the render functions (e.g., `renderToday`, `applyMod`) override with state-dependent values on render.

---

## GROUP 3: MINOR — Orphan Dictionary Keys

### Keys Removed (4 dead keys = 8 dictionary entries)
Only keys with **zero code references** were removed:
- `autoadj.fast_loss.title` (IT + EN)
- `autoadj.maintain_drift.title` (IT + EN)
- `autoadj.slow_loss.title` (IT + EN)
- `lang.gate.title` (IT + EN)

### Keys Preserved (investigation found they ARE used)

The audit originally classified 27+ additional keys as orphans. Investigation revealed they are actively used via:

| Category | Usage Pattern | Example |
----------|---------------|----------|
| `adaptive.rule.*` | `key:` in adaptive rules object | `'adaptive.rule.canIntensify'` at L5545 |
| `ci.fb.*` | `t()` conditional call | `t(goal==='cut_extreme'?'ci.fb.tip_cut':'ci.fb.tip_other')` |
| `coach.bodycomp.recomp` | `msg:` in coach logic | `{shift:150,msg:'coach.bodycomp.recomp'}` |
| `coach.micro.*` | `msg:` in coach logic | `{level:'high',msg:'coach.micro.b12high'}` |
| `coach.msg.*` | `t()` conditional call | `t(goal==='cut_extreme'?'coach.msg.tip_cut':'coach.msg.tip_other')` |
| `logout` | `t()` in signOut | `lbl.textContent=t('logout')` |
| `syn.*` | `labelKey:` in sync quality map | `{labelKey:'syn.buona'}` |
| `sub.paid.*` | `t()` in subscription UI | `t(isLT?'sub.paid.detail.lifetime':...)` |
| `misc.locale` | Dictionary entries (value refs) | Part of compound dictionary line |

---

## Verification

### Syntax Checks (all passed)
```
✅ Block-level JS syntax validation (all <script> blocks)
✅ server.js syntax check
✅ sw.js syntax check
```

### Key Integrity
- IT dictionary key count: maintained
- EN dictionary key count: maintained
- IT/EN parity: maintained
- All new keys present in both dictionaries

---

## Backup

- **Backup branch:** `backup/20260417140725` (pre-fix snapshot)

---

## Remaining Work

The audit identified additional categories of i18n issues that were **out of scope** for this fix:
- 40+ `prv.*` privacy modal keys exist but HTML uses hardcoded text with `data-i18n` on some elements
- 24 `help.feature.*` keys exist but help modal feature cards may use dynamic rendering
- `confirm.*` keys exist but confirm() dialogs use `_lang` ternaries
- Various nav/UI labels still set by `_nm` map rather than `data-i18n`

These can be addressed in a follow-up pass if needed.
