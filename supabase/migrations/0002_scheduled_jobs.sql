-- =====================================================================
-- MailPilot — scheduled maintenance jobs (pg_cron)
-- Pure-SQL jobs only. The SES send worker (Edge Function) is scheduled
-- in a later migration once the function exists (Phase 4).
-- cron.schedule(name, …) upserts by job name, so this file is re-runnable.
-- =====================================================================

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;

-- Scheduled campaigns whose time has come -> materialise + enqueue
select cron.schedule('mp-enqueue-due-campaigns', '* * * * *',
  $$select public.enqueue_due_campaigns()$$);

-- Sequence enrollments whose next step is due -> enqueue (bounded batch)
select cron.schedule('mp-enqueue-due-sequence-steps', '* * * * *',
  $$select public.enqueue_due_sequence_steps(500)$$);

-- Close out campaigns with nothing left in flight
select cron.schedule('mp-finalize-campaigns', '* * * * *',
  $$select public.finalize_campaigns()$$);

-- Leases that expired without an SES result -> ambiguous (never auto-retried)
select cron.schedule('mp-mark-stale-sends', '*/5 * * * *',
  $$select public.mark_stale_sends_ambiguous()$$);

-- Keep cron history small (free-tier friendly)
select cron.schedule('mp-purge-cron-history', '17 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);

-- Processed webhook payloads are only needed for short-term debugging
select cron.schedule('mp-purge-webhook-inbox', '27 3 * * *',
  $$delete from public.webhook_inbox where processed_at < now() - interval '30 days'$$);
