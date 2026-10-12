/* RIO BOX — single-page app */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function api(method, url, body, isForm) {
  const opts = { method, headers: {} };
  if (body && !isForm) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body && isForm) {
    opts.body = body;
  }
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

let me = null;

async function refreshMe() {
  try {
    const d = await api('GET', '/api/auth/me');
    me = d.user;
  } catch (e) {
    me = null;
  }
  updateHeader();
}

function avatarHtml(user, size = 32) {
  if (!user) return '';
  const initial = esc((user.username || '?')[0].toUpperCase());
  if (user.avatar) {
    return `<img class="avatar" style="width:${size}px;height:${size}px" src="${esc(user.avatar)}" alt="${esc(user.username)}">`;
  }
  return `<span class="avatar-initial" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.44)}px">${initial}</span>`;
}

function updateHeader() {
  const nav = $('#mainNav');
  if (me) {
    nav.innerHTML = `
      <a class="btn" href="#/">Home</a>
      <a class="btn" href="#/upload">+ Create</a>
      <a class="btn btn-ghost" href="#/boards">Boards</a>
      <a class="btn btn-ghost" href="#/settings" title="Settings">⚙</a>
      <a href="#/user/${esc(me.username)}" title="${esc(me.username)}">${avatarHtml(me, 38)}</a>
      <button class="btn btn-ghost" id="logoutBtn">Log out</button>`;
    $('#logoutBtn').addEventListener('click', async () => {
      await api('POST', '/api/auth/logout');
      me = null;
      updateHeader();
      location.hash = '#/';
    });
  } else {
    nav.innerHTML = `
      <a class="btn" href="#/">Home</a>
      <a class="btn btn-ghost" href="#/login">Log in</a>
      <a class="btn btn-primary" href="#/signup">Sign up</a>`;
  }
}

$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  location.hash = q ? '#/?q=' + encodeURIComponent(q) : '#/';
});

/* ---------------- shared bits ---------------- */

const googleSvg = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.3H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.6-5.1 3.6-8.5z"/><path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.8-5l-3.9 3C3.3 21.3 7.3 24 12 24z"/><path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4l-3.9-3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l3.9-3z"/><path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.3 0 3.3 2.7 1.3 6.6l3.9 3c.9-2.8 3.6-4.9 6.8-4.9z"/></svg>`;
const facebookSvg = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#1877F2" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3v-3.5h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 1-2 1.9V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12z"/></svg>`;

let oauthProviders = null;
async function getProviders() {
  if (oauthProviders) return oauthProviders;
  try { oauthProviders = await api('GET', '/api/auth/providers'); }
  catch (e) { oauthProviders = { google: false, facebook: false }; }
  return oauthProviders;
}

function mediaTag(p, inCard) {
  if (p.media_type === 'video') {
    return `<video src="${esc(p.media)}" ${inCard ? 'muted playsinline preload="metadata"' : 'controls playsinline'}></video>` +
      (inCard ? '<span class="badge-video">▶ Video</span>' : '');
  }
  return `<img src="${esc(p.media)}" alt="${esc(p.title)}" ${inCard ? 'loading="lazy"' : ''}>`;
}

function pinCard(p, opts = {}) {
  return `<div class="pin-card">
    ${opts.showRemove ? `<button class="btn btn-danger remove-pin" data-remove-pin="${p.id}">Remove</button>` : ''}
    <a href="#/pin/${p.id}" style="text-decoration:none;color:inherit">
      <div class="pin-media">${mediaTag(p, true)}<span class="pin-save-btn">Save</span></div>
      <div class="pin-meta">
        <div class="pin-title">${esc(p.title)}</div>
        <div class="pin-user">${avatarHtml(p.user, 24)}<span>${esc(p.user.username)}</span>
          <span style="margin-left:auto">♥ ${p.like_count}</span></div>
      </div>
    </a>
  </div>`;
}

function wireFeedVideos() {
  $$('#masonry video').forEach((v) => {
    const card = v.closest('.pin-card');
    card.addEventListener('mouseenter', () => v.play().catch(() => {}));
    card.addEventListener('mouseleave', () => { v.pause(); v.currentTime = 0; });
  });
}

function errorHtml(e) {
  return `<div class="error-box"><h2>Oops</h2><p>${esc(e.message)}</p><p><a href="#/">Back home</a></p></div>`;
}

