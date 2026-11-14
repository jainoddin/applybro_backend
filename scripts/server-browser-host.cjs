// Temporary public health/result host; browser control is never exposed.
const http = require('node:http');
const { spawn } = require('node:child_process');
let result = { status: 'STARTING', loginAttempted: false, applicationsSubmitted: 0 };
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET' || !['/', '/health', '/result'].includes(req.url)) {
    res.writeHead(404); return res.end(JSON.stringify({ message: 'Not found' }));
  }
  res.end(JSON.stringify(req.url === '/health' ? { status: 'ok', purpose: 'read-only-browser-probe' } : result));
});
server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => {
  console.log('Probe health server listening; starting one read-only browser access test.');
  // A bounded child isolates Xvfb/browser startup from HTTP readiness.
  const child = spawn('timeout', ['--signal=TERM', '--kill-after=5s', '45s', 'xvfb-run', '-a', 'node', 'scripts/server-browser-probe.cjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '', reported = false;
  child.stdout.on('data', chunk => {
    buffer += chunk.toString();
    if (buffer.length > 16384) buffer = buffer.slice(-16384);
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      try {
        const data = JSON.parse(line);
        if (['BLOCKED', 'LOGIN_FORM_AVAILABLE', 'NOT_VERIFIED'].includes(data.status)) {
          result = { ...data, checkedAt: new Date().toISOString() }; reported = true;
          console.log(JSON.stringify(result));
        }
      } catch { /* Do not relay raw browser diagnostics. */ }
    }
  });
  child.stderr.on('data', () => {});
  const failed = status => {
    if (reported) return;
    reported = true; result = { status, loginAttempted: false, applicationsSubmitted: 0 };
    console.log(JSON.stringify(result));
  };
  child.on('error', () => failed('RUNTIME_FAILED'));
  child.on('exit', code => failed(code === 124 || code === 137 ? 'BROWSER_TIMEOUT' : 'RUNTIME_FAILED'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { child.kill('SIGTERM'); server.close(() => process.exit(0)); });
});
