-- Reading Quiz Live — initial database schema.
-- Apply in Supabase SQL Editor. For production, keep answer keys private and use the Edge Function
-- as the only path for joining, reading questions, submitting answers, and scoring.
create extension if not exists pgcrypto;

create table if not exists public.quiz_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique check (room_code ~ '^[A-Z0-9]{4,8}$'),
  status text not null default 'lobby' check (status in ('lobby','live','finished')),
  question_index integer not null default -1,
  questions jsonb not null default '[]'::jsonb,
  deadline timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.quiz_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.quiz_rooms(id) on delete cascade,
  player_id text not null,
  nickname text not null check (char_length(nickname) between 1 and 24),
  score integer not null default 0 check (score >= 0),
  joined_at timestamptz not null default now(),
  unique(room_id, player_id)
);

create table if not exists public.quiz_answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.quiz_rooms(id) on delete cascade,
  participant_id uuid not null references public.quiz_participants(id) on delete cascade,
  question_index integer not null,
  answer_index integer not null check (answer_index between 0 and 3),
  is_correct boolean not null,
  points_awarded integer not null default 0,
  submitted_at timestamptz not null default now(),
  unique(participant_id, question_index)
);

alter table public.quiz_rooms enable row level security;
alter table public.quiz_participants enable row level security;
alter table public.quiz_answers enable row level security;

-- Deny direct client access by default. The quiz-api Edge Function uses the service role key
-- on the server only, and validates all actions. Do not add broad anon SELECT/INSERT policies.
revoke all on public.quiz_rooms from anon, authenticated;
revoke all on public.quiz_participants from anon, authenticated;
revoke all on public.quiz_answers from anon, authenticated;

-- Enable realtime broadcast at application level via Supabase channels.
-- Do not expose quiz_rooms.questions directly: it contains answer keys.
