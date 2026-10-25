// Local-only regression: exercise the installed Functions parser with real HTTP streams.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const zlib = require('node:zlib')
const bodyParser = require('body-parser')

test('compressed JSON with delayed trailing bytes leaves the server responsive', async () => {
  const server = http.createServer((req, res) => {
    bodyParser.json({ limit: '16kb' })(req, res, error => {
      res.writeHead(error ? error.status || 500 : 200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(error ? { error: error.type } : req.body))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  function post(encoding, payload, trailing) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', headers: {
        'content-type': 'application/json', ...(encoding ? { 'content-encoding': encoding } : {}),
      } }, res => {
        let text = ''
        res.on('data', data => { text += data })
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }))
      })
      req.on('error', reject)
      req.setTimeout(2000, () => req.destroy(new Error('Parser stalled')))
      req.write(payload)
      if (trailing) setTimeout(() => req.end(trailing), 20)
      else req.end()
    })
  }
  try {
    for (const [encoding, compress] of [['deflate', zlib.deflateSync], ['br', zlib.brotliCompressSync]]) {
      const result = await post(encoding, compress(Buffer.from('{"ok":true}')), Buffer.alloc(128, 0))
      assert.equal(result.status, 200)
      assert.deepEqual(result.body, { ok: true })
    }
    const normal = await post('gzip', zlib.gzipSync(Buffer.from('{"ok":true}')))
    assert.equal(normal.status, 200)
    const large = await post('gzip', zlib.gzipSync(Buffer.from(JSON.stringify({ text: 'x'.repeat(17000) }))))
    assert.equal(large.status, 413)
    assert.equal((await post(null, Buffer.from('{"still":"responsive"}'))).status, 200)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
