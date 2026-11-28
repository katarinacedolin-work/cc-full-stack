-- The worker's place in Sharetribe's event feed. Always exactly one row.
create table event_cursor (
  id integer primary key default 1 check (id = 1),
  -- The last event the worker finished. Null until the first event arrives.
  sequence_id bigint,
  -- Until then, the worker reads events created from this moment on.
  started_at timestamptz not null default now()
);

insert into event_cursor default values;
