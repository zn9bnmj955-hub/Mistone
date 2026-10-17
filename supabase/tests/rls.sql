-- Row Level Security checks. Run with `pnpm test:db` (needs the local stack
-- and the demo seed). Each block raises an exception if a rule is broken;
-- everything runs in a transaction that is rolled back.
\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.as_user(p_email text) returns void language plpgsql as $$
declare uid uuid;
begin
  select id into uid from auth.users where email = p_email;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;

create or replace function pg_temp.reset() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 1. Anonymous visitors see published tournaments but no personal data.
-- Independent of the tournaments the e2e tests publish: a draft is added here
-- (rolled back), and anon must see exactly the non-draft ones, demo codes included.
do $$ begin
  insert into public.tournaments (club_id, sport_slug, name, created_by)
    select club_id, sport_slug, 'Brouillon test RLS', created_by from public.tournaments where short_code = 'GP3M';
  perform set_config('rls_test.public_count', (select count(*) from public.tournaments where status <> 'draft')::text, true);
end $$;
select pg_temp.as_anon();
do $$ begin
  if (select count(*) from public.tournaments) <> current_setting('rls_test.public_count')::int then
    raise exception 'anon should see exactly the published (non-draft) tournaments';
  end if;
  if exists (select 1 from public.tournaments where status = 'draft') then raise exception 'anon must not see drafts'; end if;
  if (select count(*) from public.tournaments where short_code in ('7KQ2', 'GP3M', 'TR8E', 'C4DR', '2J7P', 'PQ8P')) <> 6 then
    raise exception 'anon should see the 6 demo tournaments';
  end if;
  if (select count(*) from public.matches) = 0 then raise exception 'anon should see matches'; end if;
  if (select count(*) from public.players) <> 0 then raise exception 'anon must not read players'; end if;
  if (select count(*) from public.registrations) <> 0 then raise exception 'anon must not read registrations'; end if;
  if (select count(*) from public.players_private) <> 0 then raise exception 'anon must not read licenses'; end if;
  if (select count(*) from public.profiles) <> 0 then raise exception 'anon must not read profiles'; end if;
end $$;
select pg_temp.reset();

-- 2. A player sees only their own player row and registration.
select pg_temp.as_user('joueur@demo.orgasport.fr');
do $$ begin
  if (select count(*) from public.players) <> 1 then raise exception 'player should see exactly their own player row'; end if;
  if (select count(*) from public.players_private) <> 1 then raise exception 'player should see only their own license'; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'player should see only their profile'; end if;
end $$;
-- ...cannot switch to a club they are not a member of.
do $$ begin
  begin
    update public.profiles set active_club_id = (select id from public.clubs limit 1) where id = auth.uid();
    raise exception 'player switched to a foreign club';
  exception when insufficient_privilege or check_violation then null;
  end;
  if exists (select 1 from public.profiles where id = auth.uid() and active_club_id is not null) then
    raise exception 'foreign club switch persisted';
  end if;
end $$;
-- ...cannot create a tournament for a club.
do $$ begin
  begin
    insert into public.tournaments (club_id, sport_slug, name, created_by)
    values ((select id from public.clubs limit 1), 'petanque', 'Intrus', auth.uid());
    raise exception 'player created a tournament';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.reset();

-- 3. The club owner manages its tournaments but cannot publish without payment.
select pg_temp.as_user('club@demo.orgasport.fr');
do $$
declare tid uuid;
begin
  if (select count(*) from public.players) < 200 then raise exception 'club should see its players'; end if;
  insert into public.tournaments (club_id, sport_slug, name, created_by)
  values ((select id from public.clubs where slug = 'as-les-platanes'), 'petanque', 'Brouillon de test', auth.uid())
  returning id into tid;
  if (select status from public.tournaments where id = tid) <> 'draft' then raise exception 'new tournament should be a draft'; end if;
  if (select short_code from public.tournaments where id = tid) is null then raise exception 'short code should be generated'; end if;
  begin
    update public.tournaments set status = 'published' where id = tid;
    raise exception 'club published without payment';
  exception when raise_exception then
    if sqlerrm not like '%payment%' then raise; end if;
  end;
end $$;
-- ...never reads PIN hashes.
do $$ begin
  begin
    perform pin_hash from public.tournament_staff;
    raise exception 'pin_hash readable';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.reset();

-- 4. A plain member cannot add people to the club nor promote themselves.
select set_config('test.player_id', (select id::text from auth.users where email = 'joueur@demo.orgasport.fr'), true);
select pg_temp.as_user('benevole@demo.orgasport.fr');
do $$ begin
  begin
    insert into public.club_members (club_id, user_id, role)
    values ((select id from public.clubs where slug = 'as-les-platanes'), current_setting('test.player_id')::uuid, 'member');
    raise exception 'member added someone to the club';
  exception when insufficient_privilege then null;
  end;
  update public.club_members set role = 'admin' where user_id = auth.uid();
  if exists (select 1 from public.club_members where user_id = auth.uid() and role = 'admin') then
    raise exception 'member promoted themselves';
  end if;
