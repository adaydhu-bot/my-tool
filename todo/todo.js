// ================================================================
// Ada's To Do List - Supabase 云端同步版 + 全功能增强
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
let reportWeekOffset = -1; // -1=上周, 0=本周, etc.
let reportMonthOffset = -1; // -1=上月, 0=本月, etc.
let currentSummaryMode = 'week'; // 'week' | 'month'
let currentIdeaTag = 'all';
let currentIdeaSort = 'newest';
let currentIdeaStatus = 'all';
let currentIdeaSearch = '';
let newIdeaTags = [];
let editingIdeaId = null;
let editingIdeaTags = [];
let currentUser = null;
let editingTodoId = null;
let editingTodoDate = null;

// 拖拽状态
let draggedItem = null;
let draggedId = null;

// 喝水提醒状态
let waterTimerInterval = null;
let waterSecondsLeft = 30 * 60;
let waterEnabled = true;

// 待办提醒状态
let reminderEnabled = false;
let reminderTime = '09:00';
let reminderCheckInterval = null;
let lastReminderDate = null;

// ========== 超时与离线支持 ==========
function withTimeout(promise, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('请求超时')), ms))
  ]);
}

function tempId() {
  return 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

let pendingSyncs = [];

async function processPendingSyncs() {
  if (pendingSyncs.length === 0 || !currentUser) return;
  const queue = [...pendingSyncs];
  pendingSyncs = [];

  for (const task of queue) {
    try {
      if (task.type === 'add_todo') {
        const { data, error } = await withTimeout(
          _supaClient.from('todos').insert({
            user_id: currentUser.id,
            date: task.date,
            text: task.text,
            priority: task.priority,
            done: task.done,
            time: task.time || null,
            end_time: task.endTime || null
          }).select().single()
        );
        if (!error && data) {
          const items = todos[task.date] || [];
          const localItem = items.find(t => t.id === task.localId);
          if (localItem) localItem.id = data.id;
          backupTodosToLocal();
        }
      } else if (task.type === 'add_idea') {
        const { data, error } = await withTimeout(
          _supaClient.from('ideas').insert({
            user_id: currentUser.id,
            text: task.text,
            tags: task.tags
          }).select().single()
        );
        if (!error && data) {
          const localItem = ideas.find(i => i.id === task.localId);
          if (localItem) localItem.id = data.id;
          backupIdeasToLocal();
        }
      }
    } catch (e) {
      pendingSyncs.push(task);
    }
  }
}

setInterval(processPendingSyncs, 30000);

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
      nicknameInput.style.display = authMode === 'register' ? 'block' : 'none';
      nicknameInput.required = authMode === 'register';
      errorEl.textContent = '';
    });
  }

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
          options: { data: { nickname } }
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
        if (result.data.session) return;
        errorEl.style.color = 'var(--success)';
        errorEl.textContent = '注册成功！请检查邮箱点击确认链接后再登录';
      }
    } catch (err) {
      errorEl.textContent = '网络错误，请重试';
    }

    submitBtn.disabled = false;
    submitBtn.textContent = authMode === 'login' ? '登录' : '注册';
  });

  let appInitialized = false;

  _supaClient.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      currentUser = session.user;
      overlay.classList.add('hidden');
      document.getElementById('app').style.display = 'block';

      if (appInitialized && event === 'TOKEN_REFRESHED') return;

      startHeartbeat();

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

      appInitialized = true;

      // ====== 快速启动：先用本地缓存立即渲染 UI ======
      const localTodos = getLocalTodosBackup();
      const localIdeas = getLocalIdeasBackup();
      if (localTodos) {
        todos = localTodos;
        // 本地缓存去重：同日期内同文本只保留一条
        deduplicateTodos();
        // 本地缓存也做跨日期已完成任务清理，防止脏数据先渲染
        cleanLocalTodosBeforeRender();
      }
      if (localIdeas) ideas = localIdeas;

      // 立即渲染 UI（用缓存数据），消除白屏等待
      initApp();
      loadSettings();
      initWaterReminder();
      initTodoReminder();

      // ====== 后台异步加载云端数据，完成后静默刷新 ======
      (async () => {
        try {
          await loadAllData();
          await restoreFromLocalBackup();
          const todoCount = Object.values(todos).reduce((sum, arr) => sum + arr.length, 0);
          if (todoCount > 0) backupTodosToLocal();
          if (ideas.length > 0) backupIdeasToLocal();
        } catch (err) {
          console.error('数据加载失败:', err);
        }
        try {
          await carryOverUnfinishedTodos();
          generateRepeatingTodos();
          backupTodosToLocal();
        } catch (err) {
          console.error('顺延/重复任务处理失败:', err);
        }
        // 云端数据加载完毕，静默刷新 UI
        initApp();
      })();
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

  // 从云端查询今天已存在的所有待办文本（含顺延），确保幂等
  const existingTexts = new Set();
  
  // 本地数据
  (todos[today] || []).forEach(t => existingTexts.add(t.text));
  
  // 云端数据（覆盖本地可能的不一致）
  try {
    const { data: cloudTodayItems } = await withTimeout(
      _supaClient.from('todos').select('text')
        .eq('user_id', currentUser.id)
        .eq('date', today),
      8000
    );
    if (cloudTodayItems) {
      cloudTodayItems.forEach(ci => existingTexts.add(ci.text));
    }
  } catch (e) {
    // 查询失败时继续用本地数据判断
  }

  // 收集所有已完成的任务文本（跨所有日期），这些不需要顺延
  const allCompletedTexts = new Set();
  Object.keys(todos).forEach(dk => {
    (todos[dk] || []).forEach(item => {
      if (item.done) allCompletedTexts.add(item.text);
    });
  });

  // 收集所有重复任务模板的文本，避免repeat信息丢失后被误顺延
  const repeatTexts = new Set();
  const templates = collectRepeatTemplates();
  Object.values(templates).forEach(t => repeatTexts.add(t.text));

  const tasksToCarry = [];

  for (let i = 1; i <= 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    const items = todos[key] || [];
    items.forEach(item => {
      if (!item.done && !item.repeat
        && !repeatTexts.has(item.text)
        && !existingTexts.has(item.text)
        && !allCompletedTexts.has(item.text)) {
        tasksToCarry.push({ ...item, originalDate: key });
        existingTexts.add(item.text);
      }
    });
  }

  if (tasksToCarry.length === 0) return;

  for (const task of tasksToCarry) {
    try {
      const { data, error } = await withTimeout(
        _supaClient.from('todos').insert({
          user_id: currentUser.id,
          date: today,
          text: task.text,
          priority: task.priority,
          done: false,
          carried_from: task.originalDate,
          time: task.time || null,
          end_time: task.endTime || null
        }).select().single(),
        8000
      );

      if (!error && data) {
        if (!todos[today]) todos[today] = [];
        todos[today].push({
          id: data.id,
          text: data.text,
          priority: data.priority,
          done: data.done,
          createdAt: data.created_at,
          carriedFrom: data.carried_from,
          subtasks: [],
          repeat: null,
          time: task.time || null,
          endTime: task.endTime || null,
          order: todos[today].length
        });
      }
    } catch (err) {
      if (!todos[today]) todos[today] = [];
      todos[today].push({
        id: tempId(),
        text: task.text,
        priority: task.priority,
        done: false,
        createdAt: new Date().toISOString(),
        carriedFrom: task.originalDate,
        subtasks: [],
        repeat: null,
        time: task.time || null,
        endTime: task.endTime || null,
        order: todos[today].length
      });
    }

    // 顺延后删除原始日期的这条未完成任务（云端+本地），防止下次再次顺延
    const originalItems = todos[task.originalDate] || [];
    const origIdx = originalItems.findIndex(t => t.text === task.text && !t.done);
    if (origIdx !== -1) {
      const origItem = originalItems[origIdx];
      originalItems.splice(origIdx, 1);
      if (origItem.id && !String(origItem.id).startsWith('local_')) {
        try {
          await withTimeout(
            _supaClient.from('todos').delete().eq('id', origItem.id),
            8000
          );
        } catch (e) {}
      }
    }
  }
}

// ========== 重复任务生成（仅为今天生成实体） ==========
function generateRepeatingTodos() {
  const today = todayKey();
  const todayDate = new Date();
  const dayOfWeek = todayDate.getDay();
  const dayOfMonth = todayDate.getDate();

  const templates = collectRepeatTemplates();
  const todayItems = todos[today] || [];

  Object.values(templates).forEach(template => {
    const repeat = template.repeat;
    let shouldGenerate = false;

    if (repeat.type === 'daily') {
      shouldGenerate = true;
    } else if (repeat.type === 'weekly' && dayOfWeek === repeat.value) {
      shouldGenerate = true;
    } else if (repeat.type === 'monthly' && dayOfMonth === repeat.value) {
      shouldGenerate = true;
    } else if (repeat.type === 'weekdays' && dayOfWeek >= 1 && dayOfWeek <= 5) {
      shouldGenerate = true;
    }

    if (shouldGenerate) {
      const alreadyExists = todayItems.some(t =>
        t.text === template.text && t.repeat && JSON.stringify(t.repeat) === JSON.stringify(template.repeat)
      );

      if (!alreadyExists) {
        if (!todos[today]) todos[today] = [];
        const newItem = {
          id: tempId(),
          text: template.text,
          priority: template.priority,
          done: false,
          createdAt: new Date().toISOString(),
          carriedFrom: null,
          subtasks: [],
          repeat: template.repeat,
          time: template.time || null,
          endTime: template.endTime || null,
          order: todos[today].length
        };
        todos[today].push(newItem);

        if (currentUser) {
          withTimeout(
            _supaClient.from('todos').insert({
              user_id: currentUser.id,
              date: today,
              text: newItem.text,
              priority: newItem.priority,
              done: false,
              time: newItem.time || null,
              end_time: newItem.endTime || null
            }).select().single(),
            8000
          ).then(({ data }) => {
            if (data) newItem.id = data.id;
          }).catch(() => {});
        }
      }
    }
  });
}

// 收集所有重复任务模板（去重）
function collectRepeatTemplates() {
  const repeatTemplates = [];
  Object.keys(todos).forEach(dk => {
    (todos[dk] || []).forEach(item => {
      if (item.repeat) {
        repeatTemplates.push({ ...item, _sourceDate: dk });
      }
    });
  });

  const uniqueRepeats = {};
  repeatTemplates.forEach(t => {
    const key = t.text + '|' + JSON.stringify(t.repeat);
    if (!uniqueRepeats[key] || new Date(t.createdAt) > new Date(uniqueRepeats[key].createdAt)) {
      uniqueRepeats[key] = t;
    }
  });
  return uniqueRepeats;
}

// 判断某个日期是否应该有某个重复任务的实例
function dateMatchesRepeat(dateStr, repeat, createdAt) {
  const parts = dateStr.split('-');
  const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  const dayOfWeek = d.getDay();
  const dayOfMonth = d.getDate();

  // 只在创建日期当天或之后生效
  const createdDate = new Date(createdAt);
  createdDate.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  if (d < createdDate) return false;

  // 创建当天只在匹配时才显示（如周四创建每周五→周四不显示）
  if (repeat.type === 'daily') return true;
  if (repeat.type === 'weekly') return dayOfWeek === repeat.value;
  if (repeat.type === 'monthly') return dayOfMonth === repeat.value;
  if (repeat.type === 'weekdays') return dayOfWeek >= 1 && dayOfWeek <= 5;
  return false;
}

// 获取某日期的虚拟重复任务（不含已实际存在的）
function getVirtualRepeatingTodos(dateKey) {
  const templates = collectRepeatTemplates();
  const existingItems = todos[dateKey] || [];
  const virtualItems = [];

  Object.values(templates).forEach(template => {
    if (!dateMatchesRepeat(dateKey, template.repeat, template.createdAt)) return;

    // 如果该日期已有同文本的任务（无论是否标记为重复），跳过
    // 这避免了实体任务 repeat 字段丢失时虚拟任务仍被生成的问题
    const alreadyExists = existingItems.some(t => t.text === template.text);
    if (alreadyExists) return;

    virtualItems.push({
      id: 'virtual_' + template.id + '_' + dateKey,
      text: template.text,
      priority: template.priority,
      done: false,
      createdAt: template.createdAt,
      carriedFrom: null,
      subtasks: [],
      repeat: template.repeat,
      time: template.time || null,
      endTime: template.endTime || null,
      order: 9000 + virtualItems.length,
      isVirtual: true
    });
  });

  return virtualItems;
}

