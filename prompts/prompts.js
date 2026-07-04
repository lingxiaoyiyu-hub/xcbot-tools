/* AI 绘图提示词库 — 前端逻辑（原生 JS，零依赖）
 *
 * 功能：
 *   1. fetch prompts/data/aiart-prompts.json
 *   2. 渲染前 300 条提示词卡片
 *   3. 搜索（标题/作者/prompt/标签）
 *   4. 分类筛选（全部/摄影/插画/3D/海报/UI/产品图/表情包）
 *   5. 一键复制（剪贴板 + "已复制"反馈）
 *   6. 图片加载失败 → 灰色占位
 *   7. 详情弹层（完整 prompt + 全部元信息）
 */

(function () {
  'use strict';

  var DATA_URL = 'prompts/data/aiart-prompts.json';
  var allItems = [];
  var currentCat = '全部';
  var currentQuery = '';

  // DOM
  var grid = document.getElementById('promptsGrid');
  var searchInput = document.getElementById('searchInput');
  var filters = document.getElementById('filters');
  var resultCount = document.getElementById('resultCount');
  var emptyState = document.getElementById('emptyState');
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

  /** 渲染整个列表。 */
  function renderList(items) {
    var html = items.map(renderCard).join('');
    grid.innerHTML = html;
    emptyState.style.display = items.length === 0 ? 'block' : 'none';
    resultCount.textContent = '共 ' + items.length + ' 条' + (allItems.length > items.length ? '（已筛选自 ' + allItems.length + ' 条）' : '');
  }

  /** 应用搜索 + 分类筛选。 */
  function applyFilter() {
    var q = currentQuery.toLowerCase();
    var filtered = allItems.filter(function (item) {
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
    renderList(filtered);
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

  // 搜索（input 防抖）
  var searchTimer = null;
  searchInput.addEventListener('input', function () {
    currentQuery = searchInput.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilter, 180);
  });

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
    });
})();
