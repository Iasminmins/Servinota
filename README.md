# Servinota

**Emissão e gestão de NFS-e para escritórios contábeis.**

Sistema para escritórios de contabilidade emitirem NFS-e das empresas clientes, usando a **API da NFS-e Nacional** (Sefin Nacional / ADN), que é o padrão obrigatório a partir de 2026.

Feito em Node.js + Express + SQLite (o SQLite que já vem no Node, sem instalar banco). Roda em qualquer máquina com Node 22.13 ou mais novo.

## Rodar

```
npm install
npm start
```

Abra http://localhost:3100 e clique em **Criar conta** para cadastrar o escritório (o primeiro usuário vira administrador).

A página pública de apresentação do produto fica em http://localhost:3100/produto.

No primeiro start é criado o arquivo `.env` com um `APP_SECRET` aleatório. **Guarde esse arquivo**: os certificados e senhas SMTP são criptografados com ele. Se perder, vai ter que reenviar os certificados.

Para desenvolvimento: `npm run dev` (reinicia sozinho ao salvar).

## O que tem

- **Multi-escritório**: cada escritório só vê os próprios dados. Perfis admin, operador e cliente.
- **Empresas** (prestadores): cadastro com busca de CNPJ (BrasilAPI) e CEP (ViaCEP, já traz o código IBGE), dados fiscais, série/numeração da DPS.
- **Certificado A1**: upload do .pfx, validação de senha, CNPJ e validade; alerta no painel quando está vencendo.
- **Tomadores e serviços** por empresa.
- **Emissão**: fila de envio em segundo plano, PDF, XML, reenvio de nota com erro, duplicar nota, cancelamento (evento 101101).
- **Ambientes**: Simulação (testa tudo sem certificado e sem valor fiscal), Homologação (produção restrita da Receita) e Produção.
- **Emissão recorrente**: todo mês no dia escolhido (checagem diária às 7h), com `{mes}/{ano}` na descrição.
- **Importação de planilha** (.xlsx ou .csv) com conferência antes de emitir; tomador novo é cadastrado sozinho.
- **Envio por e-mail** com PDF e XML anexados, pelo SMTP do escritório e com modelo de mensagem editável.
- **Portal do cliente**: o cliente da contabilidade entra, vê e baixa as notas dele e, se liberado, emite.
- Exportação CSV, download de XMLs em zip, histórico de atividades.

## Antes de usar em produção

1. Cadastre a empresa, envie o certificado A1 ICP-Brasil e mude o ambiente para **Homologação**.
2. Emita algumas notas de teste. Os erros que a Sefin devolver aparecem na tela da nota com código e descrição.
3. Ajuste conforme as rejeições, por exemplo: informar ou não a inscrição municipal, a alíquota e o regime. O código de tributação nacional tem 6 dígitos.
4. Funcionando, passe para **Produção**.

Observações:
- O município da empresa precisa ter aderido à NFS-e Nacional (desde 2026 a adesão é obrigatória, mas confira).
- O layout da DPS segue a versão 1.00. Se a Receita exigir outra versão, mude `VERSAO_DPS` no `.env` e revise `src/nfse/dps.js`.
- O PDF oficial (DANFSe) é baixado do ADN. Se não estiver disponível, o sistema gera um PDF próprio.

## Scripts úteis

- `npm run test:assinatura`: gera um certificado falso, monta e assina uma DPS e confere a assinatura.
- `node scripts/teste-homologacao.js <id_empresa>`: manda uma DPS para a produção restrita e mostra a resposta.
- `npm run test:smoke`: testa os fluxos principais com o servidor rodando (use um banco isolado).
- `npm run test:produto`: testa a página pública e seu CSS responsivo com o servidor rodando em `http://localhost:3100`.
- `node scripts/criar-admin.js email senha`: cria um admin ou redefine a senha.

## Estrutura

```
src/
  server.js          app express, rotas, fila e agendador
  db.js              schema e helpers do sqlite
  nfse/              DPS, assinatura XML, API nacional, simulador, PDF
  services/          emissão (fila), e-mail, recorrência, planilha, validações
  routes/            telas
views/               templates EJS
public/              css e js
data/                banco (emissor.db)  <- fazer backup
```

## Deploy barato

Uma VPS simples (1 GB de RAM já basta) com Node, rodando via `pm2 start npm -- start`, atrás de um Nginx ou Caddy com HTTPS. Coloque `BASE_URL=https://seudominio` no `.env`. Faça backup diário da pasta `data/` e do `.env`.

### Vercel (somente demonstração)

O app também pode ser carregado como função Express na Vercel. Nesse modo, o SQLite fica em `/tmp`, que é temporário e isolado por instância; sessões, contas e notas podem sumir ou não aparecer em outra instância. Fila de emissão e recorrências agendadas exigem um processo contínuo. Use VPS para operação real ou migre para banco e tarefas persistentes antes de usar com dados reais.
