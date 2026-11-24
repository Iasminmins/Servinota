const express = require('express');
const multer = require('multer');
const db = require('../db');
const { exigeAdmin, checarToken, empresaDoEscritorio, naoEncontrado } = require('../middleware');
const { lerEmpresa, lerTomador, lerServico } = require('../services/cadastros');
const { lerPfx } = require('../nfse/certificado');
const { encrypt, encryptText } = require('../cripto');
const u = require('../util');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 } });

// carrega a empresa da url em req.empresa
router.param('id', (req, res, next, id) => {
  const emp = empresaDoEscritorio(req, id);
  if (!emp) return naoEncontrado(res, 'Empresa');
  req.empresa = emp;
  next();
});

router.get('/', (req, res) => {
  const busca = String(req.query.busca || '').trim();
  const params = [req.session.user.escritorio_id];
  let filtro = '';
  if (busca) {
    filtro = ' AND (razao_social LIKE ? OR nome_fantasia LIKE ? OR cnpj LIKE ?)';
    const like = `%${busca}%`;
    params.push(like, like, `%${u.soNumeros(busca) || busca}%`);
  }
  if (req.query.inativas !== '1') filtro += ' AND ativo = 1';
  const empresas = db.all(`SELECT e.*,
      (SELECT COUNT(*) FROM notas n WHERE n.empresa_id = e.id AND n.status = 'emitida') AS qtd_notas
    FROM empresas e WHERE escritorio_id = ?${filtro} ORDER BY razao_social`, ...params);
  res.render('empresas/lista', { titulo: 'Empresas', empresas, busca });
});

router.get('/nova', (req, res) => {
  res.render('empresas/form', { titulo: 'Nova empresa', emp: { ambiente: 'simulacao', serie: '1', proximo_numero: 1, op_simples: 1, aliquota_padrao: 2 } });
});

router.post('/', (req, res) => {
  const { d, erros } = lerEmpresa(req.body);
  const dup = db.get('SELECT id FROM empresas WHERE escritorio_id = ? AND cnpj = ?', req.session.user.escritorio_id, d.cnpj);
  if (dup) erros.push('Essa empresa já está cadastrada.');
  if (erros.length) {
    return res.render('empresas/form', { titulo: 'Nova empresa', emp: { ...req.body }, flash: erros.map(msg => ({ tipo: 'erro', msg })) });
  }
  const id = db.insert('empresas', { ...d, escritorio_id: req.session.user.escritorio_id });
  db.log(req, 'empresa_criada', `${d.razao_social} (${d.cnpj})`);
  req.flash('ok', 'Empresa cadastrada. Agora envie o certificado digital A1 para emitir em homologação/produção.');
  res.redirect(`/empresas/${id}`);
});

router.get('/:id', (req, res) => {
  const emp = req.empresa;
  const aba = req.query.aba || 'tomadores';
  const tomadores = db.all('SELECT * FROM tomadores WHERE empresa_id = ? ORDER BY nome', emp.id);
  const servicos = db.all('SELECT * FROM servicos WHERE empresa_id = ? ORDER BY descricao', emp.id);
  const notas = db.all(`SELECT n.*, t.nome AS tomador_nome FROM notas n LEFT JOIN tomadores t ON t.id = n.tomador_id
    WHERE n.empresa_id = ? ORDER BY n.id DESC LIMIT 30`, emp.id);
  const usuarios = db.all("SELECT id, nome, email, ativo, ultimo_acesso FROM usuarios WHERE empresa_id = ? AND papel = 'cliente'", emp.id);
  res.render('empresas/ver', { titulo: emp.razao_social, emp, aba, tomadores, servicos, notas, usuarios });
});

router.get('/:id/editar', (req, res) => {
  res.render('empresas/form', { titulo: 'Editar empresa', emp: req.empresa });
});

router.post('/:id', (req, res) => {
  const { d, erros } = lerEmpresa(req.body);
  const dup = db.get('SELECT id FROM empresas WHERE escritorio_id = ? AND cnpj = ? AND id <> ?', req.session.user.escritorio_id, d.cnpj, req.empresa.id);
  if (dup) erros.push('Já existe outra empresa com esse CNPJ.');
  if (d.ambiente !== 'simulacao' && !req.empresa.cert_pfx) erros.push('Para usar homologação ou produção, envie primeiro o certificado digital.');
  if (erros.length) {
    return res.render('empresas/form', { titulo: 'Editar empresa', emp: { ...req.body, id: req.empresa.id }, flash: erros.map(msg => ({ tipo: 'erro', msg })) });
  }
  db.update('empresas', req.empresa.id, d);
  db.log(req, 'empresa_editada', `${d.razao_social} - ambiente ${d.ambiente}`);
  req.flash('ok', 'Dados salvos.');
  res.redirect(`/empresas/${req.empresa.id}?aba=dados`);
});

