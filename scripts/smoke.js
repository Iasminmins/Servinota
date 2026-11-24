// teste de fumaca: percorre os fluxos principais contra o servidor rodando em localhost
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.BASE || 'http://localhost:3100';

function cliente() {
  let cookie = '';
  let csrf = '';
  async function req(metodo, url, corpo, multipart) {
    const headers = { cookie };
    let body;
    if (multipart) body = multipart;
    else if (corpo) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({ _csrf: csrf, ...corpo }).toString();
    }
    const r = await fetch(BASE + url, { method: metodo, headers, body, redirect: 'manual' });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const tipo = r.headers.get('content-type') || '';
    const texto = tipo.includes('text/html') || tipo.includes('json') || tipo.includes('csv') ? await r.text() : null;
    if (texto) {
      const m = texto.match(/name="_csrf" value="([^"]+)"/) || texto.match(/name="csrf" content="([^"]+)"/);
      if (m) csrf = m[1];
    }
    return { status: r.status, local: r.headers.get('location'), texto, tipo, r };
  }
  return { req, get csrf() { return csrf; } };
}

let falhas = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok   ' : '  FALHA ') + msg);
  if (!cond) falhas++;
}
const espera = ms => new Promise(r => setTimeout(r, ms));

async function pagina(c, url) {
  const r = await c.req('GET', url);
  ok(r.status === 200 && !/Ocorreu um erro/.test(r.texto || ''), `GET ${url} -> ${r.status}`);
  return r;
}

