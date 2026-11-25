/**
 * The board, directory and support routes, run against a real Postgres.
 * Needs the migrations applied (npm run dev-cc-migrate). Removes what it adds.
 */

require('../../env').configureEnv();

jest.mock('./requireUser', () => ({
  requireUser: jest.fn(),
  requireApprovedUser: jest.fn(),
}));

const crypto = require('crypto');
const db = require('../db');
const { requireUser, requireApprovedUser } = require('./requireUser');
const boards = require('./boards');
const conversations = require('./conversations');
const directory = require('./directory');
const support = require('./support');
const directoryStore = require('../directory/store');
const { checkEntry } = require('../directory/entries');
const notifications = require('../notifications/store');

const hasDatabase = Boolean(process.env.DATABASE_URL);
const maybe = hasDatabase ? describe : describe.skip;

const uuid = () => crypto.randomUUID();
const POSTER = uuid();
const READER = uuid();
const STRANGER = uuid();

const person = (id, displayName, email) => ({
  id: { uuid: id },
  type: 'currentUser',
  attributes: { state: 'active', email, profile: { displayName } },
});

const PEOPLE = {
  [POSTER]: person(POSTER, 'Alex Ruiz', 'aruiz@sdsu.edu'),
  [READER]: person(READER, 'Priya Shah', 'pshah@sdsu.edu'),
  [STRANGER]: person(STRANGER, 'Sam T', 'st@sdsu.edu'),
};

// Runs one route as one student and returns what it answered. Sharetribe is never needed here,
// so the SDK is a stand-in that fails if anything calls it.
const call = async (handler, userId, { body = {}, params = {}, query = {} } = {}) => {
  const sdk = new Proxy(
    {},
    {
      get: (_, name) => {
        throw new Error(`Sharetribe should not be called (sdk.${String(name)})`);
      },
    }
  );
  const signedIn = { sdk, user: PEOPLE[userId], userId };
  requireUser.mockResolvedValue(signedIn);
  requireApprovedUser.mockResolvedValue(signedIn);
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  await handler({ body, params, query }, res);
  return { status: res.statusCode, ...res.body };
};

const boardOf = async (kind, userId) =>
  (await call(boards.list, userId, { query: { kind } })).posts;

// Other tests and real posts share the table, so only look at what this run added.
const ours = posts => posts.filter(post => post.posterId === POSTER || post.posterId === READER);

const job = {
  kind: 'job',
  title: 'Move-in helper',
  where: 'Tenochca',
  schedule: 'Saturday morning',
  pay: '$20/hr',
  summary: 'Carry boxes up two floors.',
};

const ENTRY_IDS = [`test-agent-${Date.now()}`, `test-hidden-${Date.now()}`];

// Runs once, after every group below.
afterAll(async () => {
  if (!hasDatabase) return;
  const people = [POSTER, READER, STRANGER];
  await db.query('delete from threads where starter_id = any($1) or owner_id = any($1)', [people]);
  await db.query('delete from notifications where user_id = any($1)', [people]);
  await db.query('delete from user_activity where user_id = any($1)', [people]);
  await db.query('delete from board_posts where author_id = any($1)', [people]);
  await db.query('delete from support_cases where user_id = any($1)', [people]);
  await db.query('delete from directory_entries where id = any($1)', [ENTRY_IDS]);
  await db.close();
});

