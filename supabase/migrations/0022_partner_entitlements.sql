-- Prototype item 2 (default-off): Presence-owned subscription sharing for one linked partner.
-- This is intentionally independent of App Store Family Sharing. Service-role writes only.

create table if not exists public.subscription_entitlements (
  person uuid primary key references public.profiles(id) on delete cascade,
  product_id text not null check (product_id in ('app.presence.plus.monthly', 'app.presence.plus.yearly')),
  original_transaction_id text not null unique,
  status text not null check (status in ('active', 'expired', 'revoked')),
  expires_at timestamptz,
  app_environment text not null check (app_environment in ('sandbox', 'production')),
  last_notification_uuid uuid not null unique,
  updated_at timestamptz not null default now()
);

alter table public.subscription_entitlements enable row level security;
-- No client policy: verified App Store notification handling uses the service role.

create trigger subscription_entitlements_updated before update on public.subscription_entitlements
for each row execute function public.set_updated_at();
