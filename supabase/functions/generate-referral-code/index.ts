import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://irokninetic-production.up.railway.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-jwt',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      {
        auth: { persistSession: false },
        global: { headers: { Authorization: 'Bearer ' + (req.headers.get('X-User-JWT') ?? '') } },
      }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return json({ error: 'Unauthorized' }, 401)
    }

    // Check if user already has a referral code
    const { data: existing } = await supabase
      .from('referral_codes')
      .select('code')
      .eq('user_id', user.id)
      .single()

    if (existing?.code) {
      return json({ code: existing.code })
    }

    // Generate unique code with retry on collision
    let code: string | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = 'IK-' + Math.random().toString(36).substring(2, 8).toUpperCase()
      const { error: insertError } = await supabase
        .from('referral_codes')
        .insert({ user_id: user.id, code: candidate })
      if (!insertError) {
        code = candidate
        break
      }
      console.warn(`[generate-referral-code] collision on attempt ${attempt}, retrying...`)
    }

    if (!code) {
      return json({ error: 'Failed to generate unique code' }, 500)
    }

    console.log(`[generate-referral-code] created code ${code} for user ${user.id}`)
    return json({ code })

  } catch (err) {
    console.error('[generate-referral-code]', err)
    return json({ error: (err as Error).message }, 500)
  }
})
