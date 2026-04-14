import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    const { data: { user }, error: authError } = await sb.auth.getUser(token)
    if (authError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    // Idempotente: restituisce il codice esistente se già creato
    const { data: existing } = await sb
      .from('referral_codes')
      .select('code')
      .eq('user_id', user.id)
      .single()

    if (existing?.code) {
      return new Response(JSON.stringify({ code: existing.code }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Genera codice univoco con retry su collisione
    // Uses crypto.randomUUID() — cryptographically secure, NOT Math.random()
    let code: string | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const raw = crypto.randomUUID().replace(/-/g, '').substring(0, 6).toUpperCase()
      const candidate = 'IK-' + raw
      const { error: insertError } = await sb
        .from('referral_codes')
        .insert({ user_id: user.id, code: candidate })
      if (!insertError) { code = candidate; break }
    }

    if (!code) throw new Error('Failed to generate unique code after 5 attempts')

    return new Response(JSON.stringify({ code }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('[generate-referral-code]', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
