const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const db = require('../db');
const { naoEncontrado } = require('../middleware');

const router = express.Router();

const PAPEIS = { admin: 'Administrador', operador: 'Operador', cliente: 'Cliente (portal)' };

function usuarioDoEscritorio(req) {
  return db.get('SELECT * FROM usuarios WHERE id = ? AND escritorio_id = ?', Number(req.params.id), req.session.user.escritorio_id);
}

function empresas(req) {
  return db.all('SELECT id, razao_social FROM empresas WHERE escritorio_id = ? AND ativo = 1 ORDER BY razao_social', req.session.user.escritorio_id);
}

function senhaAleatoria() {
  return crypto.randomBytes(6).toString('base64').replace(/[+/=]/g, '').slice(0, 8) + Math.floor(Math.random() * 90 + 10);
}

function ler(req, editando) {
  const b = req.body;
  const erros = [];
  const d = {
    nome: String(b.nome || '').trim(),
    email: String(b.email || '').trim().toLowerCase(),
    papel: PAPEIS[b.papel] ? b.papel : 'operador',
    empresa_id: null,
  };
  if (!d.nome) erros.push('Informe o nome.');
  if (!/^\S+@\S+\.\S+$/.test(d.email)) erros.push('E-mail inválido.');
  if (d.papel === 'cliente') {
    const emp = db.get('SELECT id FROM empresas WHERE id = ? AND escritorio_id = ?', Number(b.empresa_id), req.session.user.escritorio_id);
    if (!emp) erros.push('Usuário cliente precisa estar vinculado a uma empresa.');
    else d.empresa_id = emp.id;
  }
  const outro = db.get('SELECT id FROM usuarios WHERE email = ? AND id <> ?', d.email, editando ? editando.id : 0);
  if (outro) erros.push('Já existe um usuário com esse e-mail.');
  if (b.senha && b.senha.length < 8) erros.push('A senha precisa ter pelo menos 8 caracteres.');
  return { d, erros };
}

router.get('/', (req, res) => {
  const usuarios = db.all(`SELECT u.*, e.razao_social FROM usuarios u LEFT JOIN empresas e ON e.id = u.empresa_id
    WHERE u.escritorio_id = ? ORDER BY u.papel = 'cliente', u.nome`, req.session.user.escritorio_id);
  res.render('usuarios/lista', { titulo: 'Usuários', usuarios, PAPEIS });
});

router.get('/novo', (req, res) => {
  res.render('usuarios/form', {
    titulo: 'Novo usuário', usr: { papel: req.query.empresa ? 'cliente' : 'operador', empresa_id: req.query.empresa || '' },
    empresas: empresas(req), PAPEIS, sugestao: senhaAleatoria(),
  });
});

router.post('/', async (req, res) => {
  const { d, erros } = ler(req, null);
  if (!req.body.senha) erros.push('Defina uma senha inicial.');
  if (erros.length) {
    return res.render('usuarios/form', { titulo: 'Novo usuário', usr: req.body, empresas: empresas(req), PAPEIS, sugestao: req.body.senha, flash: erros.map(msg => ({ tipo: 'erro', msg })) });
  }
  db.insert('usuarios', { ...d, escritorio_id: req.session.user.escritorio_id, senha_hash: await bcrypt.hash(req.body.senha, 10) });
  db.log(req, 'usuario_criado', `${d.email} (${d.papel})`);
  req.flash('ok', `Usuário criado. Passe para ${d.nome} o e-mail ${d.email} e a senha definida.`);
  res.redirect('/usuarios');
});

router.get('/:id/editar', (req, res) => {
  const usr = usuarioDoEscritorio(req);
  if (!usr) return naoEncontrado(res, 'Usuário');
  res.render('usuarios/form', { titulo: 'Editar usuário', usr, empresas: empresas(req), PAPEIS, sugestao: '' });
});

router.post('/:id', async (req, res) => {
  const usr = usuarioDoEscritorio(req);
  if (!usr) return naoEncontrado(res, 'Usuário');
  const { d, erros } = ler(req, usr);
  if (usr.id === req.session.user.id && d.papel !== 'admin') erros.push('Você não pode tirar seu próprio acesso de administrador.');
  if (erros.length) {
    return res.render('usuarios/form', { titulo: 'Editar usuário', usr: { ...req.body, id: usr.id }, empresas: empresas(req), PAPEIS, sugestao: '', flash: erros.map(msg => ({ tipo: 'erro', msg })) });
  }
  if (req.body.senha) d.senha_hash = await bcrypt.hash(req.body.senha, 10);
  db.update('usuarios', usr.id, d);
  db.log(req, 'usuario_editado', d.email + (req.body.senha ? ' (senha redefinida)' : ''));
  req.flash('ok', 'Usuário atualizado.');
  res.redirect('/usuarios');
});

router.post('/:id/ativo', (req, res) => {
  const usr = usuarioDoEscritorio(req);
  if (!usr) return naoEncontrado(res, 'Usuário');
  if (usr.id === req.session.user.id) {
    req.flash('erro', 'Você não pode desativar a si mesmo.');
    return res.redirect('/usuarios');
  }
  db.run('UPDATE usuarios SET ativo = ? WHERE id = ?', usr.ativo ? 0 : 1, usr.id);
  if (usr.ativo) db.run("DELETE FROM sessoes WHERE dados LIKE ?", `%"id":${usr.id},%`);
  db.log(req, usr.ativo ? 'usuario_desativado' : 'usuario_ativado', usr.email);
  req.flash('ok', usr.ativo ? 'Usuário desativado.' : 'Usuário reativado.');
  res.redirect('/usuarios');
});

module.exports = router;
