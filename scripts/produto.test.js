const test = require('node:test');
const assert = require('node:assert/strict');

const BASE = process.env.BASE || 'http://localhost:3100';

test('landing de produto fica pública e leva cadastro e login', async () => {
  const resposta = await fetch(`${BASE}/produto`);
  const html = await resposta.text();

  assert.equal(resposta.status, 200);
  assert.match(html, /NFS-e dos seus clientes/);
  assert.match(html, /href="\/cadastro"/);
  assert.match(html, /href="\/login"/);
});

test('landing publica sua folha de estilos responsiva', async () => {
  const resposta = await fetch(`${BASE}/static/css/landing.css`);

  assert.equal(resposta.status, 200);
  assert.match(resposta.headers.get('content-type'), /text\/css/);
  assert.match(await resposta.text(), /@media/);
});

test('login e cadastro oferecem acesso à apresentação pública', async () => {
  for (const rota of ['/login', '/cadastro']) {
    const resposta = await fetch(`${BASE}${rota}`);
    assert.equal(resposta.status, 200);
    assert.match(await resposta.text(), /href="\/produto"/);
  }
});
