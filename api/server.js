/**
 * Thin wrapper so Vercel's Node runtime can locate the Express handler.
 * Vercel automatically treats files inside /api as Serverless Functions,
 * so we re-export the main Express app defined in ../server.js.
 */
const app = require('../server');

module.exports = app;
module.exports.handler = app;
module.exports.default = app;
