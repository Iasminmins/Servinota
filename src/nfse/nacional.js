const https = require('node:https');
const zlib = require('node:zlib');
const { montarDps, montarCancelamento } = require('./dps');
const { assinarXml } = require('./assinatura');
const { certificadoDaEmpresa } = require('./certificado');

// API da NFS-e Nacional (Sefin Nacional + ADN). Autenticacao por certificado (mTLS).
const URLS = {
  producao: {
    sefin: 'https://sefin.nfse.gov.br/SefinNacional',
    adn: 'https://adn.nfse.gov.br',
  },
  homologacao: {
    sefin: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
    adn: 'https://adn.producaorestrita.nfse.gov.br',
  },
};

function requisicao(metodo, url, cert, corpo, binario = false) {
  return new Promise((resolve, reject) => {
    const dados = corpo ? Buffer.from(JSON.stringify(corpo), 'utf8') : null;
    const req = https.request(url, {
      method: metodo,
      pfx: cert.pfx,
      passphrase: cert.senha,
      timeout: 60000,
      headers: {
        Accept: binario ? 'application/pdf' : 'application/json',
        ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': dados.length } : {}),
      },
    }, res => {
      const partes = [];
      res.on('data', c => partes.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(partes);
        if (binario && res.statusCode === 200) return resolve({ status: 200, corpo: buf });
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch (e) { json = { texto: buf.toString('utf8').slice(0, 500) }; }
        resolve({ status: res.statusCode, corpo: json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tempo esgotado ao falar com a Sefin Nacional.')));
    req.on('error', reject);
    if (dados) req.write(dados);
    req.end();
  });
}

function gzipB64(xml) {
  return zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
}

function gunzipB64(b64) {
  return zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
}

// junta as mensagens de erro, a api usa nomes de campo diferentes dependendo da versao
function mensagemErro(r) {
  if (r.status === 401 || r.status === 403) {
    return 'Acesso negado pela Sefin Nacional (HTTP ' + r.status + '): o certificado não foi aceito. '
      + 'Use um certificado A1 ICP-Brasil válido, do CNPJ da empresa, e confira se o município já aderiu à NFS-e Nacional.';
  }
  if (r.status >= 500) return `A Sefin Nacional está instável (HTTP ${r.status}). Tente novamente em alguns minutos.`;
  const c = r.corpo || {};
  const lista = c.erros || c.Erros || c.erro || (c.mensagem ? [c] : null);
  if (Array.isArray(lista) && lista.length) {
    return lista.map(e => {
      const cod = e.Codigo || e.codigo || '';
      const desc = e.Descricao || e.descricao || e.mensagem || '';
      const comp = e.Complemento || e.complemento || '';
      return [cod, desc, comp].filter(Boolean).join(' - ');
    }).join(' | ');
  }
  if (c.texto) return `HTTP ${r.status}: ${c.texto}`;
  return `HTTP ${r.status}: ${JSON.stringify(c).slice(0, 400)}`;
}

function extrair(xml, tagNome) {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tagNome}[^>]*>([^<]*)</`));
  return m ? m[1] : null;
}

function criar(ambiente) {
  const urls = URLS[ambiente];
  const tpAmb = ambiente === 'producao' ? 1 : 2;

  return {
    nome: ambiente,

    async emitir({ nota, empresa, tomador }) {
      const cert = certificadoDaEmpresa(empresa);
      const { xml } = montarDps({ nota, empresa, tomador, tpAmb });
      const assinado = assinarXml(xml, 'infDPS', cert);

      const r = await requisicao('POST', `${urls.sefin}/nfse`, cert, { dpsXmlGZipB64: gzipB64(assinado) });
      const c = r.corpo || {};
      if ((r.status === 200 || r.status === 201) && c.chaveAcesso) {
        const xmlNfse = c.nfseXmlGZipB64 ? gunzipB64(c.nfseXmlGZipB64) : null;
        return {
          chave: c.chaveAcesso,
          numero: xmlNfse ? extrair(xmlNfse, 'nNFSe') : null,
          xmlDps: assinado,
          xmlNfse,
          alertas: c.alertas ? JSON.stringify(c.alertas) : null,
        };
      }
      const err = new Error(mensagemErro(r));
      err.xmlDps = assinado;
      err.rejeicao = r.status >= 400 && r.status < 500;
      throw err;
    },

    async cancelar({ nota, empresa, codigo, motivo }) {
      const cert = certificadoDaEmpresa(empresa);
      const { xml } = montarCancelamento({ chave: nota.chave_acesso, empresa, tpAmb, codigo, motivo });
      const assinado = assinarXml(xml, 'infPedReg', cert);
      const r = await requisicao('POST', `${urls.sefin}/nfse/${nota.chave_acesso}/eventos`, cert,
        { pedidoRegistroEventoXmlGZipB64: gzipB64(assinado) });
      if (r.status === 200 || r.status === 201) {
        const c = r.corpo || {};
        return { xmlEvento: c.eventoXmlGZipB64 ? gunzipB64(c.eventoXmlGZipB64) : assinado };
      }
      throw new Error(mensagemErro(r));
    },

    async consultar({ nota, empresa }) {
      const cert = certificadoDaEmpresa(empresa);
      const r = await requisicao('GET', `${urls.sefin}/nfse/${nota.chave_acesso}`, cert);
      if (r.status === 200 && r.corpo && r.corpo.nfseXmlGZipB64) {
        return { xmlNfse: gunzipB64(r.corpo.nfseXmlGZipB64) };
      }
      throw new Error(mensagemErro(r));
    },

    // PDF oficial (DANFSe) gerado pelo Ambiente de Dados Nacional
    async danfse({ nota, empresa }) {
      const cert = certificadoDaEmpresa(empresa);
      const r = await requisicao('GET', `${urls.adn}/danfse/${nota.chave_acesso}`, cert, null, true);
      if (r.status === 200 && Buffer.isBuffer(r.corpo) && r.corpo.subarray(0, 4).toString() === '%PDF') {
        return r.corpo;
      }
      throw new Error('DANFSe indisponível no ADN: ' + mensagemErro(r));
    },
  };
}

module.exports = { criar, URLS };
