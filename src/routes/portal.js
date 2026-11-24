const express = require('express');
const db = require('../db');
const { naoEncontrado } = require('../middleware');
const { lerNota, lerTomador } = require('../services/cadastros');
const emissao = require('../services/emissao');
const u = require('../util');

// area do cliente da contabilidade: ve as notas da propria empresa e (se liberado) emite
const router = express.Router();

router.use((req, res, next) => {
  const emp = db.get('SELECT * FROM empresas WHERE id = ? AND escritorio_id = ?', req.session.user.empresa_id, req.session.user.escritorio_id);
  if (!emp || !emp.ativo) {
    res.status(403);
    return res.render('erro', { titulo: 'Acesso indisponível', msg: 'Sua empresa está inativa no sistema. Fale com o seu escritório de contabilidade.' });
  }
  req.empresa = emp;
  res.locals.empresaPortal = emp;
  next();
});

function notaDaEmpresa(req) {
  return db.get('SELECT * FROM notas WHERE id = ? AND empresa_id = ?', Number(req.params.id), req.empresa.id);
}

router.get('/', (req, res) => {
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : u.hojeISO().slice(0, 7);
  const notas = db.all(`SELECT n.*, t.nome AS tomador_nome, t.documento AS tomador_doc FROM notas n
    LEFT JOIN tomadores t ON t.id = n.tomador_id
    WHERE n.empresa_id = ? AND substr(n.competencia, 1, 7) = ? ORDER BY n.id DESC`, req.empresa.id, mes);
  const total = notas.filter(n => n.status === 'emitida').reduce((s, n) => s + n.valor, 0);
  const meses = db.all(`SELECT DISTINCT substr(competencia, 1, 7) AS m FROM notas WHERE empresa_id = ? ORDER BY 1 DESC LIMIT 24`, req.empresa.id).map(r => r.m);
  if (!meses.includes(mes)) meses.unshift(mes);
  res.render('portal/index', { titulo: 'Minhas notas', notas, total, mes, meses });
});

router.get('/status.json', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean).slice(0, 100);
  if (!ids.length) return res.json([]);
  const rows = db.all(`SELECT id, status, numero_nfse FROM notas WHERE empresa_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    req.empresa.id, ...ids);
  res.json(rows.map(r => ({ ...r, status_txt: (u.STATUS[r.status] || {}).txt, status_cls: (u.STATUS[r.status] || {}).cls })));
});

router.get('/notas/:id', (req, res) => {
  const nota = notaDaEmpresa(req);
  if (!nota) return naoEncontrado(res, 'Nota');
  const tomador = nota.tomador_id ? db.get('SELECT * FROM tomadores WHERE id = ?', nota.tomador_id) : null;
  res.render('portal/nota', { titulo: `Nota ${nota.numero_nfse || '#' + nota.id}`, nota, tomador });
});

router.get('/notas/:id/pdf', async (req, res) => {
  const nota = notaDaEmpresa(req);
  if (!nota || !['emitida', 'cancelada'].includes(nota.status)) return naoEncontrado(res, 'Nota');
  const pdf = await emissao.obterPdf(nota);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="NFSe_${nota.numero_nfse || nota.numero_dps}.pdf"`);
  res.send(pdf);
});

router.get('/notas/:id/xml', (req, res) => {
  const nota = notaDaEmpresa(req);
  if (!nota || !nota.xml_nfse) return naoEncontrado(res, 'Nota');
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="NFSe_${nota.numero_nfse || nota.numero_dps}.xml"`);
  res.send(nota.xml_nfse);
});

// ---- emissao pelo cliente (so se o escritorio liberou) ----
function podeEmitir(req, res, next) {
  if (!req.empresa.portal_pode_emitir) {
    req.flash('erro', 'A emissão pelo portal não está liberada para sua empresa. Solicite ao escritório.');
    return res.redirect('/portal');
  }
  if (req.empresa.ambiente !== 'simulacao' && !req.empresa.cert_pfx) {
    req.flash('erro', 'Sua empresa ainda não tem certificado digital configurado. Fale com o escritório.');
    return res.redirect('/portal');
  }
  next();
}

function dadosForm(req) {
  return {
    tomadores: db.all('SELECT id, documento, nome FROM tomadores WHERE empresa_id = ? ORDER BY nome', req.empresa.id),
    servicos: db.all('SELECT * FROM servicos WHERE empresa_id = ? ORDER BY descricao', req.empresa.id),
  };
}

router.get('/nova', podeEmitir, (req, res) => {
  res.render('portal/nova', { titulo: 'Emitir nota', ...dadosForm(req), nota: { competencia: u.hojeISO(), enviar_email: 1, tomador_id: req.query.tomador || '' } });
});

router.post('/notas', podeEmitir, (req, res) => {
  const tomador = db.get('SELECT * FROM tomadores WHERE id = ? AND empresa_id = ?', Number(req.body.tomador_id), req.empresa.id);
  const { d, erros } = lerNota(req.body, req.empresa);
  if (!tomador) erros.unshift('Selecione o tomador.');
  if (erros.length) {
    return res.render('portal/nova', { titulo: 'Emitir nota', ...dadosForm(req), nota: req.body, flash: erros.map(msg => ({ tipo: 'erro', msg })) });
  }
  const id = emissao.criarNota({
    escritorioId: req.session.user.escritorio_id, empresa: req.empresa, tomadorId: tomador.id,
    dados: d, usuarioId: req.session.user.id, origem: 'portal',
  });
  db.log(req, 'nota_portal', `Nota #${id} emitida pelo cliente - ${u.fmtMoeda(d.valor)}`);
  setImmediate(emissao.processarFila);
  req.flash('ok', 'Nota enviada para emissão. Em alguns segundos ela aparece como emitida.');
  res.redirect(`/portal/notas/${id}`);
});

router.get('/tomadores/novo', podeEmitir, (req, res) => {
  res.render('portal/tomador', { titulo: 'Novo cliente (tomador)', tom: {} });
});

router.post('/tomadores', podeEmitir, (req, res) => {
  const { d, erros } = lerTomador(req.body);
  if (db.get('SELECT id FROM tomadores WHERE empresa_id = ? AND documento = ?', req.empresa.id, d.documento)) {
    erros.push('Esse cliente já está cadastrado.');
  }
  if (erros.length) {
    return res.render('portal/tomador', { titulo: 'Novo cliente (tomador)', tom: req.body, flash: erros.map(msg => ({ tipo: 'erro', msg })) });
  }
  const id = db.insert('tomadores', { ...d, empresa_id: req.empresa.id });
  req.flash('ok', 'Cliente cadastrado.');
  res.redirect(`/portal/nova?tomador=${id}`);
});

module.exports = router;