// 将虚拟重复任务实例化为真实记录（用于编辑）
async function materializeVirtualTodo(virtualId) {
  const key = dateKey(selectedDate);
  const allItems = getTodosForDate(key);
  const virtualItem = allItems.find(t => t.id === virtualId);
  if (!virtualItem) return null;

  const newItem = {
    id: tempId(),
    text: virtualItem.text,
    priority: virtualItem.priority,
    done: virtualItem.done,
    createdAt: new Date().toISOString(),
    carriedFrom: null,
    subtasks: [],
    repeat: virtualItem.repeat ? { ...virtualItem.repeat } : null,
    time: virtualItem.time || null,
    endTime: virtualItem.endTime || null,
    order: (todos[key] || []).length
  };

  if (!todos[key]) todos[key] = [];
  todos[key].push(newItem);

  // 同步到云端
  if (currentUser) {
    try {
      const { data, error } = await withTimeout(
        _supaClient.from('todos').insert({
          user_id: currentUser.id,
          date: key,
          text: newItem.text,
          priority: newItem.priority,
          done: newItem.done,
          time: newItem.time || null,
          end_time: newItem.endTime || null
        }).select().single(),
        8000
      );
      if (!error && data) {
        newItem.id = data.id;
      }
    } catch (e) {}
  }

  backupTodosToLocal();
  renderTodoList();
  updateTodoHeader();
  return newItem.id;
}

// 判断某日期是否有任何待办（含虚拟重复）
function dateHasTodos(dateKey) {
  if (todos[dateKey] && todos[dateKey].length > 0) return true;
  const templates = collectRepeatTemplates();
  return Object.values(templates).some(t => dateMatchesRepeat(dateKey, t.repeat, t.createdAt));
}

// ========== 云端数据加载 ==========
async function loadAllData() {
  await Promise.all([loadTodosFromCloud(), loadIdeasFromCloud()]);
}

async function loadTodosFromCloud() {
  try {
    const { data, error } = await withTimeout(
      _supaClient
        .from('todos')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: true }),
      10000
    );

    if (error) {
      console.error('加载待办失败:', error);
      return;
    }
    const newTodos = {};
    if (data) {
      data.forEach(item => {
        if (!newTodos[item.date]) newTodos[item.date] = [];
        const todoItem = {
          id: item.id,
          text: item.text,
          priority: item.priority,
          done: item.done,
          createdAt: item.created_at,
          carriedFrom: item.carried_from || null,
          subtasks: [],
          repeat: null,
          time: item.time || null,
          endTime: item.end_time || null,
          order: newTodos[item.date].length
        };
        newTodos[item.date].push(todoItem);
      });
    }

    // 去重：同日期内同文本的任务只保留一条（保留已完成的优先，否则保留最早创建的）
    const allDedupDeletes = [];
    Object.keys(newTodos).forEach(dk => {
      const seen = new Map();
      const deduped = [];
      const duplicateIds = [];
      newTodos[dk].forEach(item => {
        const key = item.text;
        if (!seen.has(key)) {
          seen.set(key, item);
          deduped.push(item);
        } else {
          // 如果新项已完成而旧项未完成，替换为已完成的版本
          const existing = seen.get(key);
          if (item.done && !existing.done) {
            duplicateIds.push(existing.id);
            const idx = deduped.indexOf(existing);
            if (idx !== -1) deduped[idx] = item;
            seen.set(key, item);
          } else {
            duplicateIds.push(item.id);
          }
        }
      });
      newTodos[dk] = deduped;
      // 同步清理云端重复数据
      if (duplicateIds.length > 0 && currentUser) {
        const delPromises = duplicateIds
          .filter(dupId => dupId && !String(dupId).startsWith('local_'))
          .map(dupId => withTimeout(
            _supaClient.from('todos').delete().eq('id', dupId),
            8000
          ).catch(() => {}));
        allDedupDeletes.push(...delPromises);
      }
    });

    // 等待所有去重删除完成
    if (allDedupDeletes.length > 0) {
      await Promise.all(allDedupDeletes);
    }

    // 跨日期修复：收集所有已完成任务的文本
    const completedTexts = new Set();
    Object.keys(newTodos).forEach(dk => {
      (newTodos[dk] || []).forEach(item => {
        if (item.done) completedTexts.add(item.text);
      });
    });

    // 清理：如果某个任务在任何日期已完成，今天的未完成顺延副本应被清理
    const today = todayKey();
    const todayList = newTodos[today] || [];
    const cleanupIds = [];
    newTodos[today] = todayList.filter(item => {
      if (item.carriedFrom && !item.done && completedTexts.has(item.text)) {
        cleanupIds.push(item.id);
        return false;
      }
      return true;
    });

    // 同步等待云端删除完成，确保下次刷新不会再加载到这些脏数据
    if (cleanupIds.length > 0 && currentUser) {
      const deletePromises = cleanupIds
        .filter(id => id && !String(id).startsWith('local_'))
        .map(id => withTimeout(
          _supaClient.from('todos').delete().eq('id', id),
          8000
        ).catch(() => {}));
      await Promise.all(deletePromises);
    }

    // 同时清理：过去7天内，已被顺延到今天的原始任务的未完成副本
    // （即：如果某天的任务已经有 carried_from 指向它的今天版本，原始的应该标记完成）
    const todayCarriedFroms = new Set();
    (newTodos[today] || []).forEach(item => {
      if (item.carriedFrom) todayCarriedFroms.add(item.carriedFrom + '|' + item.text);
    });
    
    const staleCleanupIds = [];
    Object.keys(newTodos).forEach(dk => {
      if (dk === today) return;
      newTodos[dk] = (newTodos[dk] || []).filter(item => {
        // 如果这个任务在今天有顺延副本，且原始未完成，删除原始的
        if (!item.done && !item.repeat && todayCarriedFroms.has(dk + '|' + item.text)) {
          staleCleanupIds.push(item.id);
          return false;
        }
        return true;
      });
    });

    if (staleCleanupIds.length > 0 && currentUser) {
      const staleDeletePromises = staleCleanupIds
        .filter(id => id && !String(id).startsWith('local_'))
        .map(id => withTimeout(
          _supaClient.from('todos').delete().eq('id', id),
          8000
        ).catch(() => {}));
      await Promise.all(staleDeletePromises);
    }

    // 从本地备份恢复子任务和重复任务信息（云端表没有这些字段）
    const localBackup = getLocalTodosBackup();
    if (localBackup) {
      Object.keys(newTodos).forEach(dk => {
        const localItems = localBackup[dk] || [];
        newTodos[dk].forEach(item => {
          // 优先按 id 匹配（精确），其次按 text 匹配（模糊）
          const localItemById = localItems.find(li => li.id === item.id);
          const localItemByText = !localItemById ? localItems.find(li => li.text === item.text) : null;
          const localItem = localItemById || localItemByText;
          if (localItem) {
            item.subtasks = localItem.subtasks || [];
            // repeat 字段从本地备份恢复（id匹配优先，text匹配兜底）
            if (localItem.repeat) {
              item.repeat = localItem.repeat;
            }
            item.time = localItem.time || item.time || null;
            item.endTime = localItem.endTime || item.endTime || null;
            if (localItem.order !== undefined) item.order = localItem.order;
          }
        });
      });
    }

    todos = newTodos;
  } catch (err) {
    console.error('加载待办超时/异常:', err);
    const localTodos = getLocalTodosBackup();
    if (localTodos) {
      todos = localTodos;
      deduplicateTodos();
      cleanLocalTodosBeforeRender();
    }
  }
}

async function loadIdeasFromCloud() {
  try {
    const { data, error } = await withTimeout(
      _supaClient
        .from('ideas')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: true }),
      10000
    );

    if (error) {
      console.error('加载灵感失败:', error);
      return;
    }
    if (data) {
      ideas = data.map(item => ({
        id: item.id,
        text: item.text,
        tags: item.tags || [],
        status: item.status || 'pending',
        createdAt: item.created_at
      }));
    }
  } catch (err) {
    console.error('加载灵感超时/异常:', err);
    const localIdeas = getLocalIdeasBackup();
    if (localIdeas) {
      ideas = localIdeas;
    }
  }
}

// ========== 本地备份 ==========
function backupTodosToLocal() {
  try {
    localStorage.setItem('todos_backup', JSON.stringify(todos));
    localStorage.setItem('todos_backup_time', new Date().toISOString());
  } catch (e) {}
}

function backupIdeasToLocal() {
  try {
    localStorage.setItem('ideas_backup', JSON.stringify(ideas));
    localStorage.setItem('ideas_backup_time', new Date().toISOString());
  } catch (e) {}
}

function getLocalTodosBackup() {
  try {
    const data = localStorage.getItem('todos_backup');
    return data ? JSON.parse(data) : null;
  } catch (e) { return null; }
}

function getLocalIdeasBackup() {
  try {
    const data = localStorage.getItem('ideas_backup');
    return data ? JSON.parse(data) : null;
  } catch (e) { return null; }
}

async function restoreFromLocalBackup() {
  const localTodos = getLocalTodosBackup();
  const localIdeas = getLocalIdeasBackup();
  const todoCount = Object.values(todos).reduce((sum, arr) => sum + arr.length, 0);
  const ideaCount = ideas.length;
  let restored = false;

  if (todoCount === 0 && localTodos) {
    const allLocalItems = Object.values(localTodos).flat();
    if (allLocalItems.length > 0) {
      for (const dk of Object.keys(localTodos)) {
        for (const item of localTodos[dk]) {
          try {
            const { data, error } = await withTimeout(
              _supaClient.from('todos').insert({
                user_id: currentUser.id,
                date: dk,
                text: item.text,
                priority: item.priority,
                done: item.done,
                carried_from: item.carriedFrom || null,
                time: item.time || null,
                end_time: item.endTime || null
              }).select().single(),
              8000
            );

            if (!error && data) {
              if (!todos[dk]) todos[dk] = [];
              todos[dk].push({
                id: data.id,
                text: data.text,
                priority: data.priority,
                done: data.done,
                createdAt: data.created_at,
                carriedFrom: data.carried_from || null,
                subtasks: item.subtasks || [],
                repeat: item.repeat || null,
                time: item.time || null,
                endTime: item.endTime || null,
                order: todos[dk].length
              });
            }
          } catch (e) {
            if (!todos[dk]) todos[dk] = [];
            todos[dk].push({ ...item, id: item.id || tempId(), subtasks: item.subtasks || [], repeat: item.repeat || null, time: item.time || null, endTime: item.endTime || null, order: todos[dk].length });
          }
        }
      }
      restored = true;
    }
  }

  if (ideaCount === 0 && localIdeas && localIdeas.length > 0) {
    for (const item of localIdeas) {
      try {
        const { data, error } = await withTimeout(
          _supaClient.from('ideas').insert({
            user_id: currentUser.id,
            text: item.text,
            tags: item.tags || []
          }).select().single(),
          8000
        );
        if (!error && data) {
          ideas.push({ id: data.id, text: data.text, tags: data.tags || [], status: item.status || 'pending', createdAt: data.created_at });
        }
      } catch (e) {
        ideas.push({ ...item, id: item.id || tempId() });
      }
    }
    restored = true;
  }

  if (restored) {
    backupTodosToLocal();
    backupIdeasToLocal();
  }
}

// ========== 工具函数 ==========
// 全局待办去重：同日期内同文本只保留一条（优先保留已完成的）
function deduplicateTodos() {
  Object.keys(todos).forEach(dk => {
    const seen = new Map();
    const deduped = [];
    (todos[dk] || []).forEach(item => {
      const key = item.text;
      if (!seen.has(key)) {
        seen.set(key, item);
        deduped.push(item);
      } else {
        const existing = seen.get(key);
        // 优先保留已完成的版本
        if (item.done && !existing.done) {
          const idx = deduped.indexOf(existing);
          if (idx !== -1) deduped[idx] = item;
          seen.set(key, item);
        }
      }
    });
    todos[dk] = deduped;
  });
}