maybe('board routes', () => {
  let jobId;
  let ticketId;

  it('puts a job on the board under the name of whoever posted it', async () => {
    const posted = await call(boards.create, POSTER, { body: job });
    jobId = posted.post.id;

    expect(posted.status).toBe(201);
    expect(posted.post).toMatchObject({
      title: 'Move-in helper',
      kicker: 'Tenochca',
      price: '$20/hr',
      poster: 'Alex Ruiz',
      posterId: POSTER,
      mine: true,
    });
  });

  it("shows the post to other students as someone else's, and only on its own board", async () => {
    const [seen] = ours(await boardOf('job', READER));
    expect(seen).toMatchObject({ id: jobId, mine: false, poster: 'Alex Ruiz' });
    expect(ours(await boardOf('housing', READER))).toEqual([]);
    expect(ours(await boardOf('ticket', READER))).toEqual([]);
  });

  it('lists the newest post first', async () => {
    await call(boards.create, READER, { body: { ...job, title: 'Dog walker' } });
    expect(ours(await boardOf('job', STRANGER)).map(post => post.title)).toEqual([
      'Dog walker',
      'Move-in helper',
    ]);
  });

  it('refuses a post with a blank answer, and a board that does not exist', async () => {
    await expect(
      call(boards.create, POSTER, { body: { ...job, summary: '' } })
    ).rejects.toMatchObject({ status: 400, code: 'post-incomplete' });
    await expect(call(boards.list, POSTER, { query: { kind: 'chore' } })).rejects.toMatchObject({
      status: 400,
      code: 'unknown-board',
    });
    await expect(call(boards.list, POSTER)).rejects.toMatchObject({ code: 'unknown-board' });
  });

  it('opens a conversation about a post that reaches nobody until something is said', async () => {
    const opened = await call(conversations.open, READER, { body: { postId: jobId } });

    expect(opened.status).toBe(201);
    expect(opened.conversation).toMatchObject({
      kind: 'job',
      name: 'Alex Ruiz',
      context: 'Move-in helper',
      messages: [],
    });
    expect(await notifications.list({ userId: POSTER, side: 'buyer' })).toEqual([]);

    const again = await call(conversations.open, READER, { body: { postId: jobId } });
    expect(again.conversation.id).toBe(opened.conversation.id);
  });

  it('delivers a message about a post to its author on the buyer pages, not in Seller Hub', async () => {
    const { conversation } = await call(conversations.open, READER, { body: { postId: jobId } });
    await call(conversations.send, READER, {
      params: { id: conversation.id },
      body: { text: 'Is Saturday at 9 okay?' },
    });

    const inbox = side => call(conversations.list, POSTER, { query: { side } });
    const [forPoster] = (await inbox('buyer')).conversations;
    expect(forPoster).toMatchObject({
      id: conversation.id,
      name: 'Priya Shah',
      context: 'Move-in helper',
      unread: true,
    });
    expect((await inbox('seller')).conversations).toEqual([]);

    const [bell] = await notifications.list({ userId: POSTER, side: 'buyer' });
    expect(bell).toMatchObject({
      title: 'Priya Shah',
      action: 'inbox',
      target_id: conversation.id,
    });
    expect(await notifications.list({ userId: POSTER, side: 'seller' })).toEqual([]);
  });

  it('gives each student who answers a post their own conversation', async () => {
    const first = await call(conversations.open, READER, { body: { postId: jobId } });
    const second = await call(conversations.open, STRANGER, { body: { postId: jobId } });
    expect(second.conversation.id).not.toBe(first.conversation.id);
    expect(second.conversation.messages).toEqual([]);
  });

  it('does not let you message your own post, or a post that is not there', async () => {
    await expect(
      call(conversations.open, POSTER, { body: { postId: jobId } })
    ).rejects.toMatchObject({ status: 400, code: 'own-post' });
    await expect(
      call(conversations.open, READER, { body: { postId: '999999999999' } })
    ).rejects.toMatchObject({ status: 404, code: 'post-not-found' });
    await expect(
      call(conversations.open, READER, { body: { postId: 'not-a-number' } })
    ).rejects.toMatchObject({ status: 404, code: 'post-not-found' });
  });

  it('posts a ticket for sale and names the conversation so it reads right for both people', async () => {
    const posted = await call(boards.create, POSTER, {
      body: { kind: 'ticket', ticketKind: 'resell', event: 'Boise State', price: '25' },
    });
    ticketId = posted.post.id;
    expect(posted.post).toMatchObject({
      kind: 'resell',
      event: 'Boise State',
      price: '25',
      mine: true,
    });

    const opened = await call(conversations.open, READER, { body: { postId: ticketId } });
    expect(opened.conversation).toMatchObject({
      kind: 'ticket-post',
      context: 'Boise State ticket · $25',
    });
  });

  it('only lets the author take a post down', async () => {
    await expect(call(boards.remove, READER, { params: { id: jobId } })).rejects.toMatchObject({
      status: 404,
      code: 'post-not-found',
    });
    expect(ours(await boardOf('job', READER)).map(post => post.id)).toContain(jobId);

    expect(await call(boards.remove, POSTER, { params: { id: jobId } })).toMatchObject({
      ok: true,
    });
    expect(ours(await boardOf('job', READER)).map(post => post.id)).not.toContain(jobId);
    // Taking it down twice is a 404, not an error.
    await expect(call(boards.remove, POSTER, { params: { id: jobId } })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('keeps the conversations about a post that came down, but opens no new ones', async () => {
    const { conversations: inbox } = await call(conversations.list, POSTER, {
      query: { side: 'buyer' },
    });
    expect(inbox.map(conversation => conversation.context)).toContain('Move-in helper');

    const reply = await call(conversations.send, POSTER, {
      params: { id: inbox.find(conversation => conversation.context === 'Move-in helper').id },
      body: { text: 'It is filled, sorry!' },
    });
    expect(reply.conversation.messages.at(-1)).toMatchObject({ from: 'me' });

    await expect(
      call(conversations.open, uuid(), { body: { postId: jobId } })
    ).rejects.toMatchObject({ code: 'post-not-found' });
  });

  it('drops a post from its board once its time is up, and one the team has hidden', async () => {
    await db.query(
      `update board_posts set expires_at = now() - interval '1 minute' where id = $1`,
      [ticketId]
    );
    expect(ours(await boardOf('ticket', READER))).toEqual([]);

    const { post } = await call(boards.create, POSTER, {
      body: { kind: 'ticket', ticketKind: 'request', event: 'Comedy night' },
    });
    expect(ours(await boardOf('ticket', READER)).map(entry => entry.id)).toEqual([post.id]);
    await db.query('update board_posts set hidden = true where id = $1', [post.id]);
    expect(ours(await boardOf('ticket', READER))).toEqual([]);
  });
});

maybe('directory', () => {
  const [agentId, hiddenId] = ENTRY_IDS;
  const agent = {
    id: agentId,
    name: 'Camila Reyes',
    brokerage: 'College Area Homes',
    focus: 'College Area',
    summary: 'Studios near campus.',
    website: 'https://example.com/camila',
  };
  const entryOf = (entry, position = 0) => ({ ...checkEntry('agent', entry), position });
  const listed = async () => (await call(directory.list, READER)).agents;

  it('lists what was loaded, without asking who is looking', async () => {
    expect(await directoryStore.save([entryOf(agent)])).toEqual({ added: 1, replaced: 0, kept: 0 });
    requireUser.mockClear();
    requireApprovedUser.mockClear();
    expect(await listed()).toContainEqual(
      expect.objectContaining({ id: agentId, name: 'Camila Reyes', initials: 'CR' })
    );
    expect(requireUser).not.toHaveBeenCalled();
    expect(requireApprovedUser).not.toHaveBeenCalled();
  });

  it('leaves an entry alone when it is loaded again, unless told to replace it', async () => {
    const changed = entryOf({ ...agent, focus: 'Rolando' });
    expect(await directoryStore.save([changed])).toEqual({ added: 0, replaced: 0, kept: 1 });
    expect((await listed()).find(entry => entry.id === agentId).focus).toBe('College Area');

    expect(await directoryStore.save([changed], { replace: true })).toEqual({
      added: 0,
      replaced: 1,
      kept: 0,
    });
    expect((await listed()).find(entry => entry.id === agentId).focus).toBe('Rolando');
  });

  it('leaves out an entry the team has hidden', async () => {
    await directoryStore.save([entryOf({ ...agent, id: hiddenId }, 1)]);
    await db.query('update directory_entries set hidden = true where id = $1', [hiddenId]);
    expect((await listed()).map(entry => entry.id)).not.toContain(hiddenId);
  });
});

maybe('support', () => {
  const casesOf = async userId =>
    (await db.query('select * from support_cases where user_id = $1 order by id', [userId])).rows;

  it('keeps a request with who sent it and the order it is about', async () => {
    const sent = await call(support.create, READER, {
      body: {
        topic: 'Payment or refund question',
        message: '  I was charged twice. ',
        orderId: 'abc',
      },
    });
    expect(sent).toMatchObject({ status: 201, ok: true });
    expect(await casesOf(READER)).toEqual([
      expect.objectContaining({
        user_name: 'Priya Shah',
        user_email: 'pshah@sdsu.edu',
        topic: 'Payment or refund question',
        message: 'I was charged twice.',
        order_id: 'abc',
        status: 'open',
      }),
    ]);
  });

  it('needs a message, and not a huge one', async () => {
    await expect(call(support.create, READER, { body: { topic: 'x' } })).rejects.toMatchObject({
      code: 'message-required',
    });
    await expect(
      call(support.create, READER, { body: { message: 'x'.repeat(2001) } })
    ).rejects.toMatchObject({ code: 'message-too-long' });
    expect(await casesOf(READER)).toHaveLength(1);
  });

  it('stops someone sending request after request', async () => {
    const send = () => call(support.create, STRANGER, { body: { message: 'Help' } });
    for (let i = 0; i < 5; i += 1) await send();
    await expect(send()).rejects.toMatchObject({ status: 429, code: 'slow-down' });
    expect(await casesOf(STRANGER)).toHaveLength(5);
  });
});
