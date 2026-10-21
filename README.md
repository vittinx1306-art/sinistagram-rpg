# Sinistagram | Coven Network

Protótipo de uma rede social de RPG com visual tecnológico inspirado na VoxTek. O conteúdo de exemplo foi adaptado para o RPG de Agatha All Along. O Firebase conecta jogadores diferentes; não é necessário manter um computador pessoal ligado como servidor.

## Regra de personagens

A estrutura permite um perfil por conta Firebase e impede que duas contas reivindiquem o mesmo nome de personagem ou a mesma arroba. Isso não consegue provar que uma pessoa física não criou várias contas. Para garantir a regra do RPG na prática, a administração deve aprovar a lista de personagens e conferir os jogadores antes de liberar o acesso.

## Arquivos

- `index.html`: estrutura da interface.
- `styles.css`: tema responsivo VoxTek.
- `app.js`: interface e integração com Firebase Authentication, Firestore e Storage.
- `firebase-config.js`: configuração do projeto Firebase, que você preencherá.
- `firestore.rules`: regras de segurança do banco.
- `storage.rules`: regras de segurança para imagens.

## Configuração Firebase

1. Acesse https://console.firebase.google.com/ e crie um projeto.
2. Registre um aplicativo Web no projeto e copie a configuração fornecida.
3. Cole os valores em `firebase-config.js`.
4. Em Authentication > Sign-in method, ative **E-mail/senha**.
5. Crie o banco Cloud Firestore em modo de produção.
6. Em Firestore > Rules, publique o conteúdo de `firestore.rules`.
7. Ative o Cloud Storage e publique `storage.rules` nas regras do Storage.
8. Em Authentication > Settings > Authorized domains, confira se o domínio onde o site será hospedado está autorizado.
9. Teste primeiro em um ambiente de desenvolvimento. Não publique as regras sem testá-las no Firebase Rules Playground ou no Emulator Suite.

## Como executar

Como o projeto usa módulos JavaScript e SDK do Firebase por CDN, abra-o por um servidor web local ou publique-o em uma hospedagem estática. Abrir `index.html` diretamente via `file://` pode bloquear os módulos no navegador. Não precisa instalar dependências de Node para a hospedagem estática.

## O que já está ligado na interface

- Cadastro e login por e-mail e senha.
- Um perfil de personagem por conta Firebase.
- Reserva de arroba e de nome de personagem para evitar duplicatas.
- Feed compartilhado em tempo real.
- Publicações de texto e imagens (limite de 3 MB no cliente e nas regras do Storage).
- Curtidas e comentários armazenados no Firestore.
- Contas sugeridas carregadas dos perfis cadastrados.
- Seguir e deixar de seguir personagens.
- Busca por texto e hashtags, ordenação e interface responsiva.

## Importante antes de abrir para o grupo

Este é um primeiro scaffold funcional, não uma plataforma pronta para produção. As contagens de curtidas e comentários são consultadas a partir das subcoleções, o que é adequado para um RPG pequeno, mas deve ser otimizado se a rede crescer. A reserva de personagem evita nomes duplicados, porém a administração precisa validar a identidade de cada jogador. Não há ainda recuperação de senha personalizada, verificação de e-mail obrigatória, painel de moderação, denúncias funcionais, bloqueio, mensagens privadas ou fluxo de aprovação de personagens. Esses recursos devem ser implementados e testados antes de uso público.