// 本地缓存渲染前清理：跨日期已完成任务的顺延副本 + 已被顺延的原始副本
function cleanLocalTodosBeforeRender() {
  const today = todayKey();
  
  // 1. 收集所有已完成任务的文本
  const completedTexts = new Set();
  Object.keys(todos).forEach(dk => {
    (todos[dk] || []).forEach(item => {
      if (item.done) completedTexts.add(item.text);
    });
  });

  // 2. 清理今天的未完成顺延副本（如果该文本在任何日期已完成）
  const todayList = todos[today] || [];
  todos[today] = todayList.filter(item => {
    if (item.carriedFrom && !item.done && completedTexts.has(item.text)) {
      return false;
    }
    return true;
  });

  // 3. 清理已被顺延到今天的原始未完成副本
  const todayCarriedFroms = new Set();
  (todos[today] || []).forEach(item => {
    if (item.carriedFrom) todayCarriedFroms.add(item.carriedFrom + '|' + item.text);
  });

  Object.keys(todos).forEach(dk => {
    if (dk === today) return;
    todos[dk] = (todos[dk] || []).filter(item => {
      if (!item.done && !item.repeat && todayCarriedFroms.has(dk + '|' + item.text)) {
        return false;
      }
      return true;
    });
  });
}

function dateKey(d) {
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function todayKey() { return dateKey(new Date()); }

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

// 从文本中移除时间信息，用于日程面板显示（避免与时间轴重复）
function stripTimeFromText(text) {
  // 预处理：全角数字→半角，全角冒号→半角
  let t = text.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
              .replace(/：/g, ':');

  // 移除各种时间范围和单独时间表达式
  const patterns = [
    // "10:00到11:30开会" → "开会"
    /\d{1,2}:\d{2}\s*[到至\-\—~～]\s*\d{1,2}:\d{2}\s*/g,
    // "10点到11点半开会" → "开会"
    /\d{1,2}[点时:]\d{0,2}半?\s*[到至\-\—~～]\s*\d{1,2}[点时:]\d{0,2}半?\s*/g,
    // "10-11点开会" → "开会"
    /\d{1,2}\s*[到至\-\—~～]\s*\d{1,2}\s*[点时]\s*/g,
    // "10点半开会" → "开会"
    /\d{1,2}[点时]半\s*/g,
    // "17点20开会" → "开会"（N点M或N点MM，分钟部分为纯数字）
    /\d{1,2}[点时]\d{1,2}分?\s*/g,
    // "10点开会" → "开会"
    /\d{1,2}[点时]\s*/g,
    // "10:00开会" → "开会"
    /\d{1,2}:\d{2}\s*/g,
  ];

  for (const pat of patterns) {
    t = t.replace(pat, '');
  }

  return t.trim() || text;
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

  const selKey = dateKey(selectedDate);

  let html = '';

  for (let i = firstDay - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const d = new Date(calYear, calMonth - 1, day);
    const key = dateKey(d);
    const hasTodos = dateHasTodos(key);
    html += `<button class="cal-day other-month${hasTodos ? ' has-todos' : ''}" data-date="${key}">${day}</button>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(calYear, calMonth, day);
    const key = dateKey(d);
    const isToday = key === todayKey();
    const isSelected = key === selKey;
    const hasTodos = dateHasTodos(key);
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
    const hasTodos = dateHasTodos(key);
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
  const real = todos[key] || [];
  const virtual = getVirtualRepeatingTodos(key);
  return [...real, ...virtual];
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

  const items = getTodosForDate(key).filter(t => !t.time); // 只计算待办，不含日程
  if (items.length === 0) {
    progressEl.textContent = '';
  } else {
    const done = items.filter(t => t.done).length;
    progressEl.textContent = `${done}/${items.length} 已完成`;
  }
}

function renderTodoList() {
  const key = dateKey(selectedDate);
  let items = getTodosForDate(key);

  // 分为定时任务（日程）和全天任务（待办）
  const timedItems = items.filter(t => t.time);
  const allDayItems = items.filter(t => !t.time);

  // 日程去重：同文本的日程只保留一条（优先保留已完成的）
  const seenSchedule = new Map();
  const dedupedTimed = [];
  timedItems.forEach(item => {
    const k = item.text;
    if (!seenSchedule.has(k)) {
      seenSchedule.set(k, item);
      dedupedTimed.push(item);
    } else {
      const existing = seenSchedule.get(k);
      if (item.done && !existing.done) {
        const idx = dedupedTimed.indexOf(existing);
        if (idx !== -1) dedupedTimed[idx] = item;
        seenSchedule.set(k, item);
      }
    }
  });

  // 渲染左侧日程面板
  renderSchedulePanel(dedupedTimed);

  // 右侧只显示全天待办
  let filteredItems = [...allDayItems];
  if (currentFilter === 'active') {
    filteredItems = filteredItems.filter(t => !t.done);
  } else if (currentFilter === 'completed') {
    filteredItems = filteredItems.filter(t => t.done);
  }

  const listEl = document.getElementById('todoList');

  // 更新右侧面板 badge
  const panelBadge = document.getElementById('todoPanelBadge');
  if (panelBadge) {
    const doneTodos = allDayItems.filter(t => t.done).length;
    panelBadge.textContent = `${doneTodos}/${allDayItems.length} 完成`;
  }

  if (filteredItems.length === 0) {
    const tips = {
      all: '还没有待办事项，添加一个吧~',
      active: '所有任务都完成啦，太棒了！🎉',
      completed: '还没有已完成的任务哦~'
    };
    listEl.innerHTML = `<p class="empty-tip">${tips[currentFilter]}</p>`;
    updateProgressBar();
    return;
  }

  // 全天任务排序：未完成在上，已完成沉底；同组内按 order 排序
  filteredItems.sort((a, b) => {
    // 已完成的排到最后
    if (a.done !== b.done) return a.done ? 1 : -1;
    const orderA = a.order !== undefined ? a.order : 999;
    const orderB = b.order !== undefined ? b.order : 999;
    return orderA - orderB;
  });

  let html = '';
  html += filteredItems.map(item => renderTodoItem(item)).join('');
  listEl.innerHTML = html;

  // 绑定事件
  bindTodoEvents(listEl);
  updateProgressBar();
}

// 渲染左侧日程时间轴面板
function renderSchedulePanel(timedItems) {
  const timeline = document.getElementById('scheduleTimeline');
  const countEl = document.getElementById('scheduleCount');

  if (!timeline) return;

  // 排序
  timedItems.sort((a, b) => {
    if (a.time < b.time) return -1;
    if (a.time > b.time) return 1;
    return 0;
  });

  if (countEl) countEl.textContent = `${timedItems.length} 项`;

  if (timedItems.length === 0) {
    timeline.innerHTML = '<p class="empty-tip schedule-empty">今天没有日程安排</p>';
    return;
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isToday = dateKey(selectedDate) === todayKey();

  let html = '';
  timedItems.forEach(item => {
    const [h, m] = item.time.split(':').map(Number);
    const itemMinutes = h * 60 + m;
    let endMinutes;
    if (item.endTime) {
      const [eh, em] = item.endTime.split(':').map(Number);
      endMinutes = eh * 60 + em;
    } else {
      endMinutes = itemMinutes + 60; // 无结束时间默认1小时
    }

    let statusClass = '';
    let statusHtml = '';
    let titleClass = '';
    let cardStyle = '';

    if (item.done) {
      statusClass = 'done';
      statusHtml = '<span class="t-status s-done">✓ 已结束</span>';
      titleClass = ' text-done';
    } else if (isToday && nowMinutes >= itemMinutes && nowMinutes < endMinutes) {
      statusClass = 'now';
      statusHtml = '<span class="t-status s-now">● 进行中</span>';
      cardStyle = ' style="background: rgba(255, 107, 107, 0.05);"';
    } else if (isToday && nowMinutes >= endMinutes) {
      statusClass = 'done';
      statusHtml = '<span class="t-status s-done">已结束</span>';
      titleClass = ' text-done';
    } else {
      statusHtml = '<span class="t-status s-upcoming">待开始</span>';
    }

    let timeStr;
    if (item.endTime) {
      const dur = endMinutes - itemMinutes;
      const durH = Math.floor(dur / 60);
      const durM = dur % 60;
      const durStr = durH > 0 ? (durM > 0 ? `${durH}小时${durM}分` : `${durH}小时`) : `${durM}分钟`;
      timeStr = `${item.time} - ${item.endTime} · ${durStr}`;
    } else {
      timeStr = item.time;
    }

    html += `
      <div class="t-item ${statusClass}" data-id="${item.id}">
        <div class="t-time">${item.time}</div>
        <div class="t-card"${cardStyle}>
          <div class="t-title${titleClass}">${escapeHtml(stripTimeFromText(item.text))} ${statusHtml}</div>
          <div class="t-span">${timeStr}</div>
        </div>
      </div>
    `;
  });

  timeline.innerHTML = html;

  // 绑定日程点击事件（打开编辑弹窗）
  timeline.querySelectorAll('.t-item').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.id;
      if (!id) return;
      if (id.startsWith('virtual_')) {
        // 虚拟重复任务：先实例化再编辑
        const realId = await materializeVirtualTodo(id);
        if (realId) openEditDialog(realId);
      } else {
        openEditDialog(id);
      }
    });
  });
}

function renderTodoItem(item) {
  let carriedBadge = '';
  let carryClass = '';
  if (item.carriedFrom) {
    const days = calcCarriedDays(item.carriedFrom);
    const level = days >= 3 ? 'carry-danger' : days >= 2 ? 'carry-warn' : 'carry-easy';
    carryClass = ` carried ${days >= 3 ? 'carry-danger' : ''}`;
    carriedBadge = `<span class="carried-badge ${level}">delay ${days}d<span class="carried-date">原定${formatCarriedDate(item.carriedFrom)}</span></span>`;
  }

  let repeatBadge = '';
  if (item.repeat) {
    const labels = { daily: '每天', weekly: '每周', monthly: '每月', weekdays: '工作日' };
    const repeatSvg = `<svg class="repeat-badge-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 0 1 9.3-4"/><path d="M13.5 8a5.5 5.5 0 0 1-9.3 4"/><polyline points="12 2 12.5 4.5 10 4"/><polyline points="4 12 3.5 11.5 6 12"/></svg>`;
    repeatBadge = `<span class="repeat-badge repeat-${item.repeat.type}">${repeatSvg}<span class="repeat-badge-text">${labels[item.repeat.type] || '重复'}</span></span>`;
  }

  let timeBadge = '';
  if (item.time) {
    const timeDisplay = item.endTime ? `${item.time}-${item.endTime}` : item.time;
    timeBadge = `<span class="time-badge">${timeDisplay}</span>`;
  }

  const virtualClass = item.isVirtual ? ' virtual-todo' : '';
  const draggable = item.isVirtual ? 'false' : 'true';

  return `
    <div class="todo-item priority-${item.priority}${item.done ? ' completed' : ''}${carryClass}${virtualClass}" data-id="${item.id}" draggable="${draggable}">
      ${carriedBadge}
      <button class="todo-checkbox${item.done ? ' checked' : ''}" data-id="${item.id}">${item.done ? '✓' : ''}</button>
      <div class="todo-info">
        <div class="todo-text" data-id="${item.id}">${timeBadge}${escapeHtml(item.time ? stripTimeFromText(item.text) : item.text)}${repeatBadge}</div>
      </div>
      <button class="todo-delete" data-id="${item.id}" title="删除">✕</button>
    </div>
  `;
}

function bindTodoEvents(listEl) {
  // 完成切换
  listEl.querySelectorAll('.todo-checkbox').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id.startsWith('virtual_')) {
        materializeVirtualTodo(id, (realId) => toggleTodo(realId));
      } else {
        toggleTodo(id);
      }
    });
  });

  // 删除
  listEl.querySelectorAll('.todo-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id.startsWith('virtual_')) {
        // 虚拟任务不需要删除，忽略
        return;
      }
      deleteTodo(id);
    });
  });

  // 点击文字编辑
  listEl.querySelectorAll('.todo-text').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = el.dataset.id;
      if (id.startsWith('virtual_')) {
        const realId = await materializeVirtualTodo(id);
        if (realId) openEditDialog(realId);
        return;
      }
      openEditDialog(id);
    });
  });

  // 拖拽排序
  listEl.querySelectorAll('.todo-item[draggable="true"]').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedItem = item;
      draggedId = item.dataset.id;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      listEl.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over'));
      draggedItem = null;
      draggedId = null;
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (item !== draggedItem) {
        listEl.querySelectorAll('.todo-item').forEach(el => el.classList.remove('drag-over'));
        item.classList.add('drag-over');
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      if (!draggedId || item.dataset.id === draggedId) return;

      const key = dateKey(selectedDate);
      const allItems = todos[key] || [];
      const fromIndex = allItems.findIndex(t => t.id === draggedId);
      const toIndex = allItems.findIndex(t => t.id === item.dataset.id);

      if (fromIndex === -1 || toIndex === -1) return;

      const [moved] = allItems.splice(fromIndex, 1);
      allItems.splice(toIndex, 0, moved);

      allItems.forEach((t, i) => t.order = i);

      backupTodosToLocal();
      renderTodoList();
    });
  });
}

// 将虚拟重复任务实例化为真实待办（用于勾选完成等操作）
function materializeVirtualTodo(virtualId, callback) {
  const key = dateKey(selectedDate);
  const allItems = getTodosForDate(key);
  const virtualItem = allItems.find(t => t.id === virtualId);
  if (!virtualItem) return;

  const newItem = {
    id: tempId(),
    text: virtualItem.text,
    priority: virtualItem.priority,
    done: false,
    createdAt: new Date().toISOString(),
    carriedFrom: null,
    subtasks: [],
    repeat: virtualItem.repeat,
    time: virtualItem.time || null,
    endTime: virtualItem.endTime || null,
    order: (todos[key] || []).length
  };

  if (!todos[key]) todos[key] = [];
  todos[key].push(newItem);
  backupTodosToLocal();

  // 同步到云端
  if (currentUser) {
    withTimeout(
      _supaClient.from('todos').insert({
        user_id: currentUser.id,
        date: key,
        text: newItem.text,
        priority: newItem.priority,
        done: false,
        time: newItem.time || null,
        end_time: newItem.endTime || null
      }).select().single(),
      8000
    ).then(({ data }) => {
      if (data) newItem.id = data.id;
      backupTodosToLocal();
    }).catch(() => {});
  }

  renderTodoList();
  updateTodoHeader();
  renderCalendar();

  if (callback) callback(newItem.id);
}

// ========== 编辑待办 ==========
function openEditDialog(id) {
  const key = dateKey(selectedDate);
  const item = (todos[key] || []).find(t => t.id === id);
  if (!item) return;

  editingTodoId = id;
  editingTodoDate = key;

  // 编辑文本去掉时间前缀
  document.getElementById('editTodoText').value = item.time ? stripTimeFromText(item.text) : item.text;

  // 开始时间
  const hourInput = document.getElementById('editTimeHour');
  const minuteInput = document.getElementById('editTimeMinute');
  // 结束时间
  const endHourInput = document.getElementById('editEndTimeHour');
  const endMinuteInput = document.getElementById('editEndTimeMinute');
  const timeRow = document.getElementById('editTimeRow');

  if (item.time) {
    const [h, m] = item.time.split(':');
    hourInput.value = h || '';
    minuteInput.value = m || '';
  } else {
    hourInput.value = '';
    minuteInput.value = '';
  }

  if (item.endTime) {
    const [eh, em] = item.endTime.split(':');
    endHourInput.value = eh || '';
    endMinuteInput.value = em || '';
  } else {
    endHourInput.value = '';
    endMinuteInput.value = '';
  }

  // 有时间的任务（日程）显示时间行，全天待办隐藏
  if (timeRow) {
    timeRow.style.display = item.time ? 'flex' : 'none';
  }

  const dots = document.querySelectorAll('#editPriorityDots .dot-btn');
  dots.forEach(d => d.classList.remove('selected'));
  const target = document.querySelector(`#editPriorityDots .dot-btn[data-priority="${item.priority}"]`);
  if (target) target.classList.add('selected');

  // 重复设置
  const editRepeatType = document.getElementById('editRepeatType');
  const editRepeatWeekday = document.getElementById('editRepeatWeekday');
  const editRepeatMonthday = document.getElementById('editRepeatMonthday');
  if (editRepeatType) {
    if (item.repeat && item.repeat.type) {
      editRepeatType.value = item.repeat.type;
      if (item.repeat.type === 'weekly') {
        editRepeatWeekday.style.display = '';
        editRepeatMonthday.style.display = 'none';
        editRepeatWeekday.value = item.repeat.value !== undefined ? item.repeat.value : 1;
      } else if (item.repeat.type === 'monthly') {
        editRepeatWeekday.style.display = 'none';
        editRepeatMonthday.style.display = '';
        editRepeatMonthday.value = item.repeat.value !== undefined ? item.repeat.value : 1;
      } else {
        editRepeatWeekday.style.display = 'none';
        editRepeatMonthday.style.display = 'none';
      }
    } else {
      editRepeatType.value = 'none';
      editRepeatWeekday.style.display = 'none';
      editRepeatMonthday.style.display = 'none';
    }
  }

  const overlay = document.getElementById('editOverlay');
  overlay.style.display = 'flex';
  overlay.classList.add('show');
  document.getElementById('editTodoText').focus();
}

function closeEditDialog() {
  const overlay = document.getElementById('editOverlay');
  overlay.classList.remove('show');
  overlay.style.display = 'none';
  editingTodoId = null;
  editingTodoDate = null;
}

function getEditTime() {
  const h = document.getElementById('editTimeHour').value.trim();
  const m = document.getElementById('editTimeMinute').value.trim();
  if (!h && !m) return null;
  const hh = String(Math.min(23, Math.max(0, parseInt(h) || 0))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, parseInt(m) || 0))).padStart(2, '0');
  return `${hh}:${mm}`;
}

