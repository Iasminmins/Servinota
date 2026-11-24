const PDFDocument = require('pdfkit');
const u = require('../util');

// PDF proprio da nota (usado na simulacao ou quando o DANFSe oficial nao estiver disponivel)
function gerarPdf({ nota, empresa, tomador }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36 });
    const partes = [];
    doc.on('data', c => partes.push(c));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const L = 36, W = doc.page.width - 72;
    const cinza = '#555';

    function caixa(y, h, titulo) {
      doc.lineWidth(0.6).rect(L, y, W, h).stroke('#999');
      if (titulo) {
        doc.rect(L, y, W, 14).fill('#eee');
        doc.fillColor('#222').font('Helvetica-Bold').fontSize(8).text(titulo, L + 6, y + 3.5);
      }
    }
    function campo(rotulo, valor, x, y, w) {
      doc.fillColor(cinza).font('Helvetica').fontSize(7).text(rotulo, x, y, { width: w });
      doc.fillColor('#000').font('Helvetica').fontSize(9).text(valor || '-', x, y + 9, { width: w });
    }

    if (nota.ambiente !== 'producao') {
      doc.save().rotate(-35, { origin: [300, 420] }).fillColor('#e33').opacity(0.12)
        .font('Helvetica-Bold').fontSize(60)
        .text(nota.ambiente === 'simulacao' ? 'SIMULAÇÃO' : 'HOMOLOGAÇÃO', 60, 380, { width: 480, align: 'center' })
        .fontSize(22).text('SEM VALOR FISCAL', 60, 450, { width: 480, align: 'center' })
        .restore();
      doc.opacity(1);
    }

    // cabecalho
    let y = 36;
    caixa(y, 70);
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(13).text('NFS-e', L + 8, y + 8);
    doc.font('Helvetica').fontSize(8).fillColor(cinza).text('Nota Fiscal de Serviço eletrônica', L + 8, y + 24);
    doc.text(nota.cancelada_em ? 'NOTA CANCELADA' : '', L + 8, y + 36);
    campo('Número da NFS-e', nota.numero_nfse || '-', L + 200, y + 8, 110);
    campo('Competência', u.fmtCompetencia(nota.competencia), L + 320, y + 8, 90);
    campo('Emissão', u.fmtData(nota.emitida_em), L + 420, y + 8, 100);
    campo('Chave de acesso', nota.chave_acesso || '-', L + 200, y + 38, W - 210);
    if (nota.cancelada_em) {
      doc.fillColor('#c00').font('Helvetica-Bold').fontSize(10).text('CANCELADA', L + 8, y + 50);
    }

    // prestador
    y += 80;
    caixa(y, 72, 'PRESTADOR DE SERVIÇOS');
    campo('Razão social', empresa.razao_social, L + 6, y + 18, 330);
    campo('CNPJ/CPF', u.fmtDoc(empresa.cnpj), L + 345, y + 18, 100);
    campo('Inscrição municipal', empresa.im, L + 450, y + 18, 70);
    const endP = [empresa.logradouro, empresa.numero, empresa.complemento, empresa.bairro].filter(Boolean).join(', ');
    campo('Endereço', endP, L + 6, y + 44, 260);
    campo('Município', [empresa.municipio, empresa.uf].filter(Boolean).join(' - '), L + 275, y + 44, 110);
    campo('E-mail', empresa.email, L + 395, y + 44, W - 401);

    // tomador
    y += 82;
    caixa(y, 72, 'TOMADOR DE SERVIÇOS');
    if (tomador) {
      campo('Nome / razão social', tomador.nome, L + 6, y + 18, 330);
      campo('CNPJ/CPF', u.fmtDoc(tomador.documento), L + 345, y + 18, 170);
      const endT = [tomador.logradouro, tomador.numero, tomador.complemento, tomador.bairro].filter(Boolean).join(', ');
      campo('Endereço', endT, L + 6, y + 44, 260);
      campo('Município', [tomador.municipio, tomador.uf].filter(Boolean).join(' - '), L + 275, y + 44, 110);
      campo('E-mail', tomador.email, L + 395, y + 44, W - 401);
    } else {
      doc.fillColor('#000').fontSize(9).text('Tomador não identificado', L + 6, y + 24);
    }

    // servico
    y += 82;
    caixa(y, 46, 'SERVIÇO');
    campo('Código de tributação nacional', nota.cod_trib_nac, L + 6, y + 18, 160);
    campo('Código NBS', nota.cod_nbs, L + 170, y + 18, 120);
    campo('Local da prestação (IBGE)', nota.cod_mun_prestacao, L + 300, y + 18, 150);

    y += 56;
    const hDesc = 190;
    caixa(y, hDesc, 'DISCRIMINAÇÃO DO SERVIÇO');
    doc.fillColor('#000').font('Helvetica').fontSize(9).text(nota.descricao, L + 6, y + 20, { width: W - 12, height: hDesc - 26 });

    // valores
    y += hDesc + 10;
    caixa(y, 46, 'VALORES');
    const col = W / 5;
    campo('Valor do serviço', u.fmtMoeda(nota.valor), L + 6, y + 18, col);
    campo('Alíquota ISS', nota.aliquota ? u.fmtNum(nota.aliquota) + '%' : '-', L + 6 + col, y + 18, col);
    campo('Valor do ISS', nota.valor_iss ? u.fmtMoeda(nota.valor_iss) : '-', L + 6 + col * 2, y + 18, col);
    campo('ISS retido', Number(nota.iss_retido) ? 'Sim' : 'Não', L + 6 + col * 3, y + 18, col);
    campo('Valor líquido', u.fmtMoeda(Number(nota.iss_retido) ? nota.valor - (nota.valor_iss || 0) : nota.valor), L + 6 + col * 4, y + 18, col);

    y += 60;
    doc.fillColor(cinza).fontSize(7).text(
      nota.ambiente === 'producao'
        ? 'Documento auxiliar gerado pelo sistema emissor. A versão oficial pode ser consultada no Portal Nacional da NFS-e pela chave de acesso.'
        : 'Documento gerado em ambiente de testes. Não possui valor fiscal.',
      L, y, { width: W, align: 'center' });

    doc.end();
  });
}

module.exports = { gerarPdf };
