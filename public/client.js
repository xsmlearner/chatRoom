(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    token: null,
    me: null,
    socket: null,
    online: new Set(),
    current: { type: null, key: null, title: '' },
    unread: new Map() // key -> count
  };

  function setHeader(title) {
    const header = document.querySelector('#chat-header .title') || $('chat-header');
    if (header) header.textContent = title || '';
  }

  function renderMessage(m) {
    const div = document.createElement('div');
    div.className = 'msg' + (m.sender_id === state.me.id ? ' me' : '');
    const label = document.createElement('div');
    label.className = 'sender';
    const name = state.usernames ? state.usernames.get(m.sender_id) : null;
    label.textContent = name || ('用户#' + m.sender_id);
    div.appendChild(label);
    if (m.message_type === 'image') {
      const img = document.createElement('img');
      img.src = m.content;
      div.appendChild(img);
    } else {
      const text = document.createElement('div');
      text.textContent = m.content;
      div.appendChild(text);
    }
    const time = document.createElement('div');
    time.className = 'time';
    const d = new Date(m.created_at);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const YY = d.getFullYear(), MM = String(d.getMonth()+1).padStart(2,'0'), DD = String(d.getDate()).padStart(2,'0');
    time.textContent = `${YY}-${MM}-${DD} ${hh}:${mm}`;
    div.appendChild(time);
    $('messages').appendChild(div);
    $('messages').scrollTop = $('messages').scrollHeight;
  }

  function clearMessages() {
    $('messages').innerHTML = '';
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
        ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {})
      },
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function loadUsers(q = '') {
    const users = await api('/api/users?q=' + encodeURIComponent(q));
    const ul = $('user-list');
    ul.innerHTML = '';
    users.forEach(u => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = state.online.has(u.id) ? 'online-dot' : 'offline-dot';
      const name = document.createElement('span');
      name.textContent = u.username;
      name.style.cursor = 'pointer';
      name.onclick = () => openPrivate(u);
      const badge = document.createElement('span');
      const key = [Math.min(state.me.id, u.id), Math.max(state.me.id, u.id)].join(':');
      const cnt = state.unread.get(key) || 0;
      if (cnt > 0) { badge.className = 'badge'; badge.textContent = String(cnt); }
      li.appendChild(dot);
      li.appendChild(name);
      if (cnt > 0) li.appendChild(badge);
      ul.appendChild(li);
    });
  }

  async function loadGroups() {
    const { groups } = await api('/api/conversations');
    const ul = $('group-list');
    ul.innerHTML = '';
    groups.forEach(g => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = g.name || g.key.replace('group:', '群聊 ');
      name.style.cursor = 'pointer';
      name.onclick = () => openGroup(Number(g.key.split(':')[1]));
      const badge = document.createElement('span');
      const cnt = (typeof g.unread === 'number') ? g.unread : (state.unread.get(g.key) || 0);
      if (cnt > 0) { badge.className = 'badge'; badge.textContent = String(cnt); }
      const pendingBadge = document.createElement('span');
      const pend = (typeof g.pending === 'number') ? g.pending : 0;
      if (pend > 0) { pendingBadge.className = 'badge-pending'; pendingBadge.textContent = String(pend); }
      const joinBtn = document.createElement('button');
      joinBtn.textContent = '进入';
      joinBtn.onclick = () => openGroup(Number(g.key.split(':')[1]));
      li.appendChild(name);
      if (cnt > 0) li.appendChild(badge);
      if (pend > 0) li.appendChild(pendingBadge);
      li.appendChild(joinBtn);
      ul.appendChild(li);
    });
  }

  async function refreshUnread() {
    const { private: privs, groups } = await api('/api/conversations');
    privs.forEach(p => state.unread.set(p.key, p.unread || 0));
    groups.forEach(g => state.unread.set(g.key, g.unread || 0));
  }

  async function openPrivate(u) {
    const key = [Math.min(state.me.id, u.id), Math.max(state.me.id, u.id)].join(':');
    state.current = { type: 'private', key, title: `私聊 ${u.username}` };
    setHeader(state.current.title);
    clearMessages();
    state.usernames = new Map([[state.me.id, state.me.username], [u.id, u.username]]);
    const msgs = await api(`/api/messages?type=private&key=${encodeURIComponent(key)}`);
    msgs.forEach(renderMessage);
    await api('/api/conversations/seen', { method: 'POST', body: JSON.stringify({ type: 'private', key }) });
    state.unread.set(key, 0);
    await loadUsers($('search-user') ? $('search-user').value : '');
    await loadGroups();
    if (isMobile()) setMobileMode('chat');
  }

  async function openGroup(groupId) {
    const key = `group:${groupId}`;
    const info = await api(`/api/groups/${groupId}`);
    state.current = { type: 'group', key, title: info.name };
    setHeader(state.current.title);
    clearMessages();
    const members = await api(`/api/groups/${groupId}/members`);
    state.usernames = new Map(members.map(m => [m.id, m.username]));
    state.usernames.set(state.me.id, state.me.username);
    const isMember = members.some(m => m.id === state.me.id);
    if (!isMember) { alert('您不是该群成员，无法进入。已为您提供搜索页的申请入口。'); return; }
    state.socket.emit('join_group', groupId);
    const msgs = await api(`/api/messages?type=group&key=${encodeURIComponent(key)}`);
    msgs.forEach(renderMessage);
    await api('/api/conversations/seen', { method: 'POST', body: JSON.stringify({ type: 'group', key }) });
    state.unread.set(key, 0);
    await loadGroups();
    if (state.refreshOwnerButtons) state.refreshOwnerButtons();
    if (isMobile()) setMobileMode('chat');
  }

  async function sendMessage() {
    const text = $('msg-input').value.trim();
    const imgFile = $('img-input').files[0];
    if (!state.current.type) return;

    if (imgFile) {
      const form = new FormData();
      form.append('image', imgFile);
      const { url } = await api('/api/upload', { method: 'POST', body: form });
      if (state.current.type === 'group') {
        state.socket.emit('group_message', { group_id: Number(state.current.key.split(':')[1]), message_type: 'image', content: url });
      } else {
        const otherId = Number(state.current.key.split(':')[0]) === state.me.id
          ? Number(state.current.key.split(':')[1]) : Number(state.current.key.split(':')[0]);
        state.socket.emit('private_message', { to_user_id: otherId, message_type: 'image', content: url });
      }
      $('img-input').value = '';
      return;
    }

    if (!text) return;
    if (state.current.type === 'group') {
      state.socket.emit('group_message', { group_id: Number(state.current.key.split(':')[1]), message_type: 'text', content: text });
    } else {
      const otherId = Number(state.current.key.split(':')[0]) === state.me.id
        ? Number(state.current.key.split(':')[1]) : Number(state.current.key.split(':')[0]);
      state.socket.emit('private_message', { to_user_id: otherId, message_type: 'text', content: text });
    }
    $('msg-input').value = '';
  }

  function connectSocket() {
    state.socket = io({ auth: { token: state.token } });
    state.socket.on('connect', () => {});
    state.socket.on('user_online', ({ user_id }) => {
      state.online.add(user_id);
      if ($('search-user')) loadUsers($('search-user').value);
    });
    state.socket.on('user_offline', ({ user_id }) => {
      state.online.delete(user_id);
      if ($('search-user')) loadUsers($('search-user').value);
    });
    state.socket.on('private_message', ({ message }) => {
      if (state.current.type === 'private') {
        const [a, b] = state.current.key.split(':').map(Number);
        if (message.sender_id === state.me.id || message.sender_id === a || message.sender_id === b) {
          renderMessage(message);
        }
      } else {
        const otherId = message.sender_id === state.me.id ? null : message.sender_id;
        if (otherId) {
          const key = [Math.min(state.me.id, otherId), Math.max(state.me.id, otherId)].join(':');
          const cnt = state.unread.get(key) || 0;
          state.unread.set(key, cnt + 1);
          if ($('user-list')) loadUsers($('search-user') ? $('search-user').value : '');
          refreshUnread().catch(() => {});
        }
      }
    });
    state.socket.on('group_message', ({ group_id, message }) => {
      if (state.current.type === 'group' && Number(state.current.key.split(':')[1]) === group_id) {
        renderMessage(message);
      } else {
        const key = `group:${group_id}`;
        const cnt = state.unread.get(key) || 0;
        state.unread.set(key, cnt + 1);
        refreshUnread().then(loadGroups).catch(loadGroups);
      }
    });
  }

  // Auth handlers (login page)
  if ($('btn-register')) $('btn-register').onclick = async () => {
    try {
      const payload = {
        username: $('reg-username').value.trim(),
        password: $('reg-password').value,
        recovery_question: $('reg-question').value.trim(),
        recovery_answer: $('reg-answer').value.trim(),
      };
      await api('/api/register', { method: 'POST', body: JSON.stringify(payload) });
      alert('注册成功，请登录');
    } catch (e) {
      alert('注册失败: ' + e.message);
    }
  };

  if ($('btn-login')) $('btn-login').onclick = async () => {
    try {
      const payload = {
        username: $('login-username').value.trim(),
        password: $('login-password').value,
      };
      const data = await api('/api/login', { method: 'POST', body: JSON.stringify(payload) });
      state.token = data.token;
      state.me = data.user;
      localStorage.setItem('chat_token', state.token);
      localStorage.setItem('chat_user', JSON.stringify(state.me));
      location.href = '/chat.html';
    } catch (e) {
      alert('登录失败: ' + e.message);
    }
  };

  if ($('btn-reset')) $('btn-reset').onclick = async () => {
    try {
      const payload = {
        username: $('reset-username').value.trim(),
        recovery_answer: $('reset-answer').value.trim(),
        new_password: $('reset-newpass').value,
      };
      await api('/api/password-reset', { method: 'POST', body: JSON.stringify(payload) });
      alert('密码已重置，请登录');
    } catch (e) {
      alert('重置失败: ' + e.message);
    }
  };

  if ($('btn-search')) $('btn-search').onclick = () => loadUsers($('search-user').value);
  if ($('btn-create-group')) $('btn-create-group').onclick = async () => {
    try {
      const name = $('group-name').value.trim();
      if (!name) return;
      await api('/api/groups', { method: 'POST', body: JSON.stringify({ name }) });
      $('group-name').value = '';
      await loadGroups();
    } catch (e) {
      alert('创建群失败: ' + e.message);
    }
  };
  if ($('btn-group-search')) $('btn-group-search').onclick = async () => {
    try {
      const q = $('group-search').value.trim();
      const rows = await api('/api/groups?q=' + encodeURIComponent(q));
      const ul = $('group-list');
      ul.innerHTML = '';
      rows.forEach(g => {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = `${g.name} (#${g.id})`;
        name.style.cursor = 'pointer';
        name.onclick = () => openGroup(g.id);
        const joinBtn = document.createElement('button');
        joinBtn.textContent = '申请加入';
        joinBtn.onclick = async () => {
          const r = await api(`/api/groups/${g.id}/request`, { method: 'POST' });
          if (r.status === 'member') { alert('您已是成员，可直接进入'); openGroup(g.id); }
          else { alert('已提交申请，请等待群主同意'); }
        };
        li.appendChild(name);
        li.appendChild(joinBtn);
        ul.appendChild(li);
      });
    } catch (e) {
      alert('搜索失败: ' + e.message);
    }
  };
  if ($('btn-send')) $('btn-send').onclick = sendMessage;
  if ($('msg-input')) {
    const mi = $('msg-input');
    state.composing = false;
    mi.addEventListener('compositionstart', () => { state.composing = true; });
    mi.addEventListener('compositionend', () => { state.composing = false; });
    mi.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !state.composing) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
  if ($('btn-logout')) $('btn-logout').onclick = () => {
    if (state.socket) state.socket.disconnect();
    state.socket = null;
    state.token = null;
    state.me = null;
    localStorage.removeItem('chat_token');
    localStorage.removeItem('chat_user');
    location.href = '/';
  };
  if ($('btn-members')) $('btn-members').onclick = async () => {
    if (state.current.type !== 'group') return alert('请先进入群聊');
    const groupId = Number(state.current.key.split(':')[1]);
    const members = await api(`/api/groups/${groupId}/members`);
    alert('群成员：\n' + members.map(m => `${m.username} (${m.role})`).join('\n'));
  };

  // Owner actions
  (function ownerActionsInit() {
    const actions = document.querySelector('#chat-header .actions');
    if (!actions) return;
    const renameBtn = document.createElement('button');
    renameBtn.textContent = '改名';
    const dissolveBtn = document.createElement('button');
    dissolveBtn.textContent = '解散';
    const requestsBtn = document.createElement('button');
    requestsBtn.textContent = '入群申请';
    actions.appendChild(renameBtn);
    actions.appendChild(dissolveBtn);
    actions.appendChild(requestsBtn);
    async function refreshOwnerButtons() {
      if (state.current.type !== 'group') { renameBtn.style.display = 'none'; dissolveBtn.style.display = 'none'; return; }
      const groupId = Number(state.current.key.split(':')[1]);
      const info = await api(`/api/groups/${groupId}`);
      const isOwner = info.owner_id === state.me.id;
      renameBtn.style.display = isOwner ? 'inline-block' : 'none';
      dissolveBtn.style.display = isOwner ? 'inline-block' : 'none';
      requestsBtn.style.display = isOwner ? 'inline-block' : 'none';
    }
    renameBtn.onclick = async () => {
      if (state.current.type !== 'group') return;
      const groupId = Number(state.current.key.split(':')[1]);
      const name = prompt('输入新的群名称', state.current.title || '');
      if (!name) return;
      await api(`/api/groups/${groupId}`, { method: 'PUT', body: JSON.stringify({ name }) });
      state.current.title = name;
      setHeader(name);
      await loadGroups();
    };
    dissolveBtn.onclick = async () => {
      if (state.current.type !== 'group') return;
      const groupId = Number(state.current.key.split(':')[1]);
      if (!confirm('确认解散群聊？该群及其聊天记录将被删除')) return;
      await api(`/api/groups/${groupId}`, { method: 'DELETE' });
      alert('已解散群聊');
      clearMessages();
      state.current = { type: null, key: null, title: '' };
      setHeader('');
      await loadGroups();
    };
    // expose refresh method
    state.refreshOwnerButtons = refreshOwnerButtons;
    requestsBtn.onclick = async () => {
      if (state.current.type !== 'group') return;
      const groupId = Number(state.current.key.split(':')[1]);
      const reqs = await api(`/api/groups/${groupId}/requests`);
      if (!reqs.length) return alert('暂无入群申请');
      for (const r of reqs) {
        const ok = confirm(`同意 ${r.username} 加入？`);
        if (ok) await api(`/api/groups/${groupId}/requests/${r.id}/approve`, { method: 'POST' });
        else await api(`/api/groups/${groupId}/requests/${r.id}/reject`, { method: 'POST' });
      }
      alert('处理完毕');
    };
  })();

  // Mobile toggle
  function isMobile() {
    return window.matchMedia('(max-width: 768px)').matches;
  }
  function setMobileMode(mode) {
    if (!isMobile()) return;
    document.body.classList.remove('mobile-list-mode', 'mobile-chat-mode');
    document.body.classList.add(mode === 'chat' ? 'mobile-chat-mode' : 'mobile-list-mode');
  }
  if ($('btn-back')) $('btn-back').onclick = () => setMobileMode('list');
  window.addEventListener('resize', () => {
    if (!isMobile()) {
      document.body.classList.remove('mobile-list-mode', 'mobile-chat-mode');
    }
  });

  // Page bootstrap
  (async function bootstrap() {
    const token = localStorage.getItem('chat_token');
    const user = localStorage.getItem('chat_user');
    if (location.pathname.endsWith('/chat.html')) {
      if (!token || !user) { location.href = '/'; return; }
      state.token = token;
      try {
        const me = await api('/api/me');
        state.me = me;
      } catch {
        localStorage.removeItem('chat_token'); localStorage.removeItem('chat_user'); location.href = '/'; return;
      }
      $('me-name').textContent = '你好，' + state.me.username;
      connectSocket();
      await refreshUnread();
      await loadUsers();
      await loadGroups();
      if (state.refreshOwnerButtons) state.refreshOwnerButtons();
      if (isMobile()) setMobileMode('list');
    } else {
      if (token && user) {
        try {
          await api('/api/me', { headers: { Authorization: 'Bearer ' + token } });
          location.href = '/chat.html';
        } catch {/* ignore */}
      }
    }
  })();
})();
