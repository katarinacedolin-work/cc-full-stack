/**
 * The directory: school-provided services, apartment buildings and real estate agents.
 * The team keeps these; see ../directory/entries.js for what each holds.
 */

const store = require('../directory/store');
const { toDirectory } = require('../directory/entries');

/**
 * GET /api/cc/directory
 * Answers { schoolServices, apartments, agents }. This is public information about places and
 * services, so it needs no sign-in.
 */
exports.list = async (req, res) => {
  res.json(toDirectory(await store.list()));
};
