/**
 * Board posts in Postgres.
 */

const db = require('../db');

const ON_BOARD = `status = 'open' and not hidden and expires_at > now()`;

const isId = id => /^\d{1,18}$/.test(String(id));

/**
 * @param {Object} post
 * @param {'job'|'housing'|'ticket'} post.kind
 * @param {string} post.authorId
 * @param {string} post.authorName
 * @param {string} post.title
 * @param {string} [post.summary]
 * @param {Object} [post.details]
 * @param {number} post.days how long it stays on the board
 * @returns {Promise<Object>} the board_posts row
 */
exports.create = async ({
  kind,
  authorId,
  authorName,
  title,
  summary = '',
  details = {},
  days,
}) => {
  const { rows } = await db.query(
    `insert into board_posts
       (kind, author_id, author_name, title, summary, details, expires_at)
     values ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))
     returning *`,
    [kind, authorId, authorName, title, summary, JSON.stringify(details), days]
  );
  return rows[0];
};

/**
 * What is on one board, newest first.
 */
exports.listOpen = async (kind, limit = 100) => {
  const { rows } = await db.query(
    `select * from board_posts
     where kind = $1 and ${ON_BOARD}
     order by created_at desc, id desc
     limit $2`,
    [kind, limit]
  );
  return rows;
};

/**
 * One post, if it is still on its board.
 */
exports.findOpen = async id => {
  // Ids arrive from the page, so anything that isn't a number finds nothing.
  if (!isId(id)) return null;
  const { rows } = await db.query(`select * from board_posts where id = $1 and ${ON_BOARD}`, [id]);
  return rows[0] || null;
};

/**
 * Takes a post off its board. Only its author can.
 *
 * @returns {Promise<Object|null>} the row, or null when it isn't theirs or was already down
 */
exports.close = async ({ id, authorId }) => {
  if (!isId(id)) return null;
  const { rows } = await db.query(
    `update board_posts set status = 'closed'
     where id = $1 and author_id = $2 and status = 'open'
     returning *`,
    [id, authorId]
  );
  return rows[0] || null;
};
