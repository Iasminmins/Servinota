// Teste local: gera um certificado falso, monta uma DPS, assina e confere a assinatura.
// Uso: node scripts/teste-assinatura.js  (opcional: gera certificado-teste.pfx com senha 1234)
const fs = require('node:fs');
const path = require('node:path');
const forge = require('node-forge');
const { SignedXml } = require('xml-crypto');
const { lerPfx } = require('../src/nfse/certificado');
const { montarDps, montarCancelamento } = require('../src/nfse/dps');
const { assinarXml } = require('../src/nfse/assinatura');

function gerarPfx(cnpj, senha) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ name: 'commonName', value: `EMPRESA TESTE LTDA:${cnpj}` }, { name: 'countryName', value: 'BR' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

const cnpj = '11222333000181';
const pfx = gerarPfx(cnpj, '1234');
if (process.argv.includes('--salvar')) {
  fs.writeFileSync(path.join(__dirname, 'certificado-teste.pfx'), pfx);
  console.log('certificado-teste.pfx salvo (senha 1234)');
}
const cert = lerPfx(pfx, '1234');
console.log('Titular:', cert.titular, '| CNPJ:', cert.cnpj);

const empresa = { cnpj, cod_municipio: '3306305', op_simples: 3, reg_esp_trib: 0, p_tot_trib_sn: 6, email: 'a@b.com', im: '' };
const tomador = { documento: '52998224725', nome: 'Fulano de Tal', cep: '27253005', logradouro: 'Rua A', numero: '10', bairro: 'Centro', cod_municipio: '3306305', email: 'f@t.com' };
const nota = { serie: '1', numero_dps: 7, competencia: '2026-11-19', descricao: 'Consultoria & suporte <teste>', cod_trib_nac: '010101', valor: 1500, aliquota: 2, iss_retido: 0 };

const { id, xml } = montarDps({ nota, empresa, tomador, tpAmb: 2 });
console.log('Id DPS:', id, '(' + id.length + ' caracteres)');
const assinado = assinarXml(xml, 'infDPS', cert);

const ver = new SignedXml({ publicCert: cert.certPem });
const sigNode = assinado.match(/<Signature[\s\S]*<\/Signature>/)[0];
ver.loadSignature(sigNode);
const ok = ver.checkSignature(assinado);
console.log('Assinatura DPS válida:', ok);
if (!ok) process.exit(1);

const canc = montarCancelamento({ chave: '3'.repeat(50), empresa, tpAmb: 2, codigo: 1, motivo: 'Erro no valor do serviço' });
const cancAss = assinarXml(canc.xml, 'infPedReg', cert);
const ver2 = new SignedXml({ publicCert: cert.certPem });
ver2.loadSignature(cancAss.match(/<Signature[\s\S]*<\/Signature>/)[0]);
console.log('Assinatura cancelamento válida:', ver2.checkSignature(cancAss));
console.log('\n' + assinado.slice(0, 900) + '...');
