-- APNs outbox scheduler. Product state does not depend on this job; it only wakes registered devices.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- The job itself is installed by next/scripts/configure_push_schedule.py after it puts the URL and credentials in Vault.
