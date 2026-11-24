const config = require('../config');
const { soNumeros, escXml, limparTexto, agoraBrasilia, arred } = require('../util');

const NS = 'http://www.sped.fazenda.gov.br/nfse';

function tag(nome, valor) {
  if (valor === undefined || valor === null || valor === '') return '';
  return `<${nome}>${escXml(valor)}</${nome}>`;
}

function docTag(doc) {
  const d = soNumeros(doc);
  return d.length === 11 ? tag('CPF', d) : tag('CNPJ', d);
}

function dec(v) {
  return arred(v).toFixed(2);
}

// Id da DPS: "DPS" + cMun(7) + tipo inscricao(1) + inscricao(14) + serie(5) + numero(15)
function idDps(empresa, serie, numero) {
  const cnpj = soNumeros(empresa.cnpj);
  const tpInsc = cnpj.length === 11 ? '1' : '2';
  return 'DPS'
    + soNumeros(empresa.cod_municipio).padStart(7, '0')
    + tpInsc
    + cnpj.padStart(14, '0')
    + soNumeros(serie).padStart(5, '0')
    + String(numero).padStart(15, '0');
}

function validar(nota, empresa, tomador) {
  const erros = [];
  if (soNumeros(empresa.cod_municipio).length !== 7) erros.push('Código IBGE do município da empresa inválido.');
  if (!/^\d{6}$/.test(soNumeros(nota.cod_trib_nac))) erros.push('Código de tributação nacional precisa ter 6 dígitos (ex.: 010101).');
  if (!(nota.valor > 0)) erros.push('Valor do serviço precisa ser maior que zero.');
  if (!nota.descricao || nota.descricao.trim().length < 3) erros.push('Descrição do serviço é obrigatória.');
  if (tomador) {
    if (!tomador.nome) erros.push('Nome do tomador é obrigatório.');
    if (tomador.cep && soNumeros(tomador.cod_municipio).length !== 7) {
      erros.push('Código IBGE do município do tomador inválido (use a busca por CEP).');
    }
  }
  if (erros.length) throw new Error(erros.join(' '));
}

function montarDps({ nota, empresa, tomador, tpAmb }) {
  validar(nota, empresa, tomador);

  const id = idDps(empresa, nota.serie, nota.numero_dps);
  const cMun = soNumeros(empresa.cod_municipio);
  // 1 minuto pra tras evita rejeicao por relogio adiantado
  const dhEmi = agoraBrasilia(-1);

  const opSimples = Number(empresa.op_simples) || 1;
  let regTrib = tag('opSimpNac', opSimples);
  if (opSimples === 3) regTrib += tag('regApTribSN', 1);
  regTrib += tag('regEspTrib', Number(empresa.reg_esp_trib) || 0);

  const prest = '<prest>'
    + docTag(empresa.cnpj)
    + tag('IM', soNumeros(empresa.im))
    + tag('fone', soNumeros(empresa.telefone).slice(0, 20) || null)
    + tag('email', empresa.email)
    + `<regTrib>${regTrib}</regTrib>`
    + '</prest>';

  let toma = '';
  if (tomador) {
    let end = '';
    if (tomador.cep && tomador.logradouro) {
      end = '<end>'
        + `<endNac>${tag('cMun', soNumeros(tomador.cod_municipio))}${tag('CEP', soNumeros(tomador.cep))}</endNac>`
        + tag('xLgr', limparTexto(tomador.logradouro, 255))
        + tag('nro', limparTexto(tomador.numero || 'S/N', 60))
        + tag('xCpl', limparTexto(tomador.complemento, 156))
        + tag('xBairro', limparTexto(tomador.bairro || 'Centro', 60))
        + '</end>';
    }
    toma = '<toma>'
      + docTag(tomador.documento)
      + tag('xNome', limparTexto(tomador.nome, 300))
      + end
      + tag('fone', soNumeros(tomador.telefone).slice(0, 20) || null)
      + tag('email', tomador.email)
      + '</toma>';
  }

  const serv = '<serv>'
    + `<locPrest>${tag('cLocPrestacao', soNumeros(nota.cod_mun_prestacao) || cMun)}</locPrest>`
    + '<cServ>'
    + tag('cTribNac', soNumeros(nota.cod_trib_nac))
    + tag('xDescServ', limparTexto(nota.descricao, 2000))
    + tag('cNBS', soNumeros(nota.cod_nbs))
    + '</cServ>'
    + '</serv>';

  const retido = Number(nota.iss_retido) ? 2 : 1;
  let tribMun = tag('tribISSQN', 1);
  if (Number(empresa.informar_aliquota) || retido === 2) {
    if (nota.aliquota) tribMun += tag('pAliq', dec(nota.aliquota));
  }
  tribMun += tag('tpRetISSQN', retido);

  let totTrib;
  if (opSimples === 3 && empresa.p_tot_trib_sn) totTrib = tag('pTotTribSN', dec(empresa.p_tot_trib_sn));
  else totTrib = tag('indTotTrib', 0);

  const valores = '<valores>'
    + `<vServPrest>${tag('vServ', dec(nota.valor))}</vServPrest>`
    + `<trib><tribMun>${tribMun}</tribMun><totTrib>${totTrib}</totTrib></trib>`
    + '</valores>';

  const xml = '<?xml version="1.0" encoding="UTF-8"?>'
    + `<DPS xmlns="${NS}" versao="${config.versaoDps}">`
    + `<infDPS Id="${id}">`
    + tag('tpAmb', tpAmb)
    + tag('dhEmi', dhEmi)
    + tag('verAplic', config.verAplic)
    + tag('serie', soNumeros(nota.serie) || '1')
    + tag('nDPS', nota.numero_dps)
    + tag('dCompet', nota.competencia)
    + tag('tpEmit', 1)
    + tag('cLocEmi', cMun)
    + prest + toma + serv + valores
    + '</infDPS></DPS>';

  return { id, xml };
}

// pedido de cancelamento (evento 101101)
function montarCancelamento({ chave, empresa, tpAmb, codigo, motivo }) {
  const nPed = '001';
  const id = `PRE${chave}101101${nPed}`;
  const cnpj = soNumeros(empresa.cnpj);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>'
    + `<pedRegEvento xmlns="${NS}" versao="${config.versaoDps}">`
    + `<infPedReg Id="${id}">`
    + tag('tpAmb', tpAmb)
    + tag('verAplic', config.verAplic)
    + tag('dhEvento', agoraBrasilia(-1))
    + (cnpj.length === 11 ? tag('CPFAutor', cnpj) : tag('CNPJAutor', cnpj))
    + tag('chNFSe', chave)
    + tag('nPedRegEvento', Number(nPed))
    + '<e101101>'
    + tag('xDesc', 'Cancelamento de NFS-e')
    + tag('cMotivo', codigo || 1)
    + tag('xMotivo', limparTexto(motivo, 255))
    + '</e101101>'
    + '</infPedReg></pedRegEvento>';
  return { id, xml };
}

module.exports = { montarDps, montarCancelamento, idDps, validar };
