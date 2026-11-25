const { pollOnce } = require('./poll');

const event = sequenceId => ({ attributes: { sequenceId, eventType: 'user/created' } });

const fakeSdk = (events, perPage = 100) => ({
  events: {
    query: jest.fn(async () => ({ data: { data: events, meta: { perPage } } })),
  },
});

const fakeCursor = (sequenceId = null) => {
  const saved = [];
  return {
    saved,
    get: async () => ({ sequenceId, startedAt: new Date('2026-01-01T00:00:00Z') }),
    set: async id => {
      saved.push(id);
    },
  };
};

describe('pollOnce', () => {
  it('starts from the start time when no event has been handled yet', async () => {
    const sdk = fakeSdk([]);

    const result = await pollOnce({ sdk, cursor: fakeCursor(), handlers: [] });

    expect(sdk.events.query).toHaveBeenCalledWith({
      createdAtStart: new Date('2026-01-01T00:00:00Z'),
    });
    expect(result).toEqual({ count: 0, fullPage: false });
  });

  it('continues after the last handled event', async () => {
    const sdk = fakeSdk([]);

    await pollOnce({ sdk, cursor: fakeCursor(41), handlers: [] });

    expect(sdk.events.query).toHaveBeenCalledWith({ startAfterSequenceId: 41 });
  });

  it('runs every handler for every event in order and saves each place', async () => {
    const calls = [];
    const handlers = [
      async e => calls.push(`first:${e.attributes.sequenceId}`),
      async e => calls.push(`second:${e.attributes.sequenceId}`),
    ];
    const cursor = fakeCursor(41);

    const result = await pollOnce({ sdk: fakeSdk([event(42), event(43)]), cursor, handlers });

    expect(calls).toEqual(['first:42', 'second:42', 'first:43', 'second:43']);
    expect(cursor.saved).toEqual([42, 43]);
    expect(result).toEqual({ count: 2, fullPage: false });
  });

  it('reports a full page so the caller asks for more right away', async () => {
    const sdk = fakeSdk([event(1), event(2)], 2);

    const result = await pollOnce({ sdk, cursor: fakeCursor(), handlers: [] });

    expect(result.fullPage).toBe(true);
  });

  it('stops at an event whose handler fails, without saving it or the ones after', async () => {
    const handled = [];
    const handlers = [
      async e => {
        if (e.attributes.sequenceId === 43) {
          throw new Error('handler failed');
        }
        handled.push(e.attributes.sequenceId);
      },
    ];
    const cursor = fakeCursor(41);
    const sdk = fakeSdk([event(42), event(43), event(44)]);

    await expect(pollOnce({ sdk, cursor, handlers })).rejects.toThrow('handler failed');

    expect(handled).toEqual([42]);
    expect(cursor.saved).toEqual([42]);
  });
});