end $$;
select pg_temp.reset();

-- 5. Phase 2: team score codes and the write function are server-only.
select pg_temp.as_anon();
do $$ begin
  if (select count(*) from public.team_secrets) <> 0 then raise exception 'anon must not read team codes'; end if;
  if (select count(*) from public.tournament_actions) <> 0 then raise exception 'anon must not read history'; end if;
  begin
    perform public.apply_tournament_changes(gen_random_uuid(), 0, '[]'::jsonb, '{}'::jsonb);
    raise exception 'anon called apply_tournament_changes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.verify_staff_pin(gen_random_uuid(), '4821');
    raise exception 'anon called verify_staff_pin';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.reset();
select pg_temp.as_user('joueur@demo.orgasport.fr');
do $$ begin
  if (select count(*) from public.team_secrets) <> 0 then raise exception 'player must not read team codes'; end if;
  begin
    perform public.apply_tournament_changes(gen_random_uuid(), 0, '[]'::jsonb, '{}'::jsonb);
    raise exception 'player called apply_tournament_changes';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.reset();
select pg_temp.as_user('club@demo.orgasport.fr');
do $$ begin
  if (select count(*) from public.team_secrets) = 0 then raise exception 'organizer should read team codes'; end if;
end $$;
select pg_temp.reset();

-- 6. Phase 3: promo codes, invitations, payments and publication are server-only.
select pg_temp.as_anon();
do $$ begin
  if (select count(*) from public.promo_codes) <> 0 then raise exception 'anon must not read promo codes'; end if;
  if (select count(*) from public.payments) <> 0 then raise exception 'anon must not read payments'; end if;
  if exists (select 1 from public.tournaments where status = 'draft') then raise exception 'anon must not see drafts'; end if;
end $$;
select pg_temp.reset();

select pg_temp.as_user('club@demo.orgasport.fr');
do $$ begin
  if (select count(*) from public.promo_codes) <> 0 then raise exception 'clubs must not list promo codes'; end if;
  if not exists (select 1 from public.tournaments where status = 'draft') then raise exception 'club should see its draft'; end if;
  begin
    perform token_hash from public.club_invitations;
    raise exception 'invitation tokens readable';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payments (tournament_id, club_id, amount_cents, status)
      select id, club_id, 0, 'paid' from public.tournaments where status = 'draft' limit 1;
    raise exception 'a club created its own payment';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.publish_tournament(gen_random_uuid(), '{}'::jsonb, '[]'::jsonb, '[]'::jsonb);
    raise exception 'publish_tournament callable by a club';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner) values ('tournament-media', 'x/poster.png', auth.uid());
    raise exception 'direct uploads to tournament media allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.reset();

select pg_temp.as_user('admin@demo.orgasport.fr');
do $$ begin
  if (select count(*) from public.promo_codes) < 2 then raise exception 'admins should list promo codes'; end if;
end $$;
select pg_temp.reset();

-- Publication by the service role: atomic, idempotent, PINs hashed, promo counted.
do $$
declare
  t uuid := (select id from public.tournaments where status = 'draft' limit 1);
  c uuid := (select club_id from public.tournaments where status = 'draft' limit 1);
  promo uuid := (select id from public.promo_codes where code = 'BIENVENUE');
  -- The e2e tests also use BIENVENUE: count from the current value.
  used_before int := (select redemptions from public.promo_codes where code = 'BIENVENUE');
  pay uuid;
  r text;
begin
  insert into public.payments (tournament_id, club_id, amount_cents, status, provider, promo_code_id)
    values (t, c, 0, 'pending', 'free', promo) returning id into pay;
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  r := public.publish_tournament(pay,
    jsonb_build_object('name', 'Concours publié', 'starts_at', now() + interval '7 days', 'city', 'Aubagne', 'max_teams', 32),
    '[{"label":"1","position":1},{"label":"Honneur","position":2,"reserved":true}]'::jsonb,
    '[{"role":"co_organizer","label":"Bénévole 1","pin":"123456"},{"role":"co_organizer","label":"co","email":"benevole@demo.orgasport.fr"}]'::jsonb);
  if r <> 'published' then raise exception 'expected published, got %', r; end if;
  if public.publish_tournament(pay, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb) <> 'already_published' then raise exception 'not idempotent'; end if;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  if (select status from public.tournaments where id = t) <> 'published' then raise exception 'tournament not published'; end if;
  if (select count(*) from public.venues where tournament_id = t) <> 2 then raise exception 'venues not created'; end if;
  if (select pin_hash from public.tournament_staff where tournament_id = t and label = 'Bénévole 1') in (null, '123456') then raise exception 'PIN not hashed'; end if;
  if (select user_id from public.tournament_staff where tournament_id = t and label = 'co') is null then raise exception 'co-organizer with a confirmed account not linked'; end if;
  if (select redemptions from public.promo_codes where id = promo) <> used_before + 1 then raise exception 'promo redemption not counted once'; end if;
  if (select status from public.payments where id = pay) <> 'paid' then raise exception 'payment not marked paid'; end if;
