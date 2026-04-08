## Verification Audit Complete — Full report saved to `audit/verification-audit-2026-04-08b.md`

### Verdict: NOT READY (unchanged)

**No critical finding from the original report has been fixed.** Every billing blocker remains in place.

---

### Finding-by-Finding Summary

| ID | Finding | Status | Key Evidence |
|-----|---------|--------|-------------|
| **B-01** | Checkout protocol mismatch | **VERIFIED UNFIXED** | Frontend sends `{priceId,mode,...}` (line 2119), Edge Function expects `{price_tier}` (line 50). Every checkout 400s. |
| **B-02** | Stripe test key | **VERIFIED UNFIXED** | `pk_test_...` at line 1981. Zero `pk_live` found. |
| **B-03** | Annual price placeholder | **VERIFIED UNFIXED** | `STRIPE_PRICE_ANNUAL_PLACEHOLDER` at line 1980. |
| **B-04** | Edge Functions not deployed | **UNVERIFIABLE** | Code exists and is well-structured. Requires Dashboard access to confirm deployment. |
| **B-05** | Webhook not configured | **UNVERIFIABLE** | Webhook handler code is solid (217 lines). Requires Stripe Dashboard access. |
| **B-06** | localStorage bypass on success | **VERIFIED UNFIXED** | `localStorage.setItem('ik_trend_active','1')` at line 2277. URL spoofing works. |
| **D-01** | RLS self-update hole | **VERIFIED UNFIXED** | Unrestricted UPDATE policy at migration:142-144. Any user can `update({trend_active:true})`. |
| **D-02** | localStorage short-circuit | **VERIFIED UNFIXED** | Line 2006 bypasses server check. Console self-grant possible. |
| **D-03** | SUPABASE_KEY Bearer fallback | **VERIFIED UNFIXED** | Line 2116. Partially mitigated: Edge Function rejects via `getUser()` → 401. |
| **E-01** | Unsanitized innerHTML | **UPDATED COUNT** | 35 total / 17 sanitized / 5 trivial / **13 non-trivial without sanitize** (was 16). |
| **E-02** | No CSP headers | **VERIFIED UNFIXED** | Dockerfile uses plain `serve`, no middleware. |
| **E-03** | No SRI on CDN scripts | **VERIFIED UNFIXED** | Lines 669-670, no integrity attributes. |
| **E-04** | CORS wildcard | **VERIFIED UNFIXED** | `'*'` in both checkout and portal functions. |
| **A-01** | Mixed IT/EN strings | **VERIFIED UNFIXED** | 98 `class="sn"` vs 33 `data-i18n`. Food tags all Italian. Hardcoded IT in showToast. |
| **A-02** | Lock banner bleed | **NOT A BUG** | Properly scoped: `switchTab()` only shows banner on prog tab (line 7918). Overlay hidden on non-prog (7917). |
| **F-01** | SW version mismatch | **VERIFIED UNFIXED** | CLAUDE.md says v15, sw.js says v16. |
| **F-02** | Manifest lang='it' | **VERIFIED UNFIXED** | Hardcoded Italian. |
| **F-03** | offline.html Italian | **VERIFIED UNFIXED** | `Sei offline. Riconnettiti per sincronizzare.` |
| **G-02** | Eager CDN loading | **VERIFIED UNFIXED** | No async/defer on lines 669-670. |

---

### Updated Gate Table: 4 PASS | 2 WARN | 11 FAIL

**PASS:** Auth flow, PWA install, Trial flow, Grace period + Idempotency
**WARN:** XSS prevention (13 unsanitized), i18n coverage
**FAIL:** Checkout E2E, Webhook, Test keys, Annual tier, RLS, CSP, Monitoring, Age gate, Billing portal

---

### Top 5 Blockers (Revenue-Killing)

1. **B-01** — Frontend sends `{priceId,mode}`, backend expects `{price_tier}`. 100% checkout failure rate.
2. **D-01** — Any logged-in user can self-grant lifetime access via browser console.
3. **B-02** — Test Stripe key. No real payments possible.
4. **B-04/B-05** — Edge Functions likely not deployed, webhook not configured.
5. **B-03** — Annual price is literally the string `STRIPE_PRICE_ANNUAL_PLACEHOLDER`.

### Remediation Path (4-6 hours)

1. Fix `startCheckout()` payload → send `{price_tier: plan}` instead of `{priceId, mode, ...}`
2. Add billing-column protection trigger to RLS
3. Swap `pk_test` → `pk_live`
4. Create annual price in Stripe, replace placeholder
5. Deploy Edge Functions + set secrets
6. Configure Stripe webhook endpoint
7. Remove localStorage bypass
8. Remove SUPABASE_KEY Bearer fallback

Full details with exact code diffs in the report.