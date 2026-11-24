const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');

// na primeira execucao cria o .env com um segredo aleatorio
// (o segredo e usado pra criptografar os certificados, nao perca esse arquivo)
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

const port = Number(process.env.PORT || 3100);

module.exports = {
  root,
  port,
  secret: process.env.APP_SECRET,
  baseUrl: process.env.BASE_URL || `http://localhost:${port}`,
  dbFile: path.resolve(root, process.env.DB_FILE || 'data/emissor.db'),
  verAplic: 'Servinota_1.0',
  versaoDps: process.env.VERSAO_DPS || '1.00',
  // SEM_LOGIN=1 entra direto como o primeiro administrador (so pra desenvolvimento!)
  semLogin: process.env.SEM_LOGIN === '1',
};
