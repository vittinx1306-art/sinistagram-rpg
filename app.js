// Sinistagram — versão 1: login, cadastro, publicações e feed em tempo real.
// Usa apenas Firebase Authentication + Firestore (sem Storage, sem plano pago).
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, addDoc, onSnapshot, query, orderBy, serverTimestamp, limit, runTransaction, getDocs } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let auth = null, db = null;
let initError = "";
let currentUser = null, myProfile = null, posts = [], signingUp = false, unsubscribeFeed = null;

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
  $("#authButton").textContent = currentUser ? "Sair" : "Entrar";
  $("#postText").disabled = !logged;
  $("#publishButton").disabled = !logged;
  $("#postText").placeholder = logged ? `O que está acontecendo, ${myProfile.characterName}?` : "Entre para publicar como seu personagem...";
  $("#sidebarName").textContent = myProfile?.characterName || "Visitante";
  $("#sidebarHandle").textContent = logged ? "Conectado" : "Entre para participar";
  $("#sidebarAvatar").textContent = initial;
  $("#composerAvatar").textContent = initial;
}

/* ---------- login / cadastro ---------- */
function openAuth(mode = "login") {
  if (!configReady || !auth) { showConfigNeeded(); return; }
  const isSignup = mode === "signup";
  const form = `<form id="authForm" class="auth-form">
    ${isSignup ? `<label>Nome do personagem<input name="characterName" maxlength="40" placeholder="Nome do seu personagem" required></label>` : ""}
    <label>E-mail<input name="email" type="email" autocomplete="email" required></label>
    <label>Senha<input name="password" type="password" minlength="6" autocomplete="${isSignup ? "new-password" : "current-password"}" required></label>
    <button class="btn-primary auth-submit" type="submit">${isSignup ? "Criar conta" : "Entrar"}</button>
    <p class="auth-switch">${isSignup ? "Já tem uma conta?" : "Ainda não tem conta?"} <button type="button" id="switchAuth">${isSignup ? "Entrar" : "Criar conta"}</button></p>
    ${isSignup ? '<p class="auth-note">Um personagem por conta. Seu e-mail não aparece para ninguém, só o nome do personagem.</p>' : ""}
  </form>`;
  showModal(isSignup ? "Criar conta" : "Entrar", isSignup ? "Escolha o nome do seu personagem, um e-mail e uma senha." : "Use o e-mail e a senha da sua conta.", form);
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
  submit.textContent = "Aguarde...";
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
      renderSuggestions();
      toast("Conta criada. Bem-vindo!");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      toast("Você entrou.");
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
  if (!myProfile) showModal("Perfil não encontrado", "Esta conta não tem um personagem associado. Fale com a administração.");
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
  if (search) visible = visible.filter((p) => [p.text, p.authorName].join(" ").toLowerCase().includes(search));
  $("#postFeed").innerHTML = visible.map((p) => `<article class="post">
    <div class="post-head"><span class="avatar">${escapeHTML((p.authorName || "?").slice(0, 1).toUpperCase())}</span>
    <div class="post-author"><strong>${escapeHTML(p.authorName)}</strong><small>${escapeHTML(relativeTime(p.createdAt))}</small></div></div>
    <p class="post-text">${formatText(p.text || "")}</p></article>`).join("");
  $("#emptyState").hidden = visible.length > 0;
  $("#feedHeading").textContent = search ? "Resultados da busca" : "Publicações recentes";
  if (!visible.length) {
    const empty = posts.length === 0;
    $("#emptyState").querySelector("h3").textContent = empty ? "Nada por aqui ainda" : "Nada encontrado";
    $("#emptyState").querySelector("p").textContent = empty ? (currentUser ? "Seja a primeira pessoa a publicar." : "Entre ou crie sua conta para participar.") : "Tente outra busca.";
  }
}

