-- E12: private Import finish answer and score eligibility. The server switch remains off by default.
alter table public.ai_imports
  add column if not exists feel_answer text
    check (feel_answer in ('yes','partly','not_really','skipped')),
  add column if not exists feel_answered_at timestamptz;

alter table public.ai_import_guesses
  add column if not exists rating text
    check (rating in ('not','partly','very'));

-- Preserve definite ratings written before this additive column existed.
update public.ai_import_guesses g set rating = b.rating
from public.beliefs b
where g.owner = b.owner
  and g.status = 'rated'
  and g.rating is null
  and b.rating in ('not','partly','very')
  and (b.id = g.id or (g.merge_key is not null and b.import_merge_key = g.merge_key));

-- Keep E9's belief writes and E12's eligibility accounting in one database transaction.
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
begin
  result := public.rate_import_round(p_owner, p_answers, p_tensions);
  for answer in select value from jsonb_array_elements(p_answers) loop
    v_rating := answer->>'rating';
    if v_rating in ('not','partly','very') then
      update public.ai_import_guesses set rating = v_rating
        where id = (answer->>'guess_id')::uuid and owner = p_owner;
    end if;
  end loop;
  return result || jsonb_build_object(
    'score_eligible', (
      select count(*) >= 3 from public.ai_import_guesses
      where owner = p_owner and rating in ('not','partly','very')
    )
  );
end;
$$;

revoke all on function public.rate_import_round_v2(uuid, jsonb, jsonb) from public;
grant execute on function public.rate_import_round_v2(uuid, jsonb, jsonb) to service_role;

create or replace function public.answer_import_feel(
  p_owner uuid,
  p_import uuid,
  p_answer text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  if p_answer not in ('yes','partly','not_really','skipped') then
    raise exception 'invalid import feel answer';
  end if;
  if not exists(select 1 from public.ai_imports where id = p_import and owner = p_owner) then
    raise exception 'not_found import';
  end if;
  update public.ai_imports set feel_answer = p_answer, feel_answered_at = now()
    where id = p_import and owner = p_owner and feel_answer is null;
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'conflict already_answered'; end if;
  return true;
end;
$$;

revoke all on function public.answer_import_feel(uuid, uuid, text) from public;
grant execute on function public.answer_import_feel(uuid, uuid, text) to service_role;
