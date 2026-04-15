import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

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
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
      apiVersion: '2024-06-20'
    })

    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    const { data: { user }, error: authError } = await sb.auth.getUser(token)
    if (authError || !user) return new Response('Unauthorized', { status: 401, headers: corsHeaders })

    const { data: userData } = await sb
      .from('users')
      .select('stripe_connect_account_id, stripe_connect_onboarded')
      .eq('id', user.id)
      .single()

    let accountId = userData?.stripe_connect_account_id

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'IT',
        email: user.email!,
        capabilities: { transfers: { requested: true } },
        business_type: 'individual',
        metadata: { supabase_user_id: user.id }
      })
      accountId = account.id

      await sb.from('users')
        .update({ stripe_connect_account_id: accountId })
        .eq('id', user.id)
    }

    // Se già onboardato → rimanda al dashboard Stripe Express
    if (userData?.stripe_connect_onboarded && accountId) {
      const loginLink = await stripe.accounts.createLoginLink(accountId)
      return new Response(JSON.stringify({ url: loginLink.url }), {
        headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
      })
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: 'https://ironkinetic.app?connect=refresh',
      return_url:  'https://ironkinetic.app?connect=success',
      type: 'account_onboarding'
    })

    return new Response(JSON.stringify({ url: accountLink.url }), {
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('[connect-onboard]', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' }
    })
  }
})
