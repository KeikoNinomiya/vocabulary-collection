-- Vocabulary Collection: Supabase の SQL Editor に貼り付けて「Run」を押してください。
-- 何度実行しても壊れないように書いてあります。

-- 単語・フレーズのカード
create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  phrase text not null,
  meaning text not null default '',
  example text not null default '',
  translation text not null default '',
  source text not null default '',
  source_title text not null default '',
  source_type text not null default 'manual',
  note text not null default '',
  status text not null default 'Not yet' check (status in ('Not yet', 'Fuzzy', 'Mastered')),
  step int not null default 0,
  due date not null default (now() at time zone 'Asia/Tokyo')::date,
  reviews int not null default 0,
  lapses int not null default 0,
  last_reviewed timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cards_user_due on public.cards (user_id, due);

-- 動画の要約
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id text,
  url text not null default '',
  title text not null default '',
  summary text not null default '',
  points jsonb not null default '[]',
  phrases jsonb not null default '[]',
  transcript text not null default '',
  created_at timestamptz not null default now()
);

-- 通知の送り先（iPhone などの端末ごと）
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- 自分のデータだけ読み書きできるようにする
alter table public.cards enable row level security;
alter table public.videos enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "own cards" on public.cards;
create policy "own cards" on public.cards for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own videos" on public.videos;
create policy "own videos" on public.videos for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own push" on public.push_subscriptions;
create policy "own push" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