function getEditEndTime() {
  const h = document.getElementById('editEndTimeHour').value.trim();
  const m = document.getElementById('editEndTimeMinute').value.trim();
  if (!h && !m) return null;
  const hh = String(Math.min(23, Math.max(0, parseInt(h) || 0))).padStart(2, '0');
  const mm = String(Math.min(59, Math.max(0, parseInt(m) || 0))).padStart(2, '0');
  return `${hh}:${mm}`;
}

function saveEdit() {
  if (!editingTodoId || !editingTodoDate) return;

  const text = document.getElementById('editTodoText').value.trim();
  if (!text) return;

  const selectedDot = document.querySelector('#editPriorityDots .dot-btn.selected');
  const priority = selectedDot ? selectedDot.dataset.priority : 'mid';

  const timeRow = document.getElementById('editTimeRow');
  const hasTimeRow = timeRow && timeRow.style.display !== 'none';
  const time = hasTimeRow ? getEditTime() : null;
  const endTime = hasTimeRow ? getEditEndTime() : null;

  // 读取重复设置
  let repeat = null;
  const editRepeatType = document.getElementById('editRepeatType');
  if (editRepeatType && editRepeatType.value !== 'none') {
    repeat = { type: editRepeatType.value };
    if (repeat.type === 'weekly') {
      repeat.value = +document.getElementById('editRepeatWeekday').value;
    } else if (repeat.type === 'monthly') {
      repeat.value = +document.getElementById('editRepeatMonthday').value;
    }
  }

  const items = todos[editingTodoDate] || [];
  const item = items.find(t => t.id === editingTodoId);
  if (!item) return;

  item.text = text;
  item.priority = priority;
  item.time = time;
  item.endTime = endTime;
  item.repeat = repeat;

  if (!editingTodoId.startsWith('local_')) {
    withTimeout(
      _supaClient.from('todos').update({ text, priority, time: time || null, end_time: endTime || null }).eq('id', editingTodoId),
      8000
    ).catch(e => console.warn('编辑同步失败:', e));
  }

  backupTodosToLocal();
  renderTodoList();
  updateTodoHeader();
  closeEditDialog();
}

// ========== 添加待办 ==========
function getSelectedPriority() {
  const selected = document.querySelector('#priorityDots .dot-btn.selected');
  return selected ? selected.dataset.priority : 'mid';
}

// 智能时间识别
function parseSmartTime(text) {
  // 预处理：全角数字→半角，全角冒号→半角
  const t = text.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
               .replace(/：/g, ':');

  // Range: "20-21点"、"9~10点" (纯数字-数字+点/时)
  const shortRange = t.match(/(\d{1,2})\s*[到至\-\—~～]\s*(\d{1,2})\s*[点时]/);
  if (shortRange) {
    let h1 = +shortRange[1], h2 = +shortRange[2];
    if (h1 >= 0 && h1 <= 23 && h2 >= 0 && h2 <= 23) {
      return { type: 'range', start: `${String(h1).padStart(2,'0')}:00`, end: `${String(h2).padStart(2,'0')}:00` };
    }
  }

  const rangePatterns = [
    // "10点到11点"、"10:00到11:30"、"10时-11时"
    /(\d{1,2})[点时:](\d{0,2})\s*[到至\-\—~～]\s*(\d{1,2})[点时:]?(\d{0,2})/,
    // "10:00-11:00"
    /(\d{1,2}):(\d{2})\s*[到至\-\—~～]\s*(\d{1,2}):(\d{2})/,
  ];
  for (const pat of rangePatterns) {
    const m = t.match(pat);
    if (m) {
      let h1 = +m[1], m1 = +(m[2] || 0), h2 = +m[3], m2 = +(m[4] || 0);
      if (h1 >= 0 && h1 <= 23 && h2 >= 0 && h2 <= 23) {
        return { type: 'range', start: `${String(h1).padStart(2,'0')}:${String(m1).padStart(2,'0')}`, end: `${String(h2).padStart(2,'0')}:${String(m2).padStart(2,'0')}` };
      }
    }
  }
  const halfMatch = t.match(/(\d{1,2})[点时]半/);
  if (halfMatch) {
    const h = +halfMatch[1];
    if (h >= 0 && h <= 23) return { type: 'single', start: `${String(h).padStart(2,'0')}:30` };
  }
  const singlePatterns = [
    /(\d{1,2})[点时:](\d{0,2})(?:半)?/,
    /(\d{1,2}):(\d{2})/,
  ];
  for (const pat of singlePatterns) {
    const m = t.match(pat);
    if (m) {
      const h = +m[1], min = +(m[2] || 0);
      if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
        return { type: 'single', start: `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}` };
      }
    }
  }
  return null;
}

let isAddingTodo = false;

async function addTodo() {
  if (isAddingTodo) return;

  const input = document.getElementById('todoInput');
  const addBtn = document.getElementById('addTodoBtn');
  const priority = getSelectedPriority();
  let text = input.value.trim();

  if (!text) { input.focus(); return; }

  if (!currentUser) {
    alert('正在加载用户数据，请稍等几秒再试');
    return;
  }

  isAddingTodo = true;
  addBtn.disabled = true;
  addBtn.textContent = '添加中...';

  const key = dateKey(selectedDate);

  // 智能时间识别
  let time = null;
  let endTime = null;
  const parsed = parseSmartTime(text);
  if (parsed) {
    time = parsed.start;
    endTime = parsed.end || null;
  }

  // 重复任务信息
  let repeat = null;
  const selectedRepeatOption = document.querySelector('#repeatPanel .repeat-option-item.selected');
  if (selectedRepeatOption) {
    const repeatType = selectedRepeatOption.dataset.type;
    if (repeatType && repeatType !== 'none') {
      repeat = { type: repeatType };
      if (repeatType === 'weekly') {
        repeat.value = +document.getElementById('repeatWeekday').value;
      } else if (repeatType === 'monthly') {
        repeat.value = +document.getElementById('repeatMonthday').value;
      }
    }
  }

  try {
    const { data, error } = await withTimeout(
      _supaClient.from('todos').insert({
        user_id: currentUser.id,
        date: key,
        text,
        priority,
        done: false,
        time: time || null,
        end_time: endTime || null
      }).select().single()
    );

    if (error) {
      addTodoLocally(key, text, priority, repeat, time, endTime);
    } else {
      if (!todos[key]) todos[key] = [];
      todos[key].push({
        id: data.id,
        text: data.text,
        priority: data.priority,
        done: data.done,
        createdAt: data.created_at,
        carriedFrom: data.carried_from || null,
        subtasks: [],
        repeat,
        time,
        endTime,
        order: todos[key].length
      });
    }
  } catch (err) {
    addTodoLocally(key, text, priority, repeat, time, endTime);
  }

  input.value = '';
  // 重置智能识别提示
  const smartHint = document.getElementById('smartHint');
  if (smartHint) smartHint.classList.remove('visible');
  // 重置重复任务面板
  const repeatBtn = document.getElementById('repeatToggleBtn');
  if (repeatBtn) {
    repeatBtn.classList.remove('active');
  }
  document.querySelectorAll('#repeatPanel .repeat-option-item').forEach(o => o.classList.remove('selected'));
  document.getElementById('repeatSubOptions').style.display = 'none';
  document.getElementById('repeatWeekday').style.display = 'none';
  document.getElementById('repeatMonthday').style.display = 'none';

  backupTodosToLocal();
  renderTodoList();
  renderCalendar();
  updateTodoHeader();

  isAddingTodo = false;
  addBtn.disabled = false;
  addBtn.textContent = '添加';
}

