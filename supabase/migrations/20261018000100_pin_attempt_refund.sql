-- PIN attempts are reserved before the check (hit_rate_limit, atomic, so
-- parallel requests from one device never exceed the limit) and given back
-- when the PIN is right: only failed attempts count.
create or replace function public.refund_rate_limit(p_key text)
returns void language sql security definer set search_path = '' as $$
  update public.rate_limits set count = count - 1 where key = p_key and count > 0
$$;
revoke execute on function public.refund_rate_limit(text) from public, anon, authenticated;
grant execute on function public.refund_rate_limit(text) to service_role;
