import http from 'http';
import { readFile } from 'fs/promises';
import { join, extname } from 'path';

const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;
  const filePath = join(process.cwd(), url);
  try {
    const data = await readFile(filePath);
    const type = mime[extname(filePath)] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.end(data);
  } catch (err) {
    res.statusCode = 404;
    res.end('Not found');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT);
console.log(`Server running on http://localhost:${PORT}`);
