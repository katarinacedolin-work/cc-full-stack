-- One row for each ticket order. An order is always for one ticket, so it has one code.
create table tickets (
  transaction_id text primary key,
  listing_id text not null,
  seller_id text not null,
  buyer_id text not null,
  buyer_name text not null default '',
  listing_title text not null default '',
  code text not null unique,
  -- issued: can be scanned. used: scanned at the door. void: the order was cancelled.
  status text not null default 'issued' check (status in ('issued', 'used', 'void')),
  event_starts_at timestamptz,
  issued_at timestamptz not null default now(),
  used_at timestamptz,
  used_by text,
  voided_at timestamptz,
  -- When the Sharetribe transaction was completed, which is what pays the seller.
  completed_at timestamptz,
  -- The last time completing it was tried and did not work.
  completion_checked_at timestamptz
);

create index tickets_listing_id_idx on tickets (listing_id);
create index tickets_to_complete_idx on tickets (event_starts_at)
  where completed_at is null and status <> 'void';

-- Students the host lets scan tickets for one event.
create table event_door_helpers (
  listing_id text not null,
  helper_user_id text not null,
  helper_name text not null default '',
  helper_email text not null,
  host_id text not null,
  created_at timestamptz not null default now(),
  primary key (listing_id, helper_user_id)
);

create index event_door_helpers_helper_idx on event_door_helpers (helper_user_id);