function addTodoLocally(key, text, priority, repeat, time, endTime) {
  const localId = tempId();
  if (!todos[key]) todos[key] = [];
  todos[key].push({
    id: localId,
    text,
    priority,
    done: false,
    createdAt: new Date().toISOString(),
    carriedFrom: null,
    subtasks: [],
    repeat,
    time: time || null,
    endTime: endTime || null,
    order: todos[key].length
  });
  pendingSyncs.push({ type: 'add_todo', localId, date: key, text, priority, done: false, time: time || null, endTime: endTime || null });
}

async function toggleTodo(id) {
  const key = dateKey(selectedDate);
  const item = (todos[key] || []).find(t => t.id === id);
  if (!item) return;

  const wasUndone = !item.done;
  item.done = !item.done;

  withTimeout(_supaClient.from('todos').update({ done: item.done }).eq('id', id), 8000)
    .catch(e => console.warn('更新完成状态超时:', e));
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

// ========== 进度条 ==========
function updateProgressBar() {
  const key = dateKey(selectedDate);
  const allItems = getTodosForDate(key).filter(t => !t.time); // 只计算待办，不含日程
  const bar = document.getElementById('todoProgressBar');
  const fill = document.getElementById('progressFill');
  const doneEl = document.getElementById('progressDone');
  const totalEl = document.getElementById('progressTotal');

  if (!bar) return;

  if (allItems.length === 0) {
    bar.classList.remove('show');
    return;
  }

  bar.classList.add('show');
  const done = allItems.filter(t => t.done).length;
  doneEl.textContent = done;
  totalEl.textContent = allItems.length;
  const pct = Math.round(done / allItems.length * 100);
  requestAnimationFrame(() => { fill.style.width = pct + '%'; });
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
  const colors = ['#FF6B6B', '#FFD166', '#6BCB77', '#FF8C42', '#A78BFA', '#F472B6', '#38BDF8', '#FBBF24'];

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

// ========== 撤销 Toast 系统 ==========
let undoTimers = {};

function showUndoToast(message, undoCallback, confirmCallback, duration = 3000) {
  const container = document.getElementById('undoToastContainer');
  const id = 'undo_' + Date.now();

  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.id = id;
  toast.innerHTML = `
    <span class="undo-toast-text">${escapeHtml(message)}</span>
    <button class="undo-toast-btn">撤销</button>
    <div class="undo-toast-progress" style="width: 100%;"></div>
  `;

  container.appendChild(toast);

  const progress = toast.querySelector('.undo-toast-progress');
  requestAnimationFrame(() => {
    progress.style.transitionDuration = duration + 'ms';
    progress.style.width = '0%';
  });

  const undoBtn = toast.querySelector('.undo-toast-btn');
  undoBtn.addEventListener('click', () => {
    clearTimeout(undoTimers[id]);
    delete undoTimers[id];
    undoCallback();
    removeToast(toast);
  });

  undoTimers[id] = setTimeout(() => {
    delete undoTimers[id];
    confirmCallback();
    removeToast(toast);
  }, duration);

  return id;
}

function removeToast(toast) {
  toast.classList.add('hiding');
  setTimeout(() => toast.remove(), 300);
}

async function deleteTodo(id) {
  const key = dateKey(selectedDate);
  if (!todos[key]) return;

  const itemIndex = todos[key].findIndex(t => t.id === id);
  if (itemIndex === -1) return;

  const deletedItem = todos[key][itemIndex];
  const deletedOrder = itemIndex;

  // 立即从 UI 移除
  todos[key].splice(itemIndex, 1);
  if (todos[key].length === 0) delete todos[key];
  if (todos[key]) todos[key].forEach((t, i) => t.order = i);
  backupTodosToLocal();
  renderTodoList();
  updateTodoHeader();
  renderCalendar();

  const displayText = deletedItem.text.length > 12 ? deletedItem.text.slice(0, 12) + '...' : deletedItem.text;

  showUndoToast(
    `已删除「${displayText}」`,
    // 撤销回调
    () => {
      if (!todos[key]) todos[key] = [];
      todos[key].splice(deletedOrder, 0, deletedItem);
      todos[key].forEach((t, i) => t.order = i);
      backupTodosToLocal();
      renderTodoList();
      updateTodoHeader();
      renderCalendar();
    },
    // 确认删除回调（真正删除云端）
    () => {
      if (!id.startsWith('local_')) {
        withTimeout(_supaClient.from('todos').delete().eq('id', id), 8000)
          .catch(e => console.warn('云端删除超时:', e));
      }
    }
  );
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
  // 顶部统计卡片和趋势图已移除，保留函数签名以防其他地方调用
}

// ========== 周报 & 月总结 ==========
function getWeekDateRange(offset) {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const startOfThisWeek = new Date(today);
  startOfThisWeek.setDate(today.getDate() - dayOfWeek + offset * 7);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfThisWeek);
    d.setDate(startOfThisWeek.getDate() + i);
    dates.push(dateKey(d));
  }
  return dates;
}

function getMonthDateRange(offset) {
  const today = new Date();
  const targetMonth = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const year = targetMonth.getFullYear();
  const month = targetMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dates = [];
  for (let i = 1; i <= daysInMonth; i++) {
    dates.push(dateKey(new Date(year, month, i)));
  }
  return dates;
}

function collectWeekData(dates) {
  const completedItems = [];
  const undoneItems = [];
  let totalCount = 0;
  let doneCount = 0;
  const seen = new Set();

  dates.forEach(dk => {
    const items = getTodosForDate(dk);
    const parts = dk.split('-');
    const dayLabel = `${+parts[1]}/${+parts[2]}`;

    items.forEach(item => {
      const text = item.time ? stripTimeFromText(item.text) : item.text;
      const key = text.trim();
      totalCount++;
      if (item.done) {
        doneCount++;
        if (!seen.has('done:' + key)) {
          seen.add('done:' + key);
          completedItems.push({ text: key, day: dayLabel, time: item.time || '' });
        }
      } else {
        if (!seen.has('undone:' + key)) {
          seen.add('undone:' + key);
          undoneItems.push({ text: key, day: dayLabel });
        }
      }
    });
  });

  const rate = totalCount > 0 ? Math.round(doneCount / totalCount * 100) : 0;
  return { completedItems, undoneItems, totalCount, doneCount, rate };
}

function generateWeekReview(completedItems, undoneItems, rate, doneCount, totalCount) {
  if (totalCount === 0) return '这段时间没有任务记录，给自己安排点事做吧，新的开始从一件小事起步。';

  const parts = [];

  // 提及具体完成的事
  if (completedItems.length > 0) {
    const topItems = completedItems.slice(0, 3).map(i => `「${i.text}」`);
    if (completedItems.length <= 3) {
      parts.push(`你完成了${topItems.join('、')}，辛苦了`);
    } else {
      parts.push(`你完成了${topItems.join('、')}等 ${completedItems.length} 件事，辛苦了`);
    }
  }

  // 根据完成率给出评价
  if (rate === 100) {
    parts.push('全部任务都搞定了，太厉害了！给自己放松一下吧');
  } else if (rate >= 80) {
    parts.push('完成率很高，保持这个节奏就好');
  } else if (rate >= 60) {
    parts.push('完成了大半，已经很不错了');
  } else if (rate >= 40) {
    parts.push('还有一些没做完，没关系，挑重要的先处理');
  } else if (doneCount > 0) {
    parts.push('虽然完成的不多，但你已经在行动了');
  }

  // 提及未完成的事
  if (undoneItems.length > 0 && rate < 100) {
    const topUndone = undoneItems.slice(0, 2).map(i => `「${i.text}」`);
    parts.push(`${topUndone.join('、')}还没做完，这周继续加油`);
  } else if (rate === 100) {
    parts.push('这周继续加油 💪');
  }

  return parts.join('。') + '。';
}

function renderWeeklyReport() {
  const dates = getWeekDateRange(reportWeekOffset);

  // 更新周标签
  const weekLabel = document.getElementById('reportWeekLabel');
  if (weekLabel) {
    if (reportWeekOffset === 0) {
      weekLabel.textContent = '本周';
    } else if (reportWeekOffset === -1) {
      weekLabel.textContent = '上周';
    } else {
      const start = dates[0].split('-');
      const end = dates[6].split('-');
      weekLabel.textContent = `${+start[1]}/${+start[2]} - ${+end[1]}/${+end[2]}`;
    }
  }

  // 更新标题
  const titleEl = document.getElementById('reportTitle');
  if (titleEl) {
    titleEl.textContent = reportWeekOffset === 0 ? '📋 本周进行中' : '📋 周总结';
  }

  const { completedItems, undoneItems, totalCount, doneCount, rate } = collectWeekData(dates);

  // 个性化评价
  const reviewEl = document.getElementById('reportReview');
  if (reviewEl) {
    reviewEl.textContent = generateWeekReview(completedItems, undoneItems, rate, doneCount, totalCount);
  }

  // 已完成列表
  const completedEl = document.getElementById('reportCompleted');
  if (completedEl) {
    completedEl.innerHTML = completedItems.length > 0
      ? completedItems.map((item, i) => `<div class="report-list-item"><span class="report-item-num">${i + 1}.</span><span>${escapeHtml(item.text)}</span></div>`).join('')
      : '<span class="report-empty">暂无</span>';
  }

  // 未完成列表
  const undoneEl = document.getElementById('reportUndone');
  if (undoneEl) {
    undoneEl.innerHTML = undoneItems.length > 0
      ? undoneItems.map((item, i) => `<div class="report-list-item undone-item"><span class="report-item-num">${i + 1}.</span><span>${escapeHtml(item.text)}</span></div>`).join('')
      : '<span class="report-empty">全部完成！🎉</span>';
  }

  // 底部统计
  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  el('reportDoneCount', doneCount);
  el('reportTotalCount', totalCount);
  el('reportRateValue', rate + '%');
}

// ========== 月总结 ==========
function getWeekNumber(dateStr) {
  const d = new Date(dateStr.replace(/-/g, '/'));
  const dayOfMonth = d.getDate();
  return Math.ceil(dayOfMonth / 7);
}

