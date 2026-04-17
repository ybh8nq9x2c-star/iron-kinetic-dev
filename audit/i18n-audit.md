# i18n/Translation Comprehensive Audit Report

**Project:** Iron Kinetic PWA  
**File:** `index.html` (11,085 lines)  
**Date:** 2026-04-17  
**Auditor:** Agent Zero 'Deep Research'  
**Methodology:** Automated static analysis + manual cross-reference  
**Status:** AUDIT ONLY — no code was modified

---

## SEZIONE A — Executive Summary

### Overall i18n Health

| Metric | Value | Status |
|--------|-------|--------|
| IT dictionary keys | 868 | ✅ |
| EN dictionary keys | 868 | ✅ |
| IT/EN key parity | Perfect (0 mismatches) | ✅ |
| `t()` call sites | 734 (607 unique keys) | ✅ |
| `data-i18n` attributes | 113 (112 unique) | ✅ |
| `data-i18n-html` attributes | 11 | ✅ |
| `data-i18n-aria` attributes | 3 | ✅ |
| Dynamic key prefixes | 10 (covering 103 keys) | ✅ |
| Placeholder consistency | 1 mismatch / 868 keys | ⚠️ |

### Problem Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 13 | Broken display, missing keys, hardcoded user-facing strings |
| HIGH | 93 | Hardcoded Italian in HTML, _lang ternary bypasses |
| MEDIUM | 10 | Fragile text-matching patches in applyTranslations() |
| MINOR | 137 | Orphan dictionary keys (unused bloat) |
| **TOTAL** | **253** | |

### Categories with Critical Coverage Gaps

| Category | Keys | `t()` Used | Coverage | Issue |
|----------|------|-----------|----------|-------|
| prv (Privacy) | 57 | 1 | 2% | Privacy modal almost entirely hardcoded |
| faq | 22 | 2 | 9% | FAQ populated dynamically, but orphans remain |
| clinical | 14 | 2 | 14% | Clinical condition labels unused |
| help | 33 | 8 | 24% | Help feature cards untranslated |
| shop | 6 | 1 | 17% | Shopping categories use dynamic prefix only |
| style | 3 | 1 | 33% | Diet style labels barely referenced |
| taste | 3 | 1 | 33% | Taste preference labels barely referenced |
| goal | 14 | 6 | 43% | Goal labels partially covered by dynamic prefix |
| adaptive | 7 | 3 | 43% | Adaptive rule keys unused |
| tdee | 7 | 3 | 43% | TDEE card keys unused |
| nav | 4 | 0 | 0% | Nav labels set by applyTranslations() _nm map, not t() |
| lang | 1 | 0 | 0% | Language gate title unused |
| logout | 1 | 0 | 0% | Logout key unused |
| syn | 4 | 0 | 0% | Sync quality labels unused |

---

## SEZIONE B — Complete Problem Table

### CRITICAL Severity

