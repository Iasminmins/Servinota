const express = require('express');
const JSZip = require('jszip');
const db = require('../db');
const { naoEncontrado, empresaDoEscritorio } = require('../middleware');
const { lerNota } = require('../services/cadastros');
const emissao = require('../services/emissao');
const email = require('../services/email');
const u = require('../util');

const router = express.Router();

function notaDoEscritorio(req) {
  return db.get('SELECT * FROM notas WHERE id = ? AND escritorio_id = ?', Number(req.params.id), req.session.user.escritorio_id);
}

// monta o WHERE a partir dos filtros da tela
function filtros(req) {
  const q = req.query;
  const where = ['n.escritorio_id = ?'];
  const params = [req.session.user.escritorio_id];
  if (q.empresa) { where.push('n.empresa_id = ?'); params.push(Number(q.empresa)); }
  if (q.status) { where.push('n.status = ?'); params.push(q.status); }
  if (q.mes) { where.push('substr(n.competencia, 1, 7) = ?'); params.push(q.mes); }
  if (q.busca) {
    const like = `%${String(q.busca).trim()}%`;
    where.push('(t.nome LIKE ? OR t.documento LIKE ? OR n.numero_nfse LIKE ? OR n.chave_acesso LIKE ? OR n.descricao LIKE ?)');
    params.push(like, like, like, like, like);
  }
  return { where: where.join(' AND '), params };
}

router.get('/', (req, res) => {
  const { where, params } = filtros(req);
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const porPagina = 30;
  const base = `FROM notas n JOIN empresas e ON e.id = n.empresa_id LEFT JOIN tomadores t ON t.id = n.tomador_id WHERE ${where}`;
  const tot = db.get(`SELECT COUNT(*) AS n,
      COALESCE(SUM(CASE WHEN n.status = 'emitida' THEN n.valor END), 0) AS soma,
      COALESCE(SUM(CASE WHEN n.status = 'cancelada' THEN n.valor END), 0) AS cancelado,
      COUNT(CASE WHEN n.status = 'cancelada' THEN 1 END) AS qtd_cancelada ${base}`, ...params);
  const notas = db.all(`SELECT n.id, n.status, n.numero_dps, n.numero_nfse, n.competencia, n.valor, n.ambiente, n.mensagem,
      n.email_enviado_em, n.criado_em, e.razao_social, t.nome AS tomador_nome, t.documento AS tomador_doc
    ${base} ORDER BY n.id DESC LIMIT ? OFFSET ?`, ...params, porPagina, (pagina - 1) * porPagina);
  const empresas = db.all('SELECT id, razao_social FROM empresas WHERE escritorio_id = ? ORDER BY razao_social', req.session.user.escritorio_id);
  // meses que tem nota + os ultimos 12, para o seletor de competencia
  const nomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const setMeses = new Set(db.all('SELECT DISTINCT substr(competencia, 1, 7) AS m FROM notas WHERE escritorio_id = ?', req.session.user.escritorio_id).map(r => r.m));
  let [a, m] = u.hojeISO().slice(0, 7).split('-').map(Number);
  for (let i = 0; i < 12; i++) { setMeses.add(`${a}-${String(m).padStart(2, '0')}`); if (--m < 1) { m = 12; a--; } }
  const meses = [...setMeses].sort().reverse().map(v => ({ valor: v, txt: `${nomes[Number(v.slice(5, 7)) - 1]} de ${v.slice(0, 4)}` }));
  res.render('notas/lista', {
    titulo: 'Notas fiscais', notas, empresas, meses, total: tot.n, soma: tot.soma, cancelado: tot.cancelado, qtdCancelada: tot.qtd_cancelada, pagina,
    paginas: Math.max(1, Math.ceil(tot.n / porPagina)),
    qs: new URLSearchParams(Object.entries(req.query).filter(([k, v]) => k !== 'pagina' && v)).toString(),
  });
});

