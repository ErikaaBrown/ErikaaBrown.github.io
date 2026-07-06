# PsicoLab — Backend de contas na Cloudflare (plano gratuito)

A API vive num **Cloudflare Worker** e os dados numa base **D1** (SQLite).
O site continua na GitHub Pages — só chama a API.

**Privacidade por desenho:** os registos das ferramentas são cifrados no
browser (AES-GCM) com uma chave de dados aleatória (DEK), gerada localmente
e nunca enviada ao servidor. O servidor guarda apenas texto cifrado — nem
o administrador consegue ler. Essa DEK fica guardada, cifrada, de duas
formas: uma vez com uma chave derivada da palavra-passe, e outra vez com
uma chave derivada do código de recuperação mostrado ao utilizador no
registo. Assim, perder a palavra-passe já não significa perder os dados —
o código de recuperação permite desbloquear a mesma DEK e definir uma
palavra-passe nova, mesmo num dispositivo novo.

## Configuração passo a passo (dashboard, sem linha de comandos)

### 1. Criar a base de dados D1
1. No dashboard da Cloudflare: **Storage & Databases → D1 SQL Database → Create Database**.
2. Nome: `psicolab-db` → **Create**.
3. Abre a base criada, separador **Console**, cola o conteúdo de
   `schema.sql` e executa.
   - Se a consola reclamar, executa cada instrução separadamente
     (os `CREATE TABLE` e o `CREATE INDEX`, um de cada vez).
     Voltar a executar não faz mal — os `IF NOT EXISTS` protegem.
   - **Já tinhas esta base de dados criada antes desta funcionalidade?**
     Não coles o `schema.sql` outra vez — cola antes o conteúdo de
     `migrations/0002_recovery_codes.sql` na consola. Adiciona as colunas
     novas sem tocar nas contas já existentes.

### 2. Criar o Worker
1. **Compute (Workers) → Workers & Pages → Create → Create Worker**.
2. Nome: `psicolab-api` → **Deploy** (o "Hello World" por omissão).
3. **Edit code** → apaga tudo, cola o conteúdo de `worker.js` → **Deploy**.

### 3. Ligar a base de dados e o segredo ao Worker
1. No Worker `psicolab-api`: **Settings → Bindings → Add → D1 Database**.
   - Variable name: `DB`
   - Database: `psicolab-db`
2. **Settings → Variables and Secrets → Add**:
   - Type: **Secret** · Name: `SESSION_SECRET`
   - Value: uma string longa e aleatória (50+ caracteres à sorte; guarda-a).
3. **Deploy** outra vez se o dashboard o pedir.

### 4. Apontar o site para o Worker
1. Copia o URL do Worker (algo como `https://psicolab-api.<subdominio>.workers.dev`).
2. No repositório, edita `js/sync.js` e substitui o valor de `API_BASE`
   na primeira linha por esse URL.
3. Commit + push. Pronto — a página **Conta** do site fica funcional.

## Deploys automáticos
Depois da configuração inicial acima, qualquer push a `main` volta a
publicar `worker.js` automaticamente, através de
`.github/workflows/deploy.yml` (usa `wrangler.toml`, que já aponta para
este Worker e para o binding `DB`). Para isso funcionar, o repositório
precisa dos secrets `CLOUDFLARE_API_TOKEN` e `SESSION_SECRET` configurados
em **Settings → Secrets and variables → Actions**. Sem esse deploy
automático, continua a ser possível actualizar o Worker manualmente:
repete o passo 2 (**Edit code** → colar `worker.js` → **Deploy**).

## Notas importantes
- **Palavra-passe perdida, mas código de recuperação guardado = tudo bem.**
  O código de recuperação (mostrado uma única vez, no registo) permite
  desbloquear os dados e definir uma palavra-passe nova. Só se **ambos**
  se perderem é que os dados ficam mesmo irrecuperáveis — o site avisa
  disso com clareza.
- Contas criadas antes desta funcionalidade fazem um "upgrade" automático
  e transparente no próximo login: o site gera a DEK, mostra um código de
  recuperação novo e continua a funcionar sem pedir nada extra ao
  utilizador.
- O plano gratuito chega de sobra: 100 000 pedidos/dia no Worker e
  5 milhões de leituras/dia na D1.
- A coluna `role` em `users` já existe para as fases futuras
  (contas profissionais e administração).
- Se o site mudar de domínio, acrescenta-o a `ALLOWED_ORIGINS` no worker.
