const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const db = require('../db');
const { checarToken, empresaDoEscritorio } = require('../middleware');
const { lerPlanilha, modeloXlsx } = require('../services/planilha');
const { lerTomador } = require('../services/cadastros');
const { criarNota, processarFila } = require('../services/emissao');
const u = require('../util');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// planilhas validadas ficam em memoria ate a confirmacao
const pendentes = new Map();
setInterval(() => {
  const limite = Date.now() - 30 * 60000;
  for (const [k, v] of pendentes) if (v.criado < limite) pendentes.delete(k);
}, 600000).unref();

function empresas(req) {
  return db.all('SELECT id, razao_social, cnpj FROM empresas WHERE escritorio_id = ? AND ativo = 1 ORDER BY razao_social', req.session.user.escritorio_id);
}

function converterData(s) {
  if (!s) return u.hojeISO();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const m2 = String(s).match(/^(\d{1,2})\/(\d{4})$/);
  if (m2) return `${m2[2]}-${m2[1].padStart(2, '0')}-01`;
  return null;
}

function validarLinha(l, empresa) {
  const erros = [];
  const { d: tom, erros: errTom } = lerTomador(l);
  erros.push(...errTom);
  const valor = u.parseValor(l.valor);
  if (!(valor > 0)) erros.push('Valor inválido.');
  if (!l.descricao) erros.push('Descrição vazia.');
  const codTrib = u.soNumeros(l.cod_trib_nac) || empresa.cod_trib_nac_padrao;
  if (!codTrib || codTrib.length !== 6) erros.push('Sem código de tributação (nem na linha, nem padrão da empresa).');
  const aliquota = l.aliquota ? u.parseValor(l.aliquota) : empresa.aliquota_padrao;
  if (aliquota != null && isNaN(aliquota)) erros.push('Alíquota inválida.');
  const competencia = converterData(l.competencia);
  if (!competencia) erros.push('Competência inválida (use dd/mm/aaaa).');
  else if (competencia > u.hojeISO()) erros.push('Competência no futuro.');
  return {
    linha: l.linha, erros, tomador: tom,
    nota: {
      descricao: String(l.descricao || '').trim(), valor, cod_trib_nac: codTrib, aliquota,
      iss_retido: /^(s|sim|1|x)$/i.test(String(l.iss_retido || '').trim()) ? 1 : 0, competencia,
    },
  };
}

router.get('/', (req, res) => {
  const lotes = db.all(`SELECT l.*, e.razao_social,
      (SELECT COUNT(*) FROM notas n WHERE n.lote_id = l.id AND n.status = 'emitida') AS emitidas,
      (SELECT COUNT(*) FROM notas n WHERE n.lote_id = l.id AND n.status = 'erro') AS erros
    FROM lotes l JOIN empresas e ON e.id = l.empresa_id WHERE l.escritorio_id = ? ORDER BY l.id DESC LIMIT 20`,
  req.session.user.escritorio_id);
  res.render('importacao/index', { titulo: 'Importar planilha', empresas: empresas(req), lotes });
});

router.get('/modelo.xlsx', async (req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-importacao-nfse.xlsx"');
  res.send(await modeloXlsx());
});

router.post('/', upload.single('arquivo'), checarToken, async (req, res) => {
  const empresa = empresaDoEscritorio(req, req.body.empresa_id);
  if (!empresa) {
    req.flash('erro', 'Selecione a empresa prestadora.');
    return res.redirect('/importacao');
  }
  if (!req.file) {
    req.flash('erro', 'Selecione a planilha (.xlsx ou .csv).');
    return res.redirect('/importacao');
  }
  if (empresa.ambiente !== 'simulacao' && !empresa.cert_pfx) {
    req.flash('erro', 'A empresa não tem certificado digital cadastrado.');
    return res.redirect('/importacao');
  }
  let linhas;
  try {
    linhas = await lerPlanilha(req.file.buffer, req.file.originalname);
  } catch (e) {
    req.flash('erro', 'Erro ao ler a planilha: ' + e.message);
    return res.redirect('/importacao');
  }
  if (linhas.length > 1000) {
    req.flash('erro', 'Máximo de 1000 notas por planilha.');
    return res.redirect('/importacao');
  }
  const itens = linhas.map(l => validarLinha(l, empresa));
  const token = crypto.randomBytes(16).toString('hex');
  pendentes.set(token, {
    criado: Date.now(), escritorio: req.session.user.escritorio_id, empresaId: empresa.id,
    arquivo: req.file.originalname, itens, enviarEmail: !!req.body.enviar_email,
  });
  const validos = itens.filter(i => !i.erros.length);
  res.render('importacao/preview', {
    titulo: 'Conferir importação', empresa, itens, token,
    validos: validos.length, total: u.arred(validos.reduce((s, i) => s + i.nota.valor, 0)),
    enviarEmail: !!req.body.enviar_email,
  });
});

router.post('/confirmar', (req, res) => {
  const p = pendentes.get(req.body.token);
  if (!p || p.escritorio !== req.session.user.escritorio_id) {
    req.flash('erro', 'Essa importação expirou. Envie a planilha de novo.');
    return res.redirect('/importacao');
  }
  pendentes.delete(req.body.token);
  const empresa = empresaDoEscritorio(req, p.empresaId);
  const validos = p.itens.filter(i => !i.erros.length);

  const loteId = db.insert('lotes', {
    escritorio_id: p.escritorio, empresa_id: empresa.id, arquivo: p.arquivo, total: validos.length, usuario_id: req.session.user.id,
  });
  for (const item of validos) {
    let tom = db.get('SELECT id FROM tomadores WHERE empresa_id = ? AND documento = ?', empresa.id, item.tomador.documento);
    let tomId = tom && tom.id;
    if (!tomId) tomId = db.insert('tomadores', { ...item.tomador, empresa_id: empresa.id });
    else {
      // atualiza o que veio preenchido na planilha
      const atual = Object.fromEntries(Object.entries(item.tomador).filter(([k, v]) => v && k !== 'documento'));
      db.update('tomadores', tomId, atual);
    }
    criarNota({
      escritorioId: p.escritorio, empresa, tomadorId: tomId, usuarioId: req.session.user.id, origem: 'planilha', loteId,
      dados: { ...item.nota, enviar_email: p.enviarEmail },
    });
  }
  db.log(req, 'importacao', `${p.arquivo}: ${validos.length} nota(s) para ${empresa.razao_social}`);
  setImmediate(processarFila);
  req.flash('ok', `${validos.length} nota(s) enviadas para a fila de emissão.`);
  res.redirect(`/notas?empresa=${empresa.id}`);
});

module.exports = router;
