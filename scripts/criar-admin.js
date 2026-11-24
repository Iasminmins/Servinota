// cria (ou redefine a senha de) um administrador no primeiro escritorio
// uso: node scripts/criar-admin.js email@dominio.com senha123
const bcrypt = require('bcryptjs');
const db = require('../src/db');

const [email, senha] = process.argv.slice(2);
if (!email || !senha || senha.length < 8) {
  console.log('Uso: node scripts/criar-admin.js email senha (mínimo 8 caracteres)');
  process.exit(1);
}
let esc = db.get('SELECT id FROM escritorios ORDER BY id LIMIT 1');
if (!esc) esc = { id: db.insert('escritorios', { nome: 'Meu escritório', email }) };
const hash = bcrypt.hashSync(senha, 10);
const existe = db.get('SELECT id FROM usuarios WHERE email = ?', email.toLowerCase());
if (existe) {
  db.run("UPDATE usuarios SET senha_hash = ?, ativo = 1, papel = 'admin' WHERE id = ?", hash, existe.id);
  console.log('Senha redefinida para', email);
} else {
  db.insert('usuarios', { escritorio_id: esc.id, nome: 'Administrador', email: email.toLowerCase(), senha_hash: hash, papel: 'admin' });
  console.log('Administrador criado:', email);
}
