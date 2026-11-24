const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS escritorios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  cnpj TEXT,
  email TEXT,
  telefone TEXT,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_seguro INTEGER DEFAULT 0,
  smtp_usuario TEXT,
  smtp_senha TEXT,
  smtp_remetente TEXT,
  email_assunto TEXT,
  email_corpo TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS empresas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escritorio_id INTEGER NOT NULL REFERENCES escritorios(id),
  razao_social TEXT NOT NULL,
  nome_fantasia TEXT,
  cnpj TEXT NOT NULL,
  im TEXT,
  email TEXT,
  telefone TEXT,
  cep TEXT,
  logradouro TEXT,
  numero TEXT,
  complemento TEXT,
  bairro TEXT,
  cod_municipio TEXT,
  municipio TEXT,
  uf TEXT,
  op_simples INTEGER NOT NULL DEFAULT 1,
  reg_esp_trib INTEGER NOT NULL DEFAULT 0,
  p_tot_trib_sn REAL,
  informar_aliquota INTEGER NOT NULL DEFAULT 0,
  serie TEXT NOT NULL DEFAULT '1',
  proximo_numero INTEGER NOT NULL DEFAULT 1,
  ambiente TEXT NOT NULL DEFAULT 'simulacao',
  aliquota_padrao REAL DEFAULT 2,
  cod_trib_nac_padrao TEXT,
  cert_pfx BLOB,
  cert_senha TEXT,
  cert_titular TEXT,
  cert_validade TEXT,
  portal_pode_emitir INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escritorio_id INTEGER NOT NULL REFERENCES escritorios(id),
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'operador',
  empresa_id INTEGER REFERENCES empresas(id),
  ativo INTEGER NOT NULL DEFAULT 1,
  ultimo_acesso TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS tomadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  documento TEXT NOT NULL,
  nome TEXT NOT NULL,
  email TEXT,
  telefone TEXT,
  cep TEXT,
  logradouro TEXT,
  numero TEXT,
  complemento TEXT,
  bairro TEXT,
  cod_municipio TEXT,
  municipio TEXT,
  uf TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE (empresa_id, documento)
);

CREATE TABLE IF NOT EXISTS servicos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  cod_trib_nac TEXT NOT NULL,
  cod_nbs TEXT,
  valor REAL,
  aliquota REAL,
  iss_retido INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS recorrencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escritorio_id INTEGER NOT NULL REFERENCES escritorios(id),
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tomador_id INTEGER NOT NULL REFERENCES tomadores(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  cod_trib_nac TEXT NOT NULL,
  cod_nbs TEXT,
  valor REAL NOT NULL,
  aliquota REAL,
  iss_retido INTEGER NOT NULL DEFAULT 0,
  dia_mes INTEGER NOT NULL,
  enviar_email INTEGER NOT NULL DEFAULT 1,
  ativo INTEGER NOT NULL DEFAULT 1,
  ultima_competencia TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escritorio_id INTEGER NOT NULL REFERENCES escritorios(id),
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),
  arquivo TEXT,
  total INTEGER DEFAULT 0,
  usuario_id INTEGER,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS notas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escritorio_id INTEGER NOT NULL REFERENCES escritorios(id),
  empresa_id INTEGER NOT NULL REFERENCES empresas(id),
  tomador_id INTEGER REFERENCES tomadores(id),
  recorrencia_id INTEGER,
  lote_id INTEGER,
  serie TEXT NOT NULL,
  numero_dps INTEGER NOT NULL,
  competencia TEXT NOT NULL,
  descricao TEXT NOT NULL,
  cod_trib_nac TEXT NOT NULL,
  cod_nbs TEXT,
  cod_mun_prestacao TEXT,
  valor REAL NOT NULL,
  aliquota REAL,
  iss_retido INTEGER NOT NULL DEFAULT 0,
  valor_iss REAL,
  status TEXT NOT NULL DEFAULT 'pendente',
  ambiente TEXT NOT NULL,
  chave_acesso TEXT,
  numero_nfse TEXT,
  xml_dps TEXT,
  xml_nfse TEXT,
  pdf BLOB,
  mensagem TEXT,
  tentativas INTEGER NOT NULL DEFAULT 0,
  enviar_email INTEGER NOT NULL DEFAULT 1,
  email_enviado_em TEXT,
  emitida_em TEXT,
  cancelada_em TEXT,
  motivo_cancelamento TEXT,
  usuario_id INTEGER,
  origem TEXT DEFAULT 'manual',
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notas_status ON notas(status);
CREATE INDEX IF NOT EXISTS idx_notas_empresa ON notas(empresa_id, competencia);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  escritorio_id INTEGER,
  usuario_id INTEGER,
  acao TEXT NOT NULL,
  detalhe TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessoes (
  sid TEXT PRIMARY KEY,
  dados TEXT NOT NULL,
  expira INTEGER NOT NULL
);
`);

function limpar(params) {
  return params.map(v => {
    if (v === undefined) return null;
    if (v === true) return 1;
    if (v === false) return 0;
    return v;
  });
}

function all(sql, ...params) {
  return db.prepare(sql).all(...limpar(params));
}

function get(sql, ...params) {
  return db.prepare(sql).get(...limpar(params));
}

function run(sql, ...params) {
  const r = db.prepare(sql).run(...limpar(params));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
}

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// insert generico a partir de um objeto
function insert(tabela, obj) {
  const cols = Object.keys(obj);
  const sql = `INSERT INTO ${tabela} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  return run(sql, ...cols.map(c => obj[c])).id;
}

function update(tabela, id, obj) {
  const cols = Object.keys(obj);
  if (!cols.length) return;
  const sql = `UPDATE ${tabela} SET ${cols.map(c => c + ' = ?').join(', ')} WHERE id = ?`;
  return run(sql, ...cols.map(c => obj[c]), id);
}

function log(req, acao, detalhe) {
  const u = req && req.session && req.session.user;
  run('INSERT INTO logs (escritorio_id, usuario_id, acao, detalhe) VALUES (?,?,?,?)',
    u ? u.escritorio_id : null, u ? u.id : null, acao, detalhe || null);
}

module.exports = { db, all, get, run, tx, insert, update, log };