function renderMonthlyReport() {
  const dates = getMonthDateRange(reportMonthOffset);
  if (dates.length === 0) return;

  const firstDate = new Date(dates[0].replace(/-/g, '/'));
  const year = firstDate.getFullYear();
  const month = firstDate.getMonth() + 1;

  // 更新月标签
  const monthLabel = document.getElementById('monthLabel');
  if (monthLabel) {
    if (reportMonthOffset === 0) monthLabel.textContent = '本月';
    else if (reportMonthOffset === -1) monthLabel.textContent = '上月';
    else monthLabel.textContent = `${year}年${month}月`;
  }

  const titleEl = document.getElementById('monthReportTitle');
  if (titleEl) {
    titleEl.textContent = reportMonthOffset === 0 ? '📅 本月进行中' : '📅 月总结';
  }

  // 收集月数据，按周分组
  let totalCount = 0;
  let doneCount = 0;
  const weekGroups = {};
  const allCompleted = [];
  const allUndone = [];
  const seenDone = new Set();
  const seenUndone = new Set();

  dates.forEach(dk => {
    const items = getTodosForDate(dk);
    const weekNum = getWeekNumber(dk);
    if (!weekGroups[weekNum]) weekGroups[weekNum] = { completed: [], undone: [] };

    items.forEach(item => {
      const text = item.time ? stripTimeFromText(item.text) : item.text;
      const key = text.trim();
      totalCount++;
      if (item.done) {
        doneCount++;
        if (!seenDone.has(key)) {
          seenDone.add(key);
          weekGroups[weekNum].completed.push(key);
          allCompleted.push(key);
        }
      } else {
        if (!seenUndone.has(key)) {
          seenUndone.add(key);
          weekGroups[weekNum].undone.push(key);
          allUndone.push(key);
        }
      }
    });
  });

  const rate = totalCount > 0 ? Math.round(doneCount / totalCount * 100) : 0;

  // 月度评价
  const reviewEl = document.getElementById('monthReview');
  if (reviewEl) {
    if (totalCount === 0) {
      reviewEl.textContent = '这个月没有任务记录，下个月给自己定几个小目标吧。';
    } else {
      const parts = [];
      if (allCompleted.length > 0) {
        const top = allCompleted.slice(0, 5).map(t => `「${t}」`);
        if (allCompleted.length <= 5) {
          parts.push(`这个月你完成了${top.join('、')}，一共 ${doneCount} 件事`);
        } else {
          parts.push(`这个月你完成了${top.join('、')}等 ${allCompleted.length} 件事`);
        }
      }
      if (rate >= 80) parts.push('效率很高，继续保持');
      else if (rate >= 50) parts.push('完成了大半，做得不错');
      else if (doneCount > 0) parts.push('虽然完成率不算高，但每一步都算数');
      if (allUndone.length > 0 && rate < 100) {
        parts.push(`还有 ${allUndone.length} 件事没做完，下个月优先处理吧`);
      }
      parts.push('辛苦了，继续加油 💪');
      reviewEl.textContent = parts.join('。') + '';
    }
  }

  // 按周分组渲染
  const bodyEl = document.getElementById('monthReportBody');
  if (bodyEl) {
    const weekNums = Object.keys(weekGroups).map(Number).sort();
    let html = '';

    if (totalCount === 0) {
      html = '<div class="report-empty" style="text-align:center;padding:20px;">暂无数据</div>';
    } else {
      // 已完成部分
      html += '<div class="month-section"><div class="month-section-title">✅ 已完成</div>';
      weekNums.forEach(wn => {
        const items = weekGroups[wn].completed;
        if (items.length > 0) {
          html += `<div class="month-week-group"><div class="month-week-label">第${wn}周</div>`;
          html += '<div class="month-week-items">';
          items.forEach((text, i) => {
            html += `<div class="report-list-item"><span class="report-item-num">${i + 1}.</span><span>${escapeHtml(text)}</span></div>`;
          });
          html += '</div></div>';
        }
      });
      if (allCompleted.length === 0) html += '<div class="report-empty">暂无</div>';
      html += '</div>';

      // 未完成部分
      html += '<div class="month-section"><div class="month-section-title">⏳ 未完成</div>';
      const allUndoneList = [];
      weekNums.forEach(wn => {
        weekGroups[wn].undone.forEach(text => allUndoneList.push(text));
      });
      if (allUndoneList.length > 0) {
        html += '<div class="month-week-items">';
        allUndoneList.forEach((text, i) => {
          html += `<div class="report-list-item undone-item"><span class="report-item-num">${i + 1}.</span><span>${escapeHtml(text)}</span></div>`;
        });
        html += '</div>';
      } else {
        html += '<div class="report-empty">全部完成！🎉</div>';
      }
      html += '</div>';
    }

    bodyEl.innerHTML = html;
  }

  // 底部统计
  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  el('monthDoneCount', doneCount);
  el('monthTotalCount', totalCount);
  el('monthRateValue', rate + '%');
}

function renderSummaryFull() {
  renderSummary();
  renderWeeklyReport();
  renderMonthlyReport();
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

// 灵感统计更新
function updateIdeaStats() {
  const total = ideas.length;
  const pending = ideas.filter(i => !i.status || i.status === 'pending').length;
  const doing = ideas.filter(i => i.status === 'doing').length;
  const done = ideas.filter(i => i.status === 'done').length;
  const archived = ideas.filter(i => i.status === 'archived').length;

  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  el('ideaStatTotal', total);
  el('ideaStatPending', pending);
  el('ideaStatDoing', doing);
  el('ideaStatDone', done);
  el('ideaStatArchived', archived);
}

// 从文本中提取 URL
function extractUrls(text) {
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;
  return text.match(urlRegex) || [];
}

// 渲染灵感内容（将URL转为可点击链接）
function renderIdeaContent(text) {
  const urls = extractUrls(text);
  let html = escapeHtml(text);
  // 将内容中的URL替换为链接（在转义后的内容中查找转义后的URL）
  urls.forEach(url => {
    const escaped = escapeHtml(url);
    const shortUrl = url.length > 50 ? url.slice(0, 50) + '...' : url;
    html = html.replace(escaped, `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="idea-link" onclick="event.stopPropagation()">🔗 ${escapeHtml(shortUrl)}</a>`);
  });
  return html;
}

function renderIdeasList() {
  const listEl = document.getElementById('ideasList');
  let filtered = [...ideas];

  // 搜索过滤
  if (currentIdeaSearch) {
    const kw = currentIdeaSearch.toLowerCase();
    filtered = filtered.filter(idea => idea.text.toLowerCase().includes(kw) || idea.tags.some(t => t.toLowerCase().includes(kw)));
  }

  // 标签过滤
  if (currentIdeaTag !== 'all') {
    filtered = filtered.filter(idea => idea.tags.includes(currentIdeaTag));
  }

  // 状态过滤
  if (currentIdeaStatus !== 'all') {
    filtered = filtered.filter(idea => (idea.status || 'pending') === currentIdeaStatus);
  }

  // 排序
  if (currentIdeaSort === 'newest') {
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } else {
    filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  updateIdeaStats();

  if (filtered.length === 0) {
    const msg = currentIdeaSearch ? '没有找到匹配的灵感' : '还没有灵感记录，有想法就快写下来吧~';
    listEl.innerHTML = `<p class="empty-tip">${msg}</p>`;
    return;
  }

  const statusLabels = { pending: '待处理', doing: '进行中', done: '已实现', archived: '已归档' };

  listEl.innerHTML = filtered.map(idea => {
    const d = new Date(idea.createdAt);
    const timeStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const tagsHtml = idea.tags.map(t => `<span class="idea-tag">${escapeHtml(t)}</span>`).join('');
    const status = idea.status || 'pending';
    const statusBadge = `<span class="idea-status-badge s-${status}">${statusLabels[status]}</span>`;

    return `
      <div class="idea-card status-${status}" data-id="${idea.id}">
        <button class="idea-delete" data-id="${idea.id}" title="删除">✕</button>
        <div class="idea-card-row">
          <div class="idea-card-left">
            ${tagsHtml ? `<div class="idea-tags">${tagsHtml}</div>` : ''}
            <div class="idea-content">${renderIdeaContent(idea.text)}</div>
          </div>
          <div class="idea-card-right">
            ${statusBadge}
            <span class="idea-time">${timeStr}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // 点击卡片编辑
  listEl.querySelectorAll('.idea-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.idea-delete') || e.target.closest('.idea-link')) return;
      openIdeaEditDialog(card.dataset.id);
    });
  });

  listEl.querySelectorAll('.idea-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const deleteId = btn.dataset.id;
      const ideaIndex = ideas.findIndex(i => i.id === deleteId);
      if (ideaIndex === -1) return;

      const deletedIdea = ideas[ideaIndex];

      ideas.splice(ideaIndex, 1);
      backupIdeasToLocal();
      renderIdeasList();
      renderIdeaFilterTags();

      const displayText = deletedIdea.text.length > 12 ? deletedIdea.text.slice(0, 12) + '...' : deletedIdea.text;

      showUndoToast(
        `已删除灵感「${displayText}」`,
        () => {
          ideas.splice(ideaIndex, 0, deletedIdea);
          backupIdeasToLocal();
          renderIdeasList();
          renderIdeaFilterTags();
        },
        () => {
          if (!deleteId.startsWith('local_')) {
            withTimeout(_supaClient.from('ideas').delete().eq('id', deleteId), 8000)
              .catch(e => console.warn('云端删除灵感超时:', e));
          }
        }
      );
    });
  });
}

// ========== 灵感编辑弹窗 ==========
function openIdeaEditDialog(id) {
  const idea = ideas.find(i => i.id === id);
  if (!idea) return;

  editingIdeaId = id;
  editingIdeaTags = [...(idea.tags || [])];

  document.getElementById('ideaEditText').value = idea.text;
  document.getElementById('ideaEditStatus').value = idea.status || 'pending';
  renderIdeaEditTags();

  const overlay = document.getElementById('ideaEditOverlay');
  overlay.style.display = 'flex';
  overlay.classList.add('show');
  document.getElementById('ideaEditText').focus();
}

function closeIdeaEditDialog() {
  const overlay = document.getElementById('ideaEditOverlay');
  overlay.classList.remove('show');
  overlay.style.display = 'none';
  editingIdeaId = null;
  editingIdeaTags = [];
}

function renderIdeaEditTags() {
  const container = document.getElementById('ideaEditTags');
  container.innerHTML = editingIdeaTags.map((tag, i) => `
    <span class="idea-edit-tag">${escapeHtml(tag)} <button data-index="${i}">✕</button></span>
  `).join('');

  container.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      editingIdeaTags.splice(+btn.dataset.index, 1);
      renderIdeaEditTags();
      renderIdeaEditTagPickerList();
    });
  });
}

function renderIdeaEditTagPickerList() {
  const listEl = document.getElementById('ideaEditTagPickerList');
  if (!listEl) return;
  const allTags = getAllIdeaTags();
  listEl.innerHTML = allTags.map(tag => {
    const isSelected = editingIdeaTags.includes(tag);
    return `<span class="idea-tag-picker-item${isSelected ? ' selected' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`;
  }).join('');

  listEl.querySelectorAll('.idea-tag-picker-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const tag = item.dataset.tag;
      if (editingIdeaTags.includes(tag)) {
        editingIdeaTags = editingIdeaTags.filter(t => t !== tag);
      } else if (editingIdeaTags.length < 5) {
        editingIdeaTags.push(tag);
      }
      renderIdeaEditTags();
      // 选择后自动关闭下拉框
      const dropdown = document.getElementById('ideaEditTagPickerDropdown');
      if (dropdown) dropdown.classList.remove('show');
    });
  });
}

function toggleIdeaEditTagPicker() {
  const dropdown = document.getElementById('ideaEditTagPickerDropdown');
  if (dropdown.classList.contains('show')) {
    dropdown.classList.remove('show');
  } else {
    renderIdeaEditTagPickerList();
    dropdown.classList.add('show');
  }
}

function createIdeaEditTagFromPicker() {
  const input = document.getElementById('ideaEditTagInput');
  const tag = input.value.trim();
  if (tag && !editingIdeaTags.includes(tag) && editingIdeaTags.length < 5) {
    editingIdeaTags.push(tag);
    renderIdeaEditTags();
    renderIdeaEditTagPickerList();
  }
  input.value = '';
}

function saveIdeaEdit() {
  if (!editingIdeaId) return;

  const text = document.getElementById('ideaEditText').value.trim();
  if (!text) return;

  const status = document.getElementById('ideaEditStatus').value;
  const idea = ideas.find(i => i.id === editingIdeaId);
  if (!idea) return;

  // 自动标签匹配：如果内容包含已有标签关键词，自动添加
  const existingTags = getAllIdeaTags();
  existingTags.forEach(tag => {
    if (text.includes(tag) && !editingIdeaTags.includes(tag)) {
      editingIdeaTags.push(tag);
    }
  });

  idea.text = text;
  idea.tags = [...editingIdeaTags];
  idea.status = status;

  // 云端同步
  if (!editingIdeaId.startsWith('local_')) {
    withTimeout(
      _supaClient.from('ideas').update({ text, tags: idea.tags, status }).eq('id', editingIdeaId),
      8000
    ).catch(e => console.warn('编辑灵感同步失败:', e));
  }

  backupIdeasToLocal();
  renderIdeasList();
  renderIdeaFilterTags();
  closeIdeaEditDialog();
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
      renderIdeaTagPickerList();
    });
  });
}

function renderIdeaTagPickerList() {
  const listEl = document.getElementById('ideaTagPickerList');
  if (!listEl) return;
  const allTags = getAllIdeaTags();
  listEl.innerHTML = allTags.map(tag => {
    const isSelected = newIdeaTags.includes(tag);
    return `<span class="idea-tag-picker-item${isSelected ? ' selected' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</span>`;
  }).join('');

  listEl.querySelectorAll('.idea-tag-picker-item').forEach(item => {
    item.addEventListener('click', () => {
      const tag = item.dataset.tag;
      if (newIdeaTags.includes(tag)) {
        newIdeaTags = newIdeaTags.filter(t => t !== tag);
      } else if (newIdeaTags.length < 5) {
        newIdeaTags.push(tag);
      }
      renderNewIdeaTags();
      // 选择后自动关闭下拉框
      const dropdown = document.getElementById('ideaTagPickerDropdown');
      if (dropdown) dropdown.classList.remove('show');
    });
  });
}

