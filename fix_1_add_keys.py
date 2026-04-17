#!/usr/bin/env python3
# Add missing i18n keys to IT and EN dictionaries in index.html
import re
FILE='/a0/usr/projects/iron_kninetic/index.html'
with open(FILE,'r',encoding='utf-8') as f: lines=f.readlines()
print(f'Read {len(lines)} lines')

# Find IT dict end (line with }, before line with en:{)
it_end=-1
for i in range(len(lines)):
 if 'en:{' in lines[i]:
  j=i-1
  while j>=0:
   if '},' in lines[j]: it_end=j; break
   j-=1
  break

# Find EN dict end (matching }, after en:{)
en_end=-1; depth=0; in_en=False
for i in range(len(lines)):
 if 'en:{' in lines[i]: in_en=True; depth=lines[i].count('{')-lines[i].count('}'); continue
 if in_en:
  depth+=lines[i].count('{')-lines[i].count('}')
  if depth<=0 and ('},' in lines[i]): en_end=i; break

print(f'IT end L{it_end+1}: {lines[it_end].strip()[:60]}')
print(f'EN end L{en_end+1}: {lines[en_end].strip()[:60]}')

IT="""  'oggi.checkin.aderenza':'Aderenza','oggi.checkin.digestione':'Digestione',
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
EN="""  'oggi.checkin.aderenza':'Adherence','oggi.checkin.digestione':'Digestion',
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

lines[it_end]=IT+'\n'+lines[it_end]
lines[en_end]=EN+'\n'+lines[en_end]
with open(FILE,'w',encoding='utf-8') as f: f.writelines(lines)
print(f'Done! Added {IT.count(chr(10))} IT + {EN.count(chr(10))} EN key lines')
