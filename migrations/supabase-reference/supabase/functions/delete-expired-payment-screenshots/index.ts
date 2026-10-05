import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-cleanup-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  const cleanupSecret = Deno.env.get('PAYMENT_SCREENSHOT_CLEANUP_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const configuredRetention = Number(Deno.env.get('PAYMENT_SCREENSHOT_RETENTION_HOURS') ?? '24');
  if (!cleanupSecret || !supabaseUrl || !serviceRoleKey) {
    return Response.json({ error: 'Screenshot cleanup is not configured' }, { status: 500, headers: corsHeaders });
  }
  if (!Number.isInteger(configuredRetention) || configuredRetention < 1 || configuredRetention > 720) {
    return Response.json({ error: 'Retention hours must be between 1 and 720' }, { status: 500, headers: corsHeaders });
  }
  if (request.headers.get('x-cleanup-secret') !== cleanupSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: policy, error: policyError } = await supabase
    .from('payment_screenshot_policy')
    .select('retention_hours')
    .eq('singleton', true)
    .single();
  if (policyError) {
    return Response.json({ error: `Unable to read retention policy: ${policyError.message}` }, { status: 500, headers: corsHeaders });
  }
  if (policy.retention_hours !== configuredRetention) {
    return Response.json({ error: 'Function retention environment does not match database policy' }, { status: 500, headers: corsHeaders });
  }

  const { data: expired, error: queryError } = await supabase
    .from('bookings')
    .select('id, payment_screenshot_path')
    .not('payment_screenshot_path', 'is', null)
    .not('payment_delete_at', 'is', null)
    .eq('payment_status', 'COMPLETED')
    .lte('payment_delete_at', new Date().toISOString())
    .order('payment_delete_at', { ascending: true })
    .limit(500);
  if (queryError) {
    return Response.json({ error: `Unable to find expired screenshots: ${queryError.message}` }, { status: 500, headers: corsHeaders });
  }
  if (!expired?.length) {
    return Response.json({ deleted: 0 }, { headers: corsHeaders });
  }

  const deletedAt = new Date().toISOString();
  let deletedCount = 0;
  for (const booking of expired) {
    const path = booking.payment_screenshot_path;
    if (!path) continue;
    const { error: storageError } = await supabase.storage
      .from('payment-screenshots')
      .remove([path]);
    const missingObject = storageError
      && (
        storageError.statusCode === '404'
        || storageError.message.toLowerCase().includes('not found')
      );
    if (storageError && !missingObject) {
      return Response.json({ error: `Storage deletion failed for booking ${booking.id}: ${storageError.message}` }, { status: 500, headers: corsHeaders });
    }

    const { error: updateError } = await supabase
      .from('bookings')
      .update({ payment_screenshot_path: null, payment_deleted_at: deletedAt })
      .eq('id', booking.id)
      .eq('payment_screenshot_path', path)
      .eq('payment_status', 'COMPLETED');
    if (updateError) {
      return Response.json({ error: `Screenshot row cleanup failed for booking ${booking.id}: ${updateError.message}` }, { status: 500, headers: corsHeaders });
    }
    deletedCount += 1;
  }

  return Response.json({ deleted: deletedCount }, { headers: corsHeaders });
});
