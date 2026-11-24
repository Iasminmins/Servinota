const crypto = require('node:crypto');
const db = require('./db');
const util = require('./util');
const { ic } = require('./icones');
const config = require('./config');

function locais(req, res, next) {
  req.flash = (tipo, msg) => {
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ tipo, msg });
  };
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');

  if (config.semLogin && !req.session.user) {
    const adm = db.get("SELECT * FROM usuarios WHERE papel = 'admin' AND ativo = 1 ORDER BY id LIMIT 1");
    if (adm) {
      req.session.user = {
        id: adm.id, nome: adm.nome, email: adm.email, papel: adm.papel,
        escritorio_id: adm.escritorio_id, empresa_id: adm.empresa_id,
      };
    }
  }

  const user = req.session.user || null;
  res.locals.user = user;
  res.locals.flash = req.session.flash || [];
  req.session.flash = [];
  res.locals.csrf = req.session.csrf;
  res.locals.caminho = req.path;
  res.locals.query = req.query;
  res.locals.u = util;
  res.locals.ic = ic;
  res.locals.banner = null;
  res.locals.escritorioNome = '';

  if (user) {
    const esc = db.get('SELECT nome FROM escritorios WHERE id = ?', user.escritorio_id);
    res.locals.escritorioNome = esc ? esc.nome : '';
    res.locals.iniciais = String(user.nome || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
    res.locals.banner = bannerAmbiente(user);
  }
  next();
}

// um aviso so no topo quando ha empresas fora de producao
function bannerAmbiente(user) {
  if (user.papel === 'cliente') {
    const e = db.get('SELECT ambiente FROM empresas WHERE id = ?', user.empresa_id);
    if (!e || e.ambiente === 'producao') return null;
    return { txt: e.ambiente === 'homologacao' ? 'Ambiente de homologação — notas sem valor fiscal' : 'Ambiente de simulação — notas sem valor fiscal' };
  }
  const r = db.get(`SELECT COUNT(*) AS total, SUM(ambiente = 'producao') AS prod, SUM(ambiente = 'homologacao') AS homol
    FROM empresas WHERE escritorio_id = ? AND ativo = 1`, user.escritorio_id);
  if (!r || !r.total) return null;
  const teste = r.total - (r.prod || 0);
  if (!teste) return null;
  if (!r.prod) {
    return { txt: (r.homol ? 'Ambiente de homologação' : 'Ambiente de simulação') + ' — notas sem valor fiscal', link: null };
  }
  return { txt: `${teste} empresa${teste > 1 ? 's' : ''} em ambiente de teste — as notas delas não têm valor fiscal`, link: '/empresas' };
}

function verificaCsrf(req, res, next) {
  if (req.method !== 'POST') return next();
  const tipo = req.headers['content-type'] || '';
  // multipart e verificado na propria rota depois do multer
  if (tipo.startsWith('multipart/form-data')) return next();
  return checarToken(req, res, next);
}

function checarToken(req, res, next) {
  const token = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrf) {
    res.status(403);
    return res.render('erro', { titulo: 'Sessão expirada', msg: 'O formulário expirou. Volte, atualize a página e tente de novo.' });
  }
  next();
}

function exigeLogin(req, res, next) {
  if (!req.session.user) {
    if (req.method === 'GET') req.session.voltar = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

// equipe do escritorio (admin e operador)
function exigeEquipe(req, res, next) {
  const u = req.session.user;
  if (!u) return res.redirect('/login');
  if (u.papel === 'cliente') return res.redirect('/portal');
  next();
}

function exigeAdmin(req, res, next) {
  const u = req.session.user;
  if (!u || u.papel !== 'admin') {
    res.status(403);
    return res.render('erro', { titulo: 'Sem permissão', msg: 'Só o administrador do escritório pode acessar essa área.' });
  }
  next();
}

function exigeCliente(req, res, next) {
  const u = req.session.user;
  if (!u) return res.redirect('/login');
  if (u.papel !== 'cliente') return res.redirect('/');
  next();
}

// busca empresa garantindo que pertence ao escritorio logado
function empresaDoEscritorio(req, id) {
  return db.get('SELECT * FROM empresas WHERE id = ? AND escritorio_id = ?', Number(id), req.session.user.escritorio_id);
}

function naoEncontrado(res, oque = 'Registro') {
  res.status(404);
  return res.render('erro', { titulo: 'Não encontrado', msg: `${oque} não encontrado.` });
}

module.exports = {
  locais, verificaCsrf, checarToken, exigeLogin, exigeEquipe, exigeAdmin, exigeCliente,
  empresaDoEscritorio, naoEncontrado,
};