| # | Type | Location | Problem | User Impact | Fix |
|---|------|----------|---------|-------------|-----|
| C1 | missing key | `L10924` — `div.faq-answer[data-i18n-html="faq.a.10.html"]` | Key `faq.a.10.html` exists in HTML but NOT in IT or EN dictionaries | FAQ answer 10 shows blank/empty when applyTranslations() runs or language switches | Add key to both IT and EN dictionaries |
| C2 | missing key | `L10602` — `div#prv-badge-txt[data-i18n="prv.badge"]` | Key `prv.badge` not in IT/EN dictionaries | Privacy badge text disappears on language switch | Add key to both dictionaries |
| C3 | missing key | `L10733` — `p#prv-s5b-h[data-i18n="prv.s5b.h"]` | Key `prv.s5b.h` not in IT/EN dictionaries | Privacy section 5b heading disappears on language switch | Add key to both dictionaries |
| C4 | missing key | `L10596` — `span#prv-title[data-i18n="prv.title"]` | Key `prv.title` not in IT/EN dictionaries | Privacy modal title disappears on language switch | Add key to both dictionaries |
| C5 | missing key | `L1945` — `p[data-i18n="weekly.report.label.energia"]` | Key `weekly.report.label.energia` not in IT/EN dictionaries | Weekly report energy label disappears on language switch | Add key to both dictionaries |
| C6 | hardcoded text | `L2864` — `showToast()` | `"⚠️ Pagamento in ritardo — accesso attivo per altre "` — hardcoded Italian, never translated for EN users | EN users see Italian payment warning toast | Wrap in `t()` with new key `toast.paymentLate` |
| C7 | hardcoded text | `L3158` — `showToast()` | `"Auth non configurata"` — hardcoded Italian | EN users see Italian auth error | Wrap in `t()` with key `toast.authNotConfigured` |
| C8 | hardcoded text | `L3162` — `showToast()` | `"✉️ Link di accesso inviato a "` — hardcoded Italian | EN users see Italian email confirmation | Wrap in `t()` with key `toast.loginLinkSent` |
| C9 | hardcoded text | `L3167` — `showToast()` | `"⏱ Ultimo giorno di prova — sblocca Trend per continuare"` — hardcoded Italian | EN users see Italian trial expiry warning | Wrap in `t()` with key `toast.lastTrialDay` |
| C10 | hardcoded text | `L3172` — `showToast()` | `"Auth non configurata"` — duplicate of C7 | Same as C7 | Wrap in `t()` |
| C11 | hardcoded text | `L3195` — `showToast()` | `"Auth non configurata"` — triplicate of C7 | Same as C7 | Wrap in `t()` |
| C12 | hardcoded text | `L9168` — `showToast()` | `"⚠️ ${importErrors} import error(s) — some data may be incomplete"` — hardcoded English-only | IT users see English import error | Wrap in `t()` with key `toast.importErrors` |
| C13 | placeholder mismatch | `sub.trial.subtitle` — IT vs EN | IT uses `{d}`, `{s}`, `{r}` placeholders; EN uses only `{d}`, `{s}`. Missing `{r}` in EN causes undefined output | EN trial subtitle may render `{r}` literally or skip gendered suffix | Add `{r}` placeholder to EN value |

### HIGH Severity — Hardcoded Italian Text in HTML

These elements contain visible Italian text without `data-i18n` attributes or `t()` calls. On language switch to EN, they remain in Italian.