router.post('/:id/ativo', exigeAdmin, (req, res) => {
  const novo = req.empresa.ativo ? 0 : 1;
  db.run('UPDATE empresas SET ativo = ? WHERE id = ?', novo, req.empresa.id);
  if (!novo) db.run('UPDATE recorrencias SET ativo = 0 WHERE empresa_id = ?', req.empresa.id);
  db.log(req, novo ? 'empresa_reativada' : 'empresa_desativada', req.empresa.razao_social);
  req.flash('ok', novo ? 'Empresa reativada.' : 'Empresa desativada (as recorrências dela foram pausadas).');
  res.redirect(`/empresas/${req.empresa.id}?aba=dados`);
});

// ---------- certificado A1 ----------
router.post('/:id/certificado', upload.single('arquivo'), checarToken, (req, res) => {
  const volta = `/empresas/${req.empresa.id}?aba=certificado`;
  if (!req.file) {
    req.flash('erro', 'Selecione o arquivo .pfx ou .p12.');
    return res.redirect(volta);
  }
  try {
    const info = lerPfx(req.file.buffer, req.body.senha || '');
    if (info.validoAte < new Date()) throw new Error('Esse certificado já está vencido.');
    const cnpjEmp = u.soNumeros(req.empresa.cnpj);
    if (info.cnpj && info.cnpj.slice(0, 8) !== cnpjEmp.slice(0, 8)) {
      throw new Error(`O certificado é do CNPJ ${u.fmtDoc(info.cnpj)}, diferente da empresa (${u.fmtDoc(cnpjEmp)}).`);
    }
    db.update('empresas', req.empresa.id, {
      cert_pfx: encrypt(req.file.buffer),
      cert_senha: encryptText(req.body.senha || ''),
      cert_titular: info.titular,
      cert_validade: info.validoAte.toISOString().slice(0, 10),
    });
    db.log(req, 'certificado_enviado', `${req.empresa.razao_social} - válido até ${info.validoAte.toISOString().slice(0, 10)}`);
    req.flash('ok', `Certificado de "${info.titular}" salvo. Válido até ${u.fmtData(info.validoAte.toISOString())}.`);
  } catch (e) {
    req.flash('erro', e.message);
  }
  res.redirect(volta);
});

router.post('/:id/certificado/remover', exigeAdmin, (req, res) => {
  db.run(`UPDATE empresas SET cert_pfx = NULL, cert_senha = NULL, cert_titular = NULL, cert_validade = NULL,
          ambiente = 'simulacao' WHERE id = ?`, req.empresa.id);
  db.log(req, 'certificado_removido', req.empresa.razao_social);
  req.flash('ok', 'Certificado removido. A empresa voltou para o ambiente de simulação.');
  res.redirect(`/empresas/${req.empresa.id}?aba=certificado`);
});

// ---------- tomadores ----------
function tomadorDaEmpresa(req) {
  return db.get('SELECT * FROM tomadores WHERE id = ? AND empresa_id = ?', Number(req.params.tid), req.empresa.id);
}

router.get('/:id/tomadores/novo', (req, res) => {
  res.render('empresas/tomador', { titulo: 'Novo tomador', emp: req.empresa, tom: {}, voltar: req.query.voltar || '' });
});

router.post('/:id/tomadores', (req, res) => {
  const { d, erros } = lerTomador(req.body);
  if (db.get('SELECT id FROM tomadores WHERE empresa_id = ? AND documento = ?', req.empresa.id, d.documento)) {
    erros.push('Esse tomador já está cadastrado nesta empresa.');
  }
  if (erros.length) {
    return res.render('empresas/tomador', { titulo: 'Novo tomador', emp: req.empresa, tom: req.body, voltar: req.body.voltar || '', flash: erros.map(msg => ({ tipo: 'erro', msg })) });
  }
  const id = db.insert('tomadores', { ...d, empresa_id: req.empresa.id });
  req.flash('ok', 'Tomador cadastrado.');
  if (req.body.voltar === 'nota') return res.redirect(`/notas/nova?empresa=${req.empresa.id}&tomador=${id}`);
  res.redirect(`/empresas/${req.empresa.id}?aba=tomadores`);
});

router.get('/:id/tomadores/:tid/editar', (req, res) => {
  const tom = tomadorDaEmpresa(req);
  if (!tom) return naoEncontrado(res, 'Tomador');
  res.render('empresas/tomador', { titulo: 'Editar tomador', emp: req.empresa, tom, voltar: '' });
});

