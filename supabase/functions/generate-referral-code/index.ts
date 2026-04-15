import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = [
  'https://irokninetic-production.up.railway.app',
  'https://iron-kinetic.app',
  'http://localhost:3000',
]
function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return new Response('Unauthorized', { status: 401, headers: corsHeaders(req) })

    const { data: { user }, error: authError } = await sb.auth.getUser(token)
    if (authError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders(req) })

    // Idempotente: restituisce il codice esistente se già creato
    const { data: existing } = await sb
      .from('referral_codes')
      .select('code')
      .eq('user_id', user.id)
      .single()

    let code: string | null = existing?.code || null

    // Genera codice univoco con retry su collisione se non esiste
    if (!code) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const raw = crypto.randomUUID().replace(/-/g, '').substring(0, 6).toUpperCase()
        const candidate = 'IK-' + raw
        const { error: insertError } = await sb
          .from('referral_codes')
          .insert({ user_id: user.id, code: candidate })
        if (!insertError) { code = candidate; break }
      }
    }

    if (!code) throw new Error('Failed to generate unique code after 5 attempts')

    // Recupera dati utente (credito, connect status)
    const { data: userData } = await sb
      .from('users')
      .select('referral_credit_cents, stripe_connect_account_id, stripe_connect_onboarded')
      .eq('id', user.id)
      .single()

    // Conta referral confermati
    const { count } = await sb
      .from('referrals')
      .select('*', { count: 'exact', head: true })
      .eq('referrer_id', user.id)
      .eq('status', 'confirmed')

    return new Response(JSON.stringify({
      code,
      referral_credit_cents: userData?.referral_credit_cents || 0,
      stripe_connect_account_id: userData?.stripe_connect_account_id || null,
      stripe_connect_onboarded: userData?.stripe_connect_onboarded || false,
      confirmed_referrals: count || 0
    }), {
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('[generate-referral-code]', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })
  }
})
