/**
 * What students send from "Get help", in Postgres.
 */

const db = require('../db');

/**
 * @param {Object} supportCase
 * @param {string} supportCase.userId
 * @param {string} [supportCase.userName]
 * @param {string} [supportCase.userEmail]
 * @param {string} [supportCase.topic]
 * @param {string} supportCase.message
 * @param {string} [supportCase.orderId] the order it was sent from
 * @returns {Promise<Object>} the support_cases row
 */
exports.create = async ({
  userId,
  userName = '',
  userEmail = '',
  topic = '',
  message,
  orderId = '',
}) => {
  const { rows } = await db.query(
    `insert into support_cases (user_id, user_name, user_email, topic, message, order_id)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [userId, userName, userEmail, topic, message, orderId]
  );
  return rows[0];
};
