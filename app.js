import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, addDoc, deleteDoc, onSnapshot, query, orderBy, serverTimestamp, limit, runTransaction, getDocs, getCountFromServer } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const configReady = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("COLE_") && firebaseConfig.projectId && !firebaseConfig.projectId.startsWith("SEU_");
let auth, db, storage, currentUser = null, myProfile = null, posts = [], following = new Set(), likedPostIds = new Set(), unsubscribeFeed = null, selectedMediaFile = null, activeTag = "", currentView = "feed";

function escapeHTML(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch])); }
function formatCount(n=0) { if(n>=1000000)return (n/1000000).toFixed(1)+" mi"; if(n>=10000)return (n/1000).toFixed(1)+" mil"; return new Intl.NumberFormat("pt-BR").format(n); }
function toast(message) { const node=$("#toast");node.textContent=message;node.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove("show"),3000); }
function showModal(title, copy, html="") { $("#modalContent").innerHTML=`<h2 class="modal-title">${escapeHTML(title)}</h2><p class="modal-copy">${escapeHTML(copy)}</p>${html}`;$("#modal").showModal(); }
function avatarHTML(profile, extra="") { const initial=(profile?.characterName||profile?.handle||"?").trim().slice(0,1).toUpperCase(); return `<span class="avatar ${extra}">${profile?.avatarUrl?`<img src="${escapeHTML(profile.avatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`:escapeHTML(initial)}</span>`; }
function relativeTime(ts) { if(!ts?.toDate)return "agora";const mins=Math.max(0,Math.floor((Date.now()-ts.toDate().getTime())/60000));if(mins<1)return "agora";if(mins<60)return `há ${mins} min`;const h=Math.floor(mins/60);if(h<24)return `há ${h} h`;return `há ${Math.floor(h/24)} d`; }
function formatText(text) { return escapeHTML(text).replace(/(^|\s)(#[\p{L}\d_]+)/gu,'$1<span class="hashtag">$2</span>'); }
function profileFromPost(post) { return {characterName:post.authorName,handle:post.authorHandle,avatarUrl:post.authorAvatar||""}; }
function setAuthUI() {
  $("#authButton").textContent = currentUser ? "SAIR" : "ENTRAR";
  $("#postText").disabled = !currentUser || !myProfile;
  $("#publishButton").disabled = !currentUser || !myProfile;
  $("#postText").placeholder = myProfile ? `O que está acontecendo, ${myProfile.characterName}?` : "Entre na rede para publicar como seu personagem...";
  $("#sidebarName").textContent = myProfile?.characterName || "Visitante da Rede";
  $("#sidebarHandle").textContent = myProfile ? "@"+myProfile.handle : "Entre para participar";
  $("#sidebarAvatar").textContent = myProfile?.characterName?.slice(0,1).toUpperCase() || "?";
  $("#composerAvatar").textContent = myProfile?.characterName?.slice(0,1).toUpperCase() || "?";
  if(myProfile?.avatarUrl) { const img=`<img src="${escapeHTML(myProfile.avatarUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`; $("#sidebarAvatar").innerHTML=img; $("#composerAvatar").innerHTML=img; }
}
function openAuth(mode="login") {
  const isSignup=mode==="signup";
  const form=`<form id="authForm" class="auth-form">
    ${isSignup?`<label>Nome do personagem<input name="characterName" maxlength="40" placeholder="Ex.: Billy Maximoff" required></label>
    <label>Arroba única<input name="handle" maxlength="24" pattern="[A-Za-z0-9._]+" placeholder="billymaximoff" required><small>Somente letras, números, ponto e sublinhado.</small></label>
    <label>Biografia<input name="bio" maxlength="160" placeholder="Uma frase sobre seu personagem"></label>`:""}
    <label>E-mail do jogador<input name="email" type="email" autocomplete="email" required></label>
    <label>Senha<input name="password" type="password" minlength="6" autocomplete="${isSignup?"new-password":"current-password"}" required></label>
    <button class="publish-button auth-submit" type="submit">${isSignup?"CRIAR CONTA E PERSONAGEM":"ENTRAR NA REDE"} ↗</button>
    <p class="auth-switch">${isSignup?"Já tem uma conta?":"Ainda não tem conta?"} <button type="button" id="switchAuth">${isSignup?"Entrar":"Criar conta"}</button></p>
    ${isSignup?'<p class="auth-note">Cada conta recebe um único perfil de personagem. Confirme com a administração do RPG se o personagem está disponível antes de se cadastrar.</p>':""}
  </form>`;
  showModal(isSignup?"Criar identidade do personagem":"Acessar a rede",isSignup?"Uma conta por jogador e um personagem por conta. Use o e-mail para entrar, mas o perfil público exibirá apenas seu personagem.":"Entre com o e-mail e a senha cadastrados.",form);
  $("#switchAuth").addEventListener("click",()=>openAuth(isSignup?"login":"signup"));
  $("#authForm").addEventListener("submit",async e=>{
    e.preventDefault();const fd=new FormData(e.currentTarget);const email=String(fd.get("email")).trim();const password=String(fd.get("password"));
    const submit=e.currentTarget.querySelector("button[type=submit]");submit.disabled=true;submit.textContent="CONECTANDO...";
    try {
      if(isSignup){
        const characterName=String(fd.get("characterName")).trim();const handle=String(fd.get("handle")).trim().toLowerCase().replace(/^@/,"");const bio=String(fd.get("bio")||"").trim();
        if(!/^[a-z0-9._]{3,24}$/.test(handle))throw new Error("A arroba deve ter de 3 a 24 caracteres: letras, números, ponto ou sublinhado.");
        const credential=await createUserWithEmailAndPassword(auth,email,password);
        const profileRef=doc(db,"profiles",credential.user.uid);const handleRef=doc(db,"handles",handle);const characterKey=characterName.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");const characterRef=doc(db,"characterClaims",characterKey);
        try {
          await runTransaction(db,async tx=>{const [existingHandle,existingCharacter]=await Promise.all([tx.get(handleRef),tx.get(characterRef)]);if(existingHandle.exists())throw new Error("Essa arroba já está em uso. Escolha outra.");if(existingCharacter.exists())throw new Error("Esse personagem já foi escolhido por outra conta. Converse com a administração do RPG.");tx.set(handleRef,{uid:credential.user.uid,createdAt:serverTimestamp()});tx.set(characterRef,{uid:credential.user.uid,characterName,createdAt:serverTimestamp()});tx.set(profileRef,{uid:credential.user.uid,characterName,characterKey,handle,bio,avatarUrl:"",createdAt:serverTimestamp(),role:"player"});});
        } catch(err) { await credential.user.delete();throw err; }
        await updateProfile(credential.user,{displayName:characterName});
        toast("Identidade criada. Bem-vindo à rede.");$("#modal").close();
      } else { await signInWithEmailAndPassword(auth,email,password);toast("Conexão estabelecida.");$("#modal").close(); }
    } catch(err) { toast(friendlyError(err));submit.disabled=false;submit.textContent=isSignup?"CRIAR CONTA E PERSONAGEM ↗":"ENTRAR NA REDE ↗"; }
  });
}
function friendlyError(err) { const code=err?.code||"";if(code.includes("email-already-in-use"))return "Esse e-mail já tem uma conta.";if(code.includes("invalid-credential")||code.includes("wrong-password")||code.includes("user-not-found"))return "E-mail ou senha incorretos.";if(code.includes("weak-password"))return "Use uma senha com pelo menos 6 caracteres.";if(code.includes("network-request-failed"))return "Falha de conexão. Verifique sua internet.";if(code.includes("permission-denied"))return "O Firebase recusou a operação. Confira as regras de segurança.";return err?.message||"Não foi possível concluir a operação."; }
async function loadMyProfile(user) { const snap=await getDoc(doc(db,"profiles",user.uid));myProfile=snap.exists()?snap.data():null;setAuthUI();if(user&&!myProfile){showModal("Perfil não encontrado","Esta conta não tem um perfil de personagem associado. Entre em contato com a administração do RPG.");} }
function startFeed() { if(unsubscribeFeed)unsubscribeFeed();const q=query(collection(db,"posts"),orderBy("createdAt","desc"),limit(60));unsubscribeFeed=onSnapshot(q,async snap=>{posts=snap.docs.map(d=>({id:d.id,...d.data()}));renderPosts();await hydrateCounts();renderPosts();},err=>{console.error(err);toast("Não foi possível carregar o feed. Confira as regras do Firestore.");}); }
async function hydrateCounts() {
  const snapshot = [...posts];
  await Promise.all(snapshot.map(async post => {
    try {
      const [likes, comments] = await Promise.all([getCountFromServer(collection(db,"posts",post.id,"likes")), getCountFromServer(collection(db,"posts",post.id,"comments"))]);
      post._likesCount = likes.data().count; post._commentsCount = comments.data().count;
    } catch (err) { post._likesCount = post.likesCount || 0; post._commentsCount = post.commentsCount || 0; }
  }));
}
async function refreshPersonalState() {
  following=new Set();likedPostIds=new Set();if(!currentUser)return;
  try { const [followsSnap,likesSnap]=await Promise.all([getDocs(collection(db,"profiles",currentUser.uid,"following")),getDocs(collection(db,"usersPrivate",currentUser.uid,"likes"))]);followsSnap.forEach(d=>following.add(d.id));likesSnap.forEach(d=>likedPostIds.add(d.id)); } catch(err){console.warn("Não foi possível carregar estado pessoal",err);}
}
function renderPosts() {
  const search=$("#searchInput").value.trim().toLowerCase();let visible=[...posts];
  if(activeTag)visible=visible.filter(p=>(p.text||"").toLowerCase().includes(activeTag.toLowerCase()));
  if(search)visible=visible.filter(p=>[p.text,p.authorName,p.authorHandle].join(" ").toLowerCase().includes(search));
  if(currentView==="explore"||currentView==="trending"||$("#sortSelect").value==="popular")visible.sort((a,b)=>(b._likesCount ?? b.likesCount ?? 0)-(a._likesCount ?? a.likesCount ?? 0));
  $("#postFeed").innerHTML=visible.map(post=>`<article class="post" data-post="${escapeHTML(post.id)}"><div class="post-head">${avatarHTML(profileFromPost(post),"post-avatar")}<div class="post-author"><strong>${escapeHTML(post.authorName)} ${post.verified?'<span class="verified">✓</span>':""}</strong><small>@${escapeHTML(post.authorHandle)} · ${escapeHTML(relativeTime(post.createdAt))}</small></div><button class="post-menu" data-action="menu" aria-label="Opções">•••</button></div><p class="post-text">${formatText(post.text||"")}</p>${post.mediaUrl?`<img class="post-media" src="${escapeHTML(post.mediaUrl)}" alt="Imagem da publicação" loading="lazy">`:""}<div class="post-meta"><span>${escapeHTML(post.circle||"WESTVIEW")}</span><span>TRANSMISSÃO PÚBLICA</span></div><div class="post-actions"><button class="post-action ${likedPostIds.has(post.id)?"liked":""}" data-action="like"><span>${likedPostIds.has(post.id)?"♥":"♡"}</span>${formatCount(post._likesCount ?? post.likesCount ?? 0)}</button><button class="post-action" data-action="comments"><span>▤</span>${formatCount(post._commentsCount ?? post.commentsCount ?? 0)} respostas</button><button class="post-action" data-action="share"><span>↗</span>Repassar</button></div><div class="comments-area" hidden><div class="comments-list" data-comments-list>Carregando respostas...</div><form class="comment-area" data-comment-form><input name="comment" maxlength="220" placeholder="Responder como @${escapeHTML(myProfile?.handle||"personagem")}" required ${!currentUser?"disabled":""}><button type="submit" ${!currentUser?"disabled":""}>ENVIAR</button></form></div></article>`).join("");
  $("#emptyState").hidden=visible.length>0;$("#feedHeading").textContent=activeTag?`Resultados para ${activeTag}`:currentView==="trending"?"Publicações em alta":currentView==="explore"?"Explorar transmissões":"Últimas transmissões";
  if(!visible.length&&posts.length===0){$("#emptyState").querySelector("h3").textContent=currentUser?"A rede está esperando sua primeira transmissão":"A rede está aguardando conexão";$("#emptyState").querySelector("p").textContent=currentUser?"Publique como seu personagem e dê início à conversa.":"Entre ou crie sua identidade de personagem para participar do RPG.";}
}
async function publishPost() {
  if(!currentUser||!myProfile){openAuth("login");return;}const text=$("#postText").value.trim();if(!text&&!selectedMediaFile){toast("Escreva algo antes de transmitir.");return;}if(text.length>500){toast("O limite é de 500 caracteres.");return;}
  const button=$("#publishButton");button.disabled=true;button.textContent="TRANSMITINDO...";
  try {let mediaUrl="";if(selectedMediaFile){const path=`post-media/${currentUser.uid}/${Date.now()}_${selectedMediaFile.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;const fileRef=ref(storage,path);await uploadBytes(fileRef,selectedMediaFile);mediaUrl=await getDownloadURL(fileRef);}await addDoc(collection(db,"posts"),{authorUid:currentUser.uid,authorName:myProfile.characterName,authorHandle:myProfile.handle,authorAvatar:myProfile.avatarUrl||"",text,mediaUrl,circle:"WESTVIEW",likesCount:0,commentsCount:0,createdAt:serverTimestamp()});$("#postText").value="";selectedMediaFile=null;$("#mediaPreview").hidden=true;$("#mediaPreview").innerHTML="";$("#mediaInput").value="";toast("Transmissão publicada na rede.");}catch(err){console.error(err);toast(friendlyError(err));}finally{button.disabled=!currentUser||!myProfile;button.innerHTML="TRANSMITIR <span>↗</span>";}
}
async function toggleLike(postId) {
  if(!currentUser){openAuth("login");return;}
  const likeRef=doc(db,"posts",postId,"likes",currentUser.uid);
  const privateLikeRef=doc(db,"usersPrivate",currentUser.uid,"likes",postId);
  try {
    const snap=await getDoc(likeRef);
    if(snap.exists()){await deleteDoc(likeRef);await deleteDoc(privateLikeRef);likedPostIds.delete(postId);}
    else {await setDoc(likeRef,{uid:currentUser.uid,createdAt:serverTimestamp()});await setDoc(privateLikeRef,{postId,createdAt:serverTimestamp()});likedPostIds.add(postId);}
    await hydrateCounts();renderPosts();
  } catch(err){toast(friendlyError(err));}
}
async function loadComments(postId, container) { try{const {getDocs}=await import("https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js");const snap=await getDocs(query(collection(db,"posts",postId,"comments"),orderBy("createdAt","asc"),limit(50)));container.innerHTML=snap.empty?'<div class="comment">Ainda não há respostas. Comece a conversa.</div>':snap.docs.map(d=>{const c=d.data();return `<div class="comment"><strong>@${escapeHTML(c.authorHandle)}</strong>${escapeHTML(c.text)}</div>`;}).join("");}catch(err){container.textContent="Não foi possível carregar as respostas.";} }
async function addComment(postId,text) { if(!currentUser||!myProfile){openAuth("login");return;}try{await addDoc(collection(db,"posts",postId,"comments"),{authorUid:currentUser.uid,authorName:myProfile.characterName,authorHandle:myProfile.handle,text,createdAt:serverTimestamp()});const post=posts.find(p=>p.id===postId);if(post)post._commentsCount=(post._commentsCount||0)+1;renderPosts();toast("Resposta transmitida.");}catch(err){toast(friendlyError(err));} }
async function toggleFollow(targetUid, handle) {
  if(!currentUser||!myProfile){openAuth("login");return;}if(targetUid===currentUser.uid){toast("Você não pode seguir seu próprio personagem.");return;}const followRef=doc(db,"profiles",currentUser.uid,"following",targetUid);try{if(following.has(targetUid)){await deleteDoc(followRef);following.delete(targetUid);toast("Você deixou de seguir @"+handle);}else{await setDoc(followRef,{uid:targetUid,handle,createdAt:serverTimestamp()});following.add(targetUid);toast("Você está seguindo @"+handle);}renderSuggestions();}catch(err){toast(friendlyError(err));}
}
async function renderSuggestions() { const box=$("#suggestedUsers");if(!box||!db)return;try{const snap=await getDocs(query(collection(db,"profiles"),limit(8)));const profiles=snap.docs.map(d=>d.data()).filter(p=>p.uid!==currentUser?.uid).slice(0,5);if(!profiles.length){box.innerHTML='<p class="modal-copy">Os personagens cadastrados aparecerão aqui conforme a rede crescer.</p>';return;}box.innerHTML=profiles.map(p=>`<div class="suggested-user">${avatarHTML(p)}<span class="suggested-info"><strong>${escapeHTML(p.characterName)}</strong><small>@${escapeHTML(p.handle)}</small><em>${escapeHTML(p.bio||"Personagem do RPG")}</em></span><button class="follow-button ${following.has(p.uid)?"following":""}" data-follow-uid="${escapeHTML(p.uid)}" data-follow-handle="${escapeHTML(p.handle)}">${following.has(p.uid)?"Seguindo":"Seguir"}</button></div>`).join("");}catch(err){box.innerHTML='<p class="modal-copy">Não foi possível carregar sugestões.</p>';}}

function setView(view) {currentView=view;activeTag="";$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));const titles={feed:"FEED PÚBLICO",explore:"EXPLORAR A REDE",trending:"TENDÊNCIAS AO VIVO",messages:"MENSAGENS",profile:"MEU PERFIL"};$("#viewTitle").textContent=titles[view]||"FEED PÚBLICO";if(view==="messages"){showModal("Mensagens privadas","O módulo de mensagens privadas será implementado depois do feed, perfis e seguidores.","<div class='modal-list'><div>Mensagens entre personagens serão privadas.</div><div>O sistema exigirá autenticação e regras próprias.</div></div>");return;}if(view==="profile"){if(!myProfile){openAuth("login");return;}showModal("Perfil do personagem","Este é o perfil vinculado à sua conta de jogador.",`<div class="profile-cover"></div><div class="profile-large">${avatarHTML(myProfile)}<div><strong>${escapeHTML(myProfile.characterName)}</strong><small>@${escapeHTML(myProfile.handle)}</small></div></div><p class="profile-bio">${escapeHTML(myProfile.bio||"Este personagem ainda não escreveu uma biografia.")}</p><div class="profile-stats"><div><strong>${posts.filter(p=>p.authorUid===currentUser?.uid).length}</strong><small>Publicações</small></div><div><strong>${following.size}</strong><small>Seguindo</small></div></div>`);return;}renderPosts();}

$("#publishButton").addEventListener("click",publishPost);
$("#postText").addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter")publishPost();});
$("#jumpToComposer").addEventListener("click",()=>{if(!currentUser||!myProfile){openAuth("login");return;}$("#composer").scrollIntoView({behavior:"smooth",block:"center"});$("#postText").focus({preventScroll:true});});
$("#authButton").addEventListener("click",async()=>{if(currentUser){if(confirm("Deseja sair do Sinistagram?")){await signOut(auth);toast("Sessão encerrada.");}}else openAuth("login");});
$("#attachButton").addEventListener("click",()=>{if(!currentUser){openAuth("login");return;}$("#mediaInput").click();});
$("#mediaInput").addEventListener("change",e=>{const file=e.target.files?.[0];if(!file)return;if(!file.type.startsWith("image/")){toast("Selecione um arquivo de imagem.");return;}if(file.size>3*1024*1024){toast("Escolha uma imagem de até 3 MB.");e.target.value="";return;}selectedMediaFile=file;const reader=new FileReader();reader.onload=()=>{$("#mediaPreview").hidden=false;$("#mediaPreview").innerHTML=`<span>IMAGEM PRONTA: ${escapeHTML(file.name)}</span><img src="${reader.result}" alt="Prévia da imagem"><button id="removeMedia" class="text-button">Remover mídia</button>`;$("#removeMedia").addEventListener("click",()=>{selectedMediaFile=null;$("#mediaPreview").hidden=true;$("#mediaPreview").innerHTML="";$("#mediaInput").value="";});};reader.readAsDataURL(file);});
$("#tagButton").addEventListener("click",()=>{if(!currentUser){openAuth("login");return;}const t=prompt("Qual hashtag deseja adicionar?");if(t?.trim()){$("#postText").value+=$("#postText").value?" #"+t.trim().replace(/^#+/,"").replace(/\s+/g,""):"#"+t.trim().replace(/^#+/,"").replace(/\s+/g,"");}});
$("#moodButton").addEventListener("click",()=>toast("Status de personagem será adicionado em uma próxima etapa."));
$("#searchInput").addEventListener("input",()=>{activeTag="";renderPosts();});$("#sortSelect").addEventListener("change",renderPosts);
$$('.nav-item').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
$("#exploreButton").addEventListener("click",()=>setView("trending"));$("#seeAllTrends").addEventListener("click",()=>setView("trending"));
$$('.trend-item').forEach(b=>b.addEventListener('click',()=>{activeTag=b.dataset.tag;currentView="feed";$$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view==='feed'));$("#viewTitle").textContent="BUSCA POR HASHTAG";renderPosts();$("#feedHeading").scrollIntoView({behavior:"smooth",block:"center"});}));
$("#postFeed").addEventListener("click",async e=>{const button=e.target.closest("[data-action]");if(!button)return;const article=button.closest("[data-post]");const post=posts.find(p=>p.id===article?.dataset.post);if(!post)return;const action=button.dataset.action;if(action==="like")await toggleLike(post.id);else if(action==="comments"){const area=article.querySelector(".comments-area");area.hidden=!area.hidden;if(!area.hidden)loadComments(post.id,area.querySelector("[data-comments-list]"));}else if(action==="share"){const link=location.href.split("#")[0]+"#post-"+post.id;try{await navigator.clipboard.writeText(link);toast("Link copiado. Compartilhe com outros jogadores.");}catch{showModal("Link da publicação",link);}}else if(action==="menu"){showModal("Opções da publicação","A moderação será ligada ao painel administrativo do RPG.","<div class='modal-list'><div>Se houver problema com esta publicação, avise a administração do RPG.</div></div>");}});
$("#postFeed").addEventListener("submit",async e=>{if(!e.target.matches("[data-comment-form]"))return;e.preventDefault();const article=e.target.closest("[data-post]");const input=e.target.elements.comment;const text=input.value.trim();if(!text)return;input.disabled=true;await addComment(article.dataset.post,text);input.disabled=false;input.value="";loadComments(article.dataset.post,article.querySelector("[data-comments-list]"));});
$("#suggestedUsers").addEventListener("click",e=>{const b=e.target.closest("[data-follow-uid]");if(b)toggleFollow(b.dataset.followUid,b.dataset.followHandle);});
$("#closeModal").addEventListener("click",()=>$("#modal").close());$("#modal").addEventListener("click",e=>{if(e.target===$("#modal"))$("#modal").close();});
$("#notificationsBtn").addEventListener("click",()=>showModal("Notificações","As notificações serão adicionadas após estabilizarmos as interações principais.","<div class='modal-list'><div>Próxima etapa: notificações de curtidas, respostas e novos seguidores.</div></div>"));
$("#addCircle").addEventListener("click",()=>showModal("Comunidades do RPG","Esta área poderá reunir espaços de conversa para o RPG de Agatha All Along.","<div class='modal-list'><div>Próxima etapa: comunidades para Coven, Salem e Westview.</div></div>"));
$("#allStories").addEventListener("click",()=>showModal("Stories","Stories são uma funcionalidade futura. Primeiro vamos estabilizar contas, perfis e feed compartilhado."));
$("#addStory").addEventListener("click",()=>showModal("Nova história","A publicação de histórias temporárias será adicionada depois do feed principal."));
$("#adButton").addEventListener("click",()=>showModal("VoxTek Industries","A estética tecnológica da VoxTek inspira a interface do Sinistagram."));
$("#openProfile").addEventListener("click",()=>setView("profile"));

if(!configReady){setAuthUI();renderPosts();showModal("Configuração Firebase necessária","A interface está pronta, mas precisamos conectar seu projeto Firebase para ativar cadastro, login e feed compartilhado.","<div class='modal-list'><div>1. Crie um projeto no Firebase Console.</div><div>2. Registre um aplicativo Web.</div><div>3. Ative Authentication por e-mail e senha, Firestore Database e Storage.</div><div>4. Cole a configuração em firebase-config.js e publique as regras incluídas no projeto.</div></div>");}else{const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);storage=getStorage(app);startFeed();onAuthStateChanged(auth,async user=>{currentUser=user;myProfile=null;if(user){try{await loadMyProfile(user);await refreshPersonalState();await renderSuggestions();}catch(err){console.error(err);toast(friendlyError(err));}}else{following=new Set();likedPostIds=new Set();setAuthUI();await renderSuggestions();}renderPosts();});}
