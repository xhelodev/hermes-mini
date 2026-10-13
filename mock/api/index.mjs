import { handleRequest } from '../lib/router.mjs';

export default async function handler(req, res) {
  try {
    await handleRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: { message: err?.message || 'Internal error' } }));
    }
  }
}
