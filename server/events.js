const clients = new Set();

export function addClient(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\nevent: hello\ndata: {}\n\n');
  clients.add(res);
  const hb = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(hb); clients.delete(res); });
}

export function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}
