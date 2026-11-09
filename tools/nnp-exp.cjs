// Temporary: sends one expression to the main process through the inspector, then closes the socket.
(async () => {
  const list = await (await fetch('http://127.0.0.1:9230/json/list')).json();
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const done = new Promise((r) => { ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) r(d); }; });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: process.argv[2], includeCommandLineAPI: true, returnByValue: true } }));
  const d = await Promise.race([done, new Promise((r) => setTimeout(() => r('timeout'), 3000))]);
  console.log('evaluate:', JSON.stringify(d).slice(0, 300));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
