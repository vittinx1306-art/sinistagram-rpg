// Sinistagram — versão 1: login, cadastro, publicações e feed em tempo real.
// Usa apenas Firebase Authentication + Firestore (sem Storage, sem plano pago).
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, addDoc, onSnapshot, query, orderBy, serverTimestamp, limit, runTransaction } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let auth = null, db = null;
let currentUser = null, myProfile = null, posts = [], activeTag = "", signingUp = false, unsubscribeFeed = null;

const configReady = !!firebaseConfig && !!firebaseConfig.apiKey && !/^COLE_|^SEU_/.test(firebaseConfig.apiKey) && !!firebaseConfig.projectId && !/^SEU_/.test(firebaseConfig.projectId);

/* ---------- utilidades ---------- */
function escapeHTML(v) {
  return String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 3500);
}
function showModal(title, copy, html = "") {
  $("#modalContent").innerHTML = `<h2 class="modal-title">${escapeHTML(title)}</h2><p class="modal-copy">${escapeHTML(copy)}</p>${html}`;
  const m = $("#modal");
  if (!m.open) m.showModal();
}
function relativeTime(ts) {
  if (!ts || !ts.toDate) return "agora";
  const mins = Math.max(0, Math.floor((Date.now() - ts.toDate().getTime()) / 60000));
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}
function formatText(text) {
  return escapeHTML(text).replace(/(^|\s)(#[\p{L}\d_]+)/gu, '$1<span class="hashtag">$2</span>');
}
function makeKey(name) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function friendlyError(err) {
  const code = err?.code || "";
  if (code.includes("email-already-in-use")) return "Esse e-mail já tem uma conta.";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "E-mail ou senha incorretos.";
  if (code.includes("invalid-email")) return "E-mail inválido.";
  if (code.includes("weak-password")) return "Use uma senha com pelo menos 6 caracteres.";
  if (code.includes("network-request-failed")) return "Falha de conexão. Verifique sua internet.";
  if (code.includes("operation-not-allowed")) return "Login por e-mail/senha não está ativado no Firebase.";
  if (code.includes("too-many-requests")) return "Muitas tentativas. Aguarde um pouco.";
  if (code.includes("permission-denied")) return "O Firebase recusou a operação. Confira se as regras foram publicadas.";
  return err?.message || "Não foi possível concluir a operação.";
}

/* ---------- interface conforme o estado de login ---------- */
function setAuthUI() {
  const logged = !!currentUser && !!myProfile;
  const initial = myProfile?.characterName?.slice(0, 1).toUpperCase() || "?";
  $("#authButton").textContent = currentUser ? "SAIR" : "ENTRAR";
  $("#postText").disabled = !logged;
  $("#publishButton").disabled = !logged;
  $("#postText").placeholder = logged ? `O que está acontecendo, ${myProfile.characterName}?` : "Entre na rede para publicar como seu personagem...";
  $("#sidebarName").textContent = myProfile?.characterName || "Visitante da Rede";
  $("#sidebarHandle").textContent = logged ? "Personagem conectado" : "Entre para participar";
  $("#sidebarAvatar").textContent = initial;
  $("#composerAvatar").textContent = initial;
}

/* ---------- login / cadastro ---------- */
function openAuth(mode = "login") {
  if (!configReady || !auth) { showConfigNeeded(); return; }
  const isSignup = mode === "signup";
  const form = `<form id="authForm" class="auth-form">
    ${isSignup ? `<label>Nome do personagem<input name="characterName" maxlength="40" placeholder="Ex.: Billy Maximoff" required></label>` : ""}
    <label>E-mail<input name="email" type="email" autocomplete="email" required></label>
    <label>Senha<input name="password" type="password" minlength="6" autocomplete="${isSignup ? "new-password" : "current-password"}" required></label>
    <button class="publish-button auth-submit" type="submit">${isSignup ? "CRIAR CONTA" : "ENTRAR NA REDE"} ↗</button>
    <p class="auth-switch">${isSignup ? "Já tem uma conta?" : "Ainda não tem conta?"} <button type="button" id="switchAuth">${isSignup ? "Entrar" : "Criar conta"}</button></p>
    ${isSignup ? '<p class="auth-note">Um personagem por conta. Seu e-mail não aparece publicamente — só o nome do personagem.</p>' : ""}
  </form>`;
  showModal(isSignup ? "Criar identidade do personagem" : "Acessar a rede", isSignup ? "Escolha o nome do seu personagem e crie sua conta." : "Entre com o e-mail e a senha cadastrados.", form);
  $("#switchAuth").addEventListener("click", () => openAuth(isSignup ? "login" : "signup"));
  $("#authForm").addEventListener("submit", (e) => handleAuthSubmit(e, isSignup));
}

async function handleAuthSubmit(e, isSignup) {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const email = String(fd.get("email")).trim();
  const password = String(fd.get("password"));
  const submit = e.currentTarget.querySelector("button[type=submit]");
  const label = submit.textContent;
  submit.disabled = true;
  submit.textContent = "CONECTANDO...";
  try {
    if (isSignup) {
      const characterName = String(fd.get("characterName")).trim();
      const characterKey = makeKey(characterName);
      if (characterName.length < 2 || !characterKey) throw new Error("Escolha um nome de personagem com pelo menos 2 letras ou números.");
      signingUp = true;
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      try {
        await runTransaction(db, async (tx) => {
          const claimRef = doc(db, "characterClaims", characterKey);
          if ((await tx.get(claimRef)).exists()) throw new Error("Esse personagem já foi escolhido por outra conta.");
          tx.set(claimRef, { uid: cred.user.uid, characterName, createdAt: serverTimestamp() });
          tx.set(doc(db, "profiles", cred.user.uid), { uid: cred.user.uid, characterName, characterKey, createdAt: serverTimestamp() });
        });
      } catch (err) {
        await cred.user.delete().catch(() => {});
        throw err;
      }
      try { await updateProfile(cred.user, { displayName: characterName }); } catch (_) {}
      currentUser = cred.user;
      await loadMyProfile(cred.user);
      toast("Identidade criada. Bem-vindo à rede.");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      toast("Conexão estabelecida.");
    }
    $("#modal").close();
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
    submit.disabled = false;
    submit.textContent = label;
  } finally {
    signingUp = false;
  }
}

async function loadMyProfile(user) {
  const snap = await getDoc(doc(db, "profiles", user.uid));
  myProfile = snap.exists() ? snap.data() : null;
  setAuthUI();
  renderPosts();
  if (!myProfile) showModal("Perfil não encontrado", "Esta conta não tem um personagem associado. Fale com a administração do RPG.");
}

/* ---------- feed ---------- */
function startFeed() {
  if (unsubscribeFeed) unsubscribeFeed();
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(60));
  unsubscribeFeed = onSnapshot(q, (snap) => {
    posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPosts();
  }, (err) => {
    console.error(err);
    toast("Não foi possível carregar o feed. Confira as regras do Firestore.");
  });
}

function renderPosts() {
  const search = $("#searchInput").value.trim().toLowerCase();
  let visible = [...posts];
  if (activeTag) visible = visible.filter((p) => (p.text || "").toLowerCase().includes(activeTag.toLowerCase()));
  if (search) visible = visible.filter((p) => [p.text, p.authorName].join(" ").toLowerCase().includes(search));
  $("#postFeed").innerHTML = visible.map((p) => `<article class="post">
    <div class="post-head"><span class="avatar post-avatar">${escapeHTML((p.authorName || "?").slice(0, 1).toUpperCase())}</span>
    <div class="post-author"><strong>${escapeHTML(p.authorName)}</strong><small>${escapeHTML(relativeTime(p.createdAt))}</small></div></div>
    <p class="post-text">${formatText(p.text || "")}</p>
    <div class="post-meta"><span>TRANSMISSÃO PÚBLICA</span></div></article>`).join("");
  $("#emptyState").hidden = visible.length > 0;
  $("#feedHeading").textContent = activeTag ? `Resultados para ${activeTag}` : search ? "Resultados da busca" : "Últimas transmissões";
  if (!visible.length) {
    const empty = posts.length === 0;
    $("#emptyState").querySelector("h3").textContent = empty ? "A rede está esperando a primeira transmissão" : "Nenhuma transmissão encontrada";
    $("#emptyState").querySelector("p").textContent = empty ? (currentUser ? "Publique como seu personagem e dê início à conversa." : "Entre ou crie sua conta para participar.") : "Tente outra busca.";
  }
}

async function publishPost() {
  if (!currentUser || !myProfile) { openAuth("login"); return; }
  const text = $("#postText").value.trim();
  if (!text) { toast("Escreva algo antes de transmitir."); return; }
  const btn = $("#publishButton");
  btn.disabled = true;
  btn.textContent = "TRANSMITINDO...";
  try {
    await addDoc(collection(db, "posts"), { authorUid: currentUser.uid, authorName: myProfile.characterName, text, createdAt: serverTimestamp() });
    $("#postText").value = "";
    $("#charCount").textContent = "0";
    toast("Transmissão publicada na rede.");
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
  } finally {
    btn.disabled = !currentUser || !myProfile;
    btn.innerHTML = "TRANSMITIR <span>↗</span>";
  }
}

function showConfigNeeded() {
  showModal("Configuração do Firebase necessária", "O arquivo firebase-config.js ainda está com os valores de exemplo ou o Firebase não carregou. Cole a configuração real do seu projeto nesse arquivo.");
}
function soon(name) { showModal(name, "Esta função ainda não existe — será construída nas próximas etapas, depois que login e feed estiverem estáveis."); }

/* ---------- eventos (registrados primeiro, antes de qualquer coisa do Firebase) ---------- */
$("#authButton").addEventListener("click", async () => {
  if (currentUser) {
    if (confirm("Deseja sair do Sinistagram?")) {
      try { await signOut(auth); toast("Sessão encerrada."); } catch (err) { toast(friendlyError(err)); }
    }
  } else openAuth("login");
});
$("#publishButton").addEventListener("click", publishPost);
$("#postText").addEventListener("input", (e) => { $("#charCount").textContent = e.target.value.length; });
$("#postText").addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") publishPost(); });
$("#jumpToComposer").addEventListener("click", () => {
  if (!currentUser || !myProfile) { openAuth("login"); return; }
  $("#composer").scrollIntoView({ behavior: "smooth", block: "center" });
  $("#postText").focus({ preventScroll: true });
});
$("#searchInput").addEventListener("input", () => { activeTag = ""; renderPosts(); });
$$(".trend-item").forEach((b) => b.addEventListener("click", () => {
  activeTag = b.dataset.tag;
  $("#viewTitle").textContent = "BUSCA POR HASHTAG";
  renderPosts();
  $("#feedHeading").scrollIntoView({ behavior: "smooth", block: "center" });
}));
$$(".nav-item").forEach((b) => b.addEventListener("click", () => {
  const v = b.dataset.view;
  if (v === "messages") { soon("Mensagens privadas"); return; }
  if (v === "profile") {
    if (!myProfile) { openAuth("login"); return; }
    showModal("Seu personagem", "Perfil vinculado à sua conta.", `<div class="profile-large"><span class="avatar">${escapeHTML(myProfile.characterName.slice(0, 1).toUpperCase())}</span><div><strong>${escapeHTML(myProfile.characterName)}</strong></div></div><div class="profile-stats"><div><strong>${posts.filter((p) => p.authorUid === currentUser.uid).length}</strong><small>Publicações</small></div></div>`);
    return;
  }
  activeTag = ""; $("#searchInput").value = ""; $("#viewTitle").textContent = "FEED PÚBLICO"; renderPosts();
}));
$("#exploreButton").addEventListener("click", () => $("#feedHeading").scrollIntoView({ behavior: "smooth", block: "center" }));
$("#openProfile").addEventListener("click", () => { if (!myProfile) openAuth("login"); else $('.nav-item[data-view="profile"]').click(); });
$("#closeModal").addEventListener("click", () => $("#modal").close());
$("#modal").addEventListener("click", (e) => { if (e.target === $("#modal")) $("#modal").close(); });
$("#addCircle").addEventListener("click", () => soon("Círculos"));
$("#addStory").addEventListener("click", () => soon("Histórias"));
$$(".story:not(.add-story)").forEach((s) => s.addEventListener("click", () => soon("Histórias")));
$("#adButton").addEventListener("click", () => showModal("VoxTek Industries", "Anúncio fictício do universo do Sinistagram."));

/* ---------- Firebase (se falhar, a interface continua respondendo) ---------- */
setAuthUI();
renderPosts();
if (!configReady) {
  console.warn("firebase-config.js ainda tem valores de exemplo.");
} else {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    startFeed();
    onAuthStateChanged(auth, async (user) => {
      currentUser = user;
      myProfile = null;
      if (user && !signingUp) {
        try { await loadMyProfile(user); } catch (err) { console.error(err); toast(friendlyError(err)); }
      }
      setAuthUI();
      renderPosts();
    });
  } catch (err) {
    console.error("Erro ao iniciar o Firebase:", err);
    toast("Erro ao iniciar o Firebase. Veja o console.");
  }
}