end $$;
select pg_temp.reset();

-- 7. Hardening (review of phases 3-4).
-- A club admin cannot demote or remove the owner, nor add someone directly.
do $$
declare
  c uuid := (select id from public.clubs where slug = 'as-les-platanes');
  owner uuid := (select user_id from public.club_members where club_id = c and role = 'owner');
  vol uuid := (select id from auth.users where email = 'benevole@demo.orgasport.fr');
  pl uuid := (select id from auth.users where email = 'joueur@demo.orgasport.fr');
  n int;
begin
  update public.club_members set role = 'admin' where club_id = c and user_id = vol;
  perform pg_temp.as_user('benevole@demo.orgasport.fr');
  update public.club_members set role = 'member' where club_id = c and user_id = owner;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'an admin demoted the owner'; end if;
  delete from public.club_members where club_id = c and user_id = owner;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'an admin removed the owner'; end if;
  begin
    insert into public.club_members (club_id, user_id, role) values (c, pl, 'member');
    raise exception 'an admin added a member without invitation';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.reset();
end $$;
-- A member cannot edit a published tournament directly.
select pg_temp.as_user('benevole@demo.orgasport.fr');
do $$
declare n int;
begin
  update public.tournaments set name_display = 'full', max_teams = 999 where short_code = '7KQ2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'a member edited a published tournament'; end if;
end $$;
select pg_temp.reset();
-- Published tournaments never expose the draft form (private contacts).
do $$ begin
  update public.tournaments set draft_form = '{"organizer":{"email":"x@y.z"}}' where short_code = 'GP3M';
  if (select draft_form from public.tournaments where short_code = 'GP3M') <> '{}'::jsonb then
    raise exception 'draft form kept on a published tournament';
  end if;
end $$;
-- Media buckets cannot be listed by visitors.
select pg_temp.as_anon();
do $$ begin
  if exists (select 1 from storage.objects where bucket_id in ('tournament-media', 'club-logos')) then
    raise exception 'anon can list media buckets';
  end if;
end $$;
select pg_temp.reset();

-- Tournament data is written by the server only: a referee or a club admin cannot bypass the engine.
do $$
declare
  tid uuid := (select id from public.tournaments where short_code = '7KQ2');
  vol uuid := (select id from auth.users where email = 'benevole@demo.orgasport.fr');
  n int;
begin
  update public.club_members set role = 'member' where user_id = vol;
  insert into public.tournament_staff (tournament_id, user_id, role, label) values (tid, vol, 'referee', 'Arbitre test');
  perform pg_temp.as_user('benevole@demo.orgasport.fr');
  update public.tournament_staff set revoked_at = null, role = 'organizer' where tournament_id = tid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'a referee edited staff rows'; end if;
  update public.matches set score_a = 13, score_b = 0 where tournament_id = tid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'a referee wrote raw scores'; end if;
  begin
    insert into public.teams (tournament_id, number, name) values (tid, 999, 'Intrus');
    raise exception 'a referee inserted a team';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.registrations where tournament_id = tid and user_id is distinct from vol) <> 0 then raise exception 'a referee read contacts'; end if;
  if exists (select 1 from public.players_private pp join public.players p on p.id = pp.player_id
             join public.teams t on t.id = p.team_id where t.tournament_id = tid and p.user_id is distinct from vol) then
    raise exception 'a referee read licences';
  end if;
  perform pg_temp.reset();
  perform pg_temp.as_user('club@demo.orgasport.fr');
  if (select count(*) from public.registrations where tournament_id = tid) = 0 then raise exception 'club admin should read contacts'; end if;
  update public.matches set score_a = 13, score_b = 0 where tournament_id = tid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'a club admin wrote raw scores'; end if;
  delete from public.tournament_staff where tournament_id = tid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'a club admin deleted staff rows directly'; end if;
  perform pg_temp.reset();
end $$;

-- Lot 2: B/C entries, round kind, players' clubs, closing and purge dates are written by the server only.
do $$
declare
  tid uuid := (select id from public.tournaments where short_code = '7KQ2');
  draft uuid;
  n int;
  who text;
  r jsonb;
  team uuid := (select id from public.teams where tournament_id = (select id from public.tournaments where short_code = '7KQ2') order by number limit 1);
  pl uuid := (select p.id from public.players p where p.team_id = (select id from public.teams where tournament_id = (select id from public.tournaments where short_code = '7KQ2') order by number limit 1) order by position limit 1);
  rnd uuid := (select id from public.rounds where tournament_id = (select id from public.tournaments where short_code = '7KQ2') limit 1);
  v int := (select state_version from public.tournaments where short_code = '7KQ2');
