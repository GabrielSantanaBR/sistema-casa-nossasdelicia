# Financeiro — Casa & Nossas Delícias

Sistema web de gestão financeira em português, com dois ambientes separados: **Casa** e **Nossas Delícias**.

## Funcionalidades implementadas

- Login privado por e-mail e senha; sessão HTTP-only expira em 7 dias.
- Dois ambientes com isolamento de acesso e de dados em todas as consultas da API.
- Dashboard mensal com receitas, despesas, resultado previsto, pendências, gastos por categoria, cartões e saldos.
- Criação, edição e exclusão de contas bancárias/caixas, cartões, categorias, clientes e fornecedores.
- Lançamentos de receita, despesa e transferência; vencimento, liquidação, conta ou cartão, categoria, centro de custo, fornecedor/cliente, notas e identificação de parcelas.
- Contas pendentes e atrasadas de todo o histórico, com ações para registrar pagamento ou recebimento; edição e exclusão de lançamentos.
- Relatório mensal e exportação do mês ou do histórico integral em CSV compatível com Excel, com nomes dos cadastros e colunas em português.
- Registro básico de auditoria para criações, edições e exclusões.
- Interface com abas Casa/Nossas Delícias, tema claro/escuro, menu móvel, busca e filtros por tipo/situação.
- Resumo mensal com navegação por mês, próximos vencimentos e cadastros em listas.

## Implantar no Railway

1. Crie um projeto Railway com **PostgreSQL**.
2. Crie um serviço conectado a este repositório (branch `main`).
3. Nas variáveis do serviço, configure:
   - `DATABASE_URL`: referência ao `DATABASE_URL` do serviço PostgreSQL.
   - `ADMIN_EMAIL`: e-mail para o primeiro login.
   - `ADMIN_PASSWORD`: uma senha **com no mínimo 16 caracteres**, sem reutilizar senhas.
   - `NODE_ENV`: `production`.
4. Comando de inicialização: `npm start` (Railway normalmente detecta o script). O `PORT` é fornecido pela plataforma.
5. Gere um domínio HTTPS no Railway e entre com as credenciais cadastradas.

Para executar localmente: instale Node 22.13+, crie um banco PostgreSQL e configure as variáveis como em `.env.example`, depois rode `npm install` e `npm start`.

O primeiro usuário é criado **somente se ainda não houver usuários**. Alterar `ADMIN_PASSWORD` depois **não altera automaticamente a senha do banco**.

## Segurança operacional

Nunca grave senhas no código ou README. Mantenha o repositório sem dados de produção, habilite backups e restauração do PostgreSQL, proteja as variáveis de ambiente e limite o acesso à conta administrativa. A API usa cookies HTTP-only, Secure em produção e SameSite=Strict, senha derivada com scrypt, limitação de tentativas de login, validação de origem, token CSRF por sessão e isolamento por ambiente. Gravações e auditoria são feitas na mesma transação. Uma chave de idempotência evita duplicação em novas tentativas, e um número de versão bloqueia edições desatualizadas. Valores têm até duas casas decimais; datas e referências são validadas no servidor. A política CSP restringe scripts à origem do site e bloqueia incorporação em frames. Respostas da API não ficam em cache, e células CSV com fórmulas são neutralizadas. Nenhuma aplicação deve ser considerada invulnerável; faça uma revisão adicional antes de armazenar dados sensíveis reais.

## Limites importantes da versão

- **Não existe** sincronização bancária automática, importação OFX, anexos de comprovantes, emissão de notas fiscais, DRE fiscal, conciliação automática ou múltiplos perfis com permissões distintas.
- O cartão registra **compras no período**, mas ainda **não gera automaticamente faturas nem baixa pagamentos de fatura**. Controle manualmente para não duplicar despesas.
- No formulário de novo lançamento, abra **Mais detalhes**, informe o **valor de cada parcela**, número **1**, total de parcelas e marque **Gerar todas as parcelas mensais**. O sistema conserva o dia quando possível e ajusta o vencimento para o último dia de meses curtos. Somente a primeira parcela recebe a data de pagamento informada. Editar ou excluir uma parcela altera apenas aquele lançamento.
- O saldo de contas considera lançamentos com data de pagamento e o saldo inicial. Gastos vinculados a cartão não diminuem a conta bancária.
- A soma da visão mensal usa **data de vencimento**, não competência contábil formal; o indicador de valores liquidados usa `paid_date`. Não substitui a atuação de contador.

## Saúde do serviço

`GET /health` retorna `{"status":"ok"}` quando a aplicação consegue conectar ao banco.

## Desenvolvimento e testes

```sh
npm ci
npm run check
npm test
```

Os testes de API executam PostgreSQL isolado com PGlite, sem depender do banco de produção. Cobrem autenticação, CSRF, isolamento entre ambientes, validações, versões, idempotência, reversão de transações, transferências, parcelas, paginação e exportação. Os testes da interface usam jsdom para navegação, edição, falhas de conexão e logout. O GitHub Actions executa as mesmas verificações a cada alteração.

No Railway, `RAILWAY_PUBLIC_DOMAIN` define a origem permitida automaticamente. Fora da plataforma, configure `PUBLIC_ORIGIN` com a URL HTTPS completa quando houver proxy ou domínio personalizado. `TRUST_PROXY_HOPS` aceita o número de proxies confiáveis; em produção o padrão é 1.
