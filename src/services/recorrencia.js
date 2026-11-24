const cron = require('node-cron');
const db = require('../db');
const { criarNota, processarFila } = require('./emissao');
const { hojeISO, ultimoDiaMes } = require('../util');

// substitui {mes} e {ano} na descricao, ex: "Honorarios {mes}/{ano}"
function descricaoDoMes(desc, hoje) {
  const [ano, mes] = hoje.split('-');
  const nomes = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  return desc.replace(/\{mes\}/gi, mes).replace(/\{ano\}/gi, ano).replace(/\{mes_nome\}/gi, nomes[Number(mes) - 1]);
}

function gerarNotaDaRecorrencia(rec, hoje) {
  const empresa = db.get('SELECT * FROM empresas WHERE id = ?', rec.empresa_id);
  if (!empresa || !empresa.ativo) return null;
  const notaId = criarNota({
    escritorioId: rec.escritorio_id,
    empresa,
    tomadorId: rec.tomador_id,
    origem: 'recorrencia',
    recorrenciaId: rec.id,
    dados: {
      competencia: hoje,
      descricao: descricaoDoMes(rec.descricao, hoje),
      cod_trib_nac: rec.cod_trib_nac,
      cod_nbs: rec.cod_nbs,
      valor: rec.valor,
      aliquota: rec.aliquota,
      iss_retido: rec.iss_retido,
      enviar_email: rec.enviar_email,
    },
  });
  db.run('UPDATE recorrencias SET ultima_competencia = ? WHERE id = ?', hoje.slice(0, 7), rec.id);
  return notaId;
}

// roda todo dia: gera as notas cujo dia ja chegou e que ainda nao foram geradas no mes
function executarRecorrencias() {
  const hoje = hojeISO();
  const [ano, mes, dia] = hoje.split('-').map(Number);
  const ultimo = ultimoDiaMes(ano, mes);
  const anoMes = hoje.slice(0, 7);

  const recs = db.all(`SELECT * FROM recorrencias WHERE ativo = 1
                       AND (ultima_competencia IS NULL OR ultima_competencia < ?)`, anoMes);
  let geradas = 0;
  for (const rec of recs) {
    const diaAlvo = Math.min(rec.dia_mes, ultimo);
    if (dia < diaAlvo) continue;
    try {
      if (gerarNotaDaRecorrencia(rec, hoje)) geradas++;
    } catch (e) {
      console.error('Falha na recorrência', rec.id, e.message);
    }
  }
  if (geradas) {
    console.log(`Recorrências: ${geradas} nota(s) colocada(s) na fila.`);
    setImmediate(processarFila);
  }
  return geradas;
}

function iniciarAgendador() {
  cron.schedule('0 7 * * *', executarRecorrencias, { timezone: 'America/Sao_Paulo' });
  // confere tambem ao subir, caso o servidor estivesse desligado as 7h
  setTimeout(executarRecorrencias, 10000).unref();
}

module.exports = { executarRecorrencias, gerarNotaDaRecorrencia, iniciarAgendador, descricaoDoMes };
