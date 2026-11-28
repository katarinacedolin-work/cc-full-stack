/**
 * Stops the process when a required environment variable is missing.
 *
 * @param {Array<string>} names environment variable names
 */
exports.requireEnv = names => {
  const missing = names.filter(name => !process.env[name]);
  if (missing.length > 0) {
    console.error(`Required environment variable is not set: ${missing.join(', ')}`);
    process.exit(9);
  }
};
