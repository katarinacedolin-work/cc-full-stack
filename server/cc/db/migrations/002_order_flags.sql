-- Flags that are not Sharetribe transaction states (e.g. ready-for-pickup notice).
create table order_flags (
  transaction_id text primary key,
  ready_for_pickup boolean not null default false,
  updated_at timestamptz not null default now()
);