begin
  foreach who in array array['benevole@demo.orgasport.fr', 'club@demo.orgasport.fr', 'joueur@demo.orgasport.fr'] loop
    perform pg_temp.as_user(who);
    update public.teams set bracket_entries = array['consolation', 'consolation_c']::public.bracket_kind[] where tournament_id = tid;
    get diagnostics n = row_count;
    if n <> 0 then raise exception '% entered teams in the B/C directly', who; end if;
    update public.rounds set kind = 'cadrage' where tournament_id = tid;
    get diagnostics n = row_count;
    if n <> 0 then raise exception '% changed a round kind directly', who; end if;
    update public.players set club_number = '0000000', club_name = 'Intrus' where team_id = team;
    get diagnostics n = row_count;
    if n <> 0 then raise exception '% changed a player club directly', who; end if;
    update public.tournaments set finished_at = now(), purged_at = now() where id = tid;
    get diagnostics n = row_count;
    if n <> 0 then raise exception '% closed a tournament directly', who; end if;
    perform pg_temp.reset();
  end loop;

  -- Even on a draft (editable by its club), the closing and purge dates stay server-only.
  select id into draft from public.tournaments
  where status = 'draft' and club_id = (select club_id from public.tournaments where id = tid) limit 1;
  if draft is null then
    insert into public.tournaments (club_id, sport_slug, name, status)
    select club_id, sport_slug, 'Brouillon test', 'draft' from public.tournaments where id = tid returning id into draft;
  end if;
  perform pg_temp.as_user('club@demo.orgasport.fr');
  update public.tournaments set name = 'Brouillon modifié' where id = draft;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'the club should edit its draft'; end if;
  begin
    update public.tournaments set finished_at = now() where id = draft;
    raise exception 'a club member set finished_at on a draft';
  exception when raise_exception then
    if sqlerrm not like '%server only%' then raise; end if;
  end;
  perform pg_temp.reset();

  -- Players' clubs are public; anon reads them like the rest of the player row.
  perform pg_temp.as_anon();
  perform club_number, club_name from public.players limit 1;
  perform kind from public.rounds limit 1;
  -- ...but a visitor without an account cannot write any of the lot 2 columns either.
  begin
    update public.teams set bracket_entries = array['consolation_c']::public.bracket_kind[] where tournament_id = tid;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'anon entered teams in the B/C directly'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.rounds set kind = 'cadrage' where tournament_id = tid;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'anon changed a round kind directly'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.players set club_number = '0000000', club_name = 'Intrus' where team_id = team;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'anon changed a player club directly'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.tournaments set finished_at = now(), purged_at = now() where id = tid;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'anon closed a tournament directly'; end if;
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.reset();

  -- The server (service role) writes the new columns through apply_tournament_changes.
  perform set_config('role', 'service_role', true);
  r := public.apply_tournament_changes(tid, v, jsonb_build_array(
    jsonb_build_object('table', 'teams', 'op', 'update', 'key', 'id', 'id', team, 'values', jsonb_build_object('bracket_entries', jsonb_build_array('consolation', 'consolation_c'))),
    jsonb_build_object('table', 'players', 'op', 'update', 'key', 'id', 'id', pl, 'values', jsonb_build_object('club_number', '0340901', 'club_name', 'BOULE DU CAP AGDE')),
    jsonb_build_object('table', 'rounds', 'op', 'update', 'key', 'id', 'id', rnd, 'values', jsonb_build_object('kind', 'cadrage'))
  ), jsonb_build_object('type', 'test.lot2', 'source', 'table'));
  perform pg_temp.reset();
  if (select bracket_entries from public.teams where id = team) <> array['consolation', 'consolation_c']::public.bracket_kind[] then raise exception 'B/C entries not written by the server'; end if;
  if (select club_number from public.players where id = pl) <> '0340901' then raise exception 'player club not written by the server'; end if;
  if (select kind from public.rounds where id = rnd) <> 'cadrage' then raise exception 'round kind not written by the server'; end if;
end $$;

-- Live updates: anyone may listen to "tournament:CODE" (private channel), only the server may send.
do $$
declare who text;
begin
  if exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
             and cmd in ('INSERT', 'ALL', 'UPDATE')) then
    raise exception 'a client write policy exists on realtime.messages';
  end if;
  foreach who in array array['anon', 'benevole@demo.orgasport.fr', 'club@demo.orgasport.fr'] loop
    if who = 'anon' then perform pg_temp.as_anon(); else perform pg_temp.as_user(who); end if;
    perform set_config('realtime.topic', 'tournament:7KQ2', true);
    if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and cmd = 'SELECT') then
      raise exception 'nobody can listen to tournament updates';
    end if;
    begin
      insert into realtime.messages (topic, extension, event, payload, private)
        values ('tournament:7KQ2', 'broadcast', 'update', '{"version": 999999999}', true);
      raise exception '% sent a fake tournament update', who;
    exception when insufficient_privilege then null;
    end;
    perform pg_temp.reset();
  end loop;
end $$;

-- Lot 2 (B1): the engine's real write path is an INSERT of a full row (entityToRow): the server
-- inserts a "cadrage" round of the concours C; a client can neither do that nor create a
-- tournament that is already closed or purged.
do $$
declare
  tid uuid := (select id from public.tournaments where short_code = '7KQ2');
  rid uuid := gen_random_uuid();
  draft uuid;
  n int;
