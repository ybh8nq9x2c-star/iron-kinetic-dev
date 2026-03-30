/* Iron Kinetic — Storage helpers & SK keys
   Pure module: no DOM access, no external deps.
*/

export const SK = {
  diet:     'app_diet_data',
  phase:    'ik_phase',
  mod:      'ik_modifier',
  refeed:   'ik_refeed_date',
  wLog:     'ik_weight_log',
  progStart:'ik_prog_start',
  p4Start:  'ik_p4_start',
  profile:  'ik_user_profile',
  prefs:    'ik_user_prefs',
  checkins:      'ik_checkins',
  onboardingDone:'ik_onboarding_done',
  lang:          'ik_lang',
};

export const SK_ADAPTIVE = 'ikadaptive';
export const SK_REPORT   = 'ikweeklyreport';

// Parse JSON, return fallback on miss/error
export const lsG = (k, fb=null) => {
  try { const v=localStorage.getItem(k); return v!==null?JSON.parse(v):fb; } catch { return fb; }
};

// Raw string read (no JSON parse)
export const lsR = k => {
  try { return localStorage.getItem(k); } catch { return null; }
};

// Raw string write (no dirty flags, no JSON parse)
export const lsW = (k, v) => {
  try { localStorage.setItem(k, v); } catch {}
};
