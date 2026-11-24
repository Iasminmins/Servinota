const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { soNumeros } = require('../util');

const router = express.Router();

// controle simples de tentativas de login por IP
const tentativas = new Map();
function bloqueado(ip) {
  const t = tentativas.get(ip);
  return t && t.qtd >= 8 && Date.now() - t.desde < 15 * 60000;
}
function registraFalha(ip) {
  const t = tentativas.get(ip);
  if (!t || Date.now() - t.desde > 15 * 60000) tentativas.set(ip, { qtd: 1, desde: Date.now() });
  else t.qtd++;
}

router.get('/produto', (req, res) => {
  res.render('produto', { titulo: 'NFS-e para escritórios contábeis' });
});

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(req.session.user.papel === 'cliente' ? '/portal' : '/');
  const temEscritorio = db.get('SELECT COUNT(*) AS n FROM escritorios').n > 0;
  res.render('login', { titulo: 'Entrar', email: '', temEscritorio });
});

router.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  const temEscritorio = true;

  if (bloqueado(req.ip)) {
    req.flash('erro', 'Muitas tentativas. Espere alguns minutos e tente de novo.');
    return res.render('login', { titulo: 'Entrar', email, temEscritorio, flash: req.session.flash.splice(0) });
  }

  const user = db.get('SELECT * FROM usuarios WHERE email = ?', email);
  const ok = user && user.ativo && await bcrypt.compare(senha, user.senha_hash);
  if (!ok) {
    registraFalha(req.ip);
    req.flash('erro', 'E-mail ou senha inválidos.');
    return res.render('login', { titulo: 'Entrar', email, temEscritorio, flash: req.session.flash.splice(0) });
  }

  tentativas.delete(req.ip);
  const voltar = req.session.voltar;
  req.session.regenerate(err => {
    if (err) throw err;
    req.session.user = {
      id: user.id, nome: user.nome, email: user.email, papel: user.papel,
      escritorio_id: user.escritorio_id, empresa_id: user.empresa_id,
    };
    db.run("UPDATE usuarios SET ultimo_acesso = datetime('now','localtime') WHERE id = ?", user.id);
    db.log(req, 'login', user.email);
    if (user.papel === 'cliente') return res.redirect('/portal');
    res.redirect(voltar && voltar.startsWith('/') && !voltar.startsWith('//') ? voltar : '/');
  });
});

router.get('/cadastro', (req, res) => {
  res.render('cadastro', { titulo: 'Criar conta', dados: {} });
});

router.post('/cadastro', async (req, res) => {
  const d = req.body;
  const erros = [];
  if (!d.escritorio || d.escritorio.trim().length < 3) erros.push('Informe o nome do escritório.');
  if (!d.nome || !d.nome.trim()) erros.push('Informe seu nome.');
  if (!/^\S+@\S+\.\S+$/.test(d.email || '')) erros.push('E-mail inválido.');
  if (!d.senha || d.senha.length < 8) erros.push('A senha precisa ter pelo menos 8 caracteres.');
  if (d.senha !== d.senha2) erros.push('As senhas não conferem.');
  if (db.get('SELECT id FROM usuarios WHERE email = ?', String(d.email || '').trim().toLowerCase())) {
    erros.push('Já existe um usuário com esse e-mail.');
  }
  if (erros.length) {
    erros.forEach(e => req.flash('erro', e));
    return res.render('cadastro', { titulo: 'Criar conta', dados: d, flash: req.session.flash.splice(0) });
  }

  const hash = await bcrypt.hash(d.senha, 10);
  const userId = db.tx(() => {
    const escId = db.insert('escritorios', {
      nome: d.escritorio.trim(), cnpj: soNumeros(d.cnpj) || null, email: d.email.trim().toLowerCase(),
      email_assunto: 'NFS-e nº {numero} - {prestador}',
      email_corpo: 'Olá, {tomador}.\n\nSegue em anexo a NFS-e nº {numero} emitida por {prestador}, no valor de {valor}.\n\nAtenciosamente,\n{escritorio}',
    });
    return db.insert('usuarios', {
      escritorio_id: escId, nome: d.nome.trim(), email: d.email.trim().toLowerCase(),
      senha_hash: hash, papel: 'admin',
    });
  });

  const user = db.get('SELECT * FROM usuarios WHERE id = ?', userId);
  req.session.regenerate(() => {
    req.session.user = {
      id: user.id, nome: user.nome, email: user.email, papel: user.papel,
      escritorio_id: user.escritorio_id, empresa_id: null,
    };
    db.log(req, 'cadastro', 'Escritório criado');
    req.flash('ok', 'Conta criada! Comece cadastrando a primeira empresa cliente.');
    res.redirect('/empresas/nova');
  });
});

router.post('/sair', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/minha-conta', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('conta', { titulo: 'Minha conta' });
});

router.post('/minha-conta', async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const user = db.get('SELECT * FROM usuarios WHERE id = ?', req.session.user.id);
  const { atual, nova, nova2 } = req.body;
  if (!(await bcrypt.compare(atual || '', user.senha_hash))) {
    req.flash('erro', 'Senha atual incorreta.');
  } else if (!nova || nova.length < 8) {
    req.flash('erro', 'A nova senha precisa ter pelo menos 8 caracteres.');
  } else if (nova !== nova2) {
    req.flash('erro', 'As senhas não conferem.');
  } else {
    db.run('UPDATE usuarios SET senha_hash = ? WHERE id = ?', await bcrypt.hash(nova, 10), user.id);
    db.log(req, 'senha', 'Alterou a própria senha');
    req.flash('ok', 'Senha alterada.');
  }
  res.redirect('/minha-conta');
});

module.exports = router;
