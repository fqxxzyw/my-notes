import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const hasSdk = existsSync('desktop/.cache/webview2-1.0.4370.26/lib/net462/Microsoft.Web.WebView2.Core.dll')
test('desktop keeps real files isolated, refuses traversal and preserves collisions', { skip: process.platform !== 'win32' || !hasSdk }, () => {
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'tests/desktop-attachment-check.ps1'], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /Desktop attachment storage passed/)
})
