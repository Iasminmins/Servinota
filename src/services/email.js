const nodemailer = require('nodemailer');
const db = require('../db');
const { decryptText } = require('../cripto');
const u = require('../util');

function transporteDoEscritorio(esc) {
  if (!esc.smtp_host) throw new Error('O SMTP do escritório não está configurado (Configurações > E-mail).');
  return nodemailer.createTransport({
    host: esc.smtp_host,
    port: Number(esc.smtp_port) || 587,
    secure: !!esc.smtp_seguro,
    auth: esc.smtp_usuario ? { user: esc.smtp_usuario, pass: decryptText(esc.smtp_senha) } : undefined,
  });
}

function preencher(modelo, v) {
  return String(modelo || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m));
}

async function enviarNota(notaId, destinoExtra) {
  const nota = db.get('SELECT * FROM notas WHERE id = ?', notaId);
  if (!nota) throw new Error('Nota não encontrada.');
  if (nota.status !== 'emitida' && nota.status !== 'cancelada') throw new Error('A nota ainda não foi emitida.');
  const esc = db.get('SELECT * FROM escritorios WHERE id = ?', nota.escritorio_id);
  const empresa = db.get('SELECT * FROM empresas WHERE id = ?', nota.empresa_id);
  const tomador = nota.tomador_id ? db.get('SELECT * FROM tomadores WHERE id = ?', nota.tomador_id) : null;

  const destino = destinoExtra || (tomador && tomador.email);
  if (!destino) throw new Error('O tomador não tem e-mail cadastrado.');

  const vars = {
    numero: nota.numero_nfse || nota.numero_dps,
    prestador: empresa.nome_fantasia || empresa.razao_social,
    tomador: tomador ? tomador.nome : '',
    valor: u.fmtMoeda(nota.valor),
    competencia: u.fmtCompetencia(nota.competencia),
    chave: nota.chave_acesso || '',
    escritorio: esc.nome,
  };
  const assunto = preencher(esc.email_assunto || 'NFS-e nº {numero} - {prestador}', vars);
  const corpo = preencher(esc.email_corpo || 'Segue em anexo a NFS-e nº {numero}.', vars);

  const pdf = await require('./emissao').obterPdf(nota);
  const nomeBase = `NFSe_${vars.numero}_${u.soNumeros(empresa.cnpj)}`;

  const transp = transporteDoEscritorio(esc);
  await transp.sendMail({
    from: esc.smtp_remetente || esc.smtp_usuario,
    replyTo: empresa.email || esc.email || undefined,
    to: destino,
    subject: assunto,
    text: corpo,
    attachments: [
      { filename: nomeBase + '.pdf', content: pdf },
      ...(nota.xml_nfse ? [{ filename: nomeBase + '.xml', content: nota.xml_nfse }] : []),
    ],
  });

  db.run("UPDATE notas SET email_enviado_em = datetime('now','localtime') WHERE id = ?", notaId);
  return destino;
}

async function testarSmtp(esc, para) {
  const transp = transporteDoEscritorio(esc);
  await transp.verify();
  await transp.sendMail({
    from: esc.smtp_remetente || esc.smtp_usuario,
    to: para,
    subject: 'Teste de e-mail - Servinota',
    text: 'Se você recebeu esta mensagem, o envio de e-mails do Servinota está funcionando.',
  });
}

module.exports = { enviarNota, testarSmtp };