router.get('/exportar.csv', (req, res) => {
  const { where, params } = filtros(req);
  const linhas = db.all(`SELECT n.*, e.razao_social, e.cnpj, t.nome AS tomador_nome, t.documento AS tomador_doc
    FROM notas n JOIN empresas e ON e.id = n.empresa_id LEFT JOIN tomadores t ON t.id = n.tomador_id
    WHERE ${where} ORDER BY n.id`, ...params);
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const cab = ['Prestador', 'CNPJ prestador', 'Tomador', 'Doc. tomador', 'Nº DPS', 'Nº NFS-e', 'Competência', 'Valor', 'ISS', 'ISS retido', 'Status', 'Chave de acesso', 'Descrição'];
  const corpo = linhas.map(n => [
    n.razao_social, u.fmtDoc(n.cnpj), n.tomador_nome, u.fmtDoc(n.tomador_doc), n.numero_dps, n.numero_nfse,
    u.fmtData(n.competencia), u.fmtNum(n.valor), u.fmtNum(n.valor_iss), n.iss_retido ? 'Sim' : 'Não',
    (u.STATUS[n.status] || {}).txt, n.chave_acesso, n.descricao,
  ].map(esc).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="notas.csv"');
  res.send('﻿' + [cab.map(esc).join(';'), ...corpo].join('\r\n'));
});

router.get('/xmls.zip', async (req, res) => {
  const { where, params } = filtros(req);
  const linhas = db.all(`SELECT n.id, n.numero_nfse, n.numero_dps, n.xml_nfse, n.chave_acesso, e.cnpj
    FROM notas n JOIN empresas e ON e.id = n.empresa_id LEFT JOIN tomadores t ON t.id = n.tomador_id
    WHERE ${where} AND n.xml_nfse IS NOT NULL ORDER BY n.id LIMIT 5000`, ...params);
  if (!linhas.length) {
    req.flash('erro', 'Nenhuma nota emitida com esses filtros.');
    return res.redirect('/notas?' + new URLSearchParams(req.query));
  }
  const zip = new JSZip();
  for (const n of linhas) {
    zip.file(`${u.soNumeros(n.cnpj)}/NFSe_${n.numero_nfse || n.numero_dps}_${n.chave_acesso}.xml`, n.xml_nfse);
  }
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="xmls-nfse.zip"');
  res.send(buf);
});

router.get('/status.json', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean).slice(0, 100);
  if (!ids.length) return res.json([]);
  const rows = db.all(`SELECT id, status, numero_nfse, mensagem FROM notas WHERE escritorio_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    req.session.user.escritorio_id, ...ids);
  res.json(rows.map(r => ({ ...r, status_txt: (u.STATUS[r.status] || {}).txt, status_cls: (u.STATUS[r.status] || {}).cls })));
});

router.get('/nova', (req, res) => {
  const empresas = db.all('SELECT id, razao_social, cnpj, ambiente FROM empresas WHERE escritorio_id = ? AND ativo = 1 ORDER BY razao_social',
    req.session.user.escritorio_id);
  let nota = { competencia: u.hojeISO(), enviar_email: 1, empresa_id: req.query.empresa || '', tomador_id: req.query.tomador || '' };
  if (req.query.copiar) {
    const orig = db.get('SELECT * FROM notas WHERE id = ? AND escritorio_id = ?', Number(req.query.copiar), req.session.user.escritorio_id);
    if (orig) {
      nota = { ...orig, competencia: u.hojeISO(), id: undefined };
    }
  }
  res.render('notas/nova', { titulo: 'Emitir NFS-e', empresas, nota });
});

router.post('/', (req, res) => {
  const empresa = empresaDoEscritorio(req, req.body.empresa_id);
  const empresas = db.all('SELECT id, razao_social, cnpj, ambiente FROM empresas WHERE escritorio_id = ? AND ativo = 1 ORDER BY razao_social',
    req.session.user.escritorio_id);
  const voltarComErro = erros => res.render('notas/nova', {
    titulo: 'Emitir NFS-e', empresas, nota: req.body, flash: erros.map(msg => ({ tipo: 'erro', msg })),
  });

  if (!empresa || !empresa.ativo) return voltarComErro(['Selecione a empresa prestadora.']);
  const tomador = req.body.tomador_id
    ? db.get('SELECT * FROM tomadores WHERE id = ? AND empresa_id = ?', Number(req.body.tomador_id), empresa.id)
    : null;
  if (!tomador) return voltarComErro(['Selecione o tomador do serviço.']);

  const { d, erros } = lerNota(req.body, empresa);
  if (empresa.ambiente !== 'simulacao' && !empresa.cert_pfx) erros.push('A empresa não tem certificado digital cadastrado.');
  if (erros.length) return voltarComErro(erros);

  const id = emissao.criarNota({
    escritorioId: req.session.user.escritorio_id, empresa, tomadorId: tomador.id, dados: d, usuarioId: req.session.user.id,
  });
  db.log(req, 'nota_criada', `Nota #${id} - ${empresa.razao_social} -> ${tomador.nome} ${u.fmtMoeda(d.valor)}`);

  // salva como servico do catalogo se pediu
  if (req.body.salvar_servico) {
    db.insert('servicos', {
      empresa_id: empresa.id, descricao: d.descricao, cod_trib_nac: d.cod_trib_nac, cod_nbs: d.cod_nbs,
      valor: d.valor, aliquota: d.aliquota, iss_retido: d.iss_retido,
    });
  }
  setImmediate(emissao.processarFila);
  req.flash('ok', 'Nota enviada para emissão.');
  res.redirect(`/notas/${id}`);
});