begin
  perform set_config('role', 'service_role', true);
  perform public.apply_tournament_changes(tid, (select state_version from public.tournaments where id = tid), jsonb_build_array(
    jsonb_build_object('table', 'rounds', 'op', 'insert', 'key', 'id', 'id', rid, 'values', jsonb_build_object(
      'id', rid, 'tournament_id', tid, 'bracket', 'consolation_c', 'phase', 'elimination', 'kind', 'cadrage',
      'number', 2, 'status', 'drawn', 'seed', 'b1', 'drawn_at', now()))
  ), jsonb_build_object('type', 'test.lot2.insert', 'source', 'table'));
  perform pg_temp.reset();
  if not exists (select 1 from public.rounds where id = rid and bracket = 'consolation_c' and kind = 'cadrage') then
    raise exception 'the server could not insert a cadrage round of the concours C';
  end if;

  perform pg_temp.as_user('club@demo.orgasport.fr');
  begin
    insert into public.rounds (tournament_id, bracket, phase, kind, number) values (tid, 'consolation_c', 'elimination', 'cadrage', 9);
    raise exception 'a club member inserted a round directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.tournaments (club_id, sport_slug, name, status, created_by, finished_at)
    select club_id, sport_slug, 'Déjà clos', 'draft', auth.uid(), now() from public.tournaments where id = tid;
    raise exception 'a club member created a tournament with finished_at';
  exception when raise_exception then
    if sqlerrm not like '%server only%' then raise; end if;
  end;
  begin
    insert into public.tournaments (club_id, sport_slug, name, status, created_by, purged_at)
    select club_id, sport_slug, 'Déjà purgé', 'draft', auth.uid(), now() from public.tournaments where id = tid;
    raise exception 'a club member created a tournament with purged_at';
  exception when raise_exception then
    if sqlerrm not like '%server only%' then raise; end if;
  end;
  perform pg_temp.reset();
end $$;

-- Lot 2 (B1): with a real service-role JWT (as the web server sends it), apply_tournament_changes
-- writes finished_at together with the status (B2: set when the engine reaches "finished", cleared
-- when it goes back to "live", in the same atomic action); a club member cannot call the function.
do $$
declare
  tid uuid := (select id from public.tournaments where short_code = '7KQ2');
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.apply_tournament_changes(tid, (select state_version from public.tournaments where id = tid), jsonb_build_array(
    jsonb_build_object('table', 'tournaments', 'op', 'update', 'key', 'id', 'id', tid, 'values',
      jsonb_build_object('status', 'finished', 'finished_at', '2026-10-12T18:00:00Z'))
  ), jsonb_build_object('type', 'test.lot2.lifecycle', 'source', 'table'));
  perform pg_temp.reset();
  if (select finished_at from public.tournaments where id = tid) is distinct from '2026-10-12T18:00:00Z'::timestamptz then
    raise exception 'the server could not write finished_at through apply_tournament_changes';
  end if;
  -- purged_at stays reserved to the purge function (B3): the engine path refuses it.
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  begin
    perform public.apply_tournament_changes(tid, (select state_version from public.tournaments where id = tid), jsonb_build_array(
      jsonb_build_object('table', 'tournaments', 'op', 'update', 'key', 'id', 'id', tid, 'values',
        jsonb_build_object('status', 'archived', 'purged_at', '2026-10-12T18:00:00Z'))
    ), jsonb_build_object('type', 'test.lot2.lifecycle', 'source', 'table'));
    raise exception 'apply_tournament_changes accepted purged_at';
  exception when others then
    if sqlerrm <> 'tournament_change_not_allowed' then raise; end if;
  end;
  perform pg_temp.reset();
  if (select purged_at from public.tournaments where id = tid) is not null then
    raise exception 'purged_at was written through apply_tournament_changes';
  end if;

  perform pg_temp.as_user('club@demo.orgasport.fr');
  begin
    perform public.apply_tournament_changes(tid, (select state_version from public.tournaments where id = tid), jsonb_build_array(
      jsonb_build_object('table', 'tournaments', 'op', 'update', 'key', 'id', 'id', tid, 'values', jsonb_build_object('finished_at', null))
    ), jsonb_build_object('type', 'test.lot2.lifecycle', 'source', 'table'));
    raise exception 'a club member called apply_tournament_changes';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.reset();
end $$;

-- A2: dated knowledge base. The public search finds the « cadrage » and « PIN »
-- help sheets, returns rulebook sheets with their dates, and a rulebook sheet
-- cannot be saved without its dates; a non-admin cannot edit a sheet.
do $$
declare
  r record;
  n int;