async function publishPost() {
  if (!currentUser || !myProfile) { openAuth("login"); return; }
  const text = $("#postText").value.trim();
  if (!text) { toast("Escreva algo antes de publicar."); return; }
  const btn = $("#publishButton");
  btn.disabled = true;
  btn.textContent = "Publicando...";
  try {
    await addDoc(collection(db, "posts"), { authorUid: currentUser.uid, authorName: myProfile.characterName, text, createdAt: serverTimestamp() });
    $("#postText").value = "";
    $("#charCount").textContent = "0";
    toast("Publicado!");
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
  } finally {
    btn.disabled = !currentUser || !myProfile;
    btn.textContent = "Publicar";
  }
}

function showConfigNeeded() {
  const motivo = !configReady
    ? "O firebase-config.js carregou, mas ainda tem valores de exemplo (apiKey ou projectId)."
    : initError
      ? "O Firebase não iniciou. Erro: " + initError
      : "O Firebase ainda não iniciou. Recarregue a página e tente de novo.";
  showModal("Não foi possível conectar ao Firebase", motivo);
}

/* ---------- sugestões reais (personagens cadastrados) ---------- */
async function renderSuggestions() {
  const box = $("#suggestedUsers");
  if (!db) return;
  try {
    const snap = await getDocs(query(collection(db, "profiles"), limit(12)));
    const list = snap.docs.map((d) => d.data());
    box.innerHTML = list.length ? list.map((p) => `<div class="suggested-user"><span class="avatar">${escapeHTML((p.characterName || "?").slice(0, 1).toUpperCase())}</span><strong>${escapeHTML(p.characterName)}</strong></div>`).join("") : '<p class="muted">Ninguém se cadastrou ainda.</p>';
  } catch (err) { console.error(err); }
}

/* ---------- eventos (registrados primeiro, antes de qualquer coisa do Firebase) ---------- */
function goCompose() {
  if (!currentUser || !myProfile) { openAuth("login"); return; }
  $("#composer").scrollIntoView({ behavior: "smooth", block: "center" });
  $("#postText").focus({ preventScroll: true });
}
function openMyProfile() {
  if (!myProfile) { openAuth("login"); return; }
  showModal("Seu personagem", "Perfil vinculado à sua conta.", `<div class="profile-large"><span class="avatar">${escapeHTML(myProfile.characterName.slice(0, 1).toUpperCase())}</span><strong>${escapeHTML(myProfile.characterName)}</strong></div><div class="profile-stats"><div><strong>${posts.filter((p) => p.authorUid === currentUser.uid).length}</strong><small>Publicações</small></div></div>`);
}
$("#authButton").addEventListener("click", async () => {
  if (currentUser) {
    if (confirm("Deseja sair do Sinistagram?")) {
      try { await signOut(auth); toast("Você saiu."); } catch (err) { toast(friendlyError(err)); }
    }
  } else openAuth("login");
});
$("#publishButton").addEventListener("click", publishPost);
$("#postText").addEventListener("input", (e) => { $("#charCount").textContent = e.target.value.length; });
$("#postText").addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") publishPost(); });
$("#searchInput").addEventListener("input", renderPosts);
$$(".nav-item").forEach((b) => b.addEventListener("click", () => {
  const v = b.dataset.view;
  if (v === "compose") { goCompose(); return; }
  if (v === "profile") { openMyProfile(); return; }
  $("#searchInput").value = "";
  renderPosts();
  window.scrollTo({ top: 0, behavior: "smooth" });
}));
$("#openProfile").addEventListener("click", openMyProfile);
$("#closeModal").addEventListener("click", () => $("#modal").close());
$("#modal").addEventListener("click", (e) => { if (e.target === $("#modal")) $("#modal").close(); });

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
    renderSuggestions();
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
    initError = (err && (err.code || err.message)) || String(err);
    console.error("Erro ao iniciar o Firebase:", err);
    toast("Erro ao iniciar o Firebase. Veja o console.");
  }
}
