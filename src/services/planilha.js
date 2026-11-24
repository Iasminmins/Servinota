const ExcelJS = require('exceljs');

const COLUNAS = [
  { key: 'documento', titulo: 'CPF/CNPJ do tomador', obrig: true, ex: '11.222.333/0001-81' },
  { key: 'nome', titulo: 'Nome do tomador', obrig: true, ex: 'Cliente Exemplo Ltda' },
  { key: 'email', titulo: 'E-mail', ex: 'financeiro@cliente.com.br' },
  { key: 'cep', titulo: 'CEP', ex: '27253-005' },
  { key: 'logradouro', titulo: 'Logradouro', ex: 'Rua Exemplo' },
  { key: 'numero', titulo: 'Número', ex: '100' },
  { key: 'bairro', titulo: 'Bairro', ex: 'Centro' },
  { key: 'cod_municipio', titulo: 'Cód. IBGE município', ex: '3306305' },
  { key: 'uf', titulo: 'UF', ex: 'RJ' },
  { key: 'descricao', titulo: 'Descrição do serviço', obrig: true, ex: 'Consultoria em TI referente a 11/2026' },
  { key: 'valor', titulo: 'Valor', obrig: true, ex: '1500,00' },
  { key: 'cod_trib_nac', titulo: 'Cód. tributação nacional', ex: '010101' },
  { key: 'aliquota', titulo: 'Alíquota ISS (%)', ex: '2' },
  { key: 'iss_retido', titulo: 'ISS retido (S/N)', ex: 'N' },
  { key: 'competencia', titulo: 'Competência (dd/mm/aaaa)', ex: '' },
];

function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// aceita tanto o titulo bonito quanto a chave (documento, nome, valor...)
const MAPA = {};
for (const c of COLUNAS) {
  MAPA[normalizar(c.titulo)] = c.key;
  MAPA[normalizar(c.key)] = c.key;
}
Object.assign(MAPA, {
  cpf: 'documento', cnpj: 'documento', cpfcnpj: 'documento', tomador: 'nome', razaosocial: 'nome',
  servico: 'descricao', discriminacao: 'descricao', valorservico: 'valor', ibge: 'cod_municipio',
  codigomunicipio: 'cod_municipio', aliquota: 'aliquota', issretido: 'iss_retido', ctribnac: 'cod_trib_nac',
});

function valorCelula(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.text) return String(v.text);
    if (v.result != null) return valorCelula(v.result);
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.hyperlink) return String(v.text || v.hyperlink).replace(/^mailto:/, '');
  }
  return String(v).trim();
}

function lerCsv(texto) {
  texto = texto.replace(/^﻿/, '');
  const sep = (texto.split('\n')[0].match(/;/g) || []).length >= (texto.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const linhas = [];
  let atual = [], campo = '', aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { atual.push(campo); campo = ''; }
    else if (ch === '\n') { atual.push(campo.replace(/\r$/, '')); linhas.push(atual); atual = []; campo = ''; }
    else campo += ch;
  }
  if (campo || atual.length) { atual.push(campo); linhas.push(atual); }
  return linhas;
}

async function lerPlanilha(buffer, nomeArquivo) {
  let linhas;
  if (/\.csv$/i.test(nomeArquivo)) {
    linhas = lerCsv(buffer.toString('utf8'));
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('Planilha vazia.');
    linhas = [];
    ws.eachRow({ includeEmpty: false }, row => {
      const vals = [];
      for (let c = 1; c <= ws.columnCount; c++) vals.push(valorCelula(row.getCell(c).value));
      linhas.push(vals);
    });
  }
  if (linhas.length < 2) throw new Error('A planilha precisa ter o cabeçalho e pelo menos uma linha.');

  const cab = linhas[0].map(h => MAPA[normalizar(h)] || null);
  if (!cab.includes('documento') || !cab.includes('valor')) {
    throw new Error('Não encontrei as colunas obrigatórias (CPF/CNPJ do tomador e Valor). Use o modelo para download.');
  }
  return linhas.slice(1)
    .filter(l => l.some(v => String(v).trim() !== ''))
    .map((l, i) => {
      const obj = { linha: i + 2 };
      cab.forEach((k, idx) => { if (k) obj[k] = String(l[idx] == null ? '' : l[idx]).trim(); });
      return obj;
    });
}

async function modeloXlsx() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Notas');
  ws.columns = COLUNAS.map(c => ({ header: c.titulo, key: c.key, width: Math.max(16, c.titulo.length + 4) }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
  const ex = {};
  COLUNAS.forEach(c => { ex[c.key] = c.ex; });
  ws.addRow(ex);
  const inst = wb.addWorksheet('Instruções');
  inst.columns = [{ header: 'Coluna', width: 30 }, { header: 'Obrigatória', width: 12 }, { header: 'Exemplo', width: 40 }];
  inst.getRow(1).font = { bold: true };
  COLUNAS.forEach(c => inst.addRow([c.titulo, c.obrig ? 'Sim' : 'Não', c.ex]));
  inst.addRow([]);
  inst.addRow(['Se o tomador ainda não existir ele é cadastrado automaticamente.']);
  inst.addRow(['Código de tributação e alíquota em branco usam o padrão da empresa.']);
  inst.addRow(['Competência em branco usa a data de hoje.']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { lerPlanilha, modeloXlsx, COLUNAS };