| # | Location | Hardcoded Italian Text | UI Area | Fix |
|---|----------|----------------------|---------|-----|
| H1 | `L1271` | `Continua →` (button) | Onboarding Step 0 nav | Add `data-i18n="onb.btn.avanti"` |
| H2 | `L1317` | `← Indietro` (button) | Onboarding Step 1 back | Add `data-i18n="onb.btn.indietro"` |
| H3 | `L1318` | `Continua →` (button) | Onboarding Step 1 forward | Add `data-i18n="onb.btn.avanti"` |
| H4 | `L1335` | `← Indietro` (button) | Onboarding Step 2 back | Add `data-i18n="onb.btn.indietro"` |
| H5 | `L1336` | `Continua →` (button) | Onboarding Step 2 forward | Add `data-i18n="onb.btn.avanti"` |
| H6 | `L1398` | `← Indietro` (button) | Onboarding Step 3 back | Add `data-i18n="onb.btn.indietro"` |
| H7 | `L1399` | `Continua →` (button) | Onboarding Step 3 forward | Add `data-i18n="onb.btn.avanti"` |
| H8 | `L1479` | `← Indietro` (button) | Onboarding Step 4 back | Add `data-i18n="onb.btn.indietro"` |
| H9 | `L1268` | `Opzionale. Se inserito, il calcolo diventa più preciso.` | Onboarding body fat hint | Add `data-i18n="onb.field.bf.hint"` |
| H10 | `L1276` | `La tua attività` | Onboarding step 1 label | Add `data-i18n="onb.step1.title"` or use `t()` in JS |
| H11 | `L1287` | `Selezionato: —` | Onboarding workout selector label | Add `data-i18n` or use `t('onb.wk.selected',{n:'—'})` |
| H11 | `L1287` | `Selezionato: —` | Onboarding workout selector label | Add `data-i18n` or use `t('onb.wk.selected',{n:'—'})` |
| H12 | `L1298` | `Selezionato: —` | Onboarding steps selector label | Add `data-i18n` or use `t('onb.st.selected',{n:'—'})` |
| H13 | `L1386` | `✓ Nessuno` | Clinical none button | Use `t('clinical.none')` via JS |
| H14 | `L1391` | `🔥 IBD Attiva` | Clinical IBD button | Use `t('clinical.ibd_acute')` via JS |
| H15 | `L1410` | `Proteine preferite` | Onboarding food prefs label | Add `data-i18n` key |
| H16 | `L1432` | `Carboidrati preferiti` | Onboarding food prefs label | Add `data-i18n` key |
| H17 | `L1453` | `Grassi e altro` | Onboarding food prefs label | Add `data-i18n` key |
| H18 | `L1505` | `Il Tuo Piano — Anteprima` | Onboarding result title | Add `data-i18n` key |
| H19 | `L1541` | `Cancella quando vuoi` | Subscription CTA button | Add `data-i18n` key |
| H20 | `L1593` | `Ignora` | Adaptive suggestion dismiss | Add `data-i18n="autoadj.ignore"` |
| H21 | `L1609` | `Ignora` | Auto-adjust dismiss | Add `data-i18n="autoadj.ignore"` |
| H22 | `L1728` | `↺ Reset` | Water tracker reset | Add `data-i18n` key |
| H23 | `L1741` | `↺ Reset` | Salt tracker reset | Add `data-i18n` key |
| H24 | `L1768` | `Fame` | Check-in hunger label | Add `data-i18n="oggi.checkin.fame"` |
| H25 | `L1769` | `Energia` | Check-in energy label | Add `data-i18n="oggi.checkin.energia"` |
| H26 | `L1772` | `Aderenza` | Check-in adherence label | Add `data-i18n="oggi.checkin.aderenza"` |
| H27 | `L1773` | `Digestione` | Check-in digestion label | Add `data-i18n="oggi.checkin.digestione"` |
| H28 | `L1784` | `Salva check-in` | Check-in save button | Add `data-i18n="oggi.checkin.salva"` |
| H29 | `L1831` | `Girovita (cm)` | Progress waist label | Add `data-i18n="prog.girovita"` |
| H30 | `L1848` | `Girovita` | Progress chart tab | Add `data-i18n="prog.chart.girovita"` |
| H31 | `L1861` | `Weight Trend` | Progress chart title (English only!) | Add `data-i18n="prog.chart.peso"` |
| H32 | `L1874` | `Girovita` | Progress waist chart tab | Add `data-i18n="prog.chart.girovita"` |
| H33 | `L1887-1890` | `Fame`, `Energia`, `Aderenza`, `Digestione` | Check-in analytics labels | Add `data-i18n` attributes |
| H34 | `L2002` | `🔔 Attiva Promemoria` | Notification enable button | Add `data-i18n="prog.notif.attiva"` |
| H35 | `L2097` | `Trend` | Trend section label | Add `data-i18n="nav.trend"` |
| H36 | `L2183` | `Reset modificatore` | Modifier reset button | Add `data-i18n` key |
| H37 | `L2310` | `🔔 Attiva Promemoria` | Settings notification button (alt) | Add `data-i18n` key |
| H38 | `L2331` | `Privacy & GDPR` | Settings privacy section | Add `data-i18n` key |
| H39 | `L2368` | `Privacy details` | Settings privacy button | Add `data-i18n` key |
| H40 | `L2386, L2394` | `Nessuno ✓` | Clinical status display | Add `data-i18n="clinical.none"` |
| H41 | `L2401` | `⚕️ Avviso medico importante` | Medical warning label | Add `data-i18n` key |
| H42 | `L2541` | `Trend` | Nav bar trend label | Handled by applyTranslations _nm map, but no data-i18n |
| H43 | `L10752` | `Portabilità (Art.20)` | Privacy modal right | Add `data-i18n` key |
| H44 | `L10779` | `Contatti e Autorità di Controllo` | Privacy modal contact heading | Add `data-i18n` key |
| H45 | `L10957` | `⚕️ Avviso medico importante` | Privacy modal medical warning | Add `data-i18n` key |
| H46 | `L11005` | `Iron Kinetic™ Trend` | Checkout preview title | Add `data-i18n` key |
| H47 | `L11028` | `Trend include:` | Checkout preview features | Add `data-i18n` key |
| H48 | `L11039` | `Attiva Trend →` | Checkout preview CTA | Add `data-i18n` key |
| H49 | `L11040` | `Annulla` | Checkout preview cancel | Add `data-i18n` key |
| H50 | `L11053` | `Iron Kinetic™ Trend` | Paywall title (alt) | Add `data-i18n` key |
| H51 | `L11064` | `Cancella quando vuoi` | Paywall CTA (alt) | Add `data-i18n` key |
| H52 | `L11082` | `Salva il tuo percorso` | Post-onboarding paywall title | Add `data-i18n` key |
| H53 | `L1197` | `Privacy Policy` | GDPR gate text | Add `data-i18n` key |
| H54 | `L1208` | `Read the full Privacy Policy` | GDPR gate button | Add `data-i18n` key |

