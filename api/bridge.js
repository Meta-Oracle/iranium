const { handleBridgeRequest } = require('./lib/iranium-eliza');

module.exports = async function handler(req, res) {
  await handleBridgeRequest(req, res, {
    rootDir: process.cwd(),
  });
};
