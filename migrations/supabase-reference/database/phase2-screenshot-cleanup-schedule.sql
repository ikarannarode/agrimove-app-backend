-- Configure vault secrets before running this file. Never put a service-role key here.
-- Store the public project URL as "phase2_project_url" and the function's
-- PAYMENT_SCREENSHOT_CLEANUP_SECRET as "phase2_cleanup_secret" in Supabase Vault.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'phase2-payment-screenshot-cleanup';

SELECT cron.schedule(
  'phase2-payment-screenshot-cleanup',
  '*/15 * * * *',
  $job$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'phase2_project_url'
      ) || '/functions/v1/delete-expired-payment-screenshots',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cleanup-secret', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'phase2_cleanup_secret'
        )
      ),
      body := '{}'::jsonb
    );
  $job$
);
