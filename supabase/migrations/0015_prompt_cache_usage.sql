-- Prompt-cache usage is provider billing data, kept beside ordinary input/output tokens for each hosted engine call.
-- Existing calls predate caching and therefore carry zeroes.

alter table public.engine_calls
  add column if not exists cache_creation_input_tokens int not null default 0
    check (cache_creation_input_tokens >= 0),
  add column if not exists cache_read_input_tokens int not null default 0
    check (cache_read_input_tokens >= 0);
