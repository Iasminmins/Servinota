function soNumeros(v) {
  return String(v == null ? '' : v).replace(/\D/g, '');
}

function validaCPF(cpf) {
  cpf = soNumeros(cpf);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  for (let t = 9; t < 11; t++) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(cpf[i]) * (t + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(cpf[t])) return false;
  }
  return true;
}

function validaCNPJ(cnpj) {
  cnpj = soNumeros(cnpj);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const calc = (base) => {
    const pesos = base.length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(cnpj.slice(0, 12));
  const d2 = calc(cnpj.slice(0, 12) + d1);
  return d1 === Number(cnpj[12]) && d2 === Number(cnpj[13]);
}

function validaDocumento(doc) {
  const d = soNumeros(doc);
  return d.length === 11 ? validaCPF(d) : validaCNPJ(d);
}

function fmtDoc(doc) {
  const d = soNumeros(doc);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return doc || '';
}

function fmtCep(cep) {
  const d = soNumeros(cep);
  return d.length === 8 ? d.replace(/^(\d{5})(\d{3})$/, '$1-$2') : (cep || '');
}

function fmtMoeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtNum(v, casas = 2) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

// aceita "1.234,56", "1234,56" ou "1234.56"
function parseValor(v) {
  if (typeof v === 'number') return v;
  let s = String(v == null ? '' : v).trim().replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return Number(s);
}

function arred(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

function fmtData(iso) {
  if (!iso) return '';
  const s = String(iso);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}` + (m[4] ? ` ${m[4]}:${m[5]}` : '');
}

function fmtCompetencia(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : iso;
}

// data/hora no fuso de Brasilia (sem horario de verao desde 2019)
function agoraBrasilia(offsetMin = 0) {
  const d = new Date(Date.now() - 3 * 3600000 + offsetMin * 60000);
  return d.toISOString().slice(0, 19) + '-03:00';
}

function hojeISO() {
  return agoraBrasilia().slice(0, 10);
}

function ultimoDiaMes(ano, mes) {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function limparTexto(s, max) {
  let t = String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (max) t = t.slice(0, max);
  return t;
}

const STATUS = {
  pendente: { txt: 'Na fila', cls: 'cinza' },
  processando: { txt: 'Processando', cls: 'azul' },
  emitida: { txt: 'Emitida', cls: 'verde' },
  erro: { txt: 'Erro', cls: 'vermelho' },
  cancelada: { txt: 'Cancelada', cls: 'laranja' },
};

const AMBIENTES = {
  simulacao: 'Simulação (sem valor fiscal)',
  homologacao: 'Homologação (produção restrita)',
  producao: 'Produção',
};

module.exports = {
  soNumeros, validaCPF, validaCNPJ, validaDocumento, fmtDoc, fmtCep, fmtMoeda, fmtNum,
  parseValor, arred, fmtData, fmtCompetencia, agoraBrasilia, hojeISO, ultimoDiaMes,
  escXml, limparTexto, STATUS, AMBIENTES,
};
