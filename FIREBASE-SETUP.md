# Meu Foco — Apollo 14 (versão Firebase independente)

## Estado
Esta ramificação \`apollo-14-firebase\` é uma implementação inicial para Firebase
App Hosting baseada no commit estável Apollo 14 \`a45e547\`. A Cloudflare permanece
na branch \`main\`. Ainda é obrigatório compilar, publicar e validar o app real
antes de utilizá-lo com dados ou documentos sensíveis.

O Firebase não precisa do projeto Supabase para **novas** contas e documentos.
Dados antigos não migram automaticamente. Não delete o Supabase antigo.

## 1. Criar um projeto Firebase

1. Abra https://console.firebase.google.com/ e crie um projeto separado para o Meu Foco.
2. Ative **Authentication > Sign-in method > Email/Password**.
3. Crie **Cloud Firestore** em modo produção. Aplique as regras em
   \`firebase/firestore.rules\` **antes** de salvar qualquer documento.
4. Crie um bucket no **Cloud Storage** e aplique as regras em
   \`firebase/storage.rules\` antes de subir PDFs/EPUBs.
5. Cadastre um aplicativo Web no projeto. Copie os campos públicos
   \`apiKey\`, \`projectId\` e \`storageBucket\`.

## 2. App Hosting

1. Habilite plano Blaze e configure orçamento/alertas.
2. App Hosting > Criar backend > conectar GitHub
   \`drthaleschateaubriand/pdf-voice\`.
3. **Branch: \`apollo-14-firebase\`**, diretório raiz \`/\`.
   Nunca escolha \`main\` para esse backend.
4. Configure variáveis de ambiente na interface App Hosting:
   - \`NEXT_PUBLIC_FIREBASE_API_KEY\` = firebaseConfig.apiKey
   - \`NEXT_PUBLIC_FIREBASE_PROJECT_ID\` = firebaseConfig.projectId
   - \`NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET\` = firebaseConfig.storageBucket
5. Adicione \`OPENAI\` ao Cloud Secret Manager e vincule como variável secreta
   **de execução** no App Hosting. Copie a chave legítima da sua conta OpenAI
   somente na interface protegida, não em arquivos nem mensagens. A chave
   Cloudflare não é automaticamente copiada.
6. **Opcional:** \`SONIC\` para Cartesia. O motor não está habilitado sem chave.
7. Faça rollout da branch Firebase somente após CI passar.

## 3. Segurança

- Firestore e Storage são isolados por \`request.auth.uid\`.
- Identidade: Firebase Auth via Identity Toolkit; a API do Professor valida
  o ID token antes de emitir uma credencial efêmera OpenAI.
- Não use regras públicas (ex.: \`allow read, write: if true\`).
- NUNCA grave OPENAI em variáveis NEXT_PUBLIC, Firebase config ou Git.
- Valide as regras no emulador antes de uso real.
- Os PDFs e trechos enviados ao Professor IA contêm dados do livro aberto;
  não use prontuários ou dados de terceiros sem necessidade/autorização.

## 4. Migração dos dados existentes

O projeto Supabase \`paper-voice\` (\`cmgwbowbvcwmnluzevoq\`)
foi pausado e precisa ser restaurado no painel Supabase antes da exportação.
Faça backup verificável das tabelas e do bucket \`pdfs\`.
Depois planeje a importação de usuários, documentos, progresso, marcadores e
revisão espaçada. As senhas não podem ser copiadas em texto puro;
a importação de hashes depende do esquema de hashing disponível.
A opção mais segura para um piloto é usar login Firebase separado,
enquanto testamos a migração sem alterar a conta atual.

## 5. Testes obrigatórios

- \`npm ci\`, \`npm test\`, \`npm run lint\`, \`npm run build\`
- Login, logout, token expirado, segunda conta sem acesso aos arquivos da primeira
- PDF/EPUB: upload, download e persistência de progresso entre Mac e iPad
- Revisão espaçada, professor, saída de voz, retomar posição da leitura
- POST anônimo \`/api/teacher-session\` retorna 401
- API /api/speech confirma \`configured: true\` após anexar OPENAI
- Teste em arquivo não sensível antes do uso clínico

## 6. Desenvolvimento local

\`\`\`bash
npm ci
NEXT_PUBLIC_FIREBASE_API_KEY=... \
NEXT_PUBLIC_FIREBASE_PROJECT_ID=... \
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=... \
npm run dev
\`\`\`

Configure OPENAI localmente por mecanismo seguro de variáveis do shell
apenas quando desejar testar narração real. Não publique credenciais em commits.
