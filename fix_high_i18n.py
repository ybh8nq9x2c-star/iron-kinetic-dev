#!/usr/bin/env python3
"""Fix all 70 HIGH i18n issues in index.html"""
import re, sys, os

FILE = '/a0/usr/projects/iron_kninetic/index.html'
with open(FILE, 'r', encoding='utf-8') as f:
    txt = f.read()

lines = txt.split('\n')
print(f'Total lines: {len(lines)}')
changes = 0

def count(sub):
    return txt.count(sub)

# ═══════════════════════════════════════════
# PHASE 0: Verify keys that exist vs missing
# ═══════════════════════════════════════════
exist_keys = {
    'onb.btn.avanti', 'onb.btn.indietro', 'onb.field.bf.hint',
    'oggi.checkin.fame', 'oggi.checkin.energia', 'oggi.checkin.salva',
    'onb.cibi.proteine', 'onb.cibi.carb', 'onb.cibi.grassi',
    'onb.result.preview', 'adaptive.btn.dismiss', 'autoadj.ignore',
    'clinical.none', 'clinical.ibd_acute', 'logout', 'meal.comp.fat',
    'nav.trend', 'prog.notif.btn', 'info.app.server.val',
    'info.disclaimer.title', 'info.privacy.title', 'prv.s7.r4.lbl',
    'onb.step1.title', 'onb.wk.selected', 'onb.st.selected',
    'onb.sel.none', 'prog.girovita', 'prog.stat.girovita', 'prog.chart.peso',
    'prv.contact.h',
}

for k in exist_keys:
    pattern = "'" + k + "'"
    c = txt.count(pattern)
    if c < 2:
        print(f'  WARNING: {k} found {c} times (expected 2+ for IT+EN)')

# ═══════════════════════════════════════════
# PHASE 1: Add missing keys to both dicts
# ═══════════════════════════════════════════
# Find IT dict closing (}, before en:{)
# Find EN dict closing (}, before the next section)

# Strategy: find the line with '},\nen:{' to know where IT dict ends
# and find the closing of EN dict

# IT dict ends with '},\n  en:{' pattern
it_end_pattern = "'aria.info':'Info',\n },"
en_end_pattern = "'aria.info':'Info',\n },\n en:{"  # same for IT side

# More robust: find lines containing '},'
# IT dict closing: line with ' },' right before line with 'en:{'
# EN dict closing: line with ' },' right before next major section

def find_it_dict_end():
    """Find the line index where IT dict ends (the },) before en:{"""
    for i in range(len(lines)):
        if 'en:{' in lines[i]:
            # The }, should be on line i-1
            j = i - 1
            while j >= 0:
                if '},' in lines[j] or lines[j].strip() == '},':
                    return j
                j -= 1
    return -1

def find_en_dict_end():
    """Find the line index where EN dict ends"""
    # After en:{, find the matching },
    in_en = False
    brace_depth = 0
    for i in range(len(lines)):
        if 'en:{' in lines[i]:
            in_en = True
            brace_depth = lines[i].count('{') - lines[i].count('}')
            continue
        if in_en:
            brace_depth += lines[i].count('{') - lines[i].count('}')
            if brace_depth <= 0 and ('},' in lines[i] or lines[i].strip() == '},'):
                return i
    return -1

it_end_line = find_it_dict_end()
en_end_line = find_en_dict_end()
print(f'IT dict ends at line {it_end_line+1}: {lines[it_end_line].strip()[:60]}')
print(f'EN dict ends at line {en_end_line+1}: {lines[en_end_line].strip()[:60]}')

