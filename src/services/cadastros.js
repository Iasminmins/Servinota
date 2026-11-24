const u = require('../util');

const txt = (v, max = 255) => (v == null ? '' : String(v).trim().slice(0, max)) || null;

function lerEmpresa(b) {
  const erros = [];
  const d = {
    razao_social: txt(b.razao_social),
    nome_fantasia: txt(b.nome_fantasia),
    cnpj: u.soNumeros(b.cnpj),
    im: txt(u.soNumeros(b.im), 20),
    email: txt(b.email),
    telefone: txt(b.telefone, 20),
    cep: u.soNumeros(b.cep) || null,
    logradouro: txt(b.logradouro),
    numero: txt(b.numero, 20),
    complemento: txt(b.complemento),
    bairro: txt(b.bairro),
    cod_municipio: u.soNumeros(b.cod_municipio) || null,
    municipio: txt(b.municipio),
    uf: b.uf ? String(b.uf).trim().toUpperCase().slice(0, 2) : null,
    op_simples: Number(b.op_simples) || 1,
    reg_esp_trib: Number(b.reg_esp_trib) || 0,
    p_tot_trib_sn: b.p_tot_trib_sn ? u.parseValor(b.p_tot_trib_sn) : null,
    informar_aliquota: b.informar_aliquota ? 1 : 0,
    serie: u.soNumeros(b.serie) || '1',
    proximo_numero: Number(u.soNumeros(b.proximo_numero)) || 1,
    ambiente: ['simulacao', 'homologacao', 'producao'].includes(b.ambiente) ? b.ambiente : 'simulacao',
    aliquota_padrao: b.aliquota_padrao ? u.parseValor(b.aliquota_padrao) : null,
    cod_trib_nac_padrao: u.soNumeros(b.cod_trib_nac_padrao) || null,
    portal_pode_emitir: b.portal_pode_emitir ? 1 : 0,
  };
  if (!d.razao_social) erros.push('Razão social é obrigatória.');
  if (!u.validaDocumento(d.cnpj)) erros.push('CNPJ/CPF inválido.');
  if (!d.cod_municipio || d.cod_municipio.length !== 7) erros.push('Informe o código IBGE do município (7 dígitos). A busca por CEP preenche sozinho.');
  if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) erros.push('E-mail da empresa inválido.');
  if (d.serie.length > 5) erros.push('A série pode ter no máximo 5 dígitos.');
  if (d.aliquota_padrao != null && (isNaN(d.aliquota_padrao) || d.aliquota_padrao < 0 || d.aliquota_padrao > 5)) {
    erros.push('Alíquota de ISS deve ficar entre 0% e 5%.');
  }
  if (d.cod_trib_nac_padrao && d.cod_trib_nac_padrao.length !== 6) erros.push('Código de tributação nacional tem 6 dígitos.');
  return { d, erros };
}

function lerTomador(b) {
  const erros = [];
  const d = {
    documento: u.soNumeros(b.documento),
    nome: txt(b.nome, 300),
    email: txt(b.email),
    telefone: txt(b.telefone, 20),
    cep: u.soNumeros(b.cep) || null,
    logradouro: txt(b.logradouro),
    numero: txt(b.numero, 20),
    complemento: txt(b.complemento),
    bairro: txt(b.bairro),
    cod_municipio: u.soNumeros(b.cod_municipio) || null,
    municipio: txt(b.municipio),
    uf: b.uf ? String(b.uf).trim().toUpperCase().slice(0, 2) : null,
  };
  if (!u.validaDocumento(d.documento)) erros.push('CPF/CNPJ do tomador inválido.');
  if (!d.nome) erros.push('Nome do tomador é obrigatório.');
  if (d.email && !/^\S+@\S+\.\S+$/.test(d.email.split(/[;,]/)[0].trim())) erros.push('E-mail do tomador inválido.');
  if (d.cep && d.cep.length !== 8) erros.push('CEP inválido.');
  if (d.cep && (!d.cod_municipio || d.cod_municipio.length !== 7)) erros.push('Com CEP informado, o código IBGE do município também é necessário.');
  return { d, erros };
}

function lerServico(b) {
  const erros = [];
  const d = {
    descricao: txt(b.descricao, 2000),
    cod_trib_nac: u.soNumeros(b.cod_trib_nac),
    cod_nbs: u.soNumeros(b.cod_nbs) || null,
    valor: b.valor ? u.parseValor(b.valor) : null,
    aliquota: b.aliquota ? u.parseValor(b.aliquota) : null,
    iss_retido: b.iss_retido ? 1 : 0,
  };
  if (!d.descricao) erros.push('Descrição é obrigatória.');
  if (d.cod_trib_nac.length !== 6) erros.push('Código de tributação nacional precisa ter 6 dígitos.');
  if (d.valor != null && isNaN(d.valor)) erros.push('Valor inválido.');
  if (d.aliquota != null && (isNaN(d.aliquota) || d.aliquota > 5)) erros.push('Alíquota inválida.');
  return { d, erros };
}

// dados de uma nota vindos do formulario (manual ou portal)
function lerNota(b, empresa) {
  const erros = [];
  const d = {
    competencia: /^\d{4}-\d{2}-\d{2}$/.test(b.competencia || '') ? b.competencia : u.hojeISO(),
    descricao: txt(b.descricao, 2000),
    cod_trib_nac: u.soNumeros(b.cod_trib_nac) || empresa.cod_trib_nac_padrao,
    cod_nbs: u.soNumeros(b.cod_nbs) || null,
    cod_mun_prestacao: u.soNumeros(b.cod_mun_prestacao) || empresa.cod_municipio,
    valor: u.parseValor(b.valor),
    aliquota: b.aliquota !== undefined && b.aliquota !== '' ? u.parseValor(b.aliquota) : empresa.aliquota_padrao,
    iss_retido: b.iss_retido ? 1 : 0,
    enviar_email: b.enviar_email ? 1 : 0,
  };
  if (!d.descricao || d.descricao.length < 3) erros.push('Descreva o serviço prestado.');
  if (!(d.valor > 0)) erros.push('Informe um valor maior que zero.');
  if (!d.cod_trib_nac || d.cod_trib_nac.length !== 6) erros.push('Código de tributação nacional inválido (6 dígitos).');
  if (d.aliquota != null && isNaN(d.aliquota)) erros.push('Alíquota inválida.');
  if (d.competencia > u.hojeISO()) erros.push('A competência não pode ser uma data futura.');
  return { d, erros };
}

module.exports = { lerEmpresa, lerTomador, lerServico, lerNota };