### HIGH Severity — `_lang===` Ternary Bypasses (16 UI-Visible)

These inline `_lang==='en'?'EN':'IT'` ternary expressions bypass the `t()` system. They work at runtime but are not auditable, not consistent with the i18n architecture, and cannot be extended to additional languages.

| # | Location | Ternary Text | UI Area | Fix |
|---|----------|-------------|---------|-----|
| T1 | `L2746` | `'d':'gg'` (day unit) | Progress ring unit | Add key, use `t()` |
| T2 | `L2795` | `'h':'ore'` (hour unit) | Progress ring unit | Add key, use `t()` |
| T3 | `L2813` | `'d':'gg'` (day unit) | Progress ring unit (alt) | Add key, use `t()` |
| T4 | `L2958` | `` `Continue — ${price}`:`Continua — ${price}` `` | Stripe CTA label | Add key `checkout.cta.continue` |
| T5 | `L2968` | `'Redirecting…':'Reindirizzamento…'` | Stripe redirect status | Add key `checkout.redirecting` |
| T6 | `L3043` | `'Processing…':'Elaborazione…'` | Stripe processing status | Add key `checkout.processing` |
| T7 | `L3079` | `'Auth error — please sign out and back in':'Errore auth — esci e rientra'` | Auth error toast | Already wrapped in showToast, use `t('toast.authError')` |
| T8 | `L3157` | `'Invalid email address':'Indirizzo email non valido'` | Email validation toast | Use `t('toast.invalidEmail')` |
| T9 | `L3163` | `'Sign-in error — please try again':'Errore di accesso — riprova'` | Sign-in error toast | Use `t('toast.signInError')` |
| T10 | `L3176` | `'Signing out…':'Uscita in corso…'` | Logout button label | Use `t('toast.signingOut')` |
| T11 | `L3188` | `'Sign out failed — try again':'Errore logout — riprova'` | Logout error toast | Use `t('toast.signOutFailed')` |
| T12 | `L3190` | `'Sign out':'Esci dall\'account'` | Logout button label | Use `t('logout')` (key exists!) |
| T13 | `L4838` | `'FAT':'GRASSI'` | Macro fat label in applyTranslations | Use `t('meal.comp.fat')` (key exists!) |
| T14 | `L5188` | `' kcal/day':' kcal/giorno'` | TDEE suffix | Add key `tdee.card.unit.daily` |
| T15 | `L8211` | `'TRAINING DAY':'GIORNO ALLENAMENTO'` / `'REST DAY':'GIORNO RIPOSO'` | Day type badge | Add keys `day.type.training`, `day.type.rest` |
| T16 | `L9051` | `'Weight Forecast (12 wk)':'Previsione Peso (12 sett)'` | Prediction chart title | Add key `pred.chart.title` |

