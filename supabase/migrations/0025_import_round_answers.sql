-- E9: rate person-wide Import rounds in one transaction. The server switch remains off by default.
create or replace function public.rate_import_round(
  p_owner uuid,
  p_answers jsonb,
  p_tensions jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  answer jsonb;
  tension jsonb;
  guess public.ai_import_guesses%rowtype;
  batch public.ai_imports%rowtype;
  belief_id uuid;
  first_belief_id uuid;
  second_belief_id uuid;
  belief_ids uuid[] := '{}';
  belief_by_guess jsonb := '{}'::jsonb;
  referenced integer;
  v_rating text;
  wording text;
  belief_key text;
  now_at timestamptz := now();
begin
  if jsonb_typeof(p_answers) <> 'array' or jsonb_typeof(p_tensions) <> 'array' then
    raise exception 'invalid import round payload';
  end if;

  select count(*) into referenced from jsonb_array_elements(p_answers);
  if referenced <> (
    select count(*)
    from public.ai_import_guesses g
    where g.owner = p_owner and g.status = 'waiting'
      and g.id in (select (value->>'guess_id')::uuid from jsonb_array_elements(p_answers))
  ) then
    raise exception 'not_found import_guess';
  end if;

  for answer in select value from jsonb_array_elements(p_answers) loop
    v_rating := answer->>'rating';
    if v_rating not in ('not','partly','very','not_sure','skip') then
      raise exception 'invalid import rating';
    end if;
    if v_rating = 'skip' then continue; end if;
    select * into strict guess from public.ai_import_guesses
      where id = (answer->>'guess_id')::uuid and owner = p_owner and status = 'waiting'
      for update;
    select * into strict batch from public.ai_imports where id = guess.import_id and owner = p_owner;

    if v_rating = 'not_sure' then
      update public.ai_import_guesses set status = 'retired', retired_at = now_at where id = guess.id;
      continue;
    end if;

    wording := nullif(btrim(coalesce(answer->>'wording', '')), '');
    belief_key := coalesce(nullif(answer->>'belief_key', ''), guess.merge_key, guess.id::text);
    select id into belief_id from public.beliefs
      where owner = p_owner and source = 'import' and import_merge_key = belief_key and status <> 'deleted'
      limit 1 for update;

    if belief_id is null then
      belief_id := guess.id;
      insert into public.beliefs (
        id, owner, label, statement, type, kind, level, pending_level, area, domains,
        birth_mood, status, rating, confidence, source, import_assistant, import_date,
        import_merge_key, rated_at, confirmed_at, set_aside_at
      ) values (
        belief_id, p_owner, guess.label, coalesce(wording, guess.statement), guess.type,
        case when guess.type = 'something I believe is true' then 'everyday'
             when guess.type in ('a rule I live by','something I do to cope') then 'rule' else 'everyday' end,
        case guess.type when 'something I believe is true' then 'L4' when 'a rule I live by' then 'L1'
             when 'something I do to cope' then 'L2' when 'a view or taste' then 'L3' else 'L4' end,
        case when guess.type = 'something I believe is true' then 'L0' else null end,
        guess.area,
        array[case guess.area when 'relationships' then 'close_relationships' when 'body' then 'body_health'
              else guess.area end],
        'neutral', case when v_rating = 'not' then 'set_aside' else 'confirmed' end, v_rating,
        greatest(0, least(1, guess.confidence)), 'import', batch.source_assistant, batch.source_date,
        belief_key, now_at,
        case when v_rating <> 'not' then now_at else null end,
        case when v_rating = 'not' then now_at else null end
      );
    else
      update public.beliefs set
        statement = coalesce(wording, guess.statement),
        status = case when v_rating = 'not' then 'set_aside' else 'confirmed' end,
        rating = v_rating,
        confidence = greatest(0, least(1, guess.confidence)),
        import_assistant = batch.source_assistant,
        import_date = batch.source_date,
        rated_at = now_at,
        confirmed_at = case when v_rating <> 'not' then now_at else null end,
        set_aside_at = case when v_rating = 'not' then now_at else null end
      where id = belief_id;
    end if;
    update public.ai_import_guesses set status = 'rated', rated_at = now_at where id = guess.id;
    belief_ids := array_append(belief_ids, belief_id);
    belief_by_guess := belief_by_guess || jsonb_build_object(guess.id::text, belief_id::text);
  end loop;

  for tension in select value from jsonb_array_elements(p_tensions) loop
    first_belief_id := (belief_by_guess->>(tension->>'first'))::uuid;
    second_belief_id := (belief_by_guess->>(tension->>'second'))::uuid;
    if first_belief_id is null or second_belief_id is null then
      raise exception 'not_found import_tension';
    end if;
    insert into public.belief_links(owner, from_belief, to_belief, kind)
      values (p_owner, first_belief_id, second_belief_id, 'tension')
      on conflict (from_belief, to_belief, kind) do nothing;
  end loop;

  update public.ai_imports i set
    status = case when exists (
      select 1 from public.ai_import_guesses g where g.import_id = i.id and g.status = 'waiting'
    ) then 'active' else 'answered' end,
    answered_at = case when exists (
      select 1 from public.ai_import_guesses g where g.import_id = i.id and g.status = 'waiting'
    ) then i.answered_at else now_at end
  where i.owner = p_owner and i.id in (
    select distinct g.import_id from public.ai_import_guesses g
    where g.id in (select (value->>'guess_id')::uuid from jsonb_array_elements(p_answers))
  );

  return jsonb_build_object(
    'belief_ids', to_jsonb(array(select distinct unnest(belief_ids))),
    'saved', cardinality(array(select distinct unnest(belief_ids))),
    'has_waiting', exists(select 1 from public.ai_import_guesses where owner = p_owner and status = 'waiting')
  );
end;
$$;

revoke all on function public.rate_import_round(uuid, jsonb, jsonb) from public;
grant execute on function public.rate_import_round(uuid, jsonb, jsonb) to service_role;
