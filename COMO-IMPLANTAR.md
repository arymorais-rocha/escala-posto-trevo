# Escala Posto Trevo — como colocar no ar

Arquivos:
- `Code.gs` → servidor (Google Apps Script, ligado a uma planilha)
- `admin.html` → app de gestão (só você usa, com a sua senha)
- `index.html`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` → app "Minha Escala" dos colaboradores

## 1. Servidor (Google Sheets + Apps Script)
1. Crie uma planilha nova no Google Drive chamada **Escala Posto Trevo**.
2. Menu **Extensões → Apps Script**. Apague o que estiver no editor e cole todo o conteúdo de `Code.gs`.
3. Na linha `const SENHA_ADMIN_INICIAL = '';` escreva a sua senha entre as aspas (mínimo 8 caracteres). Salve (ícone de disquete).
4. No topo, escolha a função **configurar** e clique **▶ Executar**. Autorize o acesso quando o Google pedir (Avançado → Acessar projeto).
5. Volte na linha da senha, **apague a senha** (deixe `''`) e salve de novo. Ela já ficou guardada em hash.
6. **Implantar → Nova implantação** → engrenagem → **App da Web**:
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
   - Clique **Implantar** e copie o **URL do app da Web** (termina em `/exec`). Clique **Concluído**.
7. Teste: abra o URL no navegador. Deve aparecer `{"ok":true,"app":"Escala Posto Trevo",...}`. Se der erro 404, a implantação não foi concluída.

Para atualizar o servidor depois: cole o código novo → salvar → **Implantar → Gerenciar implantações → lápis → Nova versão → Implantar** (o URL continua o mesmo).

## 2. Apps no GitHub Pages
1. Crie um repositório novo no GitHub, por exemplo `escala-posto-trevo`.
2. O endereço do servidor já está colocado no `index.html` e no `admin.html`.
3. Envie os arquivos: `index.html`, `admin.html`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`.
4. **Settings → Pages → Branch: main / (root) → Save**. Em 1 a 2 minutos o endereço fica pronto:
   - Colaboradores: `https://SEU-USUARIO.github.io/escala-posto-trevo/`
   - Você (gestão): `https://SEU-USUARIO.github.io/escala-posto-trevo/admin.html`

## 3. Primeiro uso
1. Abra o `admin.html` → botão **Nuvem** → cole o URL do servidor e a sua senha → **Entrar**. A escala deste aparelho vai para a nuvem.
2. **Senhas dos colaboradores** → **Gerar PIN** para cada um. Anote e entregue pessoalmente (o PIN não aparece de novo).
3. **Publicar escala para a equipe** → escolha os meses → **Publicar**.
4. Mande o link dos colaboradores para a equipe. No celular: abrir o link → menu do navegador → **Adicionar à tela inicial**.

## Segurança
- Só a sua senha de administrador altera, publica ou troca PINs. O servidor recusa qualquer outra tentativa.
- Cada colaborador recebe do servidor apenas a própria escala.
- 5 tentativas erradas travam o login daquele nome por 15 minutos.
- **Bloquear** ou **Novo PIN** desconecta a pessoa na hora (use quando alguém sair do posto).
- Senhas e PINs ficam em hash na planilha; não compartilhe a planilha com ninguém.
- A aba **Acessos** da planilha registra logins e publicações.
