const simulado = require('./simulado');
const nacional = require('./nacional');

const provedores = {
  simulacao: simulado,
  homologacao: nacional.criar('homologacao'),
  producao: nacional.criar('producao'),
};

function provedor(ambiente) {
  const p = provedores[ambiente];
  if (!p) throw new Error('Ambiente de emissão desconhecido: ' + ambiente);
  return p;
}

module.exports = { provedor };
