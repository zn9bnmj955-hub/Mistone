-- Lot 2 (B3, correction): a tournament purged by the 6-month safety net (never closed) is
-- also closed for good (status 'archived'), so it can no longer accept teams, scores or
-- staff sign-ins whose data would never be purged (the purge never runs twice).
-- `finished_at` is kept as it is. Same function otherwise (see 20261016001200_purge.sql).

create or replace function public.purge_finished_tournaments(p_now timestamptz default now())
returns text[] language plpgsql security definer set search_path = public as $$
declare
  ids uuid[];
  codes text[];
  subs uuid[];
begin
  with due as (
    select t.id, t.short_code
      from public.tournaments t
     where t.purged_at is null
       and t.status <> 'draft'
       and (
         (t.status = 'archived' and t.finished_at is not null and t.finished_at <= p_now - interval '14 days')
         or coalesce(t.starts_at, t.created_at) <= p_now - interval '6 months'
       )
       for update of t
  )
  select coalesce(array_agg(id order by id), '{}'), coalesce(array_agg(short_code order by id), '{}')
    into ids, codes from due;
  if cardinality(ids) = 0 then return '{}'; end if;

  -- Push subscriptions that followed these tournaments (directly or through a team).
  select coalesce(array_agg(distinct s.id), '{}') into subs
    from public.push_subscriptions s
   where s.tournament_id = any(ids)
      or s.team_id in (select id from public.teams where tournament_id = any(ids))
      or exists (select 1 from public.push_targets pt where pt.subscription_id = s.id and pt.tournament_id = any(ids));

  delete from public.notifications where tournament_id = any(ids);
  delete from public.push_targets where tournament_id = any(ids);
  delete from public.push_subscriptions s
   where s.id = any(subs) and s.user_id is null
     and not exists (select 1 from public.push_targets pt where pt.subscription_id = s.id);
  update public.push_subscriptions s set tournament_id = null, team_id = null
   where s.id = any(subs)
     and (s.tournament_id = any(ids) or s.team_id in (select id from public.teams where tournament_id = any(ids)));
  delete from public.follows where tournament_id = any(ids);

  delete from public.tournament_actions where tournament_id = any(ids);
  delete from public.score_submissions
   where match_id in (select id from public.matches where tournament_id = any(ids));
  delete from public.tournament_staff where tournament_id = any(ids);
  delete from public.registrations where tournament_id = any(ids);
  delete from public.team_secrets where team_id in (select id from public.teams where tournament_id = any(ids));
  delete from public.players_private
   where player_id in (select p.id from public.players p join public.teams tm on tm.id = p.team_id where tm.tournament_id = any(ids));
  delete from public.players where team_id in (select id from public.teams where tournament_id = any(ids));
  update public.teams set name = null, club_name = null where tournament_id = any(ids);

  -- Closed for good as well (6-month safety net); finished_at untouched.
  -- state_version + 1: the public pages rebuild their cached state and see the purge.
  update public.tournaments
     set purged_at = p_now, status = 'archived', state_version = state_version + 1
   where id = any(ids);
  return codes;
end $$;

revoke all on function public.purge_finished_tournaments(timestamptz) from public, anon, authenticated;
grant execute on function public.purge_finished_tournaments(timestamptz) to service_role;
