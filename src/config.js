const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
const naVercel = process.env.VERCEL === '1';

// Em produção local, cria .env uma vez. A Vercel usa variáveis de ambiente e
// não permite gravar na pasta publicada; ali, o segredo é mantido em memória.
if (!naVercel) {
  if (!fs.existsSync(envFile)) {
    const segredo = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(envFile, [
      'PORT=3100',
      `APP_SECRET=${segredo}`,
      'BASE_URL=http://localhost:3100',
      '# DB_FILE=./data/emissor.db',
      ''
    ].join('\n'));
  }
  process.loadEnvFile(envFile);
}

const port = Number(process.env.PORT || 3100);
const baseUrl = process.env.BASE_URL || (process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : `http://localhost:${port}`);

module.exports = {
  root,
  port,
  secret: process.env.APP_SECRET || (naVercel ? crypto.randomBytes(32).toString('hex') : undefined),
  baseUrl,
  // /tmp é gravável na Vercel, mas não é armazenamento permanente.
  dbFile: naVercel
    ? path.join('/tmp', `servinota-${process.env.VERCEL_DEPLOYMENT_ID || 'demo'}.sqlite`)
    : path.resolve(root, process.env.DB_FILE || 'data/emissor.db'),
  verAplic: 'Servinota_1.0',
  versaoDps: process.env.VERSAO_DPS || '1.00',
  // SEM_LOGIN=1 entra direto como o primeiro administrador (so pra desenvolvimento!)
  semLogin: process.env.SEM_LOGIN === '1',
};