function toggleIdeaTagPicker() {
  const dropdown = document.getElementById('ideaTagPickerDropdown');
  if (dropdown.classList.contains('show')) {
    dropdown.classList.remove('show');
  } else {
    renderIdeaTagPickerList();
    dropdown.classList.add('show');
  }
}

function createIdeaTagFromPicker() {
  const input = document.getElementById('ideaTagInput');
  const tag = input.value.trim();
  if (tag && !newIdeaTags.includes(tag) && newIdeaTags.length < 5) {
    newIdeaTags.push(tag);
    renderNewIdeaTags();
    renderIdeaTagPickerList();
  }
  input.value = '';
}

let isAddingIdea = false;

async function addIdea() {
  if (isAddingIdea) return;

  const input = document.getElementById('ideaInput');
  const addBtn = document.getElementById('addIdeaBtn');
  const text = input.value.trim();
  const tags = [...newIdeaTags];

  if (!text) { input.focus(); return; }

  // 自动标签匹配：如果内容包含已有标签关键词，自动添加
  const existingTags = getAllIdeaTags();
  existingTags.forEach(tag => {
    if (text.includes(tag) && !tags.includes(tag)) {
      tags.push(tag);
    }
  });

  isAddingIdea = true;
  addBtn.disabled = true;
  addBtn.textContent = '记录中...';

  try {
    const { data, error } = await withTimeout(
      _supaClient.from('ideas').insert({
        user_id: currentUser.id,
        text,
        tags
      }).select().single()
    );

    if (error) {
      addIdeaLocally(text, tags);
    } else {
      ideas.push({
        id: data.id,
        text: data.text,
        tags: data.tags || [],
        status: 'pending',
        createdAt: data.created_at
      });
    }
  } catch (err) {
    addIdeaLocally(text, tags);
  }

  input.value = '';
  newIdeaTags = [];
  renderNewIdeaTags();
  backupIdeasToLocal();
  renderIdeasList();
  renderIdeaFilterTags();

  isAddingIdea = false;
  addBtn.disabled = false;
  addBtn.textContent = '记录灵感 💡';
}

function addIdeaLocally(text, tags) {
  const localId = tempId();
  ideas.push({
    id: localId,
    text,
    tags,
    status: 'pending',
    createdAt: new Date().toISOString()
  });
  pendingSyncs.push({ type: 'add_idea', localId, text, tags });
}

// ================================================================
// 模块四：主题切换
// ================================================================

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('todo_theme', theme);

  // 更新主题按钮状态
  document.querySelectorAll('#themeOptions .theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

function loadTheme() {
  const autoTheme = localStorage.getItem('todo_auto_theme') === 'true';
  const savedTheme = localStorage.getItem('todo_theme') || 'orange';

  const autoToggle = document.getElementById('autoThemeToggle');
  if (autoToggle) autoToggle.checked = autoTheme;

  if (autoTheme) {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : savedTheme === 'dark' ? 'orange' : savedTheme);
  } else {
    applyTheme(savedTheme);
  }
}

// ================================================================
// 模块五：喝水提醒
// ================================================================

function initWaterReminder() {
  const saved = localStorage.getItem('todo_water_enabled');
  waterEnabled = saved === null ? true : saved === 'true';

  const checkbox = document.getElementById('waterEnabled');
  if (checkbox) checkbox.checked = waterEnabled;

  const waterEl = document.getElementById('waterReminder');
  if (!waterEnabled) {
    waterEl.classList.add('hidden');
    stopWaterTimer();
    return;
  }

  waterEl.classList.remove('hidden');
  startWaterTimer();
}

function startWaterTimer() {
  stopWaterTimer();
  waterSecondsLeft = 30 * 60;
  updateWaterDisplay();

  waterTimerInterval = setInterval(() => {
    waterSecondsLeft--;
    if (waterSecondsLeft <= 0) {
      waterSecondsLeft = 0;
      showWaterReminder();
      stopWaterTimer();
    }
    updateWaterDisplay();
  }, 1000);
}

function stopWaterTimer() {
  if (waterTimerInterval) {
    clearInterval(waterTimerInterval);
    waterTimerInterval = null;
  }
}

