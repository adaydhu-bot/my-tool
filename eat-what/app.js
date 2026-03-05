// ========== 默认美食数据 ==========
const DEFAULT_FOODS = [
  '火锅', '烧烤', '炸鸡', '披萨', '寿司',
  '拉面', '麻辣烫', '汉堡', '饺子', '炒饭'
];

// ========== 热门美食推荐库（分类） ==========
const FOOD_CATEGORIES = {
  '🔥 热门': ['火锅', '烧烤', '炸鸡', '奶茶', '麻辣烫', '披萨', '寿司', '拉面', '汉堡', '炒饭'],
  '🥘 中餐': ['红烧肉', '宫保鸡丁', '糖醋排骨', '水煮鱼', '麻婆豆腐', '回锅肉', '酸菜鱼', '东坡肉', '烤鸭', '小龙虾'],
  '🍜 面食': ['兰州拉面', '重庆小面', '炸酱面', '刀削面', '螺蛳粉', '热干面', '酸辣粉', '米线', '担担面', '油泼面'],
  '🍣 日韩': ['寿司', '拉面', '天妇罗', '鳗鱼饭', '章鱼烧', '石锅拌饭', '韩式炸鸡', '部队锅', '紫菜包饭', '味增汤'],
  '🍔 西餐': ['牛排', '意大利面', '披萨', '汉堡', '三明治', '沙拉', '薯条', '炸鱼薯条', '焗饭', '鸡排'],
  '🥟 小吃': ['煎饼果子', '肉夹馍', '生煎包', '臭豆腐', '烤冷面', '鸡蛋灌饼', '手抓饼', '锅贴', '饺子', '灌汤包'],
  '🍰 甜品': ['蛋糕', '冰淇淋', '奶茶', '甜甜圈', '布丁', '芋圆', '杨枝甘露', '双皮奶', '糖葫芦', '麻薯'],
  '🥗 轻食': ['沙拉', '三明治', '鸡胸肉', '牛油果吐司', '酸奶碗', '全麦面包', '蔬菜卷', '藜麦饭', '水果碗', '鸡肉卷']
};

// ========== 转盘配色方案 ==========
const WHEEL_COLORS = [
  '#FF6B35', '#FFC145', '#FF8C61', '#FFD66B',
  '#FF7849', '#FFCE5C', '#FF9A6C', '#FFD98E',
  '#FF6B4A', '#FFC85A', '#FF8555', '#FFDB7E'
];

// ========== 状态管理 ==========
let foods = [];
let history = [];
let isSpinning = false;
let currentRotation = 0;

// ========== DOM 元素 ==========
const canvas = document.getElementById('wheelCanvas');
const ctx = canvas.getContext('2d');
const spinBtn = document.getElementById('spinBtn');
const foodInput = document.getElementById('foodInput');
const addBtn = document.getElementById('addBtn');
const foodList = document.getElementById('foodList');
const resetBtn = document.getElementById('resetBtn');
const clearBtn = document.getElementById('clearBtn');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const resultModal = document.getElementById('resultModal');
const resultName = document.getElementById('resultName');
const againBtn = document.getElementById('againBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const categoryTabs = document.getElementById('categoryTabs');
const recommendList = document.getElementById('recommendList');

let currentCategory = Object.keys(FOOD_CATEGORIES)[0];

// ========== Canvas 高清适配 ==========
function setupCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
}

