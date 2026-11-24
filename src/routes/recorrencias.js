const express = require('express');
const db = require('../db');
const { naoEncontrado, empresaDoEscritorio } = require('../middleware');
const { gerarNotaDaRecorrencia, executarRecorrencias } = require('../services/recorrencia');
const { processarFila } = require('../services/emissao');
const u = require('../util');

const router = express.Router();

function recDoEscritorio(req) {
  return db.get('SELECT * FROM recorrencias WHERE id = ? AND escritorio_id = ?', Number(req.params.id), req.session.user.escritorio_id);
}

function empresasAtivas(req) {
  return db.all('SELECT id, razao_social, cnpj FROM empresas WHERE escritorio_id = ? AND ativo = 1 ORDER BY razao_social', req.session.user.escritorio_id);
}

function ler(req) {
  const b = req.body;
  const erros = [];
  const empresa = empresaDoEscritorio(req, b.empresa_id);
  if (!empresa) erros.push('Selecione a empresa.');
  const tomador = empresa && b.tomador_id
    ? db.get('SELECT id FROM tomadores WHERE id = ? AND empresa_id = ?', Number(b.tomador_id), empresa.id) : null;
  if (empresa && !tomador) erros.push('Selecione o tomador.');
  const d = {
    empresa_id: empresa ? empresa.id : null,
    tomador_id: tomador ? tomador.id : null,
    descricao: String(b.descricao || '').trim().slice(0, 2000),
    cod_trib_nac: u.soNumeros(b.cod_trib_nac) || (empresa && empresa.cod_trib_nac_padrao),
    cod_nbs: u.soNumeros(b.cod_nbs) || null,
    valor: u.parseValor(b.valor),
    aliquota: b.aliquota ? u.parseValor(b.aliquota) : (empresa ? empresa.aliquota_padrao : null),
    iss_retido: b.iss_retido ? 1 : 0,
    dia_mes: Number(b.dia_mes),
    enviar_email: b.enviar_email ? 1 : 0,
    ativo: b.ativo ? 1 : 0,
  };
  if (d.descricao.length < 3) erros.push('Informe a descrição do serviço.');
  if (!(d.valor > 0)) erros.push('Valor inválido.');
  if (!d.cod_trib_nac || d.cod_trib_nac.length !== 6) erros.push('Código de tributação nacional inválido.');
  if (!(d.dia_mes >= 1 && d.dia_mes <= 31)) erros.push('Dia do mês deve ser entre 1 e 31.');
  return { d, erros };
}

router.get('/', (req, res) => {
  const recs = db.all(`SELECT r.*, e.razao_social, t.nome AS tomador_nome FROM recorrencias r
    JOIN empresas e ON e.id = r.empresa_id JOIN tomadores t ON t.id = r.tomador_id
    WHERE r.escritorio_id = ? ORDER BY r.ativo DESC, e.razao_social, r.dia_mes`, req.session.user.escritorio_id);
  const mesAtual = u.hojeISO().slice(0, 7);
  const totalMensal = recs.filter(r => r.ativo).reduce((s, r) => s + r.valor, 0);
  res.render('recorrencias/lista', { titulo: 'Emissão recorrente', recs, mesAtual, totalMensal });
});

router.get('/nova', (req, res) => {
  res.render('recorrencias/form', {
    titulo: 'Nova recorrência', empresas: empresasAtivas(req),
    rec: { dia_mes: 1, enviar_email: 1, ativo: 1, empresa_id: req.query.empresa || '', descricao: 'Serviços prestados referentes a {mes}/{ano}' },
  });
});

router.post('/', (req, res) => {
  const { d, erros } = ler(req);
  if (erros.length) {
    return res.render('recorrencias/form', { titulo: 'Nova recorrência', empresas: empresasAtivas(req), rec: req.body, flash: erros.map(msg => ({ tipo: 'erro', msg })) });
  }
  // se o dia ja passou neste mes, nao gera retroativo (so a partir do proximo)
  const hoje = u.hojeISO();
  const ultima = Number(hoje.slice(8, 10)) > d.dia_mes && !req.body.gerar_mes_atual ? hoje.slice(0, 7) : null;
  db.insert('recorrencias', { ...d, escritorio_id: req.session.user.escritorio_id, ultima_competencia: ultima });
  db.log(req, 'recorrencia_criada', `${d.descricao} - ${u.fmtMoeda(d.valor)} dia ${d.dia_mes}`);
  executarRecorrencias();
  req.flash('ok', 'Recorrência criada.' + (ultima ? ' A primeira nota sai no próximo mês.' : ''));
  res.redirect('/recorrencias');
});

router.get('/:id/editar', (req, res) => {
  const rec = recDoEscritorio(req);
  if (!rec) return naoEncontrado(res, 'Recorrência');
  res.render('recorrencias/form', { titulo: 'Editar recorrência', empresas: empresasAtivas(req), rec });
});

router.post('/:id', (req, res) => {
  const rec = recDoEscritorio(req);
  if (!rec) return naoEncontrado(res, 'Recorrência');
  const { d, erros } = ler(req);
  if (erros.length) {
    return res.render('recorrencias/form', { titulo: 'Editar recorrência', empresas: empresasAtivas(req), rec: { ...req.body, id: rec.id }, flash: erros.map(msg => ({ tipo: 'erro', msg })) });
  }
  db.update('recorrencias', rec.id, d);
  db.log(req, 'recorrencia_editada', `#${rec.id}`);
  req.flash('ok', 'Recorrência atualizada.');
  res.redirect('/recorrencias');
});

router.post('/:id/ativo', (req, res) => {
  const rec = recDoEscritorio(req);
  if (!rec) return naoEncontrado(res, 'Recorrência');
  db.run('UPDATE recorrencias SET ativo = ? WHERE id = ?', rec.ativo ? 0 : 1, rec.id);
  req.flash('ok', rec.ativo ? 'Recorrência pausada.' : 'Recorrência reativada.');
  res.redirect('/recorrencias');
});

router.post('/:id/gerar', (req, res) => {
  const rec = recDoEscritorio(req);
  if (!rec) return naoEncontrado(res, 'Recorrência');
  const notaId = gerarNotaDaRecorrencia(rec, u.hojeISO());
  if (!notaId) {
    req.flash('erro', 'Não foi possível gerar (empresa inativa?).');
    return res.redirect('/recorrencias');
  }
  db.log(req, 'recorrencia_manual', `#${rec.id} -> nota #${notaId}`);
  setImmediate(processarFila);
  req.flash('ok', 'Nota gerada e enviada para emissão.');
  res.redirect(`/notas/${notaId}`);
});

router.post('/:id/excluir', (req, res) => {
  const rec = recDoEscritorio(req);
  if (!rec) return naoEncontrado(res, 'Recorrência');
  db.run('DELETE FROM recorrencias WHERE id = ?', rec.id);
  db.log(req, 'recorrencia_excluida', `#${rec.id} ${rec.descricao}`);
  req.flash('ok', 'Recorrência excluída.');
  res.redirect('/recorrencias');
});

module.exports = router;