router.get('/:id', (req, res) => {
  const nota = notaDoEscritorio(req);
  if (!nota) return naoEncontrado(res, 'Nota');
  const empresa = db.get('SELECT * FROM empresas WHERE id = ?', nota.empresa_id);
  const tomador = nota.tomador_id ? db.get('SELECT * FROM tomadores WHERE id = ?', nota.tomador_id) : null;
  const criador = nota.usuario_id ? db.get('SELECT nome FROM usuarios WHERE id = ?', nota.usuario_id) : null;
  res.render('notas/ver', { titulo: `Nota #${nota.id}`, nota, empresa, tomador, criador });
});

router.get('/:id/pdf', async (req, res) => {
  const nota = notaDoEscritorio(req);
  if (!nota) return naoEncontrado(res, 'Nota');
  if (!['emitida', 'cancelada'].includes(nota.status)) {
    req.flash('erro', 'O PDF só fica disponível depois que a nota é emitida.');
    return res.redirect(`/notas/${nota.id}`);
  }
  const pdf = await emissao.obterPdf(nota);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="NFSe_${nota.numero_nfse || nota.numero_dps}.pdf"`);
  res.send(pdf);
});

router.get('/:id/xml', (req, res) => {
  const nota = notaDoEscritorio(req);
  if (!nota) return naoEncontrado(res, 'Nota');
  const tipo = req.query.tipo === 'dps' ? 'dps' : 'nfse';
  const xml = tipo === 'dps' ? nota.xml_dps : nota.xml_nfse;
  if (!xml) {
    req.flash('erro', 'XML não disponível.');
    return res.redirect(`/notas/${nota.id}`);
  }
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${tipo.toUpperCase()}_${nota.numero_nfse || nota.numero_dps}.xml"`);
  res.send(xml);
});

router.post('/:id/reenviar', (req, res) => {
  const nota = notaDoEscritorio(req);
  if (!nota) return naoEncontrado(res, 'Nota');
  try {
    emissao.reenviar(nota);
    db.log(req, 'nota_reenviada', `Nota #${nota.id}`);
    req.flash('ok', 'Nota colocada na fila novamente.');
  } catch (e) {
    req.flash('erro', e.message);
  }
  res.redirect(`/notas/${nota.id}`);
});

router.post('/:id/cancelar', async (req, res) => {
  const nota = notaDoEscritorio(req);
  if (!nota) return naoEncontrado(res, 'Nota');
  try {
    await emissao.cancelarNota(nota, { codigo: Number(req.body.codigo) || 1, motivo: req.body.motivo });
    db.log(req, 'nota_cancelada', `Nota #${nota.id} - ${req.body.motivo}`);
    req.flash('ok', 'Nota cancelada.');
  } catch (e) {
    req.flash('erro', 'Não foi possível cancelar: ' + e.message);
  }
  res.redirect(`/notas/${nota.id}`);
});

router.post('/:id/email', async (req, res) => {
  const nota = notaDoEscritorio(req);
  if (!nota) return naoEncontrado(res, 'Nota');
  try {
    const para = await email.enviarNota(nota.id, (req.body.para || '').trim() || null);
    db.log(req, 'nota_email', `Nota #${nota.id} para ${para}`);
    req.flash('ok', `E-mail enviado para ${para}.`);
  } catch (e) {
    req.flash('erro', 'Falha ao enviar e-mail: ' + e.message);
  }
  res.redirect(`/notas/${nota.id}`);
});

router.post('/:id/excluir', (req, res) => {
  const nota = notaDoEscritorio(req);
  if (!nota) return naoEncontrado(res, 'Nota');
  if (!['erro', 'pendente'].includes(nota.status)) {
    req.flash('erro', 'Só é possível excluir notas que não foram emitidas.');
    return res.redirect(`/notas/${nota.id}`);
  }
  db.run('DELETE FROM notas WHERE id = ?', nota.id);
  db.log(req, 'nota_excluida', `Nota #${nota.id} (DPS ${nota.serie}/${nota.numero_dps})`);
  req.flash('ok', 'Nota excluída.');
  res.redirect('/notas');
});

module.exports = router;
