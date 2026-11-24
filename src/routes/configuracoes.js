const express = require('express');
const db = require('../db');
const { encryptText } = require('../cripto');
const { testarSmtp } = require('../services/email');
const { soNumeros } = require('../util');

const router = express.Router();

router.get('/', (req, res) => {
  const esc = db.get('SELECT * FROM escritorios WHERE id = ?', req.session.user.escritorio_id);
  res.render('configuracoes', { titulo: 'Configurações', esc });
});

router.post('/', (req, res) => {
  const b = req.body;
  const d = {
    nome: String(b.nome || '').trim() || 'Escritório',
    cnpj: soNumeros(b.cnpj) || null,
    email: String(b.email || '').trim() || null,
    telefone: String(b.telefone || '').trim() || null,
    smtp_host: String(b.smtp_host || '').trim() || null,
    smtp_port: Number(b.smtp_port) || null,
    smtp_seguro: b.smtp_seguro ? 1 : 0,
    smtp_usuario: String(b.smtp_usuario || '').trim() || null,
    smtp_remetente: String(b.smtp_remetente || '').trim() || null,
    email_assunto: String(b.email_assunto || '').trim() || null,
    email_corpo: String(b.email_corpo || '').trim() || null,
  };
  // senha em branco = manter a atual
  if (b.smtp_senha) d.smtp_senha = encryptText(b.smtp_senha);
  db.update('escritorios', req.session.user.escritorio_id, d);
  db.log(req, 'configuracoes', 'Dados do escritório/e-mail alterados');
  req.flash('ok', 'Configurações salvas.');
  res.redirect('/configuracoes');
});

router.post('/testar-email', async (req, res) => {
  const esc = db.get('SELECT * FROM escritorios WHERE id = ?', req.session.user.escritorio_id);
  try {
    await testarSmtp(esc, req.body.para || req.session.user.email);
    req.flash('ok', 'E-mail de teste enviado. Confira a caixa de entrada (e o spam).');
  } catch (e) {
    req.flash('erro', 'Falha no teste: ' + e.message);
  }
  res.redirect('/configuracoes');
});

router.get('/logs', (req, res) => {
  const logs = db.all(`SELECT l.*, u.nome AS usuario FROM logs l LEFT JOIN usuarios u ON u.id = l.usuario_id
    WHERE l.escritorio_id = ? ORDER BY l.id DESC LIMIT 300`, req.session.user.escritorio_id);
  res.render('logs', { titulo: 'Histórico de atividades', logs });
});

module.exports = router;