// ========== 绘制转盘 ==========
function drawWheel() {
  const size = canvas.getBoundingClientRect().width;
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size / 2 - 8;

  ctx.clearRect(0, 0, size, size);

  if (foods.length === 0) {
    // 空状态
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#f5ede6';
    ctx.fill();
    ctx.strokeStyle = '#e6d9ce';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = '#bbb';
    ctx.font = '16px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('请添加美食', centerX, centerY - 10);
    ctx.fillText('至少需要2项', centerX, centerY + 14);
    return;
  }

  const sliceAngle = (Math.PI * 2) / foods.length;

  // 绘制外圈阴影
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 107, 53, 0.08)';
  ctx.fill();

  foods.forEach((food, i) => {
    const startAngle = i * sliceAngle - Math.PI / 2;
    const endAngle = startAngle + sliceAngle;

    // 扇形
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
    ctx.fill();

    // 边线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 文字
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(startAngle + sliceAngle / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textRadius = radius * 0.62;
    const fontSize = foods.length > 8 ? 13 : foods.length > 5 ? 14 : 16;
    ctx.font = `bold ${fontSize}px "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 3;

    // 截断长文字
    let displayText = food;
    if (displayText.length > 5) {
      displayText = displayText.slice(0, 4) + '…';
    }
    ctx.fillText(displayText, textRadius, 0);
    ctx.restore();
  });

  // 中心圆
  ctx.beginPath();
  ctx.arc(centerX, centerY, 28, 0, Math.PI * 2);
  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 28);
  gradient.addColorStop(0, '#fff');
  gradient.addColorStop(1, '#f8f0e8');
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 107, 53, 0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 中心图标
  ctx.fillStyle = var_primary();
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'transparent';
  ctx.fillText('🍽️', centerX, centerY);
}

function var_primary() {
  return '#FF6B35';
}

// ========== 转盘旋转 ==========
function spinWheel() {
  if (isSpinning || foods.length < 2) {
    if (foods.length < 2) {
      shakeElement(spinBtn);
    }
    return;
  }

  isSpinning = true;
  spinBtn.disabled = true;
  spinBtn.textContent = '转动中...';

  // 随机选一个结果
  const selectedIndex = Math.floor(Math.random() * foods.length);
  const sliceAngle = 360 / foods.length;

  // 计算目标角度：让选中扇区对准顶部指针
  // 指针在顶部(12点方向), 扇区从12点方向顺时针排列
  const targetSliceCenter = selectedIndex * sliceAngle + sliceAngle / 2;
  // 需要转到 360 - targetSliceCenter 位置（使该扇区对准顶部）
  const targetAngle = 360 - targetSliceCenter;

  // 加上多圈旋转（5-8圈）
  const extraSpins = (5 + Math.floor(Math.random() * 4)) * 360;
  const totalRotation = currentRotation + extraSpins + (targetAngle - (currentRotation % 360));

  // 应用动画
  canvas.style.transition = 'transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
  canvas.style.transform = `rotate(${totalRotation}deg)`;
  currentRotation = totalRotation;

  // 动画结束后显示结果
  setTimeout(() => {
    isSpinning = false;
    spinBtn.disabled = false;
    spinBtn.textContent = '开始转！';

    // 添加到历史记录
    addHistory(foods[selectedIndex]);

    // 显示结果弹窗
    showResult(foods[selectedIndex]);
  }, 4200);
}

function shakeElement(el) {
  el.style.animation = 'none';
  el.offsetHeight; // 触发重排
  el.style.animation = 'shake 0.5s ease';
  setTimeout(() => { el.style.animation = ''; }, 500);
}

// 添加 shake 动画
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-8px); }
    40% { transform: translateX(8px); }
    60% { transform: translateX(-5px); }
    80% { transform: translateX(5px); }
  }
`;
document.head.appendChild(shakeStyle);

// ========== 结果弹窗 ==========
function showResult(food) {
  resultName.textContent = food;
  resultModal.classList.add('active');
}

function hideResult() {
  resultModal.classList.remove('active');
}

// ========== 美食管理 ==========
function addFood(name) {
  name = name.trim();
  if (!name) return;
  if (foods.includes(name)) {
    shakeElement(foodInput);
    foodInput.value = '';
    foodInput.placeholder = '这个已经有了哦~';
    setTimeout(() => { foodInput.placeholder = '输入美食名称...'; }, 1500);
    return;
  }
  if (foods.length >= 20) {
    foodInput.value = '';
    foodInput.placeholder = '最多添加20项';
    setTimeout(() => { foodInput.placeholder = '输入美食名称...'; }, 1500);
    return;
  }

  foods.push(name);
  saveFoods();
  renderFoodList();
  drawWheel();
  renderRecommendList();
  foodInput.value = '';
  foodInput.focus();
}

function removeFood(index) {
  foods.splice(index, 1);
  saveFoods();
  renderFoodList();
  resetWheelRotation();
  drawWheel();
  renderRecommendList();
}

function resetWheelRotation() {
  canvas.style.transition = 'none';
  currentRotation = 0;
  canvas.style.transform = 'rotate(0deg)';
}

function renderFoodList() {
  if (foods.length === 0) {
    foodList.innerHTML = '<p class="empty-tip">还没有美食，快添加吧~</p>';
    return;
  }

  foodList.innerHTML = foods.map((food, i) => `
    <span class="food-tag">
      ${escapeHtml(food)}
      <button class="delete-tag" onclick="removeFood(${i})" title="删除">✕</button>
    </span>
  `).join('');
}

// ========== 历史记录 ==========
function addHistory(food) {
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  const dateStr = `${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')}`;

  history.unshift({ food, time: `${dateStr} ${timeStr}` });
  if (history.length > 50) history.pop();
  saveHistory();
  renderHistory();
}

function renderHistory() {
  if (history.length === 0) {
    historyList.innerHTML = '<p class="empty-tip">还没有记录，转一转吧~</p>';
    return;
  }

  historyList.innerHTML = history.map(item => `
    <div class="history-item">
      <span class="history-food">${escapeHtml(item.food)}</span>
      <span class="history-time">${escapeHtml(item.time)}</span>
    </div>
  `).join('');
}

// ========== 本地存储 ==========
function saveFoods() {
  localStorage.setItem('foodWheel_foods', JSON.stringify(foods));
}

function loadFoods() {
  const saved = localStorage.getItem('foodWheel_foods');
  if (saved) {
    try { foods = JSON.parse(saved); } catch { foods = [...DEFAULT_FOODS]; }
  } else {
    foods = [...DEFAULT_FOODS];
  }
}

function saveHistory() {
  localStorage.setItem('foodWheel_history', JSON.stringify(history));
}

function loadHistory() {
  const saved = localStorage.getItem('foodWheel_history');
  if (saved) {
    try { history = JSON.parse(saved); } catch { history = []; }
  }
}

// ========== 工具函数 ==========
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== 推荐库 ==========
function renderCategoryTabs() {
  const categories = Object.keys(FOOD_CATEGORIES);
  categoryTabs.innerHTML = categories.map(cat => `
    <span class="category-tab${cat === currentCategory ? ' active' : ''}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</span>
  `).join('');

  categoryTabs.querySelectorAll('.category-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentCategory = tab.dataset.cat;
      renderCategoryTabs();
      renderRecommendList();
    });
  });
}

