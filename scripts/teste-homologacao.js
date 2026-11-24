// manda uma nota da empresa 1 para a producao restrita e mostra a resposta
// (com o certificado de teste a Sefin recusa, serve pra conferir conexao e tratamento de erro)
const db = require('../src/db');
const { provedor } = require('../src/nfse');

(async () => {
  const empId = Number(process.argv[2] || 1);
  const empresa = db.get('SELECT * FROM empresas WHERE id = ?', empId);
  const tomador = db.get('SELECT * FROM tomadores WHERE empresa_id = ? LIMIT 1', empId);
  const nota = {
    serie: '900', numero_dps: Math.floor(Date.now() / 1000) % 100000, competencia: new Date().toISOString().slice(0, 10),
    descricao: 'Teste de comunicacao com a producao restrita', cod_trib_nac: empresa.cod_trib_nac_padrao || '010101',
    valor: 10, aliquota: 2, iss_retido: 0,
  };
  try {
    const r = await provedor('homologacao').emitir({ nota, empresa, tomador });
    console.log('AUTORIZADA:', r.chave, r.numero);
  } catch (e) {
    console.log('Resposta da Sefin:', e.message);
  }
})();
