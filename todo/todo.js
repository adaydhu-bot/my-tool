// ================================================================
// Ada's To Do List - Supabase 云端同步版
// ================================================================

// ========== Supabase 初始化 ==========
const SUPABASE_URL = 'https://mkpektzjjalvxvyspcpa.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1rcGVrdHpqamFsdnh2eXNwY3BhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MzE0MzUsImV4cCI6MjA4ODEwNzQzNX0.llSM0cX3Y5LyGZmp6K_rMgtH55_wSPzN5PCj0SAGNvE';

const _supaClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========== 状态管理 ==========
let todos = {};
let ideas = [];
let selectedDate = new Date();
let calYear, calMonth;
let currentFilter = 'all';
let currentSummaryRange = 'week';
let currentIdeaTag = 'all';
let currentIdeaSort = 'newest';
let newIdeaTags = [];
let currentUser = null;

// ========== 认证模块 ==========
function setupAuth() {
  const overlay = document.getElementById('authOverlay');
  const form = document.getElementById('authForm');
  const nicknameInput = document.getElementById('authNickname');
  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  const submitBtn = document.getElementById('authSubmitBtn');
  const errorEl = document.getElementById('authError');
  let authMode = 'login';

  // Tab 切换 - 使用事件委托
  const tabsContainer = document.querySelector('.auth-tabs');
  if (tabsContainer) {
    tabsContainer.addEventListener('click', (e) => {
      const tab = e.target.closest('.auth-tab');
      if (!tab) return;
      e.preventDefault();
      e.stopPropagation();
      tabsContainer.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      authMode = tab.dataset.mode;
      submitBtn.textContent = authMode === 'login' ? '登录' : '注册';
      // 注册模式显示昵称输入框，登录模式隐藏
      nicknameInput.style.display = authMode === 'register' ? 'block' : 'none';
      nicknameInput.required = authMode === 'register';
      errorEl.textContent = '';
    });
  }

  // 提交
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const nickname = nicknameInput.value.trim();
    errorEl.textContent = '';
    errorEl.style.color = 'var(--danger)';
    submitBtn.disabled = true;
    submitBtn.textContent = '请稍候...';

    if (authMode === 'register' && !nickname) {
      errorEl.textContent = '请输入昵称';
      submitBtn.disabled = false;
      submitBtn.textContent = '注册';
      return;
    }

    try {
      let result;
      if (authMode === 'login') {
        result = await _supaClient.auth.signInWithPassword({ email, password });
      } else {
        result = await _supaClient.auth.signUp({
          email,
          password,
          options: {
            data: { nickname: nickname }
          }
        });
      }

      if (result.error) {
        let msg = result.error.message;
        if (msg.includes('Invalid login')) msg = '邮箱或密码错误';
        else if (msg.includes('already registered')) msg = '该邮箱已注册，请直接登录';
        else if (msg.includes('valid email')) msg = '请输入有效的邮箱地址';
        else if (msg.includes('at least')) msg = '密码至少需要6位';
        else if (msg.includes('rate limit')) msg = '操作太频繁，请稍后再试';
        errorEl.textContent = msg;
      } else if (authMode === 'register' && result.data?.user?.identities?.length === 0) {
        errorEl.textContent = '该邮箱已注册，请直接登录';
      } else if (authMode === 'register' && result.data?.user) {
        if (result.data.session) {
          return;
        }
        errorEl.style.color = 'var(--success)';
        errorEl.textContent = '注册成功！请检查邮箱点击确认链接后再登录';
      }
    } catch (err) {
      errorEl.textContent = '网络错误，请重试';
    }

    submitBtn.disabled = false;
    submitBtn.textContent = authMode === 'login' ? '登录' : '注册';
  });

  // 防止重复初始化
  let appInitialized = false;

  // 监听认证状态
  _supaClient.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      currentUser = session.user;
      overlay.classList.add('hidden');
      document.getElementById('app').style.display = 'block';

      // TOKEN_REFRESHED 等事件不需要重新初始化
      if (appInitialized && event === 'TOKEN_REFRESHED') return;

      // 启动心跳保活
      startHeartbeat();

      // 显示昵称（如果没有昵称则弹窗让用户补填）
      let nickname = session.user.user_metadata?.nickname;
      if (!nickname) {
        nickname = prompt('欢迎！请输入你的昵称：');
        if (nickname && nickname.trim()) {
          nickname = nickname.trim();
          await _supaClient.auth.updateUser({ data: { nickname } });
        } else {
          nickname = '';
        }
      }
      if (nickname) {
        const titleEl = document.getElementById('appTitle');
        if (titleEl) titleEl.textContent = `${nickname}'s To Do List`;
        document.title = `${nickname}'s To Do List`;
        const welcomeEl = document.getElementById('welcomeText');
        if (welcomeEl) welcomeEl.textContent = `Hi ${nickname}，记录每一天，捕捉每个灵感 ✨`;
      }

      // 先初始化界面，让按钮立即可用
      initApp();
      appInitialized = true;

      // 后台异步加载数据，不阻塞 UI
      try {
        await loadAllData();
        // 如果云端数据为空，尝试从本地备份恢复
        await restoreFromLocalBackup();
        // 只有有数据时才更新本地备份（防止空数据覆盖好的备份）
        const todoCount = Object.values(todos).reduce((sum, arr) => sum + arr.length, 0);
        if (todoCount > 0) backupTodosToLocal();
        if (ideas.length > 0) backupIdeasToLocal();
        initApp(); // 数据加载完后刷新渲染
      } catch (err) {
        console.error('数据加载失败:', err);
      }
      try {
        await carryOverUnfinishedTodos();
        backupTodosToLocal();
        initApp(); // 顺延完成后再刷新
      } catch (err) {
        console.error('顺延任务处理失败:', err);
      }
    } else {
      currentUser = null;
      appInitialized = false;
      stopHeartbeat();
      document.getElementById('app').style.display = 'none';
      overlay.classList.remove('hidden');
    }
  });
}

