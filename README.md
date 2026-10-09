# Financeiro — Casa & Nossas Delícias

Sistema web de gestão financeira em português, com dois ambientes separados: **Casa** e **Nossas Delícias**.

## Funcionalidades implementadas

- Login privado por e-mail e senha; sessão HTTP-only expira em 7 dias.
- Dois ambientes com isolamento de acesso e de dados em todas as consultas da API.
- Dashboard mensal com receitas, despesas, resultado previsto, pendências, gastos por categoria, cartões e saldos.
- Cadastros de contas bancárias/caixas, cartões, categorias, clientes e fornecedores.
- Lançamentos de receita, despesa e transferência; vencimento, liquidação, conta ou cartão, categoria, centro de custo, fornecedor/cliente, notas e identificação de parcelas.
- Contas pendentes e atrasadas; edição e exclusão de lançamentos.
- Relatório mensal e exportação do histórico integral em CSV compatível com Excel.
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

Para executar localmente: instale Node 20+, crie um banco PostgreSQL e configure as variáveis como em `.env.example`, depois rode `npm install` e `npm start`.

O primeiro usuário é criado **somente se ainda não houver usuários**. Alterar `ADMIN_PASSWORD` depois **não altera automaticamente a senha do banco**.

## Segurança operacional

Nunca grave senhas no código ou README. Mantenha o repositório sem dados de produção, habilite backups e restauração do PostgreSQL, proteja as variáveis de ambiente e limite o acesso à conta administrativa. A API usa cookies HTTP-only, senha derivada com scrypt, rate limiting, validação de origem e isolamento por ambiente. Nenhuma aplicação deve ser considerada invulnerável; faça uma revisão adicional antes de armazenar dados sensíveis reais.

## Limites importantes da versão

- **Não existe** sincronização bancária automática, importação OFX, anexos de comprovantes, emissão de notas fiscais, DRE fiscal, conciliação automática ou múltiplos perfis com permissões distintas.
- O cartão registra **compras no período**, mas ainda **não gera automaticamente faturas nem baixa pagamentos de fatura**. Controle manualmente para não duplicar despesas.
- Parcelas são identificáveis no cadastro; o sistema **não cria automaticamente** lançamentos futuros de parcelamentos.
- O saldo de contas considera lançamentos com data de pagamento e o saldo inicial. Gastos vinculados a cartão não diminuem a conta bancária.
- A soma da visão mensal usa **data de vencimento**, não competência contábil formal; o indicador de valores liquidados usa `paid_date`. Não substitui a atuação de contador.

## Saúde do serviço
`GET /health` retorna `{"status":"ok"}` quando a aplicação consegue conectar ao banco.