begin
  perform pg_temp.as_anon();
  if not exists (select 1 from public.kb_search('comment marche le cadrage', 'petanque', 5) where title ilike '%cadrage%' and kind = 'help') then
    raise exception 'kb_search does not find the cadrage help sheet';
  end if;
  if not exists (select 1 from public.kb_search('comment marche le PIN des bénévoles', null, 5) where title ilike '%PIN%') then
    raise exception 'kb_search does not find the PIN help sheet';
  end if;
  select * into r from public.kb_search('règlement but nul mesure', 'petanque', 10) where kind = 'rules' limit 1;
  if r is null or r.version_date is null or r.reviewed_at is null or r.source_url is null then
    raise exception 'a rulebook sheet is returned without its source or dates';
  end if;
  update public.kb_documents set kind = 'help' where kind = 'rules';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'anon edited a knowledge sheet'; end if;
  perform pg_temp.reset();

  begin
    insert into public.kb_documents (title, body, kind, published) values ('Règlement sans date', 'texte', 'rules', false);
    raise exception 'a rulebook sheet was saved without dates';
  exception when check_violation then null;
  end;
end $$;

-- B3. Purge 14 days after the final: personal data deleted, payments and the short code kept,
-- a second run does nothing, a tournament finished 13 days ago is untouched.
do $$
declare
  club uuid;
  owner uuid;
  t_old uuid; t_new uuid; t_stale uuid;
  code_old text; code_new text; code_stale text;
  tm uuid; pl uuid; sub uuid; uid uuid;
  t uuid;
  purged text[];
  n int;
begin
  select club_id, created_by into club, owner from public.tournaments where short_code = 'GP3M';
  select id into uid from auth.users where email = 'joueur@demo.orgasport.fr';
  insert into public.tournaments (club_id, sport_slug, name, status, finished_at, starts_at)
    values (club, 'petanque', 'Purge 15 jours', 'archived', now() - interval '15 days', now() - interval '15 days')
    returning id, short_code into t_old, code_old;
  insert into public.tournaments (club_id, sport_slug, name, status, finished_at, starts_at)
    values (club, 'petanque', 'Purge 13 jours', 'archived', now() - interval '13 days', now() - interval '13 days')
    returning id, short_code into t_new, code_new;
  -- Safety net: a tournament that never finished is purged 6 months after its start.
  insert into public.tournaments (club_id, sport_slug, name, status, starts_at)
    values (club, 'petanque', 'Purge 7 mois', 'published', now() - interval '7 months')
    returning id, short_code into t_stale, code_stale;
  insert into public.teams (tournament_id, number) values (t_stale, 1) returning id into tm;
  insert into public.registrations (team_id, tournament_id, source, captain_phone) values (tm, t_stale, 'online', '0600000001');
  foreach t in array array[t_old, t_new] loop
    insert into public.teams (tournament_id, number, name, club_name) values (t, 1, 'Les Pointeurs', 'Boule du Cap') returning id into tm;
    insert into public.players (team_id, first_name, last_name) values (tm, 'Jean', 'Dupont') returning id into pl;
    insert into public.players_private (player_id, license_number) values (pl, '01234567');
    insert into public.registrations (team_id, tournament_id, source, captain_name, captain_phone, captain_email)
      values (tm, t, 'online', 'Jean Dupont', '0600000000', 'jean@example.org');
    insert into public.team_secrets (team_id, code) values (tm, '1234');
    insert into public.tournament_staff (tournament_id, role, label, pin_hash) values (t, 'referee', 'Table', 'hash');
    insert into public.tournament_actions (tournament_id, type) values (t, 'team.create');
    insert into public.notifications (channel, template, tournament_id, email) values ('email', 'reminder', t, 'jean@example.org');
    insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/' || t, 'k', 'a') returning id into sub;
    insert into public.push_targets (subscription_id, tournament_id, team_id) values (sub, t, tm);
    insert into public.follows (user_id, tournament_id) values (uid, t);
    insert into public.payments (tournament_id, club_id, amount_cents, status) values (t, club, 2900, 'paid');
  end loop;

  purged := public.purge_finished_tournaments(now());
  if not (code_old = any(purged)) then raise exception 'a tournament finished 15 days ago must be purged'; end if;
  if code_new = any(purged) then raise exception 'a tournament finished 13 days ago must not be purged'; end if;
  if not (code_stale = any(purged)) or exists (select 1 from public.registrations where tournament_id = t_stale) then
    raise exception 'a tournament started 7 months ago must be purged';
  end if;

  if exists (select 1 from public.players p join public.teams x on x.id = p.team_id where x.tournament_id = t_old)
     or exists (select 1 from public.registrations where tournament_id = t_old)
     or exists (select 1 from public.team_secrets s join public.teams x on x.id = s.team_id where x.tournament_id = t_old)
     or exists (select 1 from public.tournament_staff where tournament_id = t_old)
     or exists (select 1 from public.tournament_actions where tournament_id = t_old)
     or exists (select 1 from public.notifications where tournament_id = t_old)
     or exists (select 1 from public.push_targets where tournament_id = t_old)
     or exists (select 1 from public.push_subscriptions where endpoint = 'https://push.example/' || t_old)
     or exists (select 1 from public.follows where tournament_id = t_old)
     or exists (select 1 from public.teams where tournament_id = t_old and (name is not null or club_name is not null)) then
    raise exception 'the purge left personal data behind';
  end if;
  if (select count(*) from public.players_private pp where pp.license_number = '01234567') <> 1 then
    raise exception 'the purge must delete the licence of the purged tournament only';
  end if;
  if not exists (select 1 from public.payments where tournament_id = t_old and status = 'paid') then raise exception 'payments must be kept'; end if;
  if not exists (select 1 from public.teams where tournament_id = t_old and number = 1) then raise exception 'anonymous teams must be kept'; end if;
  if (select purged_at from public.tournaments where id = t_old) is null then raise exception 'purged_at must be filled'; end if;
  if (select short_code from public.tournaments where id = t_old) is distinct from code_old then raise exception 'the tournament row and its code must be kept'; end if;

  if (select count(*) from public.players p join public.teams x on x.id = p.team_id where x.tournament_id = t_new) <> 1
     or not exists (select 1 from public.registrations where tournament_id = t_new)
     or not exists (select 1 from public.tournament_staff where tournament_id = t_new)
     or (select purged_at from public.tournaments where id = t_new) is not null then
    raise exception 'a tournament finished 13 days ago must keep its data';
  end if;

  if cardinality(public.purge_finished_tournaments(now())) <> 0 then raise exception 'a second run must do nothing'; end if;

  -- The code is never given out again: the generator checks the kept row, and the column is unique.
  for n in 1..200 loop
    if public.generate_short_code() = code_old then raise exception 'generate_short_code reused a purged code'; end if;
  end loop;
  begin
    insert into public.tournaments (club_id, sport_slug, name, short_code) values (club, 'petanque', 'Code repris', code_old);
    raise exception 'a purged code was given to a new tournament';
  exception when unique_violation then null;
  end;
