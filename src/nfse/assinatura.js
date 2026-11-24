const { SignedXml } = require('xml-crypto');

// assinatura XMLDSig envelopada, igual ao padrao da NF-e/NFS-e nacional
function assinarXml(xml, tagAssinada, cert) {
  const sig = new SignedXml({
    privateKey: cert.keyPem,
    publicCert: cert.certPem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  });

  sig.addReference({
    xpath: `//*[local-name(.)='${tagAssinada}']`,
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });

  // o KeyInfo so precisa do certificado (sem as linhas BEGIN/END)
  sig.getKeyInfoContent = () => {
    const b64 = cert.certPem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    return `<X509Data><X509Certificate>${b64}</X509Certificate></X509Data>`;
  };

  sig.computeSignature(xml, {
    location: { reference: `//*[local-name(.)='${tagAssinada}']`, action: 'after' },
  });
  return sig.getSignedXml();
}

module.exports = { assinarXml };
