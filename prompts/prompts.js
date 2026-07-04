/* AI 绘图提示词库 — 前端逻辑（原生 JS，零依赖）
 *
 * 功能：
 *   1. fetch prompts/data/aiart-prompts.json（一次性加载全量数据）
 *   2. 分页渲染：首屏 60 条，"加载更多"每次追加 60 条（不一次性插入全部 DOM）
 *   3. 搜索（标题/作者/prompt/标签）— 基于完整 allItems，非仅当前已显示
 *   4. 分类筛选（全部/摄影/插画/3D/海报/UI/产品图/表情包）
 *   5. 搜索或切换分类后，分页重置，从第 1 页重新显示
 *   6. 一键复制（剪贴板 + "已复制"反馈）
 *   7. 图片加载失败 → 灰色占位
 *   8. 详情弹层（完整 prompt + 全部元信息）
 *
 * 搜索框说明：
 *   - 主体大搜索框 #promptSearchInput 是提示词库主搜索（位于页面标题与分类筛选之间）
 *   - header 顶部 #searchInput 保留，与主体搜索框双向同步
 */

(function () {
  'use strict';

  var DATA_URL = '/prompts/data/aiart-prompts.json';
  var allItems = [];
  var filteredItems = [];   // 当前搜索+筛选后的完整结果集
  var currentCat = '全部';
  var currentQuery = '';

  // 分页
  var PAGE_SIZE = 60;
  var shownCount = 0;       // 当前已渲染到 DOM 的条数

  // DOM
  var grid = document.getElementById('promptsGrid');
  var promptSearchInput = document.getElementById('promptSearchInput');   // 主体大搜索框
  var headerSearchInput = document.getElementById('searchInput');          // header 顶部搜索框（可选，做同步）
  var filters = document.getElementById('filters');
  var resultCount = document.getElementById('resultCount');
  var emptyState = document.getElementById('emptyState');
  var loadMoreBtn = document.getElementById('loadMoreBtn');
  var modalOverlay = document.getElementById('modalOverlay');
  var modalClose = document.getElementById('modalClose');
  var modalImg = document.getElementById('modalImg');
  var modalTitle = document.getElementById('modalTitle');
  var modalAuthor = document.getElementById('modalAuthor');
  var modalSource = document.getElementById('modalSource');
  var modalDetail = document.getElementById('modalDetail');
  var modalTags = document.getElementById('modalTags');
  var modalPrompt = document.getElementById('modalPrompt');
  var modalCopy = document.getElementById('modalCopy');

  // ── 工具函数 ──

  function escapeHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 取 prompt 前 3 行作为摘要。 */
  function makeSummary(prompt) {
    if (!prompt) return '';
    var lines = prompt.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    return lines.slice(0, 3).join('\n');
  }

  /** 渲染单张卡片的 HTML。 */
  function renderCard(item) {
    var summary = makeSummary(item.prompt);
    var tagsHtml = (item.tags || []).map(function (t) {
      var isModel = (t === 'Nano Banana' || t === 'Midjourney' || t === 'Stable Diffusion');
      return '<span class="card-tag' + (isModel ? ' model' : '') + '">' + escapeHtml(t) + '</span>';
    }).join('');

    var imgHtml = item.imageUrl
      ? '<img src="' + escapeHtml(item.imageUrl) + '" alt="' + escapeHtml(item.imageAlt || item.title) + '" loading="lazy" data-fallback="1">'
      : '<div class="card-img-placeholder">无图片</div>';

    var sourceLabel = item.sourcePlatform || '来源';
    var sourceUrl = item.sourceUrl || item.detailUrl || '#';

    return (
      '<div class="prompt-card" data-id="' + escapeHtml(item.id) + '">' +
        '<div class="card-img-wrap">' + imgHtml + '</div>' +
        '<div class="card-body">' +
          '<div class="card-title">' + escapeHtml(item.title) + '</div>' +
          '<div class="card-meta">' +
            '<span class="card-meta-item">作者：' +
              (item.authorUrl
                ? '<a href="' + escapeHtml(item.authorUrl) + '" target="_blank" rel="noopener">' + escapeHtml(item.author) + '</a>'
                : escapeHtml(item.author)) +
            '</span>' +
            '<span class="card-meta-item">来源：' +
              (sourceUrl && sourceUrl !== '#'
                ? '<a href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noopener">' + escapeHtml(sourceLabel) + '</a>'
                : escapeHtml(sourceLabel)) +
            '</span>' +
          '</div>' +
          (tagsHtml ? '<div class="card-tags">' + tagsHtml + '</div>' : '') +
          (summary ? '<div class="card-summary">' + escapeHtml(summary) + '</div>' : '') +
          '<div class="card-actions">' +
            '<button class="action-btn primary copy-btn-card" data-prompt="' + encodeURIComponent(item.prompt || '') + '">复制提示词</button>' +
            '<a class="action-btn" href="' + escapeHtml(sourceUrl !== '#' ? sourceUrl : (item.detailUrl || '#')) + '" target="_blank" rel="noopener">原始来源</a>' +
            '<button class="action-btn detail-btn" data-id="' + escapeHtml(item.id) + '">查看详情</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  /** 更新结果计数文案。 */
  function updateResultCount() {
    var total = filteredItems.length;
    var shown = Math.min(shownCount, total);
    var isFiltered = (currentQuery !== '' || currentCat !== '全部');
    if (isFiltered) {
      resultCount.textContent = '共 ' + total + ' 条匹配结果，已显示 ' + shown + ' 条';
    } else {
      resultCount.textContent = '共 ' + total + ' 条，已显示 ' + shown + ' 条';
    }
  }

  /** 更新"加载更多"按钮的可见性。 */
  function updateLoadMoreBtn() {
    if (!loadMoreBtn) return;
    if (shownCount >= filteredItems.length) {
      loadMoreBtn.style.display = 'none';
    } else {
      loadMoreBtn.style.display = '';
    }
  }

  /** 渲染指定范围的卡片并追加到 DOM。 */
  function appendCards(start, end) {
    var slice = filteredItems.slice(start, end);
    if (slice.length === 0) return;
    var html = slice.map(renderCard).join('');
    grid.insertAdjacentHTML('beforeend', html);
  }

  /** 重置分页并重新渲染首屏。 */
  function resetAndRender() {
    shownCount = 0;
    grid.innerHTML = '';
    emptyState.style.display = 'none';
    if (filteredItems.length === 0) {
      emptyState.style.display = 'block';
      updateResultCount();
      updateLoadMoreBtn();
      return;
    }
    var end = Math.min(PAGE_SIZE, filteredItems.length);
    appendCards(0, end);
    shownCount = end;
    updateResultCount();
    updateLoadMoreBtn();
  }

  /** 加载下一页。 */
  function loadNextPage() {
    if (shownCount >= filteredItems.length) return;
    var start = shownCount;
    var end = Math.min(start + PAGE_SIZE, filteredItems.length);
    appendCards(start, end);
    shownCount = end;
    updateResultCount();
    updateLoadMoreBtn();
  }

  /** 应用搜索 + 分类筛选（基于完整 allItems），并重置分页。 */
  function applyFilter() {
    var q = currentQuery.toLowerCase();
    filteredItems = allItems.filter(function (item) {
      // 分类筛选
      if (currentCat !== '全部') {
        var tags = item.tags || [];
        if (tags.indexOf(currentCat) === -1) return false;
      }
      // 搜索
      if (q) {
        var hay = (
          (item.title || '') + ' ' +
          (item.author || '') + ' ' +
          (item.prompt || '') + ' ' +
          (item.tags || []).join(' ')
        ).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    resetAndRender();
  }

  /** 图片加载失败 → 灰色占位。 */
  function handleImgError(img) {
    var wrap = img.parentElement;
    img.style.display = 'none';
    if (!wrap.querySelector('.card-img-placeholder')) {
      var ph = document.createElement('div');
      ph.className = 'card-img-placeholder';
      ph.textContent = '图片加载失败';
      wrap.appendChild(ph);
    }
  }

  /** 复制文本到剪贴板，兼容旧浏览器。 */
  function copyText(text, btnEl, originalText) {
    function onDone(ok) {
      if (ok && btnEl) {
        var orig = originalText || btnEl.textContent;
        btnEl.textContent = '已复制';
        btnEl.classList.add('copied');
        setTimeout(function () {
          btnEl.textContent = orig;
          btnEl.classList.remove('copied');
        }, 1500);
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { onDone(true); }).catch(function () { fallbackCopy(text, onDone); });
    } else {
      fallbackCopy(text, onDone);
    }
  }
  function fallbackCopy(text, cb) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      cb(ok);
    } catch (e) { cb(false); }
  }

  /** 打开详情弹层。 */
  function openModal(item) {
    modalImg.src = item.imageUrl || '';
    modalImg.alt = item.imageAlt || item.title;
    modalImg.onerror = function () { modalImg.style.display = 'none'; };
    modalImg.style.display = '';
    modalTitle.textContent = item.title;
    modalAuthor.textContent = item.author || '未知';
    modalAuthor.href = item.authorUrl || '#';
    modalSource.textContent = item.sourcePlatform || '来源';
    modalSource.href = item.sourceUrl || '#';
    modalDetail.href = item.detailUrl || '#';
    modalTags.innerHTML = (item.tags || []).map(function (t) {
      return '<span class="card-tag">' + escapeHtml(t) + '</span>';
    }).join('');
    modalPrompt.textContent = item.prompt || '';
    modalCopy.dataset.prompt = encodeURIComponent(item.prompt || '');
    modalOverlay.style.display = 'flex';
  }
  function closeModal() {
    modalOverlay.style.display = 'none';
  }

  // ── 事件绑定 ──

  // 主体搜索框（input 防抖）— 提示词库主搜索
  var searchTimer = null;
  if (promptSearchInput) {
    promptSearchInput.addEventListener('input', function () {
      currentQuery = promptSearchInput.value.trim();
      // 同步到 header 搜索框
      if (headerSearchInput && headerSearchInput.value !== currentQuery) {
        headerSearchInput.value = currentQuery;
      }
      clearTimeout(searchTimer);
      searchTimer = setTimeout(applyFilter, 180);
    });
  }

  // header 搜索框 — 与主体搜索框同步（不独立触发，避免双重渲染）
  if (headerSearchInput) {
    headerSearchInput.addEventListener('input', function () {
      var v = headerSearchInput.value.trim();
      if (promptSearchInput && promptSearchInput.value !== v) {
        promptSearchInput.value = v;
        currentQuery = v;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyFilter, 180);
      }
    });
  }

  // 分类筛选
  filters.addEventListener('click', function (e) {
    var btn = e.target.closest('.filter-btn');
    if (!btn) return;
    var cat = btn.getAttribute('data-cat');
    if (!cat) return;
    currentCat = cat;
    Array.prototype.forEach.call(filters.querySelectorAll('.filter-btn'), function (b) {
      b.classList.toggle('active', b === btn);
    });
    applyFilter();
  });

  // "加载更多"按钮
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', loadNextPage);
  }

  // 卡片内事件委托（复制 / 详情 / 图片错误）
  grid.addEventListener('click', function (e) {
    var copyBtn = e.target.closest('.copy-btn-card');
    if (copyBtn) {
      e.preventDefault();
      var text = decodeURIComponent(copyBtn.getAttribute('data-prompt') || '');
      copyText(text, copyBtn, '复制提示词');
      return;
    }
    var detailBtn = e.target.closest('.detail-btn');
    if (detailBtn) {
      var id = detailBtn.getAttribute('data-id');
      var item = allItems.find(function (x) { return x.id === id; });
      if (item) openModal(item);
      return;
    }
  });

  // 图片加载失败
  grid.addEventListener('error', function (e) {
    if (e.target && e.target.tagName === 'IMG' && e.target.getAttribute('data-fallback')) {
      handleImgError(e.target);
    }
  }, true);

  // 弹层事件
  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', function (e) {
    if (e.target === modalOverlay) closeModal();
  });
  modalCopy.addEventListener('click', function () {
    var text = decodeURIComponent(modalCopy.getAttribute('data-prompt') || '');
    copyText(text, modalCopy, '复制提示词');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modalOverlay.style.display === 'flex') closeModal();
  });

  // ── 初始化 ──
  fetch(DATA_URL)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      allItems = Array.isArray(data) ? data : [];
      applyFilter();
    })
    .catch(function (err) {
      console.error('加载提示词数据失败:', err);
      grid.innerHTML = '';
      emptyState.textContent = '数据加载失败，请稍后重试。';
      emptyState.style.display = 'block';
      resultCount.textContent = '';
      if (loadMoreBtn) loadMoreBtn.style.display = 'none';
    });
})();