end $$;

-- B3 (testeur). Details of the purge: captains' score submissions deleted, a device of an
-- account kept but unlinked, a device without an account that still follows another tournament
-- kept, state_version bumped so open pages refresh; a tournament only 'finished' (not closed for
-- good) 15 days ago is left alone; rounds and matches (anonymous counters) are kept.
do $$
declare
  club uuid;
  uid uuid;
  t_old uuid; t_fin uuid; t_other uuid;
  tm uuid; tm2 uuid; rd uuid; mt uuid;
  sub_acc uuid; sub_anon uuid;
  v int;
  purged text[];
begin
  select club_id into club from public.tournaments where short_code = 'GP3M';
  select id into uid from auth.users where email = 'joueur@demo.orgasport.fr';
  insert into public.tournaments (club_id, sport_slug, name, status, finished_at, starts_at)
    values (club, 'petanque', 'Purge détails', 'archived', now() - interval '20 days', now() - interval '20 days')
    returning id, state_version into t_old, v;
  insert into public.tournaments (club_id, sport_slug, name, status, finished_at, starts_at)
    values (club, 'petanque', 'Fini non clos', 'finished', now() - interval '15 days', now() - interval '15 days')
    returning id into t_fin;
  insert into public.tournaments (club_id, sport_slug, name, status, starts_at)
    values (club, 'petanque', 'Autre suivi', 'published', now() + interval '5 days')
    returning id into t_other;
  insert into public.teams (tournament_id, number, name) values (t_old, 1, 'Equipe A') returning id into tm;
  insert into public.teams (tournament_id, number, name) values (t_old, 2, 'Equipe B') returning id into tm2;
  insert into public.rounds (tournament_id, number, phase, status) values (t_old, 1, 'elimination', 'finished') returning id into rd;
  insert into public.matches (tournament_id, round_id, position, team_a_id, team_b_id, score_a, score_b, winner_team_id, status)
    values (t_old, rd, 1, tm, tm2, 13, 7, tm, 'done') returning id into mt;
  insert into public.score_submissions (match_id, submitted_by_team, score_a, score_b) values (mt, tm, 13, 7);
  -- Device of an account, linked to the purged tournament.
  insert into public.push_subscriptions (endpoint, p256dh, auth, user_id, tournament_id, team_id)
    values ('https://push.example/acc', 'k', 'a', uid, t_old, tm) returning id into sub_acc;
  insert into public.push_targets (subscription_id, tournament_id, team_id) values (sub_acc, t_old, tm);
  -- Device without an account, following the purged tournament and another one.
  insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/anon2', 'k', 'a') returning id into sub_anon;
  insert into public.push_targets (subscription_id, tournament_id, team_id) values (sub_anon, t_old, tm2);
  insert into public.push_targets (subscription_id, tournament_id) values (sub_anon, t_other);
  insert into public.teams (tournament_id, number, name) values (t_fin, 1, 'Pas encore close');

  purged := public.purge_finished_tournaments(now());
  if not ((select short_code from public.tournaments where id = t_old) = any(purged)) then raise exception 'B3: tournament closed 20 days ago not purged'; end if;
  if exists (select 1 from public.score_submissions where match_id = mt) then raise exception 'B3: captains score submissions must be deleted'; end if;
  if not exists (select 1 from public.matches where id = mt and score_a = 13 and score_b = 7)
     or not exists (select 1 from public.rounds where id = rd) then
    raise exception 'B3: rounds and matches (anonymous counters) must be kept';
  end if;
  if not exists (select 1 from public.push_subscriptions where id = sub_acc and user_id = uid and tournament_id is null and team_id is null) then
    raise exception 'B3: the device of an account must be kept, unlinked from the purged tournament';
  end if;
  if exists (select 1 from public.push_targets where subscription_id in (sub_acc, sub_anon) and tournament_id = t_old) then
    raise exception 'B3: push targets of the purged tournament must be deleted';
  end if;
  if not exists (select 1 from public.push_targets where subscription_id = sub_anon and tournament_id = t_other) then
    raise exception 'B3: a device following another tournament must keep that follow';
  end if;
  if (select state_version from public.tournaments where id = t_old) <> v + 1 then raise exception 'B3: state_version must be bumped'; end if;
  if (select purged_at from public.tournaments where id = t_fin) is not null
     or not exists (select 1 from public.teams where tournament_id = t_fin and name = 'Pas encore close') then
    raise exception 'B3: a tournament not closed for good must not be purged at 15 days';
  end if;