// ========== 任务顺延 ==========
async function carryOverUnfinishedTodos() {
  const today = todayKey();
  const todayItems = todos[today] || [];
  // 已经顺延过的任务文本集合（避免重复）
  const carriedTexts = new Set(todayItems.filter(t => t.carriedFrom).map(t => t.text + '|' + t.carriedFrom));

  const tasksToCarry = [];

  // 检查过去7天的未完成任务
  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    const items = todos[key] || [];
    items.forEach(item => {
      if (!item.done && !carriedTexts.has(item.text + '|' + key)) {
        tasksToCarry.push({ ...item, originalDate: key });
      }
    });
  }

  if (tasksToCarry.length === 0) return;

  // 批量插入顺延任务到今天
  for (const task of tasksToCarry) {
    const { data, error } = await _supaClient
      .from('todos')
      .insert({
        user_id: currentUser.id,
        date: today,
        text: task.text,
        priority: task.priority,
        done: false,
        carried_from: task.originalDate
      })
      .select()
      .single();

    if (!error && data) {
      if (!todos[today]) todos[today] = [];
      todos[today].push({
        id: data.id,
        text: data.text,
        priority: data.priority,
        done: data.done,
        createdAt: data.created_at,
        carriedFrom: data.carried_from
      });
    }
  }
}

// ========== 云端数据加载 ==========
async function loadAllData() {
  await Promise.all([loadTodosFromCloud(), loadIdeasFromCloud()]);
}

async function loadTodosFromCloud() {
  try {
    const { data, error } = await _supaClient
      .from('todos')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('加载待办失败:', error);
      // 不清空 todos，保留之前的数据
      return;
    }
    // 只有查询成功才更新数据
    const newTodos = {};
    if (data) {
      data.forEach(item => {
        if (!newTodos[item.date]) newTodos[item.date] = [];
        newTodos[item.date].push({
          id: item.id,
          text: item.text,
          priority: item.priority,
          done: item.done,
          createdAt: item.created_at,
          carriedFrom: item.carried_from || null
        });
      });
    }
    todos = newTodos;
  } catch (err) {
    console.error('加载待办异常:', err);
    // 不清空 todos，保留之前的数据
  }
}

async function loadIdeasFromCloud() {
  try {
    const { data, error } = await _supaClient
      .from('ideas')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('加载灵感失败:', error);
      // 不清空 ideas，保留之前的数据
      return;
    }
    // 只有查询成功才更新数据
    if (data) {
      ideas = data.map(item => ({
        id: item.id,
        text: item.text,
        tags: item.tags || [],
        createdAt: item.created_at
      }));
    }
  } catch (err) {
    console.error('加载灵感异常:', err);
    // 不清空 ideas，保留之前的数据
  }
}

// ========== 本地备份 ==========
function backupTodosToLocal() {
  try {
    localStorage.setItem('todos_backup', JSON.stringify(todos));
    localStorage.setItem('todos_backup_time', new Date().toISOString());
  } catch (e) {
    console.warn('本地备份待办失败:', e);
  }
}

function backupIdeasToLocal() {
  try {
    localStorage.setItem('ideas_backup', JSON.stringify(ideas));
    localStorage.setItem('ideas_backup_time', new Date().toISOString());
  } catch (e) {
    console.warn('本地备份灵感失败:', e);
  }
}