function renderRecommendList() {
  const items = FOOD_CATEGORIES[currentCategory] || [];
  recommendList.innerHTML = items.map(item => {
    const isAdded = foods.includes(item);
    return `<span class="recommend-item${isAdded ? ' added' : ''}" data-food="${escapeHtml(item)}">${escapeHtml(item)}${isAdded ? ' ✓' : ''}</span>`;
  }).join('') + `<button class="batch-import-btn" id="batchImportBtn">一键导入该分类</button>`;

  // 单个添加
  recommendList.querySelectorAll('.recommend-item:not(.added)').forEach(el => {
    el.addEventListener('click', () => {
      addFood(el.dataset.food);
      renderRecommendList();
    });
  });

  // 批量导入
  const batchBtn = document.getElementById('batchImportBtn');
  if (batchBtn) {
    batchBtn.addEventListener('click', () => {
      const items = FOOD_CATEGORIES[currentCategory] || [];
      let addedCount = 0;
      items.forEach(item => {
        if (!foods.includes(item) && foods.length < 20) {
          foods.push(item);
          addedCount++;
        }
      });
      if (addedCount > 0) {
        saveFoods();
        renderFoodList();
        resetWheelRotation();
        drawWheel();
      }
      renderRecommendList();
    });
  }
}

// ========== 事件绑定 ==========
spinBtn.addEventListener('click', spinWheel);

addBtn.addEventListener('click', () => addFood(foodInput.value));

foodInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addFood(foodInput.value);
});

resetBtn.addEventListener('click', () => {
  foods = [...DEFAULT_FOODS];
  saveFoods();
  renderFoodList();
  resetWheelRotation();
  drawWheel();
  renderRecommendList();
});

clearBtn.addEventListener('click', () => {
  if (foods.length === 0) return;
  foods = [];
  saveFoods();
  renderFoodList();
  resetWheelRotation();
  drawWheel();
  renderRecommendList();
});

clearHistoryBtn.addEventListener('click', () => {
  history = [];
  saveHistory();
  renderHistory();
});

closeModalBtn.addEventListener('click', hideResult);

againBtn.addEventListener('click', () => {
  hideResult();
  setTimeout(spinWheel, 300);
});

resultModal.addEventListener('click', (e) => {
  if (e.target === resultModal) hideResult();
});

// ========== 初始化 ==========
function init() {
  setupCanvas();
  loadFoods();
  loadHistory();
  renderFoodList();
  renderHistory();
  renderCategoryTabs();
  renderRecommendList();
  drawWheel();
}

// 窗口大小变化时重绘
window.addEventListener('resize', () => {
  setupCanvas();
  drawWheel();
});

// 启动
init();