end $$;

-- B3 (testeur). Limits of the purge: exactly 14 days after the final is purged (14 days of
-- retention, not 15); a draft is never purged, even 7 months old (nothing was ever published);
-- the purge uses the time it is given (p_now), not the clock.
do $$
declare
  club uuid;
  t_edge uuid; t_draft uuid; t_later uuid;
  purged text[];
begin
  select club_id into club from public.tournaments where short_code = 'GP3M';
  insert into public.tournaments (club_id, sport_slug, name, status, finished_at, starts_at)
    values (club, 'petanque', 'Purge pile 14 jours', 'archived', now() - interval '14 days', now() - interval '14 days')
    returning id into t_edge;
  insert into public.tournaments (club_id, sport_slug, name, status, starts_at, created_at)
    values (club, 'petanque', 'Brouillon ancien', 'draft', now() - interval '7 months', now() - interval '7 months')
    returning id into t_draft;
  insert into public.tournaments (club_id, sport_slug, name, status, finished_at, starts_at)
    values (club, 'petanque', 'Purge plus tard', 'archived', now() - interval '10 days', now() - interval '10 days')
    returning id into t_later;
  insert into public.teams (tournament_id, number, name) values (t_draft, 1, 'Brouillon');

  purged := public.purge_finished_tournaments(now());
  if (select purged_at from public.tournaments where id = t_edge) is null then
    raise exception 'B3: a tournament finished exactly 14 days ago must be purged';
  end if;
  if (select purged_at from public.tournaments where id = t_draft) is not null
     or not exists (select 1 from public.teams where tournament_id = t_draft and name = 'Brouillon') then
    raise exception 'B3: a draft must never be purged';
  end if;
  if (select purged_at from public.tournaments where id = t_later) is not null then
    raise exception 'B3: a tournament finished 10 days ago must not be purged yet';
  end if;
  -- Five days later (p_now), the same tournament is due.
  purged := public.purge_finished_tournaments(now() + interval '5 days');
  if (select purged_at from public.tournaments where id = t_later) is distinct from now() + interval '5 days' then
    raise exception 'B3: the purge must use p_now (purged_at = p_now)';
  end if;
end $$;

-- B3 (correction). The 6-month safety net also closes the tournament for good: a 'live'
-- tournament started 7 months ago is purged AND archived (no new team, score or PIN sign-in
-- whose data would never be purged), its finished_at left as it was (null).
do $$
declare
  club uuid;
  t_live uuid; code_live text;
  purged text[];
begin
  select club_id into club from public.tournaments where short_code = 'GP3M';
  insert into public.tournaments (club_id, sport_slug, name, status, starts_at)
    values (club, 'petanque', 'En direct depuis 7 mois', 'live', now() - interval '7 months')
    returning id, short_code into t_live, code_live;
  purged := public.purge_finished_tournaments(now());
  if not (code_live = any(purged)) or (select purged_at from public.tournaments where id = t_live) is null then
    raise exception 'B3: a live tournament started 7 months ago must be purged';
  end if;
  if (select status from public.tournaments where id = t_live) <> 'archived' then
    raise exception 'B3: a tournament purged by the 6-month safety net must be archived';
  end if;
  if (select finished_at from public.tournaments where id = t_live) is not null then
    raise exception 'B3: the purge must keep finished_at as it was';
  end if;
end $$;

-- Only the server (service role, pg_cron) may run the purge.
select pg_temp.as_user('club@demo.orgasport.fr');
do $$ begin
  perform public.purge_finished_tournaments(now());
  raise exception 'a signed-in user ran the purge';
exception when insufficient_privilege then null;
end $$;
select pg_temp.as_anon();
do $$ begin
  perform public.purge_finished_tournaments(now());
  raise exception 'anon ran the purge';
exception when insufficient_privilege then null;
end $$;
select pg_temp.reset();

\echo 'RLS checks passed'
rollback;
