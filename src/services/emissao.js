const db = require('../db');
const { provedor } = require('../nfse');
const { gerarPdf } = require('../nfse/pdf');
const { arred, soNumeros } = require('../util');

// cria a nota na fila; o numero da DPS e reservado na hora pra nunca repetir
function criarNota({ escritorioId, empresa, tomadorId, dados, usuarioId, origem = 'manual', recorrenciaId = null, loteId = null }) {
  const valor = arred(dados.valor);
  const aliquota = dados.aliquota != null && dados.aliquota !== '' ? Number(dados.aliquota) : (empresa.aliquota_padrao || null);
  const valorIss = aliquota ? arred(valor * aliquota / 100) : null;

  return db.tx(() => {
    const emp = db.get('SELECT serie, proximo_numero, ambiente FROM empresas WHERE id = ?', empresa.id);
    db.run('UPDATE empresas SET proximo_numero = proximo_numero + 1 WHERE id = ?', empresa.id);
    return db.insert('notas', {
      escritorio_id: escritorioId,
      empresa_id: empresa.id,
      tomador_id: tomadorId || null,
      recorrencia_id: recorrenciaId,
      lote_id: loteId,
      serie: emp.serie,
      numero_dps: emp.proximo_numero,
      competencia: dados.competencia,
      descricao: dados.descricao,
      cod_trib_nac: soNumeros(dados.cod_trib_nac),
      cod_nbs: soNumeros(dados.cod_nbs) || null,
      cod_mun_prestacao: soNumeros(dados.cod_mun_prestacao) || empresa.cod_municipio,
      valor,
      aliquota,
      iss_retido: dados.iss_retido ? 1 : 0,
      valor_iss: valorIss,
      status: 'pendente',
      ambiente: emp.ambiente,
      enviar_email: dados.enviar_email ? 1 : 0,
      usuario_id: usuarioId || null,
      origem,
    });
  });
}

async function processarNota(id) {
  const nota = db.get('SELECT * FROM notas WHERE id = ?', id);
  if (!nota || nota.status !== 'pendente') return;
  const empresa = db.get('SELECT * FROM empresas WHERE id = ?', nota.empresa_id);
  const tomador = nota.tomador_id ? db.get('SELECT * FROM tomadores WHERE id = ?', nota.tomador_id) : null;

  db.run("UPDATE notas SET status = 'processando', tentativas = tentativas + 1 WHERE id = ?", id);
  try {
    const r = await provedor(nota.ambiente).emitir({ nota, empresa, tomador });
    db.update('notas', id, {
      status: 'emitida',
      chave_acesso: r.chave,
      numero_nfse: r.numero,
      xml_dps: r.xmlDps,
      xml_nfse: r.xmlNfse,
      mensagem: r.alertas || null,
      emitida_em: new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 19).replace('T', ' '),
    });
    db.run('INSERT INTO logs (escritorio_id, acao, detalhe) VALUES (?,?,?)', nota.escritorio_id, 'nota_emitida',
      `Nota #${id} - NFS-e ${r.numero || ''} chave ${r.chave}`);

    if (nota.enviar_email && tomador && tomador.email) {
      try {
        await require('./email').enviarNota(id);
      } catch (e) {
        db.run('UPDATE notas SET mensagem = ? WHERE id = ?', 'Nota emitida, mas o e-mail falhou: ' + e.message, id);
      }
    }
  } catch (e) {
    db.update('notas', id, {
      status: 'erro',
      mensagem: e.message,
      xml_dps: e.xmlDps || null,
    });
    db.run('INSERT INTO logs (escritorio_id, acao, detalhe) VALUES (?,?,?)', nota.escritorio_id, 'nota_erro',
      `Nota #${id}: ${e.message}`.slice(0, 1000));
  }
}

let rodando = false;
async function processarFila() {
  if (rodando) return;
  rodando = true;
  try {
    // uma por vez pra nao estourar limite da api e manter a ordem dos numeros
    for (let i = 0; i < 20; i++) {
      const prox = db.get("SELECT id FROM notas WHERE status = 'pendente' ORDER BY id LIMIT 1");
      if (!prox) break;
      await processarNota(prox.id);
    }
  } catch (e) {
    console.error('Erro na fila de emissão:', e);
  } finally {
    rodando = false;
  }
}

function iniciarFila() {
  // se o servidor caiu no meio de um envio, nao reenviamos sozinho (a nota pode ter sido autorizada)
  db.run(`UPDATE notas SET status = 'erro',
          mensagem = 'Envio interrompido (o sistema foi reiniciado). Confira no Portal Nacional se a nota foi gerada antes de reenviar.'
          WHERE status = 'processando'`);
  setInterval(processarFila, 3000).unref();
}

function reenviar(nota) {
  if (nota.status !== 'erro') throw new Error('Só notas com erro podem ser reenviadas.');
  db.run("UPDATE notas SET status = 'pendente', mensagem = NULL WHERE id = ?", nota.id);
  setImmediate(processarFila);
}

async function cancelarNota(nota, { codigo, motivo }) {
  if (nota.status !== 'emitida') throw new Error('Só notas emitidas podem ser canceladas.');
  if (!motivo || motivo.trim().length < 15) throw new Error('Descreva o motivo do cancelamento (mínimo 15 caracteres).');
  const empresa = db.get('SELECT * FROM empresas WHERE id = ?', nota.empresa_id);
  await provedor(nota.ambiente).cancelar({ nota, empresa, codigo, motivo: motivo.trim() });
  db.update('notas', nota.id, {
    status: 'cancelada',
    motivo_cancelamento: motivo.trim(),
    cancelada_em: new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 19).replace('T', ' '),
    pdf: null,
  });
}

async function obterPdf(nota) {
  if (nota.pdf) return Buffer.from(nota.pdf);
  const empresa = db.get('SELECT * FROM empresas WHERE id = ?', nota.empresa_id);
  const tomador = nota.tomador_id ? db.get('SELECT * FROM tomadores WHERE id = ?', nota.tomador_id) : null;

  let pdf = null;
  if (nota.ambiente !== 'simulacao' && nota.chave_acesso) {
    try {
      pdf = await provedor(nota.ambiente).danfse({ nota, empresa });
    } catch (e) {
      console.warn('DANFSe oficial indisponível, usando PDF próprio:', e.message);
    }
  }
  if (!pdf) pdf = await gerarPdf({ nota, empresa, tomador });
  // so guarda em cache o pdf de notas que nao mudam mais
  if (nota.status === 'emitida' || nota.status === 'cancelada') {
    db.run('UPDATE notas SET pdf = ? WHERE id = ?', pdf, nota.id);
  }
  return pdf;
}

module.exports = { criarNota, processarFila, iniciarFila, reenviar, cancelarNota, obterPdf };
