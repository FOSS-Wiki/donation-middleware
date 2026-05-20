export default {
  async fetch(request, env) {

    const secret = new URL(request.url).searchParams.get('secret');
    if (secret !== env.OC_WEBHOOK_SECRET) return new Response('unauthorized', { status: 401 });

    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });

    const body = await request.json();

    if (body.type !== 'order.paid') return new Response('invalid event type', { status: 400 });

    const order = body.data;

    const amount = order.totalAmount?.value ?? order.amount?.value;
    const name = order.fromAccount?.name ?? order.createdByAccount?.name;
    const date = body.createdAt ?? new Date().toISOString();

    if (!amount || !name) return new Response('missing fields', { status: 400 });

    const res = await fetch(`https://${env.FIBERY_ACCOUNT}.fibery.io/api/commands`, {
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
            'Finance/Name': name,
            'Finance/Date': date,
          }
        }
      }])
    });

    if (!res.ok) return new Response('fibery error', { status: 500 });
    return new Response('ok', { status: 200 });
  }
}