router.post('/:id/tomadores/:tid', (req, res) => {
  const tom = tomadorDaEmpresa(req);
  if (!tom) return naoEncontrado(res, 'Tomador');
  const { d, erros } = lerTomador(req.body);
  if (db.get('SELECT id FROM tomadores WHERE empresa_id = ? AND documento = ? AND id <> ?', req.empresa.id, d.documento, tom.id)) {
    erros.push('Já existe outro tomador com esse documento.');
  }
  if (erros.length) {
    return res.render('empresas/tomador', { titulo: 'Editar tomador', emp: req.empresa, tom: { ...req.body, id: tom.id }, voltar: '', flash: erros.map(msg => ({ tipo: 'erro', msg })) });
  }
  db.update('tomadores', tom.id, d);
  req.flash('ok', 'Tomador atualizado.');
  res.redirect(`/empresas/${req.empresa.id}?aba=tomadores`);
});

router.post('/:id/tomadores/:tid/excluir', (req, res) => {
  const tom = tomadorDaEmpresa(req);
  if (!tom) return naoEncontrado(res, 'Tomador');
  const usado = db.get('SELECT COUNT(*) AS n FROM notas WHERE tomador_id = ?', tom.id).n;
  if (usado) {
    req.flash('erro', 'Esse tomador já tem notas emitidas e não pode ser excluído.');
  } else {
    db.run('DELETE FROM recorrencias WHERE tomador_id = ?', tom.id);
    db.run('DELETE FROM tomadores WHERE id = ?', tom.id);
    req.flash('ok', 'Tomador excluído.');
  }
  res.redirect(`/empresas/${req.empresa.id}?aba=tomadores`);
});

// ---------- servicos ----------
function servicoDaEmpresa(req) {
  return db.get('SELECT * FROM servicos WHERE id = ? AND empresa_id = ?', Number(req.params.sid), req.empresa.id);
}

router.get('/:id/servicos/novo', (req, res) => {
  res.render('empresas/servico', {
    titulo: 'Novo serviço', emp: req.empresa,
    serv: { cod_trib_nac: req.empresa.cod_trib_nac_padrao, aliquota: req.empresa.aliquota_padrao },
  });
});

router.post('/:id/servicos', (req, res) => {
  const { d, erros } = lerServico(req.body);
  if (erros.length) {
    return res.render('empresas/servico', { titulo: 'Novo serviço', emp: req.empresa, serv: req.body, flash: erros.map(msg => ({ tipo: 'erro', msg })) });
  }
  db.insert('servicos', { ...d, empresa_id: req.empresa.id });
  req.flash('ok', 'Serviço cadastrado.');
  res.redirect(`/empresas/${req.empresa.id}?aba=servicos`);
});

router.get('/:id/servicos/:sid/editar', (req, res) => {
  const serv = servicoDaEmpresa(req);
  if (!serv) return naoEncontrado(res, 'Serviço');
  res.render('empresas/servico', { titulo: 'Editar serviço', emp: req.empresa, serv });
});

router.post('/:id/servicos/:sid', (req, res) => {
  const serv = servicoDaEmpresa(req);
  if (!serv) return naoEncontrado(res, 'Serviço');
  const { d, erros } = lerServico(req.body);
  if (erros.length) {
    return res.render('empresas/servico', { titulo: 'Editar serviço', emp: req.empresa, serv: { ...req.body, id: serv.id }, flash: erros.map(msg => ({ tipo: 'erro', msg })) });
  }
  db.update('servicos', serv.id, d);
  req.flash('ok', 'Serviço atualizado.');
  res.redirect(`/empresas/${req.empresa.id}?aba=servicos`);
});

router.post('/:id/servicos/:sid/excluir', (req, res) => {
  const serv = servicoDaEmpresa(req);
  if (serv) db.run('DELETE FROM servicos WHERE id = ?', serv.id);
  req.flash('ok', 'Serviço excluído.');
  res.redirect(`/empresas/${req.empresa.id}?aba=servicos`);
});

// usado pelo formulario de nota pra montar os selects
router.get('/:id/dados.json', (req, res) => {
  const e = req.empresa;
  res.json({
    empresa: {
      id: e.id, ambiente: e.ambiente, aliquota_padrao: e.aliquota_padrao, cod_trib_nac_padrao: e.cod_trib_nac_padrao,
      cod_municipio: e.cod_municipio, tem_certificado: !!e.cert_pfx,
    },
    tomadores: db.all('SELECT id, documento, nome, email FROM tomadores WHERE empresa_id = ? ORDER BY nome', e.id),
    servicos: db.all('SELECT * FROM servicos WHERE empresa_id = ? ORDER BY descricao', e.id),
  });
});

module.exports = router;
