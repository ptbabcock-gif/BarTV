-- The Cheers: shared groups schema for Supabase.
-- Paste this whole file into the Supabase SQL editor and run it once.
-- Also enable Authentication -> Sign In / Providers -> "Anonymous sign-ins".

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.venues (
  id uuid primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  city text not null default '',
  address text not null default '',
  lat double precision,
  lng double precision,
  notes text not null default '',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.tastings (
  id uuid primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  price numeric,
  scores jsonb not null default '{}'::jsonb,
  ingredients jsonb not null default '{}'::jsonb,
  notes text not null default '',
  would_order_again boolean,
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.venue_photos (
  id uuid primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists venues_group_updated on public.venues (group_id, updated_at);
create index if not exists tastings_group_updated on public.tastings (group_id, updated_at);
create index if not exists venue_photos_group_updated on public.venue_photos (group_id, updated_at);

-- ---------- helpers ----------
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists venues_touch on public.venues;
create trigger venues_touch before update on public.venues for each row execute function public.touch_updated_at();
drop trigger if exists tastings_touch on public.tastings;
create trigger tastings_touch before update on public.tastings for each row execute function public.touch_updated_at();
drop trigger if exists venue_photos_touch on public.venue_photos;
create trigger venue_photos_touch before update on public.venue_photos for each row execute function public.touch_updated_at();

create or replace function public.is_member(g uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.members where group_id = g and user_id = auth.uid());
$$;

-- Create a group and join it. Returns the group row (with its join code).
create or replace function public.create_group(p_name text, p_display_name text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups; code text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  loop
    code := '';
    for i in 1..6 loop code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from public.groups where join_code = code);
  end loop;
  insert into public.groups (name, join_code, created_by) values (trim(p_name), code, auth.uid()) returning * into g;
  insert into public.members (group_id, user_id, display_name) values (g.id, auth.uid(), trim(p_display_name));
  return g;
end $$;

-- Join an existing group by code. Returns the group row.
create or replace function public.join_group(p_code text, p_display_name text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into g from public.groups where join_code = upper(trim(p_code));
  if g.id is null then raise exception 'no group with that code'; end if;
  insert into public.members (group_id, user_id, display_name) values (g.id, auth.uid(), trim(p_display_name))
    on conflict (group_id, user_id) do update set display_name = excluded.display_name;
  return g;
end $$;

-- ---------- row level security ----------
alter table public.groups enable row level security;
alter table public.members enable row level security;
alter table public.venues enable row level security;
alter table public.tastings enable row level security;
alter table public.venue_photos enable row level security;

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select using (public.is_member(id));

drop policy if exists members_select on public.members;
create policy members_select on public.members for select using (public.is_member(group_id));
drop policy if exists members_update_own on public.members;
create policy members_update_own on public.members for update using (user_id = auth.uid());
drop policy if exists members_delete_own on public.members;
create policy members_delete_own on public.members for delete using (user_id = auth.uid());

drop policy if exists venues_select on public.venues;
create policy venues_select on public.venues for select using (public.is_member(group_id));
drop policy if exists venues_insert on public.venues;
create policy venues_insert on public.venues for insert with check (public.is_member(group_id) and created_by = auth.uid());
drop policy if exists venues_update on public.venues;
create policy venues_update on public.venues for update using (public.is_member(group_id));

drop policy if exists tastings_select on public.tastings;
create policy tastings_select on public.tastings for select using (public.is_member(group_id));
drop policy if exists tastings_insert on public.tastings;
create policy tastings_insert on public.tastings for insert with check (public.is_member(group_id) and user_id = auth.uid());
drop policy if exists tastings_update_own on public.tastings;
create policy tastings_update_own on public.tastings for update using (user_id = auth.uid());

drop policy if exists venue_photos_select on public.venue_photos;
create policy venue_photos_select on public.venue_photos for select using (public.is_member(group_id));
drop policy if exists venue_photos_insert on public.venue_photos;
create policy venue_photos_insert on public.venue_photos for insert with check (public.is_member(group_id) and user_id = auth.uid());
drop policy if exists venue_photos_update_own on public.venue_photos;
create policy venue_photos_update_own on public.venue_photos for update using (user_id = auth.uid());

-- ---------- photo storage ----------
insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
  on conflict (id) do nothing;

drop policy if exists photos_public_read on storage.objects;
create policy photos_public_read on storage.objects for select using (bucket_id = 'photos');
drop policy if exists photos_member_upload on storage.objects;
create policy photos_member_upload on storage.objects for insert
  with check (bucket_id = 'photos' and auth.uid() is not null);