function updateWaterDisplay() {
  const timerEl = document.getElementById('waterTimer');
  const fillEl = document.getElementById('waterFill');

  if (timerEl) {
    const mins = Math.floor(waterSecondsLeft / 60);
    const secs = waterSecondsLeft % 60;
    timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  if (fillEl) {
    // 从底部填充：总高度80，水滴路径约从y=5到y=78
    // elapsed比例越大，水越满
    const elapsed = 1 - (waterSecondsLeft / (30 * 60));
    const maxFillHeight = 73; // 水滴内部可填充高度
    const yStart = 78 - elapsed * maxFillHeight;
    fillEl.setAttribute('y', yStart);
  }

  // 最后2分钟水滴晃动
  const waterEl = document.getElementById('waterReminder');
  if (waterEl) {
    if (waterSecondsLeft <= 120 && waterSecondsLeft > 0) {
      if (waterSecondsLeft % 10 === 0) {
        waterEl.classList.add('shake');
        setTimeout(() => waterEl.classList.remove('shake'), 1500);
      }
    }
  }
}

function showWaterReminder() {
  const overlay = document.getElementById('waterOverlay');
  overlay.style.display = 'flex';
  overlay.classList.add('show');

  // 水滴晃动
  const waterEl = document.getElementById('waterReminder');
  if (waterEl) {
    waterEl.classList.add('shake');
  }
}

function hideWaterReminder() {
  const overlay = document.getElementById('waterOverlay');
  overlay.classList.remove('show');
  overlay.style.display = 'none';

  const waterEl = document.getElementById('waterReminder');
  if (waterEl) waterEl.classList.remove('shake');

  // 重置计时器
  startWaterTimer();
}

// ================================================================
// 模块六：待办提醒
// ================================================================

function initTodoReminder() {
  reminderEnabled = localStorage.getItem('todo_reminder_enabled') === 'true';
  reminderTime = localStorage.getItem('todo_reminder_time') || '09:00';
  lastReminderDate = localStorage.getItem('todo_last_reminder_date');

  const checkbox = document.getElementById('reminderEnabled');
  const timeInput = document.getElementById('reminderTime');
  const timeRow = document.getElementById('reminderTimeRow');

  if (checkbox) checkbox.checked = reminderEnabled;
  if (timeInput) timeInput.value = reminderTime;
  if (timeRow) timeRow.style.display = reminderEnabled ? 'flex' : 'none';

  // 每分钟检查一次是否到了提醒时间
  if (reminderCheckInterval) clearInterval(reminderCheckInterval);
  reminderCheckInterval = setInterval(checkTodoReminder, 60000);
  // 立即检查一次
  checkTodoReminder();
}

function checkTodoReminder() {
  if (!reminderEnabled) return;

  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const todayStr = todayKey();

  // 今天已经提醒过了
  if (lastReminderDate === todayStr) return;

  // 到了提醒时间
  if (currentTime === reminderTime) {
    const todayItems = getTodosForDate(todayStr);
    const undone = todayItems.filter(t => !t.done);

    if (undone.length > 0) {
      showTodoReminder(undone);
      lastReminderDate = todayStr;
      localStorage.setItem('todo_last_reminder_date', todayStr);
    }
  }
}

function showTodoReminder(undoneTodos) {
  const listEl = document.getElementById('reminderList');
  listEl.innerHTML = undoneTodos.map(t => {
    const dotColor = t.priority === 'high' ? '#FF6B6B' : t.priority === 'mid' ? '#FFD166' : '#6BCB77';
    return `<div class="reminder-item"><span class="ri-dot" style="background:${dotColor}"></span>${escapeHtml(t.text)}</div>`;
  }).join('');

  const overlay = document.getElementById('reminderOverlay');
  overlay.style.display = 'flex';
  overlay.classList.add('show');
}

function hideTodoReminder() {
  const overlay = document.getElementById('reminderOverlay');
  overlay.classList.remove('show');
  overlay.style.display = 'none';
}

// ================================================================
// 模块七：设置管理
// ================================================================

function loadSettings() {
  loadTheme();
}

function saveSettings() {
  // 主题
  const autoTheme = document.getElementById('autoThemeToggle')?.checked || false;
  localStorage.setItem('todo_auto_theme', autoTheme);

  // 提醒
  reminderEnabled = document.getElementById('reminderEnabled')?.checked || false;
  reminderTime = document.getElementById('reminderTime')?.value || '09:00';
  localStorage.setItem('todo_reminder_enabled', reminderEnabled);
  localStorage.setItem('todo_reminder_time', reminderTime);

  const timeRow = document.getElementById('reminderTimeRow');
  if (timeRow) timeRow.style.display = reminderEnabled ? 'flex' : 'none';

  // 喝水
  waterEnabled = document.getElementById('waterEnabled')?.checked || false;
  localStorage.setItem('todo_water_enabled', waterEnabled);

  const waterEl = document.getElementById('waterReminder');
  if (waterEnabled) {
    waterEl.classList.remove('hidden');
    startWaterTimer();
  } else {
    waterEl.classList.add('hidden');
    stopWaterTimer();
  }
}


// ================================================================
// 心跳保活
// ================================================================
let heartbeatTimer = null;

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(async () => {
    if (!currentUser) return;
    try {
      await withTimeout(_supaClient.from('todos').select('id').limit(1), 10000);
    } catch (e) {}
  }, 4 * 60 * 60 * 1000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ================================================================
// 初始化
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
  updateIdeaStats();
}

// ================================================================
// 事件绑定
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

      // 移除齿轮激活态
      const csb = document.getElementById('cornerSettingsBtn');
      if (csb) csb.classList.remove('settings-active');

      if (btn.dataset.tab === 'summary') renderSummaryFull();
    });
  });

  // 右上角设置齿轮按钮
  const cornerSettingsBtn = document.getElementById('cornerSettingsBtn');
  if (cornerSettingsBtn) {
    cornerSettingsBtn.addEventListener('click', () => {
      // 取消所有 tab active，激活 settings
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      const settingsSection = document.getElementById('settingsSection');
      if (settingsSection) settingsSection.classList.add('active');
      // 齿轮变为激活态
      cornerSettingsBtn.classList.add('settings-active');
    });
  }

  // 设置页返回按钮
  const settingsBackBtn = document.getElementById('settingsBackBtn');
  if (settingsBackBtn) {
    settingsBackBtn.addEventListener('click', () => {
      // 回到第一个 tab（每日待办）
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      const firstTab = document.querySelector('.tab-btn[data-tab="todo"]');
      if (firstTab) firstTab.classList.add('active');
      const todoSection = document.getElementById('todoSection');
      if (todoSection) todoSection.classList.add('active');
      // 移除齿轮激活态
      if (cornerSettingsBtn) cornerSettingsBtn.classList.remove('settings-active');
    });
  }

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

  // 智能时间识别实时提示
  const _todoInput = document.getElementById('todoInput');
  const _smartHint = document.getElementById('smartHint');
  const _hintTag = document.getElementById('hintTag');
  if (_todoInput && _smartHint && _hintTag) {
    _todoInput.addEventListener('input', function() {
      const val = this.value.trim();
      const result = parseSmartTime(val);
      if (result && val.length > 2) {
        _smartHint.classList.add('visible');
        if (result.type === 'range') {
          _hintTag.textContent = `📅 日程 ${result.start} - ${result.end}`;
        } else {
          _hintTag.textContent = `📅 日程 ${result.start}`;
        }
      } else if (val.length > 0) {
        _smartHint.classList.add('visible');
        _hintTag.textContent = '📝 待办事项';
      } else {
        _smartHint.classList.remove('visible');
      }
    });
  }

  // 优先级圆点切换
  document.getElementById('priorityDots').addEventListener('click', e => {
    const btn = e.target.closest('.dot-btn');
    if (!btn) return;
    document.querySelectorAll('#priorityDots .dot-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });

  // 重复任务弹出面板
  const repeatToggleBtn = document.getElementById('repeatToggleBtn');
  const repeatPanel = document.getElementById('repeatPanel');
  let repeatPanelOpen = false;

  if (repeatToggleBtn && repeatPanel) {
    repeatToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      repeatPanelOpen = !repeatPanelOpen;
      if (repeatPanelOpen) {
        repeatPanel.classList.add('show');
      } else {
        repeatPanel.classList.remove('show');
      }
    });

    repeatPanel.querySelectorAll('.repeat-option-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = item.dataset.type;

        if (type === 'none') {
          // 取消重复
          repeatPanel.querySelectorAll('.repeat-option-item').forEach(o => o.classList.remove('selected'));
          repeatToggleBtn.classList.remove('active');
          document.getElementById('repeatSubOptions').style.display = 'none';
          document.getElementById('repeatWeekday').style.display = 'none';
          document.getElementById('repeatMonthday').style.display = 'none';
        } else {
          repeatPanel.querySelectorAll('.repeat-option-item').forEach(o => o.classList.remove('selected'));
          item.classList.add('selected');
          repeatToggleBtn.classList.add('active');

          // 显示子选项
          const subOptions = document.getElementById('repeatSubOptions');
          const weekdaySel = document.getElementById('repeatWeekday');
          const monthdaySel = document.getElementById('repeatMonthday');

          if (type === 'weekly') {
            subOptions.style.display = 'block';
            weekdaySel.style.display = 'block';
            monthdaySel.style.display = 'none';
          } else if (type === 'monthly') {
            subOptions.style.display = 'block';
            weekdaySel.style.display = 'none';
            monthdaySel.style.display = 'block';
          } else {
            subOptions.style.display = 'none';
            weekdaySel.style.display = 'none';
            monthdaySel.style.display = 'none';
          }
        }

        // 关闭面板（仅非周/月选项时自动关闭）
        if (type !== 'weekly' && type !== 'monthly') {
          setTimeout(() => {
            repeatPanel.classList.remove('show');
            repeatPanelOpen = false;
          }, 200);
        }
      });
    });

    // 点击外部关闭
    document.addEventListener('click', (e) => {
      if (repeatPanelOpen && !repeatToggleBtn.contains(e.target) && !repeatPanel.contains(e.target)) {
        repeatPanel.classList.remove('show');
        repeatPanelOpen = false;
      }
    });
  }

  // 填充月份日期选项
  const monthDaySelect = document.getElementById('repeatMonthday');
  if (monthDaySelect) {
    for (let i = 1; i <= 31; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i}号`;
      monthDaySelect.appendChild(opt);
    }
  }

  // 全部完成弹窗关闭
  document.getElementById('completionCloseBtn').addEventListener('click', hideCompletionOverlay);
  document.getElementById('completionOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideCompletionOverlay();
  });

  // 喝水提醒弹窗关闭
  document.getElementById('waterCloseBtn').addEventListener('click', hideWaterReminder);
  document.getElementById('waterOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideWaterReminder();
  });

  // 待办提醒弹窗关闭
  document.getElementById('reminderCloseBtn').addEventListener('click', hideTodoReminder);
  document.getElementById('reminderOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideTodoReminder();
  });

  // 编辑弹窗
  document.getElementById('editCancelBtn').addEventListener('click', closeEditDialog);
  document.getElementById('editSaveBtn').addEventListener('click', saveEdit);
  document.getElementById('editOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeEditDialog();
  });
  document.getElementById('editTodoText').addEventListener('keypress', e => {
    if (e.key === 'Enter') saveEdit();
  });

  // 时间输入框行为
  const editTimeHour = document.getElementById('editTimeHour');
  const editTimeMinute = document.getElementById('editTimeMinute');
  const editEndTimeHour = document.getElementById('editEndTimeHour');
  const editEndTimeMinute = document.getElementById('editEndTimeMinute');
  const editTimeClearBtn = document.getElementById('editTimeClearBtn');

  [editTimeHour, editTimeMinute, editEndTimeHour, editEndTimeMinute].forEach(input => {
    const isHour = input === editTimeHour || input === editEndTimeHour;
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '');
    });
    input.addEventListener('blur', () => {
      if (input.value) {
        const max = isHour ? 23 : 59;
        let val = Math.min(max, Math.max(0, parseInt(input.value) || 0));
        input.value = String(val).padStart(2, '0');
      }
    });
    input.addEventListener('keypress', e => {
      if (e.key === 'Enter') saveEdit();
    });
  });

  editTimeHour.addEventListener('input', () => {
    if (editTimeHour.value.length === 2) editTimeMinute.focus();
  });
  editEndTimeHour.addEventListener('input', () => {
    if (editEndTimeHour.value.length === 2) editEndTimeMinute.focus();
  });

  editTimeClearBtn.addEventListener('click', () => {
    editTimeHour.value = '';
    editTimeMinute.value = '';
    editEndTimeHour.value = '';
    editEndTimeMinute.value = '';
  });

  // 编辑弹窗优先级切换
  document.getElementById('editPriorityDots').addEventListener('click', e => {
    const btn = e.target.closest('.dot-btn');
    if (!btn) return;
    document.querySelectorAll('#editPriorityDots .dot-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });

  // 编辑弹窗重复类型切换
  const editRepeatTypeEl = document.getElementById('editRepeatType');
  const editRepeatWeekdayEl = document.getElementById('editRepeatWeekday');
  const editRepeatMonthdayEl = document.getElementById('editRepeatMonthday');
  if (editRepeatTypeEl) {
    editRepeatTypeEl.addEventListener('change', () => {
      const val = editRepeatTypeEl.value;
      editRepeatWeekdayEl.style.display = val === 'weekly' ? '' : 'none';
      editRepeatMonthdayEl.style.display = val === 'monthly' ? '' : 'none';
    });
  }
  // 填充编辑弹窗月份日期选项
  if (editRepeatMonthdayEl && editRepeatMonthdayEl.options.length === 0) {
    for (let i = 1; i <= 31; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${i}号`;
      editRepeatMonthdayEl.appendChild(opt);
    }
  }

  // 待办筛选
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderTodoList();
    });
  });

  // 添加灵感
  document.getElementById('addIdeaBtn').addEventListener('click', addIdea);

  document.getElementById('ideaTagInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      createIdeaTagFromPicker();
    }
  });

  const ideaTagPickerBtn = document.getElementById('ideaTagPickerBtn');
  if (ideaTagPickerBtn) {
    ideaTagPickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleIdeaTagPicker();
    });
  }

  const ideaTagCreateBtn = document.getElementById('ideaTagCreateBtn');
  if (ideaTagCreateBtn) {
    ideaTagCreateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      createIdeaTagFromPicker();
    });
  }

  // 点击外部关闭标签选择器
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('ideaTagPickerDropdown');
    const wrap = document.querySelector('.idea-tag-picker-wrap');
    if (dropdown && wrap && !wrap.contains(e.target)) {
      dropdown.classList.remove('show');
    }
  });

  document.getElementById('ideaSortSelect').addEventListener('change', e => {
    currentIdeaSort = e.target.value;
    renderIdeasList();
  });

  // 灵感搜索
  const ideaSearchInput = document.getElementById('ideaSearchInput');
  if (ideaSearchInput) {
    ideaSearchInput.addEventListener('input', () => {
      currentIdeaSearch = ideaSearchInput.value.trim();
      renderIdeasList();
    });
  }

  // 灵感状态筛选
  const ideaStatusFilter = document.getElementById('ideaStatusFilter');
  if (ideaStatusFilter) {
    ideaStatusFilter.addEventListener('change', () => {
      currentIdeaStatus = ideaStatusFilter.value;
      renderIdeasList();
    });
  }

  // 灵感编辑弹窗
  const ideaEditCancelBtn = document.getElementById('ideaEditCancelBtn');
  const ideaEditSaveBtn = document.getElementById('ideaEditSaveBtn');
  const ideaEditOverlay = document.getElementById('ideaEditOverlay');
  const ideaEditTagInput = document.getElementById('ideaEditTagInput');

  if (ideaEditCancelBtn) ideaEditCancelBtn.addEventListener('click', closeIdeaEditDialog);
  if (ideaEditSaveBtn) ideaEditSaveBtn.addEventListener('click', saveIdeaEdit);
  if (ideaEditOverlay) {
    ideaEditOverlay.addEventListener('click', e => {
      if (e.target === e.currentTarget) closeIdeaEditDialog();
    });
  }
  if (ideaEditTagInput) {
    ideaEditTagInput.addEventListener('keypress', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createIdeaEditTagFromPicker();
      }
    });
  }

  const ideaEditTagPickerBtn = document.getElementById('ideaEditTagPickerBtn');
  if (ideaEditTagPickerBtn) {
    ideaEditTagPickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleIdeaEditTagPicker();
    });
  }

  const ideaEditTagCreateBtn = document.getElementById('ideaEditTagCreateBtn');
  if (ideaEditTagCreateBtn) {
    ideaEditTagCreateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      createIdeaEditTagFromPicker();
    });
  }

  // 点击外部关闭编辑弹窗标签选择器
  document.addEventListener('click', (e) => {
    const editDropdown = document.getElementById('ideaEditTagPickerDropdown');
    const editWrap = document.querySelector('#ideaEditOverlay .idea-tag-picker-wrap');
    if (editDropdown && editWrap && !editWrap.contains(e.target)) {
      editDropdown.classList.remove('show');
    }
  });

  // 周报导航
  const reportPrevWeek = document.getElementById('reportPrevWeek');
  const reportNextWeek = document.getElementById('reportNextWeek');
  if (reportPrevWeek) {
    reportPrevWeek.addEventListener('click', () => {
      reportWeekOffset--;
      renderWeeklyReport();
    });
  }
  if (reportNextWeek) {
    reportNextWeek.addEventListener('click', () => {
      if (reportWeekOffset < 0) {
        reportWeekOffset++;
        renderWeeklyReport();
      }
    });
  }

  // 月总结导航
  const monthPrev = document.getElementById('monthPrev');
  const monthNext = document.getElementById('monthNext');
  if (monthPrev) {
    monthPrev.addEventListener('click', () => {
      reportMonthOffset--;
      renderMonthlyReport();
    });
  }
  if (monthNext) {
    monthNext.addEventListener('click', () => {
      if (reportMonthOffset < 0) {
        reportMonthOffset++;
        renderMonthlyReport();
      }
    });
  }

  // 周总结/月总结切换
  document.querySelectorAll('.summary-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.summary-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSummaryMode = btn.dataset.mode;
      const weekCard = document.getElementById('weeklyReportCard');
      const monthCard = document.getElementById('monthlyReportCard');
      if (currentSummaryMode === 'week') {
        weekCard.style.display = '';
        monthCard.style.display = 'none';
      } else {
        weekCard.style.display = 'none';
        monthCard.style.display = '';
      }
    });
  });

  // 主题切换
  document.querySelectorAll('#themeOptions .theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme);
    });
  });

  // 自动主题切换
  const autoThemeToggle = document.getElementById('autoThemeToggle');
  if (autoThemeToggle) {
    autoThemeToggle.addEventListener('change', () => {
      localStorage.setItem('todo_auto_theme', autoThemeToggle.checked);
      if (autoThemeToggle.checked) {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) applyTheme('dark');
      }
    });
  }

  // 监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    const autoTheme = localStorage.getItem('todo_auto_theme') === 'true';
    if (autoTheme) {
      applyTheme(e.matches ? 'dark' : (localStorage.getItem('todo_theme_light') || 'orange'));
    }
  });

  // 设置变更
  const reminderEnabledEl = document.getElementById('reminderEnabled');
  if (reminderEnabledEl) {
    reminderEnabledEl.addEventListener('change', saveSettings);
  }

  const reminderTimeEl = document.getElementById('reminderTime');
  if (reminderTimeEl) {
    reminderTimeEl.addEventListener('change', saveSettings);
  }

  const waterEnabledEl = document.getElementById('waterEnabled');
  if (waterEnabledEl) {
    waterEnabledEl.addEventListener('change', saveSettings);
  }

  // 点击水滴也能手动触发喝水提醒
  const waterReminder = document.getElementById('waterReminder');
  if (waterReminder) {
    waterReminder.addEventListener('click', () => {
      if (waterSecondsLeft <= 0) {
        showWaterReminder();
      }
    });
  }

  // 窗口大小变化时重绘图表
  window.addEventListener('resize', () => {
    if (document.getElementById('summarySection').classList.contains('active')) {
      renderSummaryFull();
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

  // 加载主题（在登录前就应用）
  loadTheme();

  // 启动认证
  setupAuth();
});