/* ---------------- views ---------------- */

async function renderFeed(app, query) {
  const q = query.get('q') || '';
  $('#searchInput').value = q;
  app.innerHTML = `
    ${q ? `<h2 class="section-title" style="margin-top:0">Results for “${esc(q)}”</h2>` : ''}
    <div class="masonry" id="masonry"></div>
    <div class="loader" id="loader">Loading pins…</div>`;
  try {
    const { pins } = await api('GET', '/api/pins?limit=60' + (q ? `&search=${encodeURIComponent(q)}` : ''));
    const m = $('#masonry');
    if (!pins.length) {
      m.innerHTML = `<div class="empty">${q ? `No pins found for “${esc(q)}”.` : 'No pins yet.'} <a href="#/upload">Upload the first one!</a></div>`;
    } else {
      m.innerHTML = pins.map((p) => pinCard(p)).join('');
      wireFeedVideos();
    }
  } catch (e) {
    app.innerHTML = errorHtml(e);
    return;
  }
  $('#loader')?.remove();
}

async function renderPin(app, id) {
  app.innerHTML = `<div class="loader">Loading pin…</div>`;
  let pin, comments;
  try {
    const d = await api('GET', `/api/pins/${id}`);
    pin = d.pin; comments = d.comments;
  } catch (e) { app.innerHTML = errorHtml(e); return; }

  const tags = (pin.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
  const isOwner = me && me.id === pin.user.id;

  app.innerHTML = `
  <div class="pin-detail">
    <div class="pin-detail-media">${mediaTag(pin, false)}</div>
    <div class="pin-detail-info">
      <div class="pin-actions">
        <button class="btn like-btn ${pin.liked ? 'liked' : ''}" id="likeBtn">♥ <span id="likeCount">${pin.like_count}</span></button>
        <a class="btn" href="/api/pins/${pin.id}/download">⬇ Download</a>
        ${isOwner ? `<button class="btn btn-danger" id="deletePinBtn">Delete</button>` : ''}
      </div>
      <h1 style="margin:0;font-size:26px">${esc(pin.title)}</h1>
      ${pin.description ? `<div class="pin-desc">${esc(pin.description)}</div>` : ''}
      ${tags.length ? `<div class="pin-tags">${tags.map((t) => `<a class="tag" href="#/?q=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>` : ''}
      <a class="pin-uploader" href="#/user/${esc(pin.user.username)}">
        ${avatarHtml(pin.user, 44)}
        <span><span class="name">${esc(pin.user.username)}</span><br><span class="sub">View profile</span></span>
      </a>
      <div class="save-box" id="saveBox"></div>
      <div class="comments">
        <h3>Comments (${comments.length})</h3>
        <div id="commentList">${comments.map(commentHtml).join('') || '<p style="color:var(--muted);font-size:14px">No comments yet.</p>'}</div>
        ${me ? `<form class="comment-form" id="commentForm">
            <input class="text-input" id="commentInput" maxlength="1000" placeholder="Add a comment…" autocomplete="off">
            <button class="btn btn-primary" type="submit">Post</button>
          </form>` : `<p style="font-size:14px"><a href="#/login" style="color:var(--red);font-weight:700">Log in</a> to comment.</p>`}
      </div>
    </div>
  </div>`;

  // like
  $('#likeBtn').addEventListener('click', async () => {
    if (!me) { location.hash = '#/login'; return; }
    try {
      const d = await api(pin.liked ? 'DELETE' : 'POST', `/api/pins/${pin.id}/like`);
      pin.liked = d.liked;
      $('#likeBtn').classList.toggle('liked', d.liked);
      $('#likeCount').textContent = d.like_count;
    } catch (e) { alert(e.message); }
  });

  // delete
  $('#deletePinBtn')?.addEventListener('click', async () => {
    if (!confirm('Delete this pin?')) return;
    try { await api('DELETE', `/api/pins/${pin.id}`); location.hash = '#/'; }
    catch (e) { alert(e.message); }
  });

  // comments
  $('#commentForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#commentInput');
    const text = input.value.trim();
    if (!text) return;
    try {
      const { comment } = await api('POST', `/api/pins/${pin.id}/comments`, { text });
      $('#commentList').insertAdjacentHTML('beforeend', commentHtml(comment));
      input.value = '';
    } catch (err) { alert(err.message); }
  });

  renderSaveBox(pin);
}

function commentHtml(c) {
  return `<div class="comment">${avatarHtml(c.user, 32)}
    <div><span class="who">${esc(c.user.username)}</span>
    <span class="when">${esc(new Date(c.created_at).toLocaleString())}</span>
    <div class="body">${esc(c.text)}</div></div></div>`;
}

async function renderSaveBox(pin) {
  const box = $('#saveBox');
  if (!me) {
    box.innerHTML = `<h4>Save this pin</h4><a class="btn btn-primary" href="#/login">Log in to save to a board</a>`;
    return;
  }
  let boards = [];
  try { boards = (await api('GET', '/api/boards/mine')).boards; } catch (e) {}
  box.innerHTML = `
    <h4>Save to board</h4>
    <div class="save-row">
      <select id="saveBoardSel">${boards.map((b) => `<option value="${b.id}">${esc(b.name)} (${b.pin_count})</option>`).join('') || '<option value="">No boards yet</option>'}</select>
      <button class="btn btn-primary" id="savePinBtn">Save</button>
    </div>
    <div class="save-row">
      <input id="newBoardName" maxlength="80" placeholder="New board name…">
      <button class="btn" id="createBoardBtn">Create</button>
    </div>
    <div id="saveMsg" style="font-size:13px;color:var(--red-dark)"></div>`;

  $('#savePinBtn').addEventListener('click', async () => {
    const boardId = $('#saveBoardSel').value;
    if (!boardId) { $('#saveMsg').textContent = 'Create a board first.'; return; }
    try {
      await api('POST', `/api/boards/${boardId}/pins`, { pin_id: pin.id });
      $('#saveMsg').textContent = 'Saved!';
    } catch (e) { $('#saveMsg').textContent = e.message; }
  });

  $('#createBoardBtn').addEventListener('click', async () => {
    const name = $('#newBoardName').value.trim();
    if (!name) return;
    try {
      const { board } = await api('POST', '/api/boards', { name });
      await api('POST', `/api/boards/${board.id}/pins`, { pin_id: pin.id });
      $('#saveMsg').textContent = `Saved to “${board.name}”!`;
      renderSaveBox(pin);
    } catch (e) { $('#saveMsg').textContent = e.message; }
  });
}

function renderUpload(app) {
  if (!me) { location.hash = '#/login'; return; }
  app.innerHTML = `
  <div class="form-card" style="max-width:620px">
    <h1>Upload to RIO BOX</h1>
    <p class="lede">Share a photo or video with the community.</p>
    <div class="form-error" id="upErr" style="display:none"></div>
    <form id="uploadForm">
      <div class="field">
        <label class="file-drop" id="dropZone">Click to choose a photo or video
          <br><small>JPG, PNG, WEBP, GIF, MP4, WEBM — up to 50 MB</small>
          <input type="file" id="mediaInput" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm">
        </label>
        <div class="preview" id="preview" style="display:none"></div>
      </div>
      <div class="field"><label>Title</label><input id="fTitle" maxlength="120" required placeholder="Give your pin a title"></div>
      <div class="field"><label>Description</label><textarea id="fDesc" rows="3" maxlength="2000" placeholder="Tell people about it…"></textarea></div>
      <div class="field"><label>Tags (comma separated)</label><input id="fTags" maxlength="300" placeholder="nature, sunset, travel"></div>
      <button class="btn btn-primary" type="submit" id="upBtn" style="width:100%">Publish pin</button>
    </form>
  </div>`;

  const input = $('#mediaInput'), preview = $('#preview');
  input.addEventListener('change', () => {
    const f = input.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    preview.style.display = 'block';
    preview.innerHTML = f.type.startsWith('video')
      ? `<video src="${url}" controls playsinline></video>`
      : `<img src="${url}" alt="preview">`;
  });

  $('#uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#upErr');
    err.style.display = 'none';
    if (!input.files[0]) { err.textContent = 'Please choose a file first.'; err.style.display = 'block'; return; }
    const fd = new FormData();
    fd.append('media', input.files[0]);
    fd.append('title', $('#fTitle').value);
    fd.append('description', $('#fDesc').value);
    fd.append('tags', $('#fTags').value);
    $('#upBtn').disabled = true;
    $('#upBtn').textContent = 'Uploading…';
    try {
      const { pin } = await api('POST', '/api/pins', fd, true);
      location.hash = '#/pin/' + pin.id;
    } catch (ex) {
      err.textContent = ex.message; err.style.display = 'block';
      $('#upBtn').disabled = false; $('#upBtn').textContent = 'Publish pin';
    }
  });
}

function authForm(app, mode) {
  const isLogin = mode === 'login';
  app.innerHTML = `
  <div class="form-card">
    <h1>${isLogin ? 'Welcome back' : 'Join RIO BOX'}</h1>
    <p class="lede">${isLogin ? 'Log in to upload, like, save and comment.' : 'Create your account and start pinning.'}</p>
    <div class="form-error" id="authErr" style="display:none"></div>
    <form id="authForm">
      <div class="field"><label>Username</label><input id="aUser" required minlength="3" maxlength="20" pattern="[a-zA-Z0-9_]+" autocomplete="username" placeholder="yourname"></div>
      <div class="field"><label>Password</label><input id="aPass" type="password" required minlength="6" autocomplete="${isLogin ? 'current-password' : 'new-password'}" placeholder="••••••"></div>
      ${isLogin ? '' : '<div class="field"><label>Bio (optional)</label><input id="aBio" maxlength="500" placeholder="A little about you…"></div>'}
      <button class="btn btn-primary" type="submit" style="width:100%">${isLogin ? 'Log in' : 'Sign up'}</button>
    </form>
    <div class="switch">${isLogin ? 'New to RIO BOX? <a href="#/signup">Sign up</a>' : 'Already have an account? <a href="#/login">Log in</a>'}</div>
    <div id="oauthZone"></div>
  </div>`;
  $('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#authErr');
    err.style.display = 'none';
    try {
      const body = { username: $('#aUser').value.trim(), password: $('#aPass').value };
      if (!isLogin) body.bio = $('#aBio').value.trim();
      await api('POST', `/api/auth/${isLogin ? 'login' : 'signup'}`, body);
      await refreshMe();
      location.hash = '#/';
    } catch (ex) { err.textContent = ex.message; err.style.display = 'block'; }
  });
  // Social login buttons (only for providers the server has configured)
  getProviders().then((prov) => {
    const zone = $('#oauthZone');
    if (!zone) return;
    const btns = [];
    if (prov.google) btns.push(`<a class="btn oauth-btn" href="/api/auth/google">${googleSvg}<span>Continue with Google</span></a>`);
    if (prov.facebook) btns.push(`<a class="btn oauth-btn" href="/api/auth/facebook">${facebookSvg}<span>Continue with Facebook</span></a>`);
    if (btns.length) zone.innerHTML = `<div class="oauth-divider"><span>or</span></div><div class="oauth-btns">${btns.join('')}</div>`;
  });
  if (location.hash.includes('oauth=error')) {
    const err = $('#authErr');
    err.textContent = 'Social login failed. Please try again or use your password.';
    err.style.display = 'block';
  }
}

async function renderProfile(app, username) {
  app.innerHTML = `<div class="loader">Loading profile…</div>`;
  let data;
  try { data = await api('GET', `/api/users/${encodeURIComponent(username)}`); }
  catch (e) { app.innerHTML = errorHtml(e); return; }
  const { user, pins, boards } = data;
  const isMe = me && me.id === user.id;

  app.innerHTML = `
  <div class="profile-head">
    ${avatarHtml(user, 110)}
    <h1>${esc(user.username)}</h1>
    <div class="uname">@${esc(user.username)} · joined ${esc(new Date(user.created_at).toLocaleDateString())}</div>
    ${user.bio ? `<p class="profile-bio">${esc(user.bio)}</p>` : ''}
    ${isMe ? `<div class="profile-edit">
      <form id="avatarForm" class="save-row">
        <input type="file" id="avatarInput" accept="image/jpeg,image/png,image/webp,image/gif" class="text-input">
        <button class="btn" type="submit">Update photo</button>
      </form>
      <form id="bioForm" class="save-row">
        <input id="bioInput" class="text-input" maxlength="500" placeholder="Update your bio…" value="${esc(user.bio)}">
        <button class="btn" type="submit">Save bio</button>
      </form>
    </div>` : ''}
  </div>
  <h2 class="section-title">Pins (${pins.length})</h2>
  ${pins.length ? `<div class="masonry" id="masonry">${pins.map((p) => pinCard(p)).join('')}</div>` : '<p style="color:var(--muted)">No pins yet.</p>'}
  <h2 class="section-title">Boards (${boards.length})</h2>
  ${boards.length ? `<div class="board-grid">${boards.map(boardCard).join('')}</div>` : '<p style="color:var(--muted)">No boards yet.</p>'}`;
  wireFeedVideos();

  if (isMe) {
    $('#bioForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const d = await api('PUT', '/api/users/me', { bio: $('#bioInput').value }); me = d.user; renderProfile(app, username); }
      catch (err) { alert(err.message); }
    });
    $('#avatarForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = $('#avatarInput').files[0];
      if (!f) return;
      const fd = new FormData(); fd.append('avatar', f);
      try { const d = await api('POST', '/api/users/me/avatar', fd, true); me.avatar = d.avatar; updateHeader(); renderProfile(app, username); }
      catch (err) { alert(err.message); }
    });
  }
}

function boardCard(b) {
  const cover = b.cover
    ? (b.cover_type === 'video' ? `<video src="${esc(b.cover)}" muted playsinline preload="metadata"></video>` : `<img src="${esc(b.cover)}" alt="" loading="lazy">`)
    : 'No pins yet';
  return `<a class="board-card" href="#/board/${b.id}">
    <div class="board-cover">${cover}</div>
    <div class="pad"><div class="name">${esc(b.name)}</div><div class="count">${b.pin_count} pin${b.pin_count === 1 ? '' : 's'}</div></div>
  </a>`;
}

async function renderBoards(app) {
  if (!me) { location.hash = '#/login'; return; }
  app.innerHTML = `<div class="loader">Loading boards…</div>`;
  let boards;
  try { boards = (await api('GET', '/api/boards/mine')).boards; }
  catch (e) { app.innerHTML = errorHtml(e); return; }
  app.innerHTML = `
    <div class="board-head">
      <h2 class="section-title" style="margin:0">Your boards</h2>
      <form id="newBoardForm" class="save-row" style="max-width:420px">
        <input id="nbName" class="text-input" maxlength="80" placeholder="New board name…">
        <button class="btn btn-primary" type="submit">Create</button>
      </form>
    </div>
    <div class="board-grid" style="margin-top:18px">
      ${boards.map(boardCard).join('') || '<p style="color:var(--muted)">No boards yet — create your first one above.</p>'}
    </div>`;
  $('#newBoardForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#nbName').value.trim();
    if (!name) return;
    try { await api('POST', '/api/boards', { name }); renderBoards(app); }
    catch (err) { alert(err.message); }
  });
}

async function renderBoard(app, id) {
  app.innerHTML = `<div class="loader">Loading board…</div>`;
  let board, pins;
  try {
    const d = await api('GET', `/api/boards/${id}`);
    board = d.board; pins = d.pins;
  } catch (e) { app.innerHTML = errorHtml(e); return; }
  const isOwner = me && board.owner === me.username;
  app.innerHTML = `
    <div class="board-head">
      <div><h2 class="section-title" style="margin:0">${esc(board.name)}</h2>
      <div style="color:var(--muted);font-size:14px">${board.pin_count} pin${board.pin_count === 1 ? '' : 's'} · by ${esc(board.owner)}</div></div>
      ${isOwner ? '<button class="btn btn-danger" id="delBoardBtn">Delete board</button>' : ''}
    </div>
    <div class="masonry" id="masonry" style="margin-top:18px">
      ${pins.length ? pins.map((p) => pinCard(p, { showRemove: isOwner })).join('') : '<div class="empty">This board is empty.</div>'}
    </div>`;
  wireFeedVideos();

  $$('[data-remove-pin]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      try { await api('DELETE', `/api/boards/${id}/pins/${btn.dataset.removePin}`); renderBoard(app, id); }
      catch (err) { alert(err.message); }
    });
  });
  $('#delBoardBtn')?.addEventListener('click', async () => {
    if (!confirm('Delete this board?')) return;
    try { await api('DELETE', `/api/boards/${id}`); location.hash = '#/boards'; }
    catch (err) { alert(err.message); }
  });
}

/* ---------------- settings ---------------- */

async function renderSettings(app) {
  if (!me) { location.hash = '#/login'; return; }
  app.innerHTML = `
  <div class="form-card" style="max-width:620px">
    <h1>Settings</h1>
    <h3 class="settings-h">Profile</h3>
    <form id="setBioForm" class="save-row">
      <input id="setBioInput" class="text-input" maxlength="500" placeholder="Your bio…" value="${esc(me.bio || '')}">
      <button class="btn btn-primary" type="submit">Save</button>
    </form>
    <form id="setAvatarForm" class="save-row" style="margin-top:10px">
      <input type="file" id="setAvatarInput" accept="image/jpeg,image/png,image/webp,image/gif" class="text-input">
      <button class="btn" type="submit">Update photo</button>
    </form>
    <h3 class="settings-h">Change password</h3>
    <div class="form-error" id="pwErr" style="display:none"></div>
    <form id="pwForm">
      <div class="field"><label>Current password</label><input id="pwCur" type="password" class="text-input" autocomplete="current-password" placeholder="••••••"></div>
      <div class="field"><label>New password</label><input id="pwNew" type="password" class="text-input" minlength="6" autocomplete="new-password" placeholder="At least 6 characters"></div>
      <button class="btn btn-primary" type="submit">Update password</button>
    </form>
    <h3 class="settings-h">Account</h3>
    <div class="save-row">
      <button class="btn" id="setLogoutBtn">Log out</button>
      <button class="btn btn-danger" id="delAccountBtn">Delete my account</button>
    </div>
    <p class="muted-note">Deleting your account permanently removes your profile, pins, boards and comments.</p>
  </div>`;

  $('#setBioForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const d = await api('PUT', '/api/users/me', { bio: $('#setBioInput').value });
      me = d.user; alert('Bio saved.');
    } catch (err) { alert(err.message); }
  });
  $('#setAvatarForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = $('#setAvatarInput').files[0];
    if (!f) return;
    const fd = new FormData(); fd.append('avatar', f);
    try {
      const d = await api('POST', '/api/users/me/avatar', fd, true);
      me.avatar = d.avatar; updateHeader(); alert('Photo updated.');
    } catch (err) { alert(err.message); }
  });
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#pwErr');
    err.style.display = 'none'; err.style.color = '';
    try {
      await api('POST', '/api/users/me/password', { currentPassword: $('#pwCur').value, newPassword: $('#pwNew').value });
      $('#pwCur').value = ''; $('#pwNew').value = '';
      err.style.color = '#1a7f37'; err.textContent = 'Password updated.'; err.style.display = 'block';
    } catch (ex) { err.textContent = ex.message; err.style.display = 'block'; }
  });
  $('#setLogoutBtn').addEventListener('click', async () => {
    await api('POST', '/api/auth/logout');
    me = null; updateHeader(); location.hash = '#/';
  });
  $('#delAccountBtn').addEventListener('click', async () => {
    if (!confirm('Delete your account and everything in it? This cannot be undone.')) return;
    if (!confirm('Last chance — really delete?')) return;
    try {
      await api('DELETE', '/api/users/me');
      me = null; updateHeader(); location.hash = '#/';
    } catch (err) { alert(err.message); }
  });
}

/* ---------------- router ---------------- */

async function route() {
  const app = $('#app');
  const raw = location.hash.slice(1) || '/';
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart || '');
  window.scrollTo(0, 0);

  try {
    if (parts.length === 0) return await renderFeed(app, query);
    if (parts[0] === 'pin' && parts[1]) return await renderPin(app, parts[1]);
    if (parts[0] === 'upload') return renderUpload(app);
    if (parts[0] === 'login') return authForm(app, 'login');
    if (parts[0] === 'signup') return authForm(app, 'signup');
    if (parts[0] === 'user' && parts[1]) return await renderProfile(app, decodeURIComponent(parts[1]));
    if (parts[0] === 'boards') return await renderBoards(app);
    if (parts[0] === 'board' && parts[1]) return await renderBoard(app, parts[1]);
    if (parts[0] === 'settings') return await renderSettings(app);
    app.innerHTML = errorHtml(new Error('Page not found.'));
  } catch (e) {
    app.innerHTML = errorHtml(e);
  }
}

window.addEventListener('hashchange', route);
refreshMe().then(route);
