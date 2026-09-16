create or replace function public.repo_learning_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.repo_learning_projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null,
  audience text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.repo_learning_research_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.repo_learning_projects(id) on delete cascade,
  slug text not null unique,
  title text not null,
  summary text not null,
  category text not null,
  content text not null,
  source_path text not null unique,
  source_url text,
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.repo_learning_tracks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.repo_learning_projects(id) on delete cascade,
  slug text not null unique,
  title text not null,
  description text not null,
  order_index integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.repo_learning_lessons (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.repo_learning_projects(id) on delete cascade,
  track_id uuid not null references public.repo_learning_tracks(id) on delete cascade,
  slug text not null unique,
  title text not null,
  stage text not null,
  difficulty text not null,
  order_index integer not null,
  estimated_minutes integer not null,
  summary text not null,
  goals_json jsonb not null default '[]'::jsonb,
  content text not null,
  related_research_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.repo_learning_quizzes (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.repo_learning_lessons(id) on delete cascade,
  title text not null,
  passing_score integer not null default 70,
  question_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.repo_learning_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.repo_learning_quizzes(id) on delete cascade,
  order_index integer not null,
  prompt text not null,
  options_json jsonb not null default '[]'::jsonb,
  correct_option text not null,
  explanation text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quiz_id, order_index)
);

create table if not exists public.repo_learning_lesson_progress (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.repo_learning_lessons(id) on delete cascade,
  status text not null default 'not_started',
  confidence integer not null default 1,
  quiz_average integer not null default 0,
  quiz_best integer not null default 0,
  last_viewed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.repo_learning_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.repo_learning_quizzes(id) on delete cascade,
  score integer not null,
  total_questions integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.repo_learning_quiz_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.repo_learning_quiz_attempts(id) on delete cascade,
  question_id uuid not null references public.repo_learning_quiz_questions(id) on delete cascade,
  selected_option text not null,
  is_correct boolean not null,
  created_at timestamptz not null default now()
);

create table if not exists public.repo_learning_lesson_comments (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.repo_learning_lessons(id) on delete cascade,
  body text not null,
  understanding_state text not null,
  created_at timestamptz not null default now()
);

create index if not exists repo_learning_research_documents_project_idx
  on public.repo_learning_research_documents(project_id);

create index if not exists repo_learning_tracks_project_idx
  on public.repo_learning_tracks(project_id, order_index);

create index if not exists repo_learning_lessons_track_idx
  on public.repo_learning_lessons(track_id, order_index);

create index if not exists repo_learning_quiz_attempts_quiz_idx
  on public.repo_learning_quiz_attempts(quiz_id, created_at desc);

create index if not exists repo_learning_lesson_comments_lesson_idx
  on public.repo_learning_lesson_comments(lesson_id, created_at desc);

drop trigger if exists repo_learning_projects_touch_updated_at on public.repo_learning_projects;
create trigger repo_learning_projects_touch_updated_at
before update on public.repo_learning_projects
for each row execute function public.repo_learning_touch_updated_at();

drop trigger if exists repo_learning_research_documents_touch_updated_at on public.repo_learning_research_documents;
create trigger repo_learning_research_documents_touch_updated_at
before update on public.repo_learning_research_documents
for each row execute function public.repo_learning_touch_updated_at();

drop trigger if exists repo_learning_tracks_touch_updated_at on public.repo_learning_tracks;
create trigger repo_learning_tracks_touch_updated_at
before update on public.repo_learning_tracks
for each row execute function public.repo_learning_touch_updated_at();

drop trigger if exists repo_learning_lessons_touch_updated_at on public.repo_learning_lessons;
create trigger repo_learning_lessons_touch_updated_at
before update on public.repo_learning_lessons
for each row execute function public.repo_learning_touch_updated_at();

drop trigger if exists repo_learning_quizzes_touch_updated_at on public.repo_learning_quizzes;
create trigger repo_learning_quizzes_touch_updated_at
before update on public.repo_learning_quizzes
for each row execute function public.repo_learning_touch_updated_at();

drop trigger if exists repo_learning_quiz_questions_touch_updated_at on public.repo_learning_quiz_questions;
create trigger repo_learning_quiz_questions_touch_updated_at
before update on public.repo_learning_quiz_questions
for each row execute function public.repo_learning_touch_updated_at();

drop trigger if exists repo_learning_lesson_progress_touch_updated_at on public.repo_learning_lesson_progress;
create trigger repo_learning_lesson_progress_touch_updated_at
before update on public.repo_learning_lesson_progress
for each row execute function public.repo_learning_touch_updated_at();

grant select, insert, update, delete on table public.repo_learning_projects to service_role;
grant select, insert, update, delete on table public.repo_learning_research_documents to service_role;
grant select, insert, update, delete on table public.repo_learning_tracks to service_role;
grant select, insert, update, delete on table public.repo_learning_lessons to service_role;
grant select, insert, update, delete on table public.repo_learning_quizzes to service_role;
grant select, insert, update, delete on table public.repo_learning_quiz_questions to service_role;
grant select, insert, update, delete on table public.repo_learning_lesson_progress to service_role;
grant select, insert, update, delete on table public.repo_learning_quiz_attempts to service_role;
grant select, insert, update, delete on table public.repo_learning_quiz_responses to service_role;
grant select, insert, update, delete on table public.repo_learning_lesson_comments to service_role;
