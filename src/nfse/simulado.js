const crypto = require('node:crypto');
const { montarDps } = require('./dps');
const { soNumeros, escXml, agoraBrasilia } = require('../util');

// "emissor" de mentira pra testar o sistema todo sem certificado e sem valor fiscal
function chaveFake(empresa, numero) {
  const cMun = soNumeros(empresa.cod_municipio).padStart(7, '0');
  const cnpj = soNumeros(empresa.cnpj).padStart(14, '0');
  const aamm = agoraBrasilia().slice(2, 7).replace('-', '');
  const aleat = String(crypto.randomInt(0, 999999999)).padStart(9, '0');
  const base = cMun + '2' + '2' + cnpj + String(numero).padStart(13, '0') + aamm + aleat;
  // digito verificador modulo 11
  let soma = 0, peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return base + (r < 2 ? 0 : 11 - r);
}

module.exports = {
  nome: 'simulacao',

  async emitir({ nota, empresa, tomador }) {
    const { xml } = montarDps({ nota, empresa, tomador, tpAmb: 2 });
    await new Promise(r => setTimeout(r, 400));
    const numero = String(nota.numero_dps);
    const chave = chaveFake(empresa, numero);
    const xmlNfse = '<?xml version="1.0" encoding="UTF-8"?>'
      + '<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">'
      + `<infNFSe Id="NFS${chave}">`
      + `<xLocEmi>${escXml(empresa.municipio || '')}</xLocEmi>`
      + `<nNFSe>${numero}</nNFSe>`
      + `<dhProc>${agoraBrasilia()}</dhProc>`
      + '<xObs>SIMULACAO - DOCUMENTO SEM VALOR FISCAL</xObs>'
      + xml.replace(/^<\?xml[^>]*\?>/, '')
      + '</infNFSe></NFSe>';
    return { chave, numero, xmlDps: xml, xmlNfse };
  },

  async cancelar() {
    await new Promise(r => setTimeout(r, 200));
    return { xmlEvento: null };
  },

  async consultar({ nota }) {
    return { xmlNfse: nota.xml_nfse };
  },

  async danfse() {
    throw new Error('Simulação não tem DANFSe oficial.');
  },
};
