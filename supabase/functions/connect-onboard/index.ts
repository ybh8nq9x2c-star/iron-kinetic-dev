import Stripe from 'https://esm.sh/stripe@14?target=deno'
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
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return json({ error: 'Unauthorized' }, 401)
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    })

    // Get or create Connect account
    const { data: userData } = await supabase
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
        metadata: { supabase_user_id: user.id },
      })
      accountId = account.id

      await supabase.from('users')
        .update({ stripe_connect_account_id: accountId })
        .eq('id', user.id)
    }

    // If already onboarded, return Express dashboard login link
    if (userData?.stripe_connect_onboarded && accountId) {
      const loginLink = await stripe.accounts.createLoginLink(accountId)
      return json({ url: loginLink.url })
    }

    // Generate onboarding link
    const origin = req.headers.get('origin') ?? 'https://irokninetic-production.up.railway.app'
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/?connect=refresh`,
      return_url: `${origin}/?connect=success`,
      type: 'account_onboarding',
    })

    console.log(`[connect-onboard] onboarding link for user ${user.id}, account ${accountId}`)
    return json({ url: accountLink.url })

  } catch (err) {
    console.error('[connect-onboard]', err)
    return json({ error: (err as Error).message }, 500)
  }
})