**Note:** 7 date/locale ternaries (`toLocaleDateString`, `toLocaleString`) are ACCEPTABLE — they correctly use the locale parameter for number/date formatting and do not need `t()`.

### MEDIUM Severity — Fragile Text-Matching Patches in applyTranslations()

These patches in `applyTranslations()` (lines 4765–4965) compare `textContent` against hardcoded Italian AND English strings. They fail if:
- Text was already translated by a previous pass
- Text contains unexpected whitespace or formatting
- A third language is ever added

| # | Location | Fragile Match | Problem | Fix |
|---|----------|---------------|---------|-----|
| M1 | `L4781` | `el.textContent.trim()==='Contesto giornata'||el.textContent.trim()==='Day context'` | Relies on exact text match in both languages | Use `data-i18n` attribute instead |
| M2 | `L4795` | `_wkS.textContent==='Non fatto'||_wkS.textContent==='Not done'` | Workout status text match | Use `data-i18n` attribute on element |
| M3 | `L4797` | `_wkB.textContent.trim()==='Fatto ✓'||_wkB.textContent.trim()==='Done ✓'` | Workout button text match | Use `data-i18n` attribute on element |
| M4 | `L4814` | `_mS.textContent.trim()==='Base invariata'||_mS.textContent.trim()==='Unchanged'` | Modifier status text match | Use `data-i18n` attribute on element |
| M5 | `L4819` | `b.textContent.includes('Reset')||b.textContent.includes('reset')` | Reset button text match (case-insensitive hack) | Use `data-i18n` attribute on element |
| M6 | `L4823` | `p.textContent.includes('irreversibili')||p.textContent.includes('irreversible')` | Danger zone warning text match | Already has `data-i18n` check but falls back to text match |
| M7 | `L4829` | `v==='Versione'||v==='Version'` | Info screen label match | Use `data-i18n` or data attribute on element |
| M8 | `L4831` | `v==='Dati su server'||v==='Server data'` | Info screen label match | Use `data-i18n` or data attribute on element |
| M9 | `L4832` | `v==='Cookie'||v==='Cookies'` | Info screen label match | Use `data-i18n` or data attribute on element |
| M10 | `L4833` | `v==='Tracking'` | Info screen label match | Use `data-i18n` or data attribute on element |

### MINOR Severity — Orphan Dictionary Keys (137 total)

These keys exist in both IT and EN dictionaries but are never referenced by `t()`, `data-i18n`, `data-i18n-html`, `data-i18n-aria`, or dynamic key construction. They represent dictionary bloat — unused translations that inflate the LANG object.

#### Potentially False Orphans (may be used via indirect patterns not detected)

| Category | Keys | Notes |
|----------|------|-------|
| `clinical.*` (12) | `clinical.ckd`, `clinical.dash`, `clinical.ibd_acute`, `clinical.ibd_remiss`, `clinical.ibs`, `clinical.none`, `clinical.t2d` | May be used in dynamically-constructed food preference UI |
| `coach.urgenza.*` (2) | `coach.urgenza.programmato`, `coach.urgenza.urgente` | May be used in coach message generation |
| `confirm.*` (4) | `confirm.eliminaPiano`, `confirm.resetAll`, `confirm.revocaConsenso`, `confirm.ricomincia` | Likely intended for `confirm()` dialogs, currently using `_lang` ternary |
| `help.feature.*` (24) | `help.feature.{adaptive,checkin,circadian,coach,mealplan,offline,onboarding,prediction,privacy,progress,shopping,tdee}.{title,desc}` | Help modal feature cards — appears unused in current HTML |
| `prv.*` (40+) | `prv.s0.p`, `prv.s1.*`, `prv.s2.p`, `prv.s3.*`, `prv.s4b.*`, `prv.s6.p`, `prv.s7.r0-r7.*`, `prv.s8.p`, `prv.s9.p`, `prv.th.*`, `prv.contact.*` | Privacy modal content — keys exist but HTML uses hardcoded text with data-i18n pointing to MISSING keys |
| `ref.*` (8) | `ref.btn.copy.label`, `ref.btn.share.label`, `ref.error.retry`, `ref.login.icon.label` | Referral section — may be used via `data-i18n-aria` or dynamic JS |
| `toast.*` (6) | `toast.pesoGirovita`, `toast.pesolog`, `toast.refeedOff`, `toast.refeedOn`, `toast.stripeUnavailable`, `toast.wkCompletato`, `toast.wkRimosso` | Toast keys that may be used in untracked code paths |