(async () => {
  const c = cliente();
  const email = `admin${Date.now()}@teste.com`;

  console.log('Cadastro / login');
  await c.req('GET', '/cadastro');
  let r = await c.req('POST', '/cadastro', { escritorio: 'Contabilidade Teste', nome: 'Admin', email, senha: 'senha12345', senha2: 'senha12345' });
  ok(r.status === 302 && r.local === '/empresas/nova', 'cria escritório e redireciona');

  console.log('Empresa');
  await c.req('GET', '/empresas/nova');
  r = await c.req('POST', '/empresas', {
    cnpj: '11.222.333/0001-81', razao_social: 'Empresa Teste Ltda', email: 'empresa@teste.com', cep: '27253-005',
    logradouro: 'Rua Teste', numero: '100', bairro: 'Centro', municipio: 'Volta Redonda', uf: 'RJ', cod_municipio: '3306305',
    op_simples: '3', reg_esp_trib: '0', cod_trib_nac_padrao: '010101', aliquota_padrao: '2,5', ambiente: 'simulacao',
    serie: '1', proximo_numero: '1', portal_pode_emitir: '1',
  });
  ok(r.status === 302 && /^\/empresas\/\d+$/.test(r.local), 'empresa criada ' + r.local);
  const empId = r.local.split('/').pop();

  // certificado
  await c.req('GET', `/empresas/${empId}?aba=certificado`);
  const pfxPath = path.join(__dirname, 'certificado-teste.pfx');
  if (fs.existsSync(pfxPath)) {
    const fd = new FormData();
    fd.append('_csrf', c.csrf);
    fd.append('senha', '1234');
    fd.append('arquivo', new Blob([fs.readFileSync(pfxPath)]), 'cert.pfx');
    r = await c.req('POST', `/empresas/${empId}/certificado`, null, fd);
    ok(r.status === 302, 'envio do certificado');
    r = await c.req('GET', `/empresas/${empId}?aba=certificado`);
    ok(/EMPRESA TESTE LTDA/.test(r.texto), 'certificado aparece na tela');
  }

  console.log('Tomador e serviço');
  r = await c.req('POST', `/empresas/${empId}/tomadores`, {
    documento: '529.982.247-25', nome: 'Fulano de Tal', email: 'fulano@teste.com', cep: '27253005',
    logradouro: 'Rua A', numero: '10', bairro: 'Centro', municipio: 'Volta Redonda', uf: 'RJ', cod_municipio: '3306305',
  });
  ok(r.status === 302, 'tomador criado');
  r = await c.req('POST', `/empresas/${empId}/tomadores`, { documento: '123', nome: 'x' });
  ok(r.status === 200 && /inválido/.test(r.texto), 'valida documento inválido');
  r = await c.req('POST', `/empresas/${empId}/servicos`, { descricao: 'Honorários contábeis', cod_trib_nac: '171901', valor: '800,00', aliquota: '2' });
  ok(r.status === 302, 'serviço criado');
  r = await c.req('GET', `/empresas/${empId}/dados.json`);
  const dados = JSON.parse(r.texto);
  ok(dados.tomadores.length === 1 && dados.servicos.length === 1, 'dados.json da empresa');
  const tomId = dados.tomadores[0].id;

  console.log('Emissão');
  await c.req('GET', '/notas/nova');
  r = await c.req('POST', '/notas', {
    empresa_id: empId, tomador_id: tomId, descricao: 'Desenvolvimento de sistema - parcela 1', cod_trib_nac: '010101',
    competencia: new Date().toISOString().slice(0, 10), valor: '1.500,00', aliquota: '2,5', enviar_email: '',
  });
  ok(r.status === 302 && /^\/notas\/\d+$/.test(r.local), 'nota criada ' + r.local);
  const notaId = r.local.split('/').pop();
  await espera(5000);
  r = await c.req('GET', `/notas/${notaId}`);
  ok(/data-status="emitida"/.test(r.texto), 'nota emitida (simulação)');
  r = await c.req('GET', `/notas/${notaId}/pdf`);
  ok(r.status === 200 && r.tipo.includes('pdf'), 'PDF da nota');
  const pdfBuf = Buffer.from(await r.r.arrayBuffer());
  fs.writeFileSync(path.join(__dirname, 'nota-exemplo.pdf'), pdfBuf);
  r = await c.req('GET', `/notas/${notaId}/xml`);
  ok(r.status === 200, 'XML da nota');

  r = await c.req('POST', '/notas', { empresa_id: empId, tomador_id: tomId, descricao: 'x', valor: '0' });
  ok(r.status === 200 && /maior que zero/.test(r.texto), 'valida nota sem valor');

  r = await c.req('GET', `/notas/${notaId}`);
  r = await c.req('POST', `/notas/${notaId}/cancelar`, { codigo: '1', motivo: 'curto' });
  r = await c.req('GET', `/notas/${notaId}`);
  ok(/mínimo 15/.test(r.texto), 'cancelamento exige justificativa');
  r = await c.req('POST', `/notas/${notaId}/cancelar`, { codigo: '1', motivo: 'Valor do serviço informado errado' });
  r = await c.req('GET', `/notas/${notaId}`);
  ok(/data-status="cancelada"/.test(r.texto), 'nota cancelada');

  console.log('Recorrência');
  await c.req('GET', '/recorrencias/nova');
  r = await c.req('POST', '/recorrencias', {
    empresa_id: empId, tomador_id: tomId, descricao: 'Honorários {mes}/{ano}', valor: '800', dia_mes: '1',
    cod_trib_nac: '171901', aliquota: '2', enviar_email: '1', ativo: '1', gerar_mes_atual: '1',
  });
  ok(r.status === 302, 'recorrência criada');
  await espera(4000);
  r = await c.req('GET', '/notas?busca=Honor');
  ok(/data-status/.test(r.texto) && /R\$\s?800,00/.test(r.texto), 'recorrência gerou nota do mês');

  console.log('Importação');
  await c.req('GET', '/importacao');
  const csv = 'CPF/CNPJ do tomador;Nome do tomador;E-mail;Descrição do serviço;Valor;Competência (dd/mm/aaaa)\n'
    + '11.444.777/0001-61;Cliente Planilha SA;cp@teste.com;Serviço via planilha;2.000,50;\n'
    + '000;Inválido;;Sem valor;;\n';
  const fd2 = new FormData();
  fd2.append('_csrf', c.csrf);
  fd2.append('empresa_id', empId);
  fd2.append('arquivo', new Blob([csv]), 'notas.csv');
  r = await c.req('POST', '/importacao', null, fd2);
  ok(r.status === 200 && /Emitir 1 nota/.test(r.texto), 'preview da planilha (1 válida, 1 com erro)');
  const token = (r.texto.match(/name="token" value="([^"]+)"/) || [])[1];
  r = await c.req('POST', '/importacao/confirmar', { token });
  ok(r.status === 302, 'importação confirmada');
  await espera(4000);
  r = await c.req('GET', '/notas?busca=Planilha');
  ok(/Cliente Planilha SA/.test(r.texto) && /data-status="emitida"/.test(r.texto), 'nota da planilha emitida');

  console.log('Usuário do portal');
  await c.req('GET', '/usuarios/novo');
  const emailCli = `cliente${Date.now()}@teste.com`;
  r = await c.req('POST', '/usuarios', { nome: 'Cliente', email: emailCli, papel: 'cliente', empresa_id: empId, senha: 'cliente123' });
  ok(r.status === 302, 'usuário cliente criado');

  console.log('Páginas');
  for (const url of ['/', '/notas', '/empresas', `/empresas/${empId}`, `/empresas/${empId}?aba=servicos`, `/empresas/${empId}?aba=notas`,
    `/empresas/${empId}?aba=dados`, `/empresas/${empId}?aba=portal`, `/empresas/${empId}/editar`, '/recorrencias', '/importacao',
    '/usuarios', '/configuracoes', '/configuracoes/logs', '/minha-conta', `/notas/nova?copiar=${notaId}`]) {
    await pagina(c, url);
  }
  r = await c.req('GET', '/notas/exportar.csv');
  ok(r.status === 200 && /Prestador/.test(r.texto), 'exportar CSV');
  r = await c.req('GET', '/notas/xmls.zip');
  ok(r.status === 200 && r.tipo.includes('zip'), 'zip de XMLs');
  r = await c.req('GET', '/importacao/modelo.xlsx');
  ok(r.status === 200 && r.tipo.includes('spreadsheet'), 'modelo xlsx');

  console.log('Segurança');
  const anon = cliente();
  r = await anon.req('GET', '/notas');
  ok(r.status === 302 && r.local === '/login', 'anônimo vai pro login');
  r = await c.req('POST', '/configuracoes', { _csrf: 'errado', nome: 'X' });
  ok(r.status === 403, 'CSRF inválido bloqueado');

  console.log('Portal do cliente');
  const cli = cliente();
  await cli.req('GET', '/login');
  r = await cli.req('POST', '/login', { email: emailCli, senha: 'cliente123' });
  ok(r.status === 302 && r.local === '/portal', 'cliente loga e cai no portal');
  r = await pagina(cli, '/portal');
  ok(/Desenvolvimento de sistema|Fulano/.test(r.texto), 'cliente vê as notas da empresa');
  r = await cli.req('GET', '/notas');
  ok(r.status === 302 && r.local === '/portal', 'cliente não acessa área do escritório');
  await pagina(cli, '/portal/nova');
  r = await cli.req('POST', '/portal/notas', { tomador_id: tomId, descricao: 'Nota pelo portal', valor: '350,00', cod_trib_nac: '010101', competencia: new Date().toISOString().slice(0, 10) });
  ok(r.status === 302 && /^\/portal\/notas\/\d+$/.test(r.local), 'cliente emite pelo portal');
  const pid = r.local.split('/').pop();
  await espera(4000);
  r = await cli.req('GET', `/portal/notas/${pid}`);
  ok(/data-status="emitida"/.test(r.texto), 'nota do portal emitida');
  r = await cli.req('GET', `/portal/notas/${pid}/pdf`);
  ok(r.status === 200, 'cliente baixa PDF');

  console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo!');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
