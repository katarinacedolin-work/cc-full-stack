const { toConversation } = require('./mapConversation');

const thread = (overrides = {}) => ({
  id: '42',
  kind: 'order',
  transaction_id: 'tx-1',
  context_id: 'listing-1',
  context_title: 'Desk lamp',
  starter_id: 'buyer-1',
  starter_name: 'Jordan Park',
  owner_id: 'seller-1',
  owner_name: 'Maya Chen',
  read_at: null,
  done: false,
  ...overrides,
});

const message = (senderId, body, createdAt) => ({
  sender_id: senderId,
  body,
  created_at: new Date(createdAt),
});

describe('toConversation', () => {
  it('shows the buyer the seller, and the seller the buyer', () => {
    const forBuyer = toConversation(thread(), [], 'buyer-1');
    const forSeller = toConversation(thread(), [], 'seller-1');
    expect(forBuyer.name).toBe('Maya Chen');
    expect(forBuyer.initials).toBe('MC');
    expect(forBuyer.sellerId).toBe('seller-1');
    expect(forSeller.name).toBe('Jordan Park');
    expect(forSeller.sellerId).toBeUndefined();
  });

  it('marks each message as mine or theirs', () => {
    const messages = [
      message('buyer-1', 'Is this still available?', '2026-11-20T18:00:00Z'),
      message('seller-1', 'Yes!', '2026-11-20T18:05:00Z'),
    ];
    expect(toConversation(thread(), messages, 'buyer-1').messages).toEqual([
      { from: 'me', text: 'Is this still available?', at: '2026-11-20T18:00:00.000Z' },
      { from: 'them', text: 'Yes!', at: '2026-11-20T18:05:00.000Z' },
    ]);
  });

  it('is unread while the other person has written since it was last opened', () => {
    const messages = [message('seller-1', 'Yes!', '2026-11-20T18:05:00Z')];
    const opened = at => toConversation(thread({ read_at: at }), messages, 'buyer-1').unread;
    expect(opened(null)).toBe(true);
    expect(opened(new Date('2026-11-20T18:00:00Z'))).toBe(true);
    expect(opened(new Date('2026-11-20T18:06:00Z'))).toBe(false);
  });

  it('is never unread because of your own messages', () => {
    const messages = [message('buyer-1', 'Hello?', '2026-11-20T18:05:00Z')];
    expect(toConversation(thread(), messages, 'buyer-1').unread).toBe(false);
  });

  it('links a conversation about a listing to the listing and the order', () => {
    const conversation = toConversation(thread(), [], 'seller-1');
    expect(conversation.listingId).toBe('listing-1');
    expect(conversation.orderId).toBe('tx-1');
    expect(conversation.context).toBe('Desk lamp');
  });

  it('describes a conversation that has no title by what kind it is', () => {
    const direct = thread({
      kind: 'direct',
      context_title: '',
      context_id: '',
      transaction_id: null,
    });
    const conversation = toConversation(direct, [], 'buyer-1');
    expect(conversation.context).toBe('Direct message');
    expect(conversation.orderId).toBeUndefined();
  });
});
