import http from 'node:http';
import { handleRequest } from './router.mjs';

const port = Number(process.env.PORT || 8642);

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
  });
});

server.listen(port, () => {
  console.log(`Hermes mock gateway listening on http://localhost:${port}`);
});