#### Confirmed Dead Orphans (no plausible usage path)

| Category | Keys | Notes |
|----------|------|-------|
| `adaptive.rule.*` (4) | `adaptive.rule.canIntensify`, `adaptive.rule.hungerAdher`, `adaptive.rule.lowEnergy`, `adaptive.rule.stallingRefeed` | Dead adaptive rule descriptions |
| `autoadj.*` (3) | `autoadj.fast_loss.title`, `autoadj.maintain_drift.title`, `autoadj.slow_loss.title` | Auto-adjust titles (main keys used, these sub-variants not) |
| `ci.fb.*` (2) | `ci.fb.tip_cut`, `ci.fb.tip_other` | Check-in feedback tips — appear unused |
| `coach.bodycomp.*` (1) | `coach.bodycomp.recomp` | Body composition recomp message |
| `coach.micro.*` (2) | `coach.micro.b12high`, `coach.micro.b12med` | Micronutrient coach messages |
| `coach.msg.*` (2) | `coach.msg.tip_cut`, `coach.msg.tip_other` | Coach tip messages |
| `goal.*` (6) | `goal.bulk`, `goal.bulk.sub`, `goal.cut_extreme`, `goal.cut_extreme.sub`, `goal.maintain`, `goal.maintain.sub`, `goal.recomp`, `goal.recomp.sub` | Goal labels with subs — may be used in goal selection UI |
| `lang.*` (1) | `lang.gate.title` | Language gate screen title |
| `logout` (1) | `logout` | Logout key — exists but T12 ternary bypasses it |
| `misc.locale` (1) | `misc.locale` | Locale identifier |
| `sub.paid.*` (9) | `sub.paid.detail.{monthly,annual,lifetime}`, `sub.paid.prog.right.{monthly,annual,lifetime}`, `sub.paid.subtitle.{monthly,annual,lifetime}` | Subscription detail texts |
| `syn.*` (4) | `syn.buona`, `syn.limitata`, `syn.neutro`, `syn.ottimale` | Sync quality labels |

---

## SEZIONE C — Suggested Logical Diff

### C.1 — New Keys to Add (5 missing data-i18n keys)

```diff
+ IT: 'prv.badge':'Aggiornata: Aprile 2026 · GDPR (Reg. UE 2016/679) · D.Lgs. 196/2003',
+ EN: 'prv.badge':'Updated: April 2026 · GDPR (EU Reg. 2016/679) · D.Lgs. 196/2003',

+ IT: 'prv.s5b.h':'5b. Dati e abbonamento (freemium / premium)',
+ EN: 'prv.s5b.h':'5b. Data and subscription (freemium / premium)',

+ IT: 'prv.title':'🛡 Privacy & GDPR',
+ EN: 'prv.title':'🛡 Privacy & GDPR',

+ IT: 'weekly.report.label.energia':'Energia media',
+ EN: 'weekly.report.label.energia':'Average energy',

+ IT: 'faq.a.10.html':'<strong>Referral program</strong> — share your personalised link from Settings. Every friend who signs up earns you credit.',
+ EN: 'faq.a.10.html':'<strong>Referral program</strong> — share your personalised link from Settings. Every friend who signs up earns you credit.',
```

### C.2 — New Keys for Hardcoded Toast Messages

