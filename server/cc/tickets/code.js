/**
 * Ticket codes: what the QR code holds and what is printed under it.
 */

const crypto = require('crypto');

// No 0, O, 1 or I, so a code read aloud or typed at the door is hard to get wrong.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LENGTH = 10;

/**
 * @returns {string} a new random code, such as 'K7M3QX9RTB'
 */
exports.makeCode = () => {
  let code = '';
  for (let i = 0; i < LENGTH; i += 1) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return code;
};

/**
 * @param {*} input what was scanned or typed
 * @returns {string} the code in the form it is stored in, or '' when it can't be a code
 */
exports.normalizeCode = input => {
  const code = String(input ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
  return new RegExp(`^[${ALPHABET}]{${LENGTH}}$`).test(code) ? code : '';
};
