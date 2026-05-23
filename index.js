export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('nope', { status: 405 });

    const body = await request.text();
    const sig = request.headers.get('Stripe-Signature');

    if (!sig) return new Response('unauthorized', { status: 401 });

    const isValid = await verifyStripeSignature(body, sig, env.STRIPE_WEBHOOK_SECRET);
    if (!isValid) return new Response('unauthorized', { status: 401 });

    const event = JSON.parse(body);

    if (event.type !== 'payment_intent.succeeded') return new Response('incorrect event type', { status: 400 });

    const intent = event.data.object;
    const amount = intent.amount;
    const from = intent.metadata?.from;

    if (!from) return new Response('missing metadata', { status: 400 });

    const donor = new URL(from).pathname.slice(1);
    const date = new Date(intent.created * 1000).toISOString();

    const [fiberyRes, discordRes] = await Promise.all([
      fetch(`https://${env.FIBERY_ACCOUNT}.fibery.io/api/commands`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${env.FIBERY_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([{
          command: 'fibery.entity/create',
          args: {
            type: 'Finance/Donations',
            entity: {
              'Finance/Amount': amount,
              'Finance/Name': donor,
              'Finance/Date': date,
            }
          }
        }])
      }),
      fetch(env.DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `Thank you [${donor}](<${from}>) for donating £${amount} to foss.wiki!`
        })
      })
    ]);

    if (!fiberyRes.ok) return new Response('fibery error', { status: 500 });
    if (!discordRes.ok) return new Response('discord error', { status: 500 });
    return new Response('ok', { status: 200 });
  }
}

async function verifyStripeSignature(body, sig, secret) {
  const parts = Object.fromEntries(sig.split(',').map(p => p.split('=')));
  const timestamp = parts['t'];
  const expected = parts['v1'];

  if (!timestamp || !expected) return false;

  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;

  const payload = `${timestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(signed)).map(b => b.toString(16).padStart(2, '0')).join('');

  return hex === expected;
}