```diff
+ IT: 'toast.paymentLate':'⚠️ Pagamento in ritardo — accesso attivo per altre {gg} giorn{s}',
+ EN: 'toast.paymentLate':'⚠️ Late payment — access active for {gg} more day{s}',

+ IT: 'toast.authNotConfigured':'Auth non configurata',
+ EN: 'toast.authNotConfigured':'Auth not configured',

+ IT: 'toast.loginLinkSent':'✉️ Link di accesso inviato a {email}',
+ EN: 'toast.loginLinkSent':'✉️ Login link sent to {email}',

+ IT: 'toast.lastTrialDay':'⏱ Ultimo giorno di prova — sblocca Trend per continuare',
+ EN: 'toast.lastTrialDay':'⏱ Last trial day — unlock Trend to continue',

+ IT: 'toast.importErrors':'⚠️ {n} errori di importazione — alcuni dati potrebbero essere incompleti',
+ EN: 'toast.importErrors':'⚠️ {n} import error(s) — some data may be incomplete',

+ IT: 'toast.authError':'Errore auth — esci e rientra',
+ EN: 'toast.authError':'Auth error — please sign out and back in',

+ IT: 'toast.invalidEmail':'Indirizzo email non valido',
+ EN: 'toast.invalidEmail':'Invalid email address',

+ IT: 'toast.signInError':'Errore di accesso — riprova',
+ EN: 'toast.signInError':'Sign-in error — please try again',

+ IT: 'toast.signingOut':'Uscita in corso…',
+ EN: 'toast.signingOut':'Signing out…',

+ IT: 'toast.signOutFailed':'Errore logout — riprova',
+ EN: 'toast.signOutFailed':'Sign out failed — try again',
```

### C.3 — New Keys for _lang Ternary Replacements

```diff
+ IT: 'unit.days':'gg',           EN: 'unit.days':'d',
+ IT: 'unit.hours':'ore',         EN: 'unit.hours':'h',
+ IT: 'checkout.cta.continue':'Continua — {price}',  EN: 'checkout.cta.continue':'Continue — {price}',
+ IT: 'checkout.redirecting':'Reindirizzamento…',    EN: 'checkout.redirecting':'Redirecting…',
+ IT: 'checkout.processing':'Elaborazione…',          EN: 'checkout.processing':'Processing…',
+ IT: 'day.type.training':'GIORNO ALLENAMENTO',       EN: 'day.type.training':'TRAINING DAY',
+ IT: 'day.type.rest':'GIORNO RIPOSO',                 EN: 'day.type.rest':'REST DAY',
+ IT: 'pred.chart.title':'Previsione Peso (12 sett)',  EN: 'pred.chart.title':'Weight Forecast (12 wk)',
+ IT: 'tdee.card.unit.daily':' kcal/giorno',           EN: 'tdee.card.unit.daily':' kcal/day',
```

### C.4 — Placeholder Fix

```diff
  sub.trial.subtitle — IT has {r} for gendered agreement (rimast{r})
  EN does not use {r} but t() must tolerate extra placeholders
- Verify t() ignores undefined {r} — if not, add {r}='' fallback to EN value
```

### C.5 — Hardcoded HTML Strings to Move Under i18n

Priority order for adding `data-i18n` attributes to hardcoded HTML:

1. **Onboarding nav buttons** (8 elements): `Continua →` and `← Indietro` across steps 0–4
2. **Check-in labels** (8 elements): `Fame`, `Energia`, `Aderenza`, `Digestione` at L1768–L1773 and L1887–L1890
3. **Privacy modal** (5+ elements): Title, badge, section headings at L10596–L10779
4. **Paywall/checkout** (6+ elements): Titles, CTAs, cancel buttons at L11005–L11082
5. **Food preference labels** (3 elements): `Proteine preferite`, `Carboidrati preferiti`, `Grassi e altro` at L1410–L1453
6. **Progress section** (4 elements): `Girovita`, `Weight Trend`, `Salva check-in`, chart labels
7. **Settings section** (5 elements): `Reset modificatore`, `🔔 Attiva Promemoria`, `Privacy & GDPR`, `Privacy details`, `Nessuno ✓`
8. **GDPR gate** (2 elements): `Privacy Policy`, `Read the full Privacy Policy`

