# PsicoLab — Backend de contas na Cloudflare (plano gratuito)

A API vive num **Cloudflare Worker** e os dados numa base **D1** (SQLite).
O site continua na GitHub Pages — só chama a API.

**Privacidade por desenho:** os registos das ferramentas são cifrados no
browser (AES-GCM) com uma chave derivada da palavra-passe do utilizador.
O servidor guarda apenas texto cifrado — nem o administrador consegue ler.
A palavra-passe nunca é enviada: o browser deriva duas chaves distintas
(uma para autenticar, outra para cifrar) e só a primeira sai da máquina.

## Configuração passo a passo (dashboard, sem linha de comandos)

### 1. Criar a base de dados D1
1. No dashboard da Cloudflare: **Storage & Databases → D1 SQL Database → Create Database**.
2. Nome: `psicolab-db` → **Create**.
3. Abre a base criada, separador **Console**, cola o conteúdo de
   `schema.sql` e executa.

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

## Notas importantes
- **Palavra-passe perdida = dados perdidos.** É o preço da cifragem
  ponta-a-ponta: não existe "recuperar palavra-passe" que devolva os dados.
  O site avisa o utilizador no registo. (Código de recuperação: fase 2.)
- O plano gratuito chega de sobra: 100 000 pedidos/dia no Worker e
  5 milhões de leituras/dia na D1.
- A coluna `role` em `users` já existe para as fases futuras
  (contas profissionais e administração).
- Se o site mudar de domínio, acrescenta-o a `ALLOWED_ORIGINS` no worker.
