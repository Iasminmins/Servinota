const crypto = require('node:crypto');
const config = require('./config');

const chave = crypto.createHash('sha256').update(String(config.secret)).digest();

// AES-256-GCM: iv(12) + tag(16) + dados
function encrypt(buf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), dados]);
}

function decrypt(buf) {
  buf = Buffer.from(buf);
  const decipher = crypto.createDecipheriv('aes-256-gcm', chave, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}

function encryptText(txt) {
  if (txt == null || txt === '') return null;
  return encrypt(Buffer.from(String(txt), 'utf8')).toString('base64');
}

function decryptText(txt) {
  if (!txt) return '';
  return decrypt(Buffer.from(txt, 'base64')).toString('utf8');
}

module.exports = { encrypt, decrypt, encryptText, decryptText };