### C.6 — applyTranslations() Refactoring Points

1. **Replace text-matching patches with `data-i18n`** (M1–M10): Add `data-i18n="key"` to each element; the generic `querySelectorAll('[data-i18n]')` pass at L4770 handles them automatically
2. **Remove _nm map** (L4767): Once nav labels have `data-i18n` attributes, the _nm object is redundant
3. **Remove _fatLbl ternary** (L4838): `t('meal.comp.fat')` key exists — use it via `data-i18n`
4. **Consolidate micro-chip patch** (L4783–4789): Use `data-i18n` on micro-chip buttons instead of onclick parsing
5. **Remove check-card field-label patch** (L4780–4781): Use `data-i18n` on the element

### C.7 — Helper Functions to Introduce

```
// Replace _lang ternary pattern with a reusable helper
function _t(textIT, textEN) {
  return _lang === 'en' ? textEN : textIT;
}
// Usage: showToast(_t('Errore auth', 'Auth error'))
// Better: showToast(t('toast.authError'))
```

---

## SEZIONE D — Go / No-Go

### Verdict: CONDITIONAL GO

The app is **functionally usable** in both IT and EN for the primary user flows (onboarding, today tab, progress, settings). However, there are **13 CRITICAL issues** that cause visible text breakage on language switch, and **54+ hardcoded Italian strings** that remain untranslated when switching to EN.

**For Italian-only users:** The experience is cohesive. Hardcoded Italian text matches the dictionary values. Language switching is not triggered.

**For English users:** The experience is degraded. Multiple toasts, auth error messages, paywall/checkout UI, privacy modal, and various labels remain in Italian or disappear entirely on language switch.

### Top 10 Fixes Required Before Production EN Release

| Priority | Fix | Impact | Effort |
|----------|-----|--------|--------|
| 1 | Add 5 missing keys to IT/EN dictionaries (C1–C5) | Prevents text disappearing on lang switch | 10 min |
| 2 | Wrap 7 hardcoded showToast calls in `t()` (C6–C12) | EN users see correct toast messages | 20 min |
| 3 | Fix `sub.trial.subtitle` EN placeholder (C13) | Prevents potential `{r}` literal rendering | 2 min |
| 4 | Add `data-i18n` to 8 onboarding nav buttons (H1–H8) | Onboarding fully translatable | 15 min |
| 5 | Add `data-i18n` to 8 check-in labels (H24–H27, H33) | Check-in section fully translatable | 10 min |
| 6 | Replace 6 Stripe/auth ternary bypasses with `t()` (T4–T9) | Checkout/auth flow translatable | 20 min |
| 7 | Add `data-i18n` to privacy modal title + badge (C2–C4) | Privacy modal title translatable | 5 min |
| 8 | Add `data-i18n` to 6 paywall/checkout elements (H46–H52) | Paywall fully translatable | 15 min |
| 9 | Replace `logout` and `meal.comp.fat` ternary bypasses (T12–T13) | Keys exist, just need `t()` call | 5 min |
| 10 | Replace 3 fragile text-match patches with `data-i18n` (M1–M3) | Eliminates brittle text comparisons | 10 min |

**Total estimated effort: ~2 hours**

### Long-Term Recommendations

1. **Enforce `data-i18n` everywhere**: Make it a lint rule — no visible text in HTML without `data-i18n` or `data-i18n-html` attribute
2. **Eliminate all `_lang===` ternary bypasses**: Every user-visible string should go through `t()`
3. **Purge 137 orphan keys**: Remove unused dictionary entries to reduce bundle size and maintenance confusion
4. **Add i18n regression test**: Automated test that switches language and checks for remaining hardcoded strings
5. **Consider extracting LANG to separate JSON files**: 868 keys embedded in `index.html` adds ~30KB to every page load

---

*End of audit report. No code was modified during this analysis.*
