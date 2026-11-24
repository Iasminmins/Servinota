const path = require('node:path');
const express = require('express');
const session = require('express-session');
const config = require('./config');
const SqliteStore = require('./sessao');
const mw = require('./middleware');
const { iniciarFila } = require('./services/emissao');
const { iniciarAgendador } = require('./services/recorrencia');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(config.root, 'views'));
app.set('trust proxy', 1);
const producao = process.env.NODE_ENV === 'production';
app.set('view cache', producao);
if (!producao) {
  // em desenvolvimento os templates sao relidos a cada pagina
  const ejs = require('ejs');
  app.use((req, res, next) => { ejs.clearCache(); next(); });
}
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use('/static', express.static(path.join(config.root, 'public'), { maxAge: '1h' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  store: new SqliteStore(),
  secret: config.secret,
  name: 'emissor.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.baseUrl.startsWith('https'),
    maxAge: 8 * 3600000,
  },
}));
app.use(mw.locais);
app.use(mw.verificaCsrf);

app.use(require('./routes/auth'));
app.use('/portal', mw.exigeLogin, mw.exigeCliente, require('./routes/portal'));
app.use('/empresas', mw.exigeLogin, mw.exigeEquipe, require('./routes/empresas'));
app.use('/notas', mw.exigeLogin, mw.exigeEquipe, require('./routes/notas'));
app.use('/recorrencias', mw.exigeLogin, mw.exigeEquipe, require('./routes/recorrencias'));
app.use('/importacao', mw.exigeLogin, mw.exigeEquipe, require('./routes/importacao'));
app.use('/usuarios', mw.exigeLogin, mw.exigeAdmin, require('./routes/usuarios'));
app.use('/configuracoes', mw.exigeLogin, mw.exigeAdmin, require('./routes/configuracoes'));
app.use('/', mw.exigeLogin, mw.exigeEquipe, require('./routes/dashboard'));

app.use((req, res) => {
  res.status(404).render('erro', { titulo: 'Página não encontrada', msg: 'O endereço acessado não existe.' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo grande demais.' : 'Ocorreu um erro inesperado. Tente novamente.';
  res.status(500).render('erro', { titulo: 'Erro', msg, detalhe: process.env.NODE_ENV === 'production' ? null : err.message });
});

iniciarFila();
iniciarAgendador();

const servidor = app.listen(config.port, () => {
  console.log(`Servinota rodando em ${config.baseUrl}`);
  if (config.semLogin) console.warn('ATENÇÃO: SEM_LOGIN=1 ativo, qualquer pessoa entra como administrador. Tire do .env antes de publicar.');
});
servidor.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`A porta ${config.port} já está em uso. Troque PORT no arquivo .env.`);
  else console.error(e);
  process.exit(1);
});