# Keys to add to IT dict
NEW_IT = """  'oggi.checkin.aderenza':'Aderenza','oggi.checkin.digestione':'Digestione',
  'unit.days':'gg','unit.hours':'ore','unit.reset':'↺ Reset',
  'checkout.cta.continue':'Continua — {price}','checkout.redirecting':'Reindirizzamento…','checkout.processing':'Elaborazione…',
  'day.type.training':'GIORNO ALLENAMENTO','day.type.rest':'GIORNO RIPOSO',
  'pred.chart.title':'Previsione Peso (12 sett)','tdee.card.unit.daily':' kcal/giorno',
  'toast.authError':'Errore auth — esci e rientra','toast.invalidEmail':'Indirizzo email non valido',
  'toast.signInError':'Errore di accesso — riprova','toast.signingOut':'Uscita in corso…',
  'toast.signOutFailed':'Errore logout — riprova',
  'prv.title':'🛡 Privacy & GDPR','prv.badge':'Aggiornata: Aprile 2026 · GDPR (Reg. UE 2016/679) · D.Lgs. 196/2003',
  'prv.s5b.h':'5b. Dati e abbonamento (freemium / premium)',
  'checkout.preview.title':'Iron Kinetic™ Trend','checkout.preview.includes':'Trend include:',
  'checkout.preview.cta':'Attiva Trend →','checkout.preview.cancel':'Annulla',
  'checkout.paywall.title':'Iron Kinetic™ Trend','checkout.paywall.cancel':'Cancella quando vuoi',
  'checkout.ponb.title':'Salva il tuo percorso','checkout.cancel':'Cancella quando vuoi',
  'onb.food.grassi_altro':'Grassi e altro',
  'info.medical.warning':'⚕️ Avviso medico importante',
  'clinical.ibd.active':'🔥 IBD Attiva',
  'prog.chart.weight':'Weight Trend',
  'reset.modificatore':'Reset modificatore',
  'privacy.details.btn':'Privacy details',
  'weekly.report.label.energia':'Energia media',
  'faq.a.10.html':'<strong>Programma referral</strong> — condividi il tuo link personalizzato dalle Impostazioni. Ogni amico che si iscrive ti fa guadagnare crediti.',
"""

NEW_EN = """  'oggi.checkin.aderenza':'Adherence','oggi.checkin.digestione':'Digestion',
  'unit.days':'d','unit.hours':'h','unit.reset':'↺ Reset',
  'checkout.cta.continue':'Continue — {price}','checkout.redirecting':'Redirecting…','checkout.processing':'Processing…',
  'day.type.training':'TRAINING DAY','day.type.rest':'REST DAY',
  'pred.chart.title':'Weight Forecast (12 wk)','tdee.card.unit.daily':' kcal/day',
  'toast.authError':'Auth error — please sign out and back in','toast.invalidEmail':'Invalid email address',
  'toast.signInError':'Sign-in error — please try again','toast.signingOut':'Signing out…',
  'toast.signOutFailed':'Sign out failed — try again',
  'prv.title':'🛡 Privacy & GDPR','prv.badge':'Updated: April 2026 · GDPR (EU Reg. 2016/679) · D.Lgs. 196/2003',
  'prv.s5b.h':'5b. Data and subscription (freemium / premium)',
  'checkout.preview.title':'Iron Kinetic™ Trend','checkout.preview.includes':'Trend includes:',
  'checkout.preview.cta':'Activate Trend →','checkout.preview.cancel':'Cancel',
  'checkout.paywall.title':'Iron Kinetic™ Trend','checkout.paywall.cancel':'Cancel anytime',
  'checkout.ponb.title':'Save your progress','checkout.cancel':'Cancel anytime',
  'onb.food.grassi_altro':'Fats & other',
  'info.medical.warning':'⚕️ Important medical notice',
  'clinical.ibd.active':'🔥 Active IBD',
  'prog.chart.weight':'Weight Trend',
  'reset.modificatore':'Reset modifier',
  'privacy.details.btn':'Privacy details',
  'weekly.report.label.energia':'Average energy',
  'faq.a.10.html':'<strong>Referral program</strong> — share your personalised link from Settings. Every friend who signs up earns you credit.',
"""

# Insert new keys before the closing of IT dict
old_it_end = lines[it_end_line]
lines[it_end_line] = NEW_IT + '\n' + old_it_end
changes += 1
print(f'Added {len(NEW_IT.strip().split(chr(10)))} new key lines to IT dict')

# Insert new keys before the closing of EN dict
old_en_end = lines[en_end_line]
lines[en_end_line] = NEW_EN + '\n' + old_en_end
changes += 1
print(f'Added {len(NEW_EN.strip().split(chr(10)))}