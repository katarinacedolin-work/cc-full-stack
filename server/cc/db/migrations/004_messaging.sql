-- Every conversation in the inbox.
--
-- A conversation about a listing or an order belongs to a Sharetribe transaction: Sharetribe
-- keeps the messages and emails the other person, and a copy of each message is kept here so
-- the inbox is one query. The other kinds only exist here.
create table threads (
  id bigserial primary key,
  kind text not null check (kind in ('order', 'direct', 'job', 'housing', 'ticket-post')),
  -- The Sharetribe transaction, for kind 'order'. A question about a listing gets one when
  -- its first message is sent.
  transaction_id text unique,
  -- What it is about: the listing for 'order', the board post for the board kinds.
  context_id text not null default '',
  context_title text not null default '',
  -- Who wrote first: the buyer, or the person answering a post.
  starter_id text not null,
  starter_name text not null default '',
  -- Who was written to: the seller, or the post's author.
  owner_id text not null,
  owner_name text not null default '',
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

-- Two people have one conversation about one thing. Orders are the exception: each has its own.
create unique index threads_pair_idx on threads (kind, context_id, starter_id, owner_id)
  where transaction_id is null;
create index threads_starter_idx on threads (starter_id, last_message_at desc);
create index threads_owner_idx on threads (owner_id, last_message_at desc);

create table messages (
  id bigserial primary key,
  thread_id bigint not null references threads (id) on delete cascade,
  sender_id text not null,
  body text not null,
  -- The id of the message in Sharetribe, for 'order' threads. It keeps a copy from being
  -- stored twice.
  sharetribe_id text unique,
  created_at timestamptz not null default now()
);

create index messages_thread_idx on messages (thread_id, created_at, id);

-- What one person has done with a conversation.
create table thread_state (
  thread_id bigint not null references threads (id) on delete cascade,
  user_id text not null,
  -- When they last opened it. Messages from the other person after this are unread.
  read_at timestamptz,
  done boolean not null default false,
  primary key (thread_id, user_id)
);

-- The bell.
create table notifications (
  id bigserial primary key,
  user_id text not null,
  -- Which pages show it: the buyer pages or Seller Hub.
  side text not null check (side in ('buyer', 'seller')),
  category text not null check (category in ('orders', 'messages', 'reviews')),
  title text not null,
  body text not null default '',
  emoji text not null default '',
  accent text not null default 'cobalt',
  -- Where a click leads (order, inbox, reviews, listing, scan) and the id of that thing.
  action text not null default '',
  target_id text not null default '',
  -- Set when the same notification could be written twice, so there is only ever one.
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index notifications_user_idx on notifications (user_id, side, created_at desc);

-- Which kinds of bell notification a person wants. A missing row means all of them.
create table user_settings (
  user_id text primary key,
  notify_messages boolean not null default true,
  notify_orders boolean not null default true,
  notify_requests boolean not null default true,
  notify_reviews boolean not null default true,
  updated_at timestamptz not null default now()
);

-- When something last changed for a person. The pages ask for this to know when to reload.
create table user_activity (
  user_id text primary key,
  changed_at timestamptz not null default now()
);
