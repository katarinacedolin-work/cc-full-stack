-- What students post themselves: a job, a room or sublease, or a ticket they want or want to
-- sell. Nothing is bought through a post. People message its author.
create table board_posts (
  id bigserial primary key,
  kind text not null check (kind in ('job', 'housing', 'ticket')),
  -- The Sharetribe user who posted it, and their name as it was then.
  author_id text not null,
  author_name text not null default '',
  -- The job title, what is for rent, or the event a ticket is for.
  title text not null,
  summary text not null default '',
  -- The short answers from the form: where, schedule and pay for a job; place, dates and rent
  -- for housing; ticketKind ('resell' or 'request') and price for a ticket.
  details jsonb not null default '{}',
  -- 'closed' once its author takes it down.
  status text not null default 'open' check (status in ('open', 'closed')),
  -- Set by the team to take a post off the board.
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  -- A post leaves the board on its own after this, so the boards don't fill with old ones.
  expires_at timestamptz not null
);

create index board_posts_open_idx on board_posts (kind, created_at desc)
  where status = 'open' and not hidden;
create index board_posts_author_idx on board_posts (author_id);

-- What the team lists by hand: school-provided services, apartment buildings near campus, and
-- real estate agents. Loaded with the seed script.
create table directory_entries (
  id text primary key,
  kind text not null check (kind in ('school-service', 'apartment', 'agent')),
  -- The order within its kind, lowest first.
  position integer not null default 0,
  -- Everything the pages show for it. The fields depend on the kind.
  details jsonb not null,
  hidden boolean not null default false,
  updated_at timestamptz not null default now()
);

create index directory_entries_kind_idx on directory_entries (kind, position);

-- What students send from "Get help".
create table support_cases (
  id bigserial primary key,
  user_id text not null,
  -- Kept with the case so the team can answer without looking the student up.
  user_name text not null default '',
  user_email text not null default '',
  topic text not null default '',
  message text not null,
  -- The order it is about, when it was sent from one.
  order_id text not null default '',
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

create index support_cases_open_idx on support_cases (created_at desc) where status = 'open';
