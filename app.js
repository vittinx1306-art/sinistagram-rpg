// COVEN — versão 7 (excluir publicação e recuperar senha): login, cadastro, publicações e feed em tempo real.
// Usa apenas Firebase Authentication + Firestore (sem Storage, sem plano pago).
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, addDoc, onSnapshot, query, orderBy, serverTimestamp, limit, runTransaction, getDocs, setDoc, deleteDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let auth = null, db = null;
let currentUser = null, myProfile = null, posts = [], profiles = [], likes = [], comments = [], characters = [], activeId = null, signingUp = false, unsubscribeFeed = null;
const openComments = new Set(), drafts = {};
let sendingComment = false, manageOpen = false;
const MAX_CHARS = 10;

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
  manageOpen = false;
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
  const ch = activeChar();
  const logged = !!currentUser && !!myProfile && !!ch;
  const shown = ch?.name || myProfile?.characterName || "";
  const initial = shown.slice(0, 1).toUpperCase() || "?";
  $("#authButton").textContent = currentUser ? "Sair" : "Entrar";
  $("#postText").disabled = !logged;
  $("#publishButton").disabled = !logged;
  $("#postText").placeholder = logged ? `O que está acontecendo, ${ch.name}?` : "Entre para publicar como seu personagem...";
  $("#sidebarName").textContent = shown || "Visitante";
  $("#sidebarHandle").textContent = logged ? "Personagem ativo" : "Entre para participar";
  $("#sidebarAvatar").textContent = initial;
  $("#composerAvatar").textContent = initial;
  const hh = hue(shown);
  $("#sidebarAvatar").style.setProperty("--h", hh);
  $("#composerAvatar").style.setProperty("--h", hh);
  const mine = myCharacters();
  $("#asRow").hidden = !(currentUser && mine.length > 1);
  $("#charSelect").innerHTML = charOptions(mine, ch);
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
    ${isSignup ? "" : '<p class="auth-switch"><button type="button" id="forgotPass">Esqueci minha senha</button></p>'}
    <p class="auth-switch">${isSignup ? "Já tem uma conta?" : "Ainda não tem conta?"} <button type="button" id="switchAuth">${isSignup ? "Entrar" : "Criar conta"}</button></p>
    ${isSignup ? '<p class="auth-note">Você poderá criar até 10 personagens na mesma conta. Seu e-mail não aparece para ninguém, só o nome do personagem.</p>' : ""}
  </form>`;
  showModal(isSignup ? "Criar conta" : "Entrar", isSignup ? "Escolha o nome do seu personagem, um e-mail e uma senha." : "Use o e-mail e a senha da sua conta.", form);
  $("#switchAuth").addEventListener("click", () => openAuth(isSignup ? "login" : "signup"));
  $("#authForm").addEventListener("submit", (e) => handleAuthSubmit(e, isSignup));
  const forgot = $("#forgotPass");
  if (forgot) forgot.addEventListener("click", async () => {
    const email = String($("#authForm").elements.email.value || "").trim();
    if (!email) { toast("Digite seu e-mail no campo acima e toque de novo."); return; }
    forgot.disabled = true;
    try {
      await sendPasswordResetEmail(auth, email);
      toast("Se houver uma conta com esse e-mail, enviamos o link para criar uma nova senha. Olhe também o spam.");
    } catch (err) { console.error(err); toast(friendlyError(err)); }
    finally { forgot.disabled = false; }
  });
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
          tx.set(doc(db, "characters", `${cred.user.uid}_0`), { ownerUid: cred.user.uid, slot: 0, name: characterName, key: characterKey, createdAt: serverTimestamp() });
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
  loadActiveFromStorage();
  if (myProfile) await ensureFirstCharacter(user);
  setAuthUI();
  renderPosts();
  if (!myProfile) showModal("Perfil não encontrado", "Esta conta não tem um personagem associado. Fale com a administração.");
}
// Contas criadas antes da v6 têm só o perfil: o personagem antigo vira o personagem 1.
async function ensureFirstCharacter(user) {
  try {
    const q = await getDocs(query(collection(db, "characters"), where("ownerUid", "==", user.uid), limit(1)));
    if (!q.empty) return;
    await setDoc(doc(db, "characters", `${user.uid}_0`), { ownerUid: user.uid, slot: 0, name: myProfile.characterName, key: myProfile.characterKey, createdAt: serverTimestamp() });
  } catch (err) { console.error(err); }
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

function tsMillis(ts) { return ts?.toMillis ? ts.toMillis() : Date.now(); }
function commentsHTML(p) {
  const list = comments.filter((c) => c.postId === p.id).sort((a, b) => tsMillis(a.createdAt) - tsMillis(b.createdAt));
  const items = list.length ? list.map((c) => `<div class="comment" style="--h:${hue(c.authorName)}">
      <button class="who" data-profile="${escapeHTML(postCharId(c))}" data-pname="${escapeHTML(c.authorName)}" aria-label="Ver perfil"><span class="avatar sm" style="--h:${hue(c.authorName)}">${escapeHTML((c.authorName || "?").slice(0, 1).toUpperCase())}</span></button>
      <div class="comment-body"><div class="comment-head"><strong>${escapeHTML(c.authorName)}</strong><small>${escapeHTML(relativeTime(c.createdAt))}</small>${currentUser && currentUser.uid === c.authorUid ? `<button class="comment-del" data-cdel="${escapeHTML(c.id)}" aria-label="Apagar comentário">×</button>` : ""}</div>
      <p>${formatText(c.text || "")}</p></div></div>`).join("") : '<p class="muted comment-empty">Nenhum comentário ainda.</p>';
  const mine = myCharacters(), ch = activeChar();
  let form;
  if (currentUser && myProfile && ch) {
    const asRow = mine.length > 1 ? `<label class="comment-as">Comentando como <select class="char-select" aria-label="Personagem ativo">${charOptions(mine, ch)}</select></label>` : "";
    form = `<div class="comment-compose">${asRow}<div class="comment-form"><input class="comment-input" data-cinput="${escapeHTML(p.id)}" maxlength="300" autocomplete="off" placeholder="Comentar como ${escapeHTML(ch.name)}..." value="${escapeHTML(drafts[p.id] || "")}"><button class="btn-primary comment-send" data-csend="${escapeHTML(p.id)}">Enviar</button></div></div>`;
  } else if (currentUser && myProfile) {
    form = '<p class="muted">Carregando personagens...</p>';
  } else {
    form = '<button class="comment-login" data-cauth>Entre para comentar</button>';
  }
  return `<div class="comments">${items}${form}</div>`;
}

function renderPosts() {
  const ae = document.activeElement;
  const keep = ae && ae.matches && ae.matches(".comment-input") ? { id: ae.dataset.cinput, s: ae.selectionStart, e: ae.selectionEnd } : null;
  const search = $("#searchInput").value.trim().toLowerCase();
  let visible = [...posts];
  if (search) visible = visible.filter((p) => [p.text, p.authorName].join(" ").toLowerCase().includes(search));
  $("#postFeed").innerHTML = visible.map((p) => {
    const n = likes.filter((l) => l.postId === p.id).length;
    const on = !!currentUser && likes.some((l) => l.postId === p.id && l.uid === currentUser.uid);
    const cn = comments.filter((c) => c.postId === p.id).length;
    const open = openComments.has(p.id);
    return `<article class="post" style="--h:${hue(p.authorName)}">
    <button class="who" data-profile="${escapeHTML(postCharId(p))}" data-pname="${escapeHTML(p.authorName)}"><span class="avatar" style="--h:${hue(p.authorName)}">${escapeHTML((p.authorName || "?").slice(0, 1).toUpperCase())}</span>
    <span class="post-author"><strong>${escapeHTML(p.authorName)}</strong><small>@${escapeHTML(makeKey(p.authorName || ""))} · ${escapeHTML(relativeTime(p.createdAt))}</small></span></button>
    <p class="post-text">${formatText(p.text || "")}</p>
    <div class="post-actions"><button class="like${on ? " on" : ""}" data-like="${escapeHTML(p.id)}" aria-pressed="${on}" aria-label="Curtir"><span>${on ? "♥" : "♡"}</span> ${n}</button><button class="like cbtn${open ? " on" : ""}" data-comments="${escapeHTML(p.id)}" aria-expanded="${open}" aria-label="Comentários"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg> ${cn}</button>${currentUser && currentUser.uid === p.authorUid ? `<button class="post-del" data-delpost="${escapeHTML(p.id)}" aria-label="Excluir publicação">Excluir</button>` : ""}</div>${open ? commentsHTML(p) : ""}</article>`;
  }).join("");
  if (keep) {
    const el = document.querySelector(`.comment-input[data-cinput="${CSS.escape(keep.id)}"]`);
    if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.s, keep.e); } catch (_) {} }
  }
  $("#emptyState").hidden = visible.length > 0;
  $("#feedHeading").textContent = search ? "Resultados da busca" : "Publicações recentes";
  if (!visible.length) {
    const empty = posts.length === 0;
    $("#emptyState").querySelector("h3").textContent = empty ? "Nada por aqui ainda" : "Nada encontrado";
    $("#emptyState").querySelector("p").textContent = empty ? (currentUser ? "Seja a primeira pessoa a publicar." : "Entre ou crie sua conta para participar.") : "Tente outra busca.";
  }
}

async function publishPost() {
  const ch = activeChar();
  if (!currentUser || !myProfile || !ch) { openAuth("login"); return; }
  const text = $("#postText").value.trim();
  if (!text) { toast("Escreva algo antes de publicar."); return; }
  const btn = $("#publishButton");
  btn.disabled = true;
  btn.textContent = "Publicando...";
  try {
    await addDoc(collection(db, "posts"), { authorUid: currentUser.uid, characterId: ch.id, authorName: ch.name, text, createdAt: serverTimestamp() });
    $("#postText").value = "";
    $("#charCount").textContent = "0";
    toast("Publicado!");
  } catch (err) {
    console.error(err);
    toast(friendlyError(err));
  } finally {
    btn.disabled = !currentUser || !myProfile || !activeChar();
    btn.textContent = "Publicar";
  }
}

function showConfigNeeded() {
  showModal("Configuração do Firebase necessária", "O arquivo firebase-config.js ainda está com os valores de exemplo ou o Firebase não carregou. Cole a configuração real do seu projeto nesse arquivo.");
}

/* ---------- sugestões reais (personagens cadastrados) ---------- */
function renderSuggestions() {
  const list = characters.slice(0, 20);
  const av = (c, cls = "") => `<span class="avatar${cls}" style="--h:${hue(c.name)}">${escapeHTML((c.name || "?").slice(0, 1).toUpperCase())}</span>`;
  $("#suggestedUsers").innerHTML = list.length ? list.slice(0, 12).map((c) => `<button class="suggested-user" data-profile="${escapeHTML(c.id)}" data-pname="${escapeHTML(c.name)}">${av(c)}<strong>${escapeHTML(c.name)}</strong></button>`).join("") : '<p class="muted">Ninguém se cadastrou ainda.</p>';
  $("#stories").innerHTML = list.map((c) => `<button class="story" data-profile="${escapeHTML(c.id)}" data-pname="${escapeHTML(c.name)}">${av(c, " xl")}<small>${escapeHTML(c.name)}</small></button>`).join("");
  $("#stories").hidden = !list.length;
}

/* ---------- v6: vários personagens por conta ---------- */
const myCharacters = () => currentUser ? characters.filter((c) => c.ownerUid === currentUser.uid).sort((a, b) => a.slot - b.slot) : [];
function activeChar() { const mine = myCharacters(); return mine.find((c) => c.id === activeId) || mine[0] || null; }
function postCharId(p) { return p.characterId || `${p.authorUid}_0`; }
function charOptions(mine, ch) { return mine.map((c) => `<option value="${escapeHTML(c.id)}"${ch && ch.id === c.id ? " selected" : ""}>${escapeHTML(c.name)}</option>`).join(""); }
function loadActiveFromStorage() { try { activeId = currentUser ? localStorage.getItem(`coven_active_${currentUser.uid}`) : null; } catch (_) { activeId = null; } }
function setActive(id) {
  activeId = id;
  try { if (currentUser) localStorage.setItem(`coven_active_${currentUser.uid}`, id); } catch (_) {}
  setAuthUI();
  renderPosts();
}
function startCharacters() {
  onSnapshot(query(collection(db, "characters"), orderBy("createdAt", "desc"), limit(200)), (snap) => {
    characters = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setAuthUI(); renderSuggestions(); renderPosts();
    if (manageOpen && $("#modal").open && !($("#newCharName") && $("#newCharName").value)) openManage();
  }, (err) => { console.error(err); toast("Não foi possível carregar os personagens. Publique as regras novas do Firestore."); });
}
async function createCharacter(rawName) {
  const mine = myCharacters();
  if (mine.length >= MAX_CHARS) { toast("Você já tem 10 personagens."); return false; }
  const name = rawName.trim(), key = makeKey(name);
  if (name.length < 2 || !key) { toast("Escolha um nome com pelo menos 2 letras ou números."); return false; }
  const used = new Set(mine.map((c) => c.slot));
  let slot = 0; while (slot < MAX_CHARS && used.has(slot)) slot++;
  if (slot >= MAX_CHARS) { toast("Você já tem 10 personagens."); return false; }
  const uid = currentUser.uid;
  try {
    await runTransaction(db, async (tx) => {
      const claimRef = doc(db, "characterClaims", key), charRef = doc(db, "characters", `${uid}_${slot}`);
      const claim = await tx.get(claimRef), taken = await tx.get(charRef);
      if (taken.exists()) throw new Error("Essa vaga acabou de ser usada. Tente de novo.");
      if (claim.exists() && claim.data().uid !== uid) throw new Error("Esse nome de personagem já foi escolhido.");
      const finalName = claim.exists() ? claim.data().characterName : name;
      if (!claim.exists()) tx.set(claimRef, { uid, characterName: name, createdAt: serverTimestamp() });
      tx.set(charRef, { ownerUid: uid, slot, name: finalName, key, createdAt: serverTimestamp() });
    });
    toast("Personagem criado!");
    return true;
  } catch (err) { console.error(err); toast(friendlyError(err)); return false; }
}
async function deleteCharacter(id) {
  const mine = myCharacters(), c = mine.find((x) => x.id === id);
  if (!c) return;
  if (mine.length <= 1) { toast("Você precisa manter pelo menos um personagem."); return; }
  if (!confirm(`Excluir o personagem ${c.name}? As publicações dele continuam no feed.`)) return;
  try { await deleteDoc(doc(db, "characters", id)); toast("Personagem excluído."); }
  catch (err) { console.error(err); toast(friendlyError(err)); }
}
function openManage() {
  if (!currentUser || !myProfile) { openAuth("login"); return; }
  const mine = myCharacters(), ch = activeChar();
  const rows = mine.map((c) => `<div class="char-row"><span class="avatar sm" style="--h:${hue(c.name)}">${escapeHTML(c.name.slice(0, 1).toUpperCase())}</span><span class="char-info"><strong>${escapeHTML(c.name)}</strong><small>@${escapeHTML(makeKey(c.name))}</small></span>${ch && ch.id === c.id ? '<span class="char-badge">Ativo</span>' : `<button class="char-use" data-use="${escapeHTML(c.id)}">Usar</button>`}<button class="comment-del" data-delchar="${escapeHTML(c.id)}" aria-label="Excluir personagem">×</button></div>`).join("");
  const form = mine.length < MAX_CHARS
    ? '<form id="charForm" class="char-form"><input id="newCharName" maxlength="40" autocomplete="off" placeholder="Nome do novo personagem" required><button class="btn-primary" type="submit">Criar</button></form>'
    : '<p class="muted">Limite de 10 personagens atingido.</p>';
  showModal("Meus personagens", `${mine.length} de ${MAX_CHARS} personagens`, `<div class="char-list">${rows}</div>${form}`);
  manageOpen = true;
  const f = $("#charForm");
  if (f) f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#newCharName");
    if (await createCharacter(input.value)) { input.value = ""; openManage(); }
  });
}

/* ---------- v3: curtidas reais, cores por personagem, perfis ---------- */
const HUES = [340, 350, 8, 20, 320, 300, 0, 28];
function hue(name) { let h = 0; for (const c of String(name || "")) h = (h * 31 + c.charCodeAt(0)) % 997; return HUES[h % HUES.length]; }
function startLikes() {
  onSnapshot(query(collection(db, "likes"), limit(1000)), (snap) => { likes = snap.docs.map((d) => d.data()); renderPosts(); }, (err) => console.error(err));
}
function startComments() {
  onSnapshot(query(collection(db, "comments"), orderBy("createdAt", "desc"), limit(1000)), (snap) => { comments = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderPosts(); }, (err) => { console.error(err); toast("Não foi possível carregar os comentários. Publique as regras novas do Firestore."); });
}
async function sendComment(postId) {
  const ch = activeChar();
  if (!currentUser || !myProfile || !ch) { openAuth("login"); return; }
  if (sendingComment) return;
  const input = document.querySelector(`.comment-input[data-cinput="${CSS.escape(postId)}"]`);
  const text = (input ? input.value : drafts[postId] || "").trim();
  if (!text) { toast("Escreva algo antes de enviar."); return; }
  sendingComment = true;
  try {
    await addDoc(collection(db, "comments"), { postId, authorUid: currentUser.uid, characterId: ch.id, authorName: ch.name, text: text.slice(0, 300), createdAt: serverTimestamp() });
    drafts[postId] = "";
    if (input) input.value = "";
  } catch (err) { console.error(err); toast(friendlyError(err)); }
  finally { sendingComment = false; }
}
async function deletePost(id) {
  const p = posts.find((x) => x.id === id);
  if (!p || !currentUser || p.authorUid !== currentUser.uid) return;
  if (!confirm("Excluir esta publicação? Os comentários e as curtidas dela também serão apagados.")) return;
  const refs = [
    ...comments.filter((c) => c.postId === id).map((c) => doc(db, "comments", c.id)),
    ...likes.filter((l) => l.postId === id).map((l) => doc(db, "likes", `${l.postId}_${l.uid}`)),
  ];
  try {
    for (let i = 0; i < refs.length; i += 400) {
      const b = writeBatch(db);
      refs.slice(i, i + 400).forEach((r) => b.delete(r));
      await b.commit();
    }
    await deleteDoc(doc(db, "posts", id));
    openComments.delete(id);
    toast("Publicação excluída.");
  } catch (err) { console.error(err); toast(friendlyError(err)); }
}
async function removeComment(id) {
  if (!confirm("Apagar este comentário?")) return;
  try { await deleteDoc(doc(db, "comments", id)); }
  catch (err) { console.error(err); toast(friendlyError(err)); }
}
async function toggleLike(postId) {
  if (!currentUser || !myProfile) { openAuth("login"); return; }
  const ref = doc(db, "likes", `${postId}_${currentUser.uid}`);
  const liked = likes.some((l) => l.postId === postId && l.uid === currentUser.uid);
  try { liked ? await deleteDoc(ref) : await setDoc(ref, { postId, uid: currentUser.uid, createdAt: serverTimestamp() }); }
  catch (err) { console.error(err); toast(friendlyError(err)); }
}
document.addEventListener("change", (e) => { const s = e.target.closest && e.target.closest(".char-select"); if (s) setActive(s.value); });
document.addEventListener("input", (e) => { const i = e.target.closest && e.target.closest(".comment-input"); if (i) drafts[i.dataset.cinput] = i.value; });
document.addEventListener("keydown", (e) => { const i = e.target.closest && e.target.closest(".comment-input"); if (i && e.key === "Enter") { e.preventDefault(); sendComment(i.dataset.cinput); } });
document.addEventListener("click", (e) => {
  const l = e.target.closest("[data-like]"); if (l) { toggleLike(l.dataset.like); return; }
  const c = e.target.closest("[data-comments]"); if (c) { const id = c.dataset.comments; openComments.has(id) ? openComments.delete(id) : openComments.add(id); renderPosts(); return; }
  const s = e.target.closest("[data-csend]"); if (s) { sendComment(s.dataset.csend); return; }
  const d = e.target.closest("[data-cdel]"); if (d) { removeComment(d.dataset.cdel); return; }
  const dp = e.target.closest("[data-delpost]"); if (dp) { deletePost(dp.dataset.delpost); return; }
  if (e.target.closest("[data-cauth]")) { openAuth("login"); return; }
  const us = e.target.closest("[data-use]"); if (us) { setActive(us.dataset.use); openManage(); return; }
  const dc = e.target.closest("[data-delchar]"); if (dc) { deleteCharacter(dc.dataset.delchar); return; }
  const u = e.target.closest("[data-profile]"); if (u) openProfile(u.dataset.profile, u.dataset.pname);
});

/* ---------- eventos (registrados primeiro, antes de qualquer coisa do Firebase) ---------- */
function goCompose() {
  if (!currentUser || !myProfile) { openAuth("login"); return; }
  $("#composer").scrollIntoView({ behavior: "smooth", block: "center" });
  $("#postText").focus({ preventScroll: true });
}
function openMyProfile() { openManage(); }
function openProfile(id, nameHint) {
  let c = characters.find((x) => x.id === id) || null;
  if (c && nameHint && c.name !== nameHint) c = null; // a vaga foi reaproveitada por outro personagem
  const name = c?.name || nameHint || "Personagem";
  const mine = posts.filter((x) => postCharId(x) === id && x.authorName === name);
  const got = likes.filter((l) => mine.some((x) => x.id === l.postId)).length;
  const since = c?.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString("pt-BR") : "";
  const recent = mine.slice(0, 3).map((x) => `<p class="pcard-post">${formatText(x.text)}</p>`).join("");
  showModal("Personagem", since ? `Na rede desde ${since}` : "Perfil público", `<div class="pcard" style="--h:${hue(name)}"><span class="avatar xl" style="--h:${hue(name)}">${escapeHTML(name.slice(0, 1).toUpperCase())}</span><h3>${escapeHTML(name)}</h3><p class="handle">@${escapeHTML(makeKey(name))}</p><div class="profile-stats"><div><strong>${mine.length}</strong><small>publicações</small></div><div><strong>${got}</strong><small>curtidas</small></div></div></div>${recent}`);
}
$("#authButton").addEventListener("click", async () => {
  if (currentUser) {
    if (confirm("Deseja sair do COVEN?")) {
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
$("#modal").addEventListener("close", () => { manageOpen = false; });
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
    startLikes();
    startComments();
    startCharacters();
    renderSuggestions();
    onAuthStateChanged(auth, async (user) => {
      currentUser = user;
      myProfile = null;
      activeId = null;
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