function getLocalTodosBackup() {
  try {
    const data = localStorage.getItem('todos_backup');
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}

function getLocalIdeasBackup() {
  try {
    const data = localStorage.getItem('ideas_backup');
    return data ? JSON.parse(data) : null;
  } catch (e) {
    return null;
  }
}

// 当云端数据为空但本地有备份时，恢复数据到云端
async function restoreFromLocalBackup() {
  const localTodos = getLocalTodosBackup();
  const localIdeas = getLocalIdeasBackup();

  // 检查云端是否为空但本地有数据
  const todoCount = Object.values(todos).reduce((sum, arr) => sum + arr.length, 0);
  const ideaCount = ideas.length;

  let restored = false;

  // 恢复待办
  if (todoCount === 0 && localTodos) {
    const allLocalItems = Object.values(localTodos).flat();
    if (allLocalItems.length > 0) {
      console.log(`发现本地备份：${allLocalItems.length} 条待办，正在恢复...`);
      for (const dateKey of Object.keys(localTodos)) {
        for (const item of localTodos[dateKey]) {
          const { data, error } = await _supaClient
            .from('todos')
            .insert({
              user_id: currentUser.id,
              date: dateKey,
              text: item.text,
              priority: item.priority,
              done: item.done,
              carried_from: item.carriedFrom || null
            })
            .select()
            .single();

          if (!error && data) {
            if (!todos[dateKey]) todos[dateKey] = [];
            todos[dateKey].push({
              id: data.id,
              text: data.text,
              priority: data.priority,
              done: data.done,
              createdAt: data.created_at,
              carriedFrom: data.carried_from || null
            });
          }
        }
      }
      restored = true;
    }
  }

  // 恢复灵感
  if (ideaCount === 0 && localIdeas && localIdeas.length > 0) {
    console.log(`发现本地备份：${localIdeas.length} 条灵感，正在恢复...`);
    for (const item of localIdeas) {
      const { data, error } = await _supaClient
        .from('ideas')
        .insert({
          user_id: currentUser.id,
          text: item.text,
          tags: item.tags || []
        })
        .select()
        .single();

      if (!error && data) {
        ideas.push({
          id: data.id,
          text: data.text,
          tags: data.tags || [],
          createdAt: data.created_at
        });
      }
    }
    restored = true;
  }

  if (restored) {
    console.log('从本地备份恢复完成！');
    backupTodosToLocal();
    backupIdeasToLocal();
  }
}

// ========== 工具函数 ==========
function dateKey(d) {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function todayKey() {
  return dateKey(new Date());
}

function formatDate(d) {
  const date = new Date(d);
  const m = date.getMonth() + 1;
  const day = date.getDate();
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${m}月${day}日 周${weekDays[date.getDay()]}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDateShort(key) {
  const parts = key.split('-');
  return `${+parts[1]}/${+parts[2]}`;
}

function formatCarriedDate(key) {
  const parts = key.split('-');
  return `${+parts[1]}月${+parts[2]}日`;
}

function calcCarriedDays(fromKey) {
  const from = new Date(fromKey + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((now - from) / 86400000));
}

// ================================================================
// 模块一：每日待办
// ================================================================

// ========== 日历 ==========
function renderCalendar() {
  const titleEl = document.getElementById('calTitle');
  const gridEl = document.getElementById('calendarGrid');

  titleEl.textContent = `${calYear}年${calMonth + 1}月`;

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(calYear, calMonth, 0).getDate();

  const today = new Date();
  const selKey = dateKey(selectedDate);

  let html = '';

  for (let i = firstDay - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const d = new Date(calYear, calMonth - 1, day);
    const key = dateKey(d);
    const hasTodos = todos[key] && todos[key].length > 0;
    html += `<button class="cal-day other-month${hasTodos ? ' has-todos' : ''}" data-date="${key}">${day}</button>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(calYear, calMonth, day);
    const key = dateKey(d);
    const isToday = key === todayKey();
    const isSelected = key === selKey;
    const hasTodos = todos[key] && todos[key].length > 0;
    let cls = 'cal-day';
    if (isToday) cls += ' today';
    if (isSelected) cls += ' selected';
    if (hasTodos) cls += ' has-todos';
    html += `<button class="${cls}" data-date="${key}">${day}</button>`;
  }

  const totalCells = firstDay + daysInMonth;
  const remainCells = (7 - totalCells % 7) % 7;
  for (let day = 1; day <= remainCells; day++) {
    const d = new Date(calYear, calMonth + 1, day);
    const key = dateKey(d);
    const hasTodos = todos[key] && todos[key].length > 0;
    html += `<button class="cal-day other-month${hasTodos ? ' has-todos' : ''}" data-date="${key}">${day}</button>`;
  }

  gridEl.innerHTML = html;

  gridEl.querySelectorAll('.cal-day').forEach(btn => {
    btn.addEventListener('click', () => {
      const parts = btn.dataset.date.split('-');
      selectedDate = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      calYear = selectedDate.getFullYear();
      calMonth = selectedDate.getMonth();
      renderCalendar();
      renderTodoList();
      updateTodoHeader();
    });
  });
}

// ========== 待办列表 ==========
function getTodosForDate(key) {
  return todos[key] || [];
}

function updateTodoHeader() {
  const key = dateKey(selectedDate);
  const titleEl = document.getElementById('selectedDateTitle');
  const progressEl = document.getElementById('todoProgress');

  if (key === todayKey()) {
    titleEl.textContent = '今天的待办';
  } else {
    titleEl.textContent = formatDate(selectedDate) + ' 的待办';
  }

  const items = getTodosForDate(key);
  if (items.length === 0) {
    progressEl.textContent = '';
  } else {
    const done = items.filter(t => t.done).length;
    progressEl.textContent = `${done}/${items.length} 已完成`;
  }
}

function renderTodoList() {
  const key = dateKey(selectedDate);
  const listEl = document.getElementById('todoList');
  let items = getTodosForDate(key);

  if (currentFilter === 'active') {
    items = items.filter(t => !t.done);
  } else if (currentFilter === 'completed') {
    items = items.filter(t => t.done);
  }

  if (items.length === 0) {
    const tips = {
      all: '还没有待办事项，添加一个吧~',
      active: '所有任务都完成啦，太棒了！🎉',
      completed: '还没有已完成的任务哦~'
    };
    listEl.innerHTML = `<p class="empty-tip">${tips[currentFilter]}</p>`;
    updateProgressBar();
    return;
  }

  const priorityOrder = { high: 0, mid: 1, low: 2 };
  items.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  listEl.innerHTML = items.map(item => {
    let carriedBadge = '';
    let carryClass = '';
    if (item.carriedFrom) {
      const days = calcCarriedDays(item.carriedFrom);
      const level = days >= 3 ? 'carry-danger' : days >= 2 ? 'carry-warn' : 'carry-easy';
      carryClass = ` carried ${days >= 3 ? 'carry-danger' : ''}`;
      carriedBadge = `<span class="carried-badge ${level}">顺延${days}天<span class="carried-date">原定${formatCarriedDate(item.carriedFrom)}</span></span>`;
    }
    return `
      <div class="todo-item priority-${item.priority}${item.done ? ' completed' : ''}${carryClass}" data-id="${item.id}">
        ${carriedBadge}
        <button class="todo-checkbox${item.done ? ' checked' : ''}" data-id="${item.id}">${item.done ? '✓' : ''}</button>
        <div class="todo-info">
          <div class="todo-text">${escapeHtml(item.text)}</div>
        </div>
        <button class="todo-delete" data-id="${item.id}" title="删除">✕</button>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.todo-checkbox').forEach(btn => {
    btn.addEventListener('click', () => toggleTodo(btn.dataset.id));
  });

  listEl.querySelectorAll('.todo-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteTodo(btn.dataset.id));
  });

  updateProgressBar();
}

function getSelectedPriority() {
  const selected = document.querySelector('#priorityDots .dot-btn.selected');
  return selected ? selected.dataset.priority : 'mid';
}

let isAddingTodo = false;

async function addTodo() {
  if (isAddingTodo) return; // 防止重复点击

  const input = document.getElementById('todoInput');
  const addBtn = document.getElementById('addTodoBtn');
  const priority = getSelectedPriority();
  const text = input.value.trim();

  if (!text) {
    input.focus();
    return;
  }

  if (!currentUser) {
    alert('正在加载用户数据，请稍等几秒再试');
    return;
  }

  // 显示加载状态
  isAddingTodo = true;
  addBtn.disabled = true;
  addBtn.textContent = '添加中...';

  const key = dateKey(selectedDate);

  try {
    const { data, error } = await _supaClient
      .from('todos')
      .insert({
        user_id: currentUser.id,
        date: key,
        text,
        priority,
        done: false
      })
      .select()
      .single();

    if (error) {
      console.error('添加失败:', error);
      alert('添加失败: ' + error.message);
      return;
    }

    if (!todos[key]) todos[key] = [];
    todos[key].push({
      id: data.id,
      text: data.text,
      priority: data.priority,
      done: data.done,
      createdAt: data.created_at,
      carriedFrom: data.carried_from || null
    });

    input.value = '';
    backupTodosToLocal();
    renderTodoList();
    renderCalendar();
    updateTodoHeader();
  } catch (err) {
    console.error('添加待办异常:', err);
    alert('网络错误，请检查网络后重试');
  } finally {
    isAddingTodo = false;
    addBtn.disabled = false;
    addBtn.textContent = '添加';
  }
}

async function toggleTodo(id) {
  const key = dateKey(selectedDate);
  const item = (todos[key] || []).find(t => t.id === id);
  if (!item) return;

  const wasUndone = !item.done;
  item.done = !item.done;

  _supaClient.from('todos').update({ done: item.done }).eq('id', id).then();
  backupTodosToLocal();

  if (wasUndone) {
    const todoEl = document.querySelector(`.todo-item[data-id="${id}"]`);
    if (todoEl) {
      spawnConfetti(todoEl);
      const cb = todoEl.querySelector('.todo-checkbox');
      if (cb) {
        cb.classList.add('bounce');
        setTimeout(() => cb.classList.remove('bounce'), 500);
      }
    }

    setTimeout(() => {
      renderTodoList();
      updateTodoHeader();
      renderCalendar();

      const allItems = getTodosForDate(key);
      if (allItems.length > 0 && allItems.every(t => t.done)) {
        setTimeout(() => showCompletionOverlay(), 300);
      }
    }, 400);
  } else {
    renderTodoList();
    updateTodoHeader();
    renderCalendar();
  }
}

// ========== 撒花粒子 ==========
function spawnConfetti(todoEl) {
  const colors = ['#FF6B6B', '#FFD166', '#6BCB77', '#FF8C42', '#A78BFA', '#F472B6', '#38BDF8', '#FBBF24'];
  const container = document.createElement('div');
  container.className = 'confetti-container';

  for (let i = 0; i < 10; i++) {
    const dot = document.createElement('div');
    dot.className = 'confetti';
    dot.style.background = colors[i % colors.length];
    dot.style.setProperty('--tx', (Math.random() - 0.5) * 70 + 'px');
    dot.style.setProperty('--ty', (Math.random() * -50 - 10) + 'px');
    dot.style.animationDelay = (Math.random() * 0.12) + 's';
    container.appendChild(dot);
  }

  todoEl.appendChild(container);

  requestAnimationFrame(() => {
    container.querySelectorAll('.confetti').forEach(c => c.classList.add('burst'));
  });

  setTimeout(() => container.remove(), 1000);
}

// ========== 进度条更新 ==========
function updateProgressBar() {
  const key = dateKey(selectedDate);
  const allItems = getTodosForDate(key);
  const bar = document.getElementById('todoProgressBar');
  const fill = document.getElementById('progressFill');
  const doneEl = document.getElementById('progressDone');
  const totalEl = document.getElementById('progressTotal');

  if (allItems.length === 0) {
    bar.classList.remove('show');
    return;
  }

  bar.classList.add('show');
  const done = allItems.filter(t => t.done).length;
  doneEl.textContent = done;
  totalEl.textContent = allItems.length;
  const pct = Math.round(done / allItems.length * 100);
  requestAnimationFrame(() => {
    fill.style.width = pct + '%';
  });
}

// ========== 全部完成弹窗 ==========
function showCompletionOverlay() {
  const overlay = document.getElementById('completionOverlay');
  overlay.style.display = 'flex';
  overlay.classList.add('show');
  spawnOverlayConfetti();
}

function hideCompletionOverlay() {
  const overlay = document.getElementById('completionOverlay');
  overlay.classList.remove('show');
  overlay.style.display = 'none';
}

function spawnOverlayConfetti() {
  const overlay = document.getElementById('completionOverlay');
  const colors = ['#FF6B6B', '#FFD166', '#6BCB77', '#FF8C42', '#A78BFA', '#F472B6', '#38BDF8', '#FBBF24', '#FF8C42', '#FFB07A'];

  for (let i = 0; i < 30; i++) {
    const dot = document.createElement('div');
    dot.style.cssText = `
      position: fixed;
      width: ${6 + Math.random() * 6}px;
      height: ${6 + Math.random() * 6}px;
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      background: ${colors[i % colors.length]};
      left: ${Math.random() * 100}vw;
      top: -10px;
      z-index: 1001;
      pointer-events: none;
      animation: confettiFall ${1.5 + Math.random() * 2}s ease-out forwards;
      animation-delay: ${Math.random() * 0.5}s;
    `;
    overlay.appendChild(dot);
    setTimeout(() => dot.remove(), 4000);
  }
}

async function deleteTodo(id) {
  const key = dateKey(selectedDate);
  if (!todos[key]) return;

  await _supaClient.from('todos').delete().eq('id', id);

  todos[key] = todos[key].filter(t => t.id !== id);
  if (todos[key].length === 0) delete todos[key];
  backupTodosToLocal();
  renderTodoList();
  updateTodoHeader();
  renderCalendar();
}

// ================================================================
// 模块二：总结统计
// ================================================================

function getDateRange(range) {
  const today = new Date();
  const dates = [];

  if (range === 'week') {
    const dayOfWeek = today.getDay();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek);
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      dates.push(dateKey(d));
    }
  } else {
    const year = today.getFullYear();
    const month = today.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let i = 1; i <= daysInMonth; i++) {
      dates.push(dateKey(new Date(year, month, i)));
    }
  }

  return dates;
}

