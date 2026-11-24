const forge = require('node-forge');
const tls = require('node:tls');
const { decrypt, decryptText } = require('../cripto');

// le um certificado A1 (.pfx/.p12) e devolve chave/certificado em PEM
function lerPfx(buffer, senha) {
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(buffer.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  } catch (e) {
    // alguns pfx novos usam algoritmos que o forge nao entende; o node valida a senha mesmo assim
    try {
      tls.createSecureContext({ pfx: buffer, passphrase: senha });
    } catch (e2) {
      throw new Error('Não foi possível abrir o certificado. Confira a senha e se o arquivo é um .pfx/.p12 válido.');
    }
    throw new Error('Certificado com formato não suportado para assinatura. Exporte o .pfx novamente usando "TripleDES-SHA1" e tente de novo.');
  }

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  const keyBags2 = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [];
  const keyBag = keyBags[0] || keyBags2[0];
  if (!keyBag || !keyBag.key) throw new Error('O arquivo não contém a chave privada do certificado.');

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  // o certificado do titular e o que bate com a chave privada
  const pub = forge.pki.setRsaPublicKey(keyBag.key.n, keyBag.key.e);
  const pubPem = forge.pki.publicKeyToPem(pub);
  const bag = certBags.find(b => b.cert && forge.pki.publicKeyToPem(b.cert.publicKey) === pubPem) || certBags[0];
  if (!bag) throw new Error('O arquivo não contém o certificado.');

  const cert = bag.cert;
  const cn = (cert.subject.getField('CN') || {}).value || '';
  const cnpj = (cn.match(/:(\d{14})$/) || [])[1] || null;

  return {
    keyPem: forge.pki.privateKeyToPem(keyBag.key),
    certPem: forge.pki.certificateToPem(cert),
    titular: cn,
    cnpj,
    validoDe: cert.validity.notBefore,
    validoAte: cert.validity.notAfter,
  };
}

// carrega o certificado salvo (criptografado) da empresa
function certificadoDaEmpresa(empresa) {
  if (!empresa.cert_pfx) throw new Error('A empresa não tem certificado digital A1 cadastrado.');
  const pfx = decrypt(empresa.cert_pfx);
  const senha = decryptText(empresa.cert_senha);
  const info = lerPfx(pfx, senha);
  if (info.validoAte < new Date()) throw new Error('O certificado digital da empresa está vencido.');
  return { pfx, senha, ...info };
}

module.exports = { lerPfx, certificadoDaEmpresa };
