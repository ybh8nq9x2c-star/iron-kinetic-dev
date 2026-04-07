import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
})

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// Map Stripe subscription status to billing fields
function subStatusToFields(sub: Stripe.Subscription, planOverride?: string) {
  const status = sub.status // active|past_due|canceled|unpaid|trialing|incomplete
  const active = status === 'active' || status === 'trialing'
  const plan = planOverride || (sub.metadata?.plan as string) || 'monthly'
  return {
    trend_active: active,
    plan: active ? plan : 'free',
    subscription_status: status,
    stripe_subscription_id: sub.id,
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
  }
}

// Lookup user row by supabase uid or stripe customer id
async function findUserRow(uid?: string, customerId?: string) {
  if (uid) {
    const { data } = await sb.from('users').select('id').eq('id', uid).single()
    return data ? { field: 'id', value: uid } : null
  }
  if (customerId) {
    const { data } = await sb.from('users').select('id').eq('stripe_customer_id', customerId).single()
    return data ? { field: 'stripe_customer_id', value: customerId } : null
  }
  return null
}

async function updateUser(uid?: string, customerId?: string, email?: string, fields: Record<string, unknown> = {}) {
  const ref = await findUserRow(uid, customerId)
  if (ref) {
    const { error } = await sb.from('users').update(fields).eq(ref.field, ref.value)
    if (error) console.error('Supabase update error:', error)
    return !error
  }
  // Last resort: email lookup
  if (email) {
    const { error } = await sb.from('users').update(fields).eq('email', email)
    if (error) console.error('Supabase email update error:', error)
    return !error
  }
  console.warn('updateUser: no user found for uid=%s customer=%s email=%s', uid, customerId, email)
  return false
}

serve(async (req) => {
  const sig = req.headers.get('stripe-signature')
  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig!,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch (err) {
    console.error('Webhook signature error:', err.message)
    return new Response(`Webhook Error: ${err.message}`, { status: 400 })
  }

  console.log('Stripe event:', event.type)

  try {

    // ── Checkout completed (subscription or one-time payment) ──
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const uid = session.metadata?.supabase_uid
      const plan = session.metadata?.plan || 'monthly'
      const customerId = session.customer as string
      const email = session.customer_details?.email

      if (session.mode === 'payment') {
        // Lifetime one-time purchase
        await updateUser(uid, customerId, email, {
          trend_active: true,
          plan: 'lifetime',
          subscription_status: 'active',
          stripe_customer_id: customerId,
          current_period_end: null,
          cancel_at_period_end: false,
        })
        console.log(`Lifetime activated uid=${uid}`)
      } else if (session.mode === 'subscription' && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription as string)
        const fields = { ...subStatusToFields(sub, plan), stripe_customer_id: customerId }
        await updateUser(uid, customerId, email, fields)
        console.log(`Subscription ${sub.status} uid=${uid} plan=${plan}`)
      }
    }

    // ── Subscription updated (cancel_at_period_end, plan change, past_due→active, etc.) ──
    if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object as Stripe.Subscription
      const uid = sub.metadata?.supabase_uid
      const customerId = sub.customer as string
      await updateUser(uid, customerId, undefined, subStatusToFields(sub))
      console.log(`sub.updated uid=${uid} status=${sub.status} cancel=${sub.cancel_at_period_end}`)
    }

    // ── Subscription canceled (hard delete at period end) ──
    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription
      const uid = sub.metadata?.supabase_uid
      const customerId = sub.customer as string
      await updateUser(uid, customerId, undefined, {
        trend_active: false,
        plan: 'free',
        subscription_status: 'canceled',
        cancel_at_period_end: false,
      })
      console.log(`Subscription canceled uid=${uid}`)
    }

    // ── Invoice paid → ensure active (handles renewals) ──
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice
      if (!invoice.subscription) return new Response(
        JSON.stringify({ received: true }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
      const sub = await stripe.subscriptions.retrieve(invoice.subscription as string)
      const uid = sub.metadata?.supabase_uid
      const customerId = sub.customer as string
      const fields = subStatusToFields(sub)
      await updateUser(uid, customerId, undefined, fields)
      console.log(`Renewed uid=${uid} period_end=${fields.current_period_end}`)
    }

    // ── Invoice payment failed → grace period (keep access, flag past_due) ──
    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice
      if (!invoice.subscription) return new Response(
        JSON.stringify({ received: true }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 }
      )
      const sub = await stripe.subscriptions.retrieve(invoice.subscription as string)
      const uid = sub.metadata?.supabase_uid
      const customerId = sub.customer as string
      // Keep trend_active=true during Stripe's retry window (grace period)
      await updateUser(uid, customerId, undefined, {
        trend_active: true,
        subscription_status: 'past_due',
      })
      console.log(`Payment failed, grace period uid=${uid}`)
    }

  } catch (err) {
    console.error('Handler error:', err)
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
})
