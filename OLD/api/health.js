import { runHealthcheck } from '../tools/healthcheck.mjs';

export default async function handler(req, res){
  try {
    const results = await runHealthcheck();
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = results.every(r => r.status === 'ok') ? 200 : 500;
    res.end(JSON.stringify(results));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err.message }));
  }
}