function computeStats(range) {
  const dates = getDateRange(range);
  let totalTasks = 0;
  let completedTasks = 0;
  const dailyCounts = [];
  const dailyLabels = [];
  let priorityCounts = { high: 0, mid: 0, low: 0 };

  dates.forEach(key => {
    const items = todos[key] || [];
    const done = items.filter(t => t.done).length;
    totalTasks += items.length;
    completedTasks += done;
    dailyCounts.push(done);

    const parts = key.split('-');
    dailyLabels.push(`${+parts[1]}/${+parts[2]}`);

    items.forEach(t => {
      if (t.done) priorityCounts[t.priority]++;
    });
  });

  const rate = totalTasks > 0 ? Math.round(completedTasks / totalTasks * 100) : 0;

  let streak = 0;
  const todayStr = todayKey();
  let checkDate = new Date();
  while (true) {
    const k = dateKey(checkDate);
    const items = todos[k] || [];
    if (items.length > 0 && items.every(t => t.done)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else if (k === todayStr && items.length === 0) {
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return { totalTasks, completedTasks, rate, streak, dailyCounts, dailyLabels, priorityCounts };
}

function renderSummary() {
  const stats = computeStats(currentSummaryRange);

  document.getElementById('statCompleted').textContent = stats.completedTasks;
  document.getElementById('statTotal').textContent = stats.totalTasks;
  document.getElementById('statRate').textContent = stats.rate + '%';
  document.getElementById('statStreak').textContent = stats.streak;

  drawBarChart(stats.dailyLabels, stats.dailyCounts);
  drawPieChart(stats.priorityCounts);
  renderHeatmap();
}

function drawBarChart(labels, data) {
  const canvas = document.getElementById('barChart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 220 * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = 220;
  const padding = { top: 10, right: 20, bottom: 40, left: 36 };
  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;

  ctx.clearRect(0, 0, W, H);

  const maxVal = Math.max(...data, 1);

  ctx.strokeStyle = '#F0E6DD';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + chartH - (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(W - padding.right, y);
    ctx.stroke();

    ctx.fillStyle = '#A08B7A';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(maxVal / 4 * i), padding.left - 6, y);
  }

  const barCount = data.length;
  const barGap = 4;
  const totalGap = barGap * (barCount + 1);
  const barWidth = Math.min((chartW - totalGap) / barCount, 40);
  const startX = padding.left + (chartW - (barWidth + barGap) * barCount) / 2;

  data.forEach((val, i) => {
    const x = startX + (barWidth + barGap) * i + barGap;
    const barH = (val / maxVal) * chartH;
    const y = padding.top + chartH - barH;

    const grad = ctx.createLinearGradient(0, y, 0, padding.top + chartH);
    grad.addColorStop(0, '#FF8C42');
    grad.addColorStop(1, '#FFD166');
    ctx.fillStyle = grad;

    const r = Math.min(4, barWidth / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + barWidth - r, y);
    ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + r);
    ctx.lineTo(x + barWidth, padding.top + chartH);
    ctx.lineTo(x, padding.top + chartH);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.fill();

    ctx.fillStyle = '#A08B7A';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    if (barCount <= 10 || i % Math.ceil(barCount / 10) === 0) {
      ctx.fillText(labels[i], x + barWidth / 2, padding.top + chartH + 6);
    }
  });
}

function drawPieChart(priorityCounts) {
  const canvas = document.getElementById('pieChart');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 220 * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = 220;
  ctx.clearRect(0, 0, W, H);

  const data = [
    { label: '高优先级', value: priorityCounts.high, color: '#FF6B6B' },
    { label: '中优先级', value: priorityCounts.mid, color: '#FFD166' },
    { label: '低优先级', value: priorityCounts.low, color: '#6BCB77' }
  ];

  const total = data.reduce((s, d) => s + d.value, 0);

  if (total === 0) {
    ctx.fillStyle = '#A08B7A';
    ctx.font = '14px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('暂无已完成数据', W / 2, H / 2);
    return;
  }

  const cx = W / 2 - 50;
  const cy = H / 2;
  const radius = 75;
  let startAngle = -Math.PI / 2;

  data.forEach(d => {
    if (d.value === 0) return;
    const sliceAngle = (d.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = d.color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    startAngle += sliceAngle;
  });

  ctx.beginPath();
  ctx.arc(cx, cy, 40, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.fillStyle = '#4A3728';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total, cx, cy);

  const legendX = cx + radius + 30;
  let legendY = cy - 36;
  data.forEach(d => {
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.arc(legendX, legendY + 6, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#4A3728';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${d.label} (${d.value})`, legendX + 14, legendY + 6);
    legendY += 24;
  });
}

function renderHeatmap() {
  const container = document.getElementById('heatmap');
  const today = new Date();
  const days = 30;
  let html = '';

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = dateKey(d);
    const items = todos[key] || [];
    const total = items.length;
    const done = items.filter(t => t.done).length;
    const rate = total > 0 ? done / total : 0;

    let level = '';
    if (total === 0) level = '';
    else if (rate <= 0.25) level = 'level-1';
    else if (rate <= 0.5) level = 'level-2';
    else if (rate <= 0.75) level = 'level-3';
    else level = 'level-4';

    const parts = key.split('-');
    const tip = `${+parts[1]}/${+parts[2]}: ${done}/${total} 已完成`;
    html += `<div class="heatmap-day ${level}" data-tip="${tip}"></div>`;
  }

  container.innerHTML = html;
}

// ================================================================
// 模块三：灵感记录
// ================================================================

function getAllIdeaTags() {
  const tagSet = new Set();
  ideas.forEach(idea => idea.tags.forEach(t => tagSet.add(t)));
  return [...tagSet].sort();
}

function renderIdeaFilterTags() {
  const container = document.getElementById('ideaAllTags');
  const allTags = getAllIdeaTags();

  let html = `<span class="idea-tag-filter${currentIdeaTag === 'all' ? ' active' : ''}" data-tag="all">全部</span>`;
  allTags.forEach(tag => {
    html += `<span class="idea-tag-filter${currentIdeaTag === tag ? ' active' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`;
  });

  container.innerHTML = html;

  container.querySelectorAll('.idea-tag-filter').forEach(el => {
    el.addEventListener('click', () => {
      currentIdeaTag = el.dataset.tag;
      renderIdeaFilterTags();
      renderIdeasList();
    });
  });
}

function renderIdeasList() {
  const listEl = document.getElementById('ideasList');

  let filtered = [...ideas];

  if (currentIdeaTag !== 'all') {
    filtered = filtered.filter(idea => idea.tags.includes(currentIdeaTag));
  }

  if (currentIdeaSort === 'newest') {
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } else {
    filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  if (filtered.length === 0) {
    listEl.innerHTML = '<p class="empty-tip">还没有灵感记录，有想法就快写下来吧~</p>';
    return;
  }

  listEl.innerHTML = filtered.map(idea => {
    const d = new Date(idea.createdAt);
    const timeStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const tagsHtml = idea.tags.map(t => `<span class="idea-tag">${escapeHtml(t)}</span>`).join('');

    return `
      <div class="idea-card">
        <button class="idea-delete" data-id="${idea.id}" title="删除">✕</button>
        <div class="idea-content">${escapeHtml(idea.text)}</div>
        <div class="idea-bottom">
          <div class="idea-tags">${tagsHtml}</div>
          <span class="idea-time">${timeStr}</span>
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.idea-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await _supaClient.from('ideas').delete().eq('id', btn.dataset.id);
      ideas = ideas.filter(i => i.id !== btn.dataset.id);
      backupIdeasToLocal();
      renderIdeasList();
      renderIdeaFilterTags();
    });
  });
}

function renderNewIdeaTags() {
  const container = document.getElementById('ideaNewTags');
  container.innerHTML = newIdeaTags.map((tag, i) => `
    <span class="idea-new-tag">${escapeHtml(tag)} <button data-index="${i}">✕</button></span>
  `).join('');

  container.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      newIdeaTags.splice(+btn.dataset.index, 1);
      renderNewIdeaTags();
    });
  });
}

let isAddingIdea = false;

async function addIdea() {
  if (isAddingIdea) return;

  const input = document.getElementById('ideaInput');
  const addBtn = document.getElementById('addIdeaBtn');
  const text = input.value.trim();

  if (!text) {
    input.focus();
    return;
  }

  isAddingIdea = true;
  addBtn.disabled = true;
  addBtn.textContent = '记录中...';

  try {
    const { data, error } = await _supaClient
      .from('ideas')
      .insert({
        user_id: currentUser.id,
        text,
        tags: [...newIdeaTags]
      })
      .select()
      .single();

    if (error) {
      console.error('添加失败:', error);
      alert('添加灵感失败: ' + error.message);
      return;
    }

    ideas.push({
      id: data.id,
      text: data.text,
      tags: data.tags || [],
      createdAt: data.created_at
    });

    input.value = '';
    newIdeaTags = [];
    renderNewIdeaTags();
    backupIdeasToLocal();
    renderIdeasList();
    renderIdeaFilterTags();
  } catch (err) {
    console.error('添加灵感异常:', err);
    alert('网络错误，请检查网络后重试');
  } finally {
    isAddingIdea = false;
    addBtn.disabled = false;
    addBtn.textContent = '记录灵感 💡';
  }
}

// ================================================================
// 心跳保活：防止 Supabase 数据库因不活跃被暂停
// ================================================================
let heartbeatTimer = null;

function startHeartbeat() {
  if (heartbeatTimer) return;
  // 每 4 小时发一次轻量查询，保持数据库活跃
  heartbeatTimer = setInterval(async () => {
    if (!currentUser) return;
    try {
      await _supaClient.from('todos').select('id').limit(1);
      console.log('心跳保活: OK', new Date().toLocaleTimeString());
    } catch (e) {
      console.warn('心跳保活失败:', e);
    }
  }, 4 * 60 * 60 * 1000); // 4小时
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ================================================================
// 初始化渲染（仅渲染，不绑定事件）
// ================================================================
function initApp() {
  const now = new Date();
  if (!calYear) calYear = now.getFullYear();
  if (calMonth === undefined || calMonth === null) calMonth = now.getMonth();

  renderCalendar();
  renderTodoList();
  updateTodoHeader();
  updateProgressBar();
  renderIdeaFilterTags();
  renderIdeasList();
}

// ================================================================
// 页面加载后立即绑定所有事件（不依赖 Supabase）
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
  // Tab 切换
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const section = document.getElementById(btn.dataset.tab + 'Section');
      if (section) section.classList.add('active');

      if (btn.dataset.tab === 'summary') {
        renderSummary();
      }
    });
  });

  // 日历导航
  document.getElementById('prevMonth').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });

  document.getElementById('nextMonth').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });

  document.getElementById('todayBtn').addEventListener('click', () => {
    selectedDate = new Date();
    calYear = selectedDate.getFullYear();
    calMonth = selectedDate.getMonth();
    renderCalendar();
    renderTodoList();
    updateTodoHeader();
  });

  // 添加待办
  document.getElementById('addTodoBtn').addEventListener('click', addTodo);
  document.getElementById('todoInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') addTodo();
  });

  // 优先级圆点切换
  document.getElementById('priorityDots').addEventListener('click', e => {
    const btn = e.target.closest('.dot-btn');
    if (!btn) return;
    document.querySelectorAll('#priorityDots .dot-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });

  // 全部完成弹窗关闭
  document.getElementById('completionCloseBtn').addEventListener('click', hideCompletionOverlay);
  document.getElementById('completionOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideCompletionOverlay();
  });

  // 待办筛选
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderTodoList();
    });
  });

  // 统计范围切换
  document.querySelectorAll('.summary-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.summary-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSummaryRange = btn.dataset.range;
      renderSummary();
    });
  });

  // 添加灵感
  document.getElementById('addIdeaBtn').addEventListener('click', addIdea);

  // 灵感标签输入
  document.getElementById('ideaTagInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') {
      const input = e.target;
      const tag = input.value.trim();
      if (tag && !newIdeaTags.includes(tag) && newIdeaTags.length < 5) {
        newIdeaTags.push(tag);
        renderNewIdeaTags();
      }
      input.value = '';
    }
  });

  // 灵感排序
  document.getElementById('ideaSortSelect').addEventListener('change', e => {
    currentIdeaSort = e.target.value;
    renderIdeasList();
  });

  // 窗口大小变化时重绘图表
  window.addEventListener('resize', () => {
    if (document.getElementById('summarySection').classList.contains('active')) {
      renderSummary();
    }
  });

  // 实时时钟
  function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const timeEl = document.getElementById('clockTime');
    const dateEl = document.getElementById('clockDate');
    if (timeEl) timeEl.textContent = `${h}:${m}`;
    if (dateEl) {
      const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      dateEl.textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${weekDays[now.getDay()]}`;
    }
  }
  updateClock();
  setInterval(updateClock, 1000);

  // 启动认证（必须在事件绑定之后）
  setupAuth();
});
