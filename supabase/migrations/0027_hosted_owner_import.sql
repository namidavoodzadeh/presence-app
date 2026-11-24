-- Revised E13: canonical source metadata and Talk-first reconciliation for the hosted owner import.
alter table public.ai_imports
  add column if not exists source text,
  add column if not exists imported_at timestamptz;

update public.ai_imports set
  source = case lower(source_assistant)
    when 'chatgpt' then 'chatgpt'
    when 'claude' then 'claude'
    when 'gemini' then 'gemini'
    else 'other'
  end,
  imported_at = coalesce(imported_at, created_at)
where source is null or imported_at is null;

alter table public.ai_imports
  alter column source set default 'other',
  alter column source set not null,
  alter column imported_at set default now(),
  alter column imported_at set not null,
  drop constraint if exists ai_imports_source_check;
alter table public.ai_imports
  add constraint ai_imports_source_check check (source in ('chatgpt','claude','gemini','other'));

-- E9 remains the atomic writer. This wrapper then lets an exact confirmed Talk belief win over
-- a newly written AI duplicate without weakening ownership or waiting-guess validation.
create or replace function public.rate_import_round_v2(
  p_owner uuid,
  p_answers jsonb,
  p_tensions jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  answer jsonb;
  result jsonb;
  v_rating text;
  import_belief public.beliefs%rowtype;
  talk_id uuid;
  resolved_ids uuid[] := '{}';
  belief_id uuid;
begin
  result := public.rate_import_round(p_owner, p_answers, p_tensions);
  for answer in select value from jsonb_array_elements(p_answers) loop
    v_rating := answer->>'rating';
    if v_rating in ('not','partly','very') then
      update public.ai_import_guesses set rating = v_rating
        where id = (answer->>'guess_id')::uuid and owner = p_owner;
    end if;
  end loop;

  for belief_id in
    select value::uuid from jsonb_array_elements_text(result->'belief_ids')
  loop
    select * into import_belief from public.beliefs
      where id = belief_id and owner = p_owner;
    talk_id := null;
    if import_belief.source = 'import' then
      select id into talk_id from public.beliefs
        where owner = p_owner and source = 'talk' and status = 'confirmed'
          and area = import_belief.area
          and lower(regexp_replace(label, '[^a-z0-9]+', ' ', 'gi')) =
              lower(regexp_replace(import_belief.label, '[^a-z0-9]+', ' ', 'gi'))
          and lower(regexp_replace(statement, '[^a-z0-9]+', ' ', 'gi')) =
              lower(regexp_replace(import_belief.statement, '[^a-z0-9]+', ' ', 'gi'))
        order by created_at asc limit 1;
    end if;
    if talk_id is not null then
      insert into public.belief_links(owner, from_belief, to_belief, kind)
        select owner,
          case when from_belief = belief_id then talk_id else from_belief end,
          case when to_belief = belief_id then talk_id else to_belief end,
          kind
        from public.belief_links
        where owner = p_owner and (from_belief = belief_id or to_belief = belief_id)
          and case when from_belief = belief_id then talk_id else from_belief end <>
              case when to_belief = belief_id then talk_id else to_belief end
        on conflict (from_belief, to_belief, kind) do nothing;
      delete from public.beliefs where id = belief_id and owner = p_owner and source = 'import';
      resolved_ids := array_append(resolved_ids, talk_id);
    else
      resolved_ids := array_append(resolved_ids, belief_id);
    end if;
  end loop;

  result := result || jsonb_build_object(
    'belief_ids', to_jsonb(array(select distinct unnest(resolved_ids))),
    'saved', cardinality(array(select distinct unnest(resolved_ids))),
    'score_eligible', (
      select count(*) >= 3 from public.ai_import_guesses
      where owner = p_owner and rating in ('not','partly','very')
    )
  );
  return result;
end;
$$;

revoke all on function public.rate_import_round_v2(uuid, jsonb, jsonb) from public;
grant execute on function public.rate_import_round_v2(uuid, jsonb, jsonb) to service_role;
