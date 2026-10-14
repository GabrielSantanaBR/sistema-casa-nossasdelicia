# Financeiro — Casa & Nossas Delícias

Sistema web de gestão financeira em português, com dois ambientes separados: **Casa** e **Nossas Delícias**.

## Funcionalidades implementadas

- Login privado por e-mail e senha; sessão HTTP-only com limite de 7 dias e expiração após 12 horas sem uso (configurável).
- Tela **Segurança da conta** com dispositivos conectados, encerramento dos outros acessos e troca de senha mediante confirmação da senha atual. A troca gira o cookie e o token CSRF.
- Dois ambientes com isolamento de acesso e de dados em todas as consultas da API.
- Dashboard mensal com receitas, despesas, resultado previsto, pendências, gastos por categoria, cartões e saldos.
- Criação, edição e exclusão de contas bancárias/caixas, cartões, categorias, clientes e fornecedores.
- Lançamentos de receita, despesa e transferência; vencimento, liquidação, conta ou cartão, categoria, centro de custo, fornecedor/cliente, notas e identificação de parcelas.
- Contas pendentes e atrasadas de todo o histórico, com ações para registrar pagamento ou recebimento; edição e exclusão de lançamentos com recuperação pela lixeira.
- Relatório mensal e exportação do mês ou do histórico integral em CSV compatível com Excel, com nomes dos cadastros e colunas em português.
- Auditoria com responsável, valores anteriores/posteriores e histórico de restaurações.
- Cópia de segurança em JSON do ambiente selecionado, com todos os cadastros, lançamentos (incluindo lixeira) e auditoria, sem credenciais de autenticação.
- Interface com abas Casa/Nossas Delícias, tema claro/escuro, menu móvel, busca e filtros por tipo/situação.
- Resumo mensal com navegação por mês, próximos vencimentos, ordenação de lançamentos e cadastros em listas.
- Valores previstos por vencimento e valores liquidados por data de pagamento. Exportação específica de pagamentos do mês, com conta de origem e destino em transferências.

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

Nunca grave senhas no código ou README. Mantenha o repositório sem dados de produção, habilite backups e restauração do PostgreSQL, proteja as variáveis de ambiente e limite o acesso à conta administrativa. A API usa cookies HTTP-only, Secure em produção e SameSite=Strict, senha derivada com scrypt, limitação de tentativas de login, validação de origem, token CSRF por sessão e isolamento por ambiente. Gravações e auditoria são feitas na mesma transação, com nova verificação da sessão antes de alterar dados. A limitação de login funciona por endereço IP e por conta. Uma chave de idempotência evita duplicação em novas tentativas, e um número de versão bloqueia edições desatualizadas. Valores têm até duas casas decimais; datas e referências são validadas no servidor. A política CSP restringe scripts à origem do site e bloqueia incorporação em frames. Respostas da API não ficam em cache, e células CSV com fórmulas são neutralizadas. Nenhuma aplicação deve ser considerada invulnerável; faça uma revisão adicional antes de armazenar dados sensíveis reais.

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

## Lixeira, backup e acesso

Excluir um lançamento o move para a **Lixeira** e retira seu efeito dos saldos, pendências, compras no cartão e relatórios. Restaurar devolve esse efeito. A lixeira não apaga itens automaticamente; cadastros referenciados por esses itens continuam protegidos contra exclusão. Cadastros sem vínculos ainda têm exclusão definitiva, com confirmação e versão para impedir remoção desatualizada.

Em **Prestação de contas**, **Baixar cópia de segurança** exporta um retrato consistente do ambiente atual. Esse JSON é um arquivo de recuperação e conferência dos dados; a versão atual não tem importação automática. Salve a cópia em um local privado.

Senhas não são armazenadas de forma legível. **Segurança da conta** permite definir uma nova senha de 16 a 128 caracteres, informando a senha atual. Alterar `ADMIN_PASSWORD` no Railway não substitui a senha de um usuário existente. A atualização do código não redefine senhas existentes.

`SESSION_IDLE_HOURS` configura o limite de inatividade (padrão 12, intervalo 1–168 horas). O limite absoluto continua em 7 dias. A lista de sessões mostra identificadores públicos e informações do navegador; ela não expõe o cookie de autenticação.

## Rotina da doceria

O ambiente **Nossas Delícias** possui um catálogo de **Doces e materiais**, **Cafeterias e fornecedores**, **Compras de materiais**, **Vendas e comprovantes** e **Dados da doceria**. A área Casa continua com seus lançamentos, contas, cartões e relatórios.

1. Cadastre os doces vendidos e os materiais comprados, com unidade e preço padrão. Cadastre cafeterias como clientes e os locais de compra como fornecedores; CPF/CNPJ e endereço são opcionais.
2. Registre a venda ou compra escolhendo a cafeteria/fornecedor, data da operação, vencimento e os itens. Informe quantidade e preço unitário. Materiais permitem até três casas decimais de quantidade; itens em unidades exigem números inteiros. O servidor calcula o subtotal de cada item e arredonda ao centavo antes de somar.
3. Ao salvar, **uma única receita ou despesa** é criada junto com o documento, na mesma transação. Não lance o mesmo valor novamente em Lançamentos. Uma venda sem data de recebimento fica **a receber**; uma compra sem data de pagamento fica **a pagar**. O caixa só muda quando há pagamento e conta vinculada.
4. Baixe o PDF na lista de compras/vendas. O comprovante tem número próprio, data, partes, itens, quantidades, preços, total e situação de pagamento. Dados de nomes, unidades, preços e emitente são copiados na emissão; alterações no cadastro não alteram documentos anteriores. A edição explícita do documento preserva seu número e atualiza o mesmo lançamento financeiro.
5. Registre recebimento/pagamento usando o botão da lista ou **A pagar e receber**. Para reabrir uma pendência, edite o recebimento/pagamento e apague a data. Remover o documento move seu lançamento para a lixeira; restaurar o lançamento recupera o documento e seu efeito financeiro. O PDF de um documento na lixeira é marcado como cancelado.
6. Em **Prestação de contas**, consulte totais por cafeteria, doces vendidos e materiais comprados, além do demonstrativo financeiro. O CSV de itens usa a **data da venda/compra**, e os relatórios financeiros mantêm a referência de vencimento/pagamento indicada na tela. O backup JSON inclui documentos, catálogo, emitente e contadores, inclusive registros da lixeira.

**O PDF é um comprovante comercial não fiscal. Não é NF-e, NFC-e nem DANFE e não substitui um documento fiscal autorizado.** A aplicação ainda não integra com SEFAZ ou um provedor fiscal; emissão fiscal real exige configuração fiscal e autorização externa. Nenhum dado fiscal ou identidade empresarial é inventado automaticamente.

As atualizações criam tabelas e campos adicionais sem apagar os lançamentos existentes nem redefinir senhas. Os testes incluem quantidades fracionadas, cálculos exatos, edição com versão, recebimento, isolamento Casa/doceria, idempotência, PDF privado, preservação de snapshots, lixeira/recuperação e reversão integral em falhas.
