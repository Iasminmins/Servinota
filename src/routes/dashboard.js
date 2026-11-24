const express = require('express');
const db = require('../db');
const { hojeISO } = require('../util');

const router = express.Router();

const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function mesAnterior(anoMes, n = 1) {
  let [a, m] = anoMes.split('-').map(Number);
  m -= n;
  while (m < 1) { m += 12; a--; }
  return `${a}-${String(m).padStart(2, '0')}`;
}

// variacao percentual (null quando nao da pra comparar)
function variacao(atual, anterior) {
  if (!anterior) return atual ? null : 0;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
}

function resumoMes(esc, mes) {
  return db.get(`SELECT
      COUNT(CASE WHEN status = 'emitida' THEN 1 END) AS emitidas,
      COALESCE(SUM(CASE WHEN status = 'emitida' THEN valor END), 0) AS total,
      COUNT(CASE WHEN status = 'erro' THEN 1 END) AS erros,
      COUNT(CASE WHEN status = 'cancelada' THEN 1 END) AS canceladas
    FROM notas WHERE escritorio_id = ? AND substr(competencia, 1, 7) = ?`, esc, mes);
}

router.get('/', (req, res) => {
  const esc = req.session.user.escritorio_id;
  const mes = hojeISO().slice(0, 7);
  const anterior = mesAnterior(mes);

  const atual = resumoMes(esc, mes);
  const passado = resumoMes(esc, anterior);
  const fila = db.get("SELECT COUNT(*) AS n FROM notas WHERE escritorio_id = ? AND status IN ('pendente','processando')", esc).n;
  const errosTotal = db.get("SELECT COUNT(*) AS n FROM notas WHERE escritorio_id = ? AND status = 'erro'", esc).n;
  const emp = db.get(`SELECT COUNT(*) AS n, SUM(ambiente = 'producao') AS prod FROM empresas WHERE escritorio_id = ? AND ativo = 1`, esc);

  const metricas = {
    emitidas: { valor: atual.emitidas, var: variacao(atual.emitidas, passado.emitidas) },
    total: { valor: atual.total, var: variacao(atual.total, passado.total) },
    erros: errosTotal,
    fila,
    empresas: emp.n,
    empresasProd: emp.prod || 0,
    ticket: atual.emitidas ? atual.total / atual.emitidas : 0,
  };

  const ultimas = db.all(`SELECT n.id, n.status, n.numero_nfse, n.numero_dps, n.valor, n.competencia, e.razao_social, t.nome AS tomador_nome
    FROM notas n JOIN empresas e ON e.id = n.empresa_id LEFT JOIN tomadores t ON t.id = n.tomador_id
    WHERE n.escritorio_id = ? ORDER BY n.id DESC LIMIT 8`, esc);

  const porEmpresa = db.all(`SELECT e.id, e.razao_social, COUNT(n.id) AS qtd, COALESCE(SUM(n.valor), 0) AS total
    FROM empresas e LEFT JOIN notas n ON n.empresa_id = e.id AND n.status = 'emitida' AND substr(n.competencia, 1, 7) = ?
    WHERE e.escritorio_id = ? AND e.ativo = 1
    GROUP BY e.id ORDER BY total DESC, e.razao_social LIMIT 6`, mes, esc);

  // ultimos 6 meses, inclusive os zerados
  const brutos = db.all(`SELECT substr(competencia, 1, 7) AS mes, COUNT(*) AS qtd, SUM(valor) AS total
    FROM notas WHERE escritorio_id = ? AND status = 'emitida' AND substr(competencia, 1, 7) >= ?
    GROUP BY 1`, esc, mesAnterior(mes, 5));
  const meses = [];
  for (let i = 5; i >= 0; i--) {
    const m = mesAnterior(mes, i);
    const r = brutos.find(b => b.mes === m);
    const [a, mm] = m.split('-');
    meses.push({ mes: m, rotulo: `${NOMES_MES[Number(mm) - 1]}/${a.slice(2)}`, qtd: r ? r.qtd : 0, total: r ? r.total : 0, atual: m === mes });
  }

  const certVencendo = db.all(`SELECT id, razao_social, cert_validade FROM empresas
    WHERE escritorio_id = ? AND ativo = 1 AND cert_validade IS NOT NULL AND cert_validade <= date('now', '+30 days')
    ORDER BY cert_validade`, esc);

  const proximasRec = db.all(`SELECT r.*, e.razao_social, t.nome AS tomador_nome FROM recorrencias r
    JOIN empresas e ON e.id = r.empresa_id JOIN tomadores t ON t.id = r.tomador_id
    WHERE r.escritorio_id = ? AND r.ativo = 1 AND (r.ultima_competencia IS NULL OR r.ultima_competencia < ?)
    ORDER BY r.dia_mes LIMIT 6`, esc, mes);

  res.render('dashboard', {
    titulo: 'Painel', metricas, ultimas, porEmpresa, meses, certVencendo, proximasRec, mes, anterior,
  });
});

module.exports = router;
