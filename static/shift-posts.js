// ===== 便签渲染 =====
var _forumEnabled = true;
var _retentionDays = 3;

function autoGrowTextarea(el) {
    el.style.height = 'auto';
    var h = el.scrollHeight;
    if (h > 200) h = 200;
    el.style.height = h + 'px';
}

function clearPostInput() {
    document.getElementById('post-title').value = '';
    document.getElementById('post-content').value = '';
    document.getElementById('post-author').value = '';
    document.getElementById('post-content').style.height = '';
}

var SAFE_TAGS_RE = /<\/?(p|br\s*\/?|b|i|u|strong|em|h[3-6]|ul|ol|li|a|span|div|sub|sup|hr\s*\/?|blockquote|pre|code|del|ins|mark|small)\b[^>]*\/?>/gi;

function renderContent(raw) {
    var div = document.createElement('div');
    div.textContent = raw || '';
    var escaped = div.innerHTML;
    var safe = escaped.replace(/&lt;\/?(p|br\s*\/?|b|i|u|strong|em|h[3-6]|ul|ol|li|a|span|div|sub|sup|hr\s*\/?|blockquote|pre|code|del|ins|mark|small)\b[^&]*\/?&gt;/gi, function(m) {
        return m.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    });
    return safe;
}

function loadPosts() {
    var board = document.getElementById('post-board');
    var forum = document.getElementById('shift-forum');
    if (!board || !forum) return;
    fetch('/api/shift_posts')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            _forumEnabled = data.enabled;
            _retentionDays = data.retention_days;
            forum.style.display = _forumEnabled ? '' : 'none';
            var posts = data.posts;
            if (!posts.length) {
                board.innerHTML = '<div class="post-board-empty">还没有便签，写一张贴上去吧</div>';
                return;
            }
            var html = '';
            for (var i = 0; i < posts.length; i++) {
                var p = posts[i];
                var color = p.id % 5;
                var size = p.id % 3;
                var rot = p.id % 3;
                var time = formatTime(p.created_at);
                html += '<div class="sticky sticky-c' + color + ' sticky-s' + size + ' sticky-r' + rot + '">';
                if (p.title) {
                    html += '<div class="sticky-title">' + escHtml(p.title) + '</div>';
                }
                html += '<div class="sticky-body">' + renderContent(p.content) + '</div>';
                html += '<div class="sticky-footer">' +
                    '<span class="sticky-time">' + escHtml(time) + '</span>' +
                    '<span class="sticky-author">— ' + escHtml(p.author) + '</span>' +
                    '<button class="sticky-del" onclick="deletePost(' + p.id + ')" title="撕掉">&times;</button>' +
                '</div></div>';
            }
            board.innerHTML = html;
        }).catch(function() {});
}

function formatTime(t) {
    if (!t) return '';
    var d = new Date(t.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return t.substring(5, 16);
    var mm = d.getMonth() + 1;
    var dd = d.getDate();
    var HH = d.getHours();
    var MM = d.getMinutes();
    return (mm < 10 ? '0' + mm : mm) + '-' + (dd < 10 ? '0' + dd : dd) + ' ' + (HH < 10 ? '0' + HH : HH) + ':' + (MM < 10 ? '0' + MM : MM);
}

function submitPost() {
    var titleEl = document.getElementById('post-title');
    var contentEl = document.getElementById('post-content');
    var authorEl = document.getElementById('post-author');
    var content = contentEl.value.trim();
    if (!content) { showToast('请输入正文'); return; }
    fetch('/api/shift_posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: titleEl.value.trim(),
            author: authorEl.value.trim(),
            content: content
        })
    }).then(function(r) { return r.json(); }).then(function(d) {
        showToast(d.msg);
        titleEl.value = '';
        contentEl.value = '';
        contentEl.style.height = '';
        authorEl.value = '';
        loadPosts();
    }).catch(function() {});
}

function deletePost(id) {
    showConfirm('撕掉便签', '确定撕掉这张便签吗？').then(function(ok) {
        if (!ok) return;
        fetch('/api/shift_posts/' + id, { method: 'DELETE' })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                showToast(d.msg);
                loadPosts();
            }).catch(function() {});
    });
}

// ===== 设置面板绑定 =====

function applyForumEnabled(enabled) {
    var val = enabled ? '1' : '0';
    fetch('/api/settings/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ category: 'forum_settings', key: 'forum_enabled', value: val }] }),
    });
    var forum = document.getElementById('shift-forum');
    if (forum) { forum.style.display = enabled ? '' : 'none'; }
    _forumEnabled = enabled;
    if (enabled) { loadPosts(); }
}

function onRetentionSliderChange(val) {
    var displayEl = document.getElementById('s-forum-retention-val');
    if (displayEl) { displayEl.textContent = val; }
    var oldVal = _retentionDays;
    var daysNum = parseInt(val, 10);
    if (isNaN(daysNum) || daysNum === oldVal) return;

    showConfirm(
        '调整保留天数',
        '将保留天数从 ' + oldVal + ' 天改为 ' + daysNum + ' 天，超过 ' + daysNum + ' 天的便签将立即被删除。确定继续吗？'
    ).then(function(ok) {
        if (!ok) {
            var slider = document.getElementById('s-forum-retention');
            var displayEl2 = document.getElementById('s-forum-retention-val');
            if (slider) { slider.value = oldVal; }
            if (displayEl2) { displayEl2.textContent = oldVal; }
            return;
        }
        _retentionDays = daysNum;
        fetch('/api/settings/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ category: 'forum_settings', key: 'forum_retention_days', value: String(daysNum) }] }),
        }).then(function() {
            return fetch('/api/shift_posts/cleanup', { method: 'POST' });
        }).then(function(r) { return r.json(); }).then(function(d) {
            showToast('已清理 ' + (d.deleted || 0) + ' 条过期便签');
            loadPosts();
        }).catch(function() {});
    });
}

function applyStoredForumSettings() {
    var fs = {};
    if (typeof _settingsData === 'object' && _settingsData['forum_settings']) {
        var arr = _settingsData['forum_settings'];
        for (var i = 0; i < arr.length; i++) {
            fs[arr[i].key] = arr[i].value;
        }
    }
    var enabled = fs['forum_enabled'] !== '0';
    var retention = parseInt(fs['forum_retention_days'], 10) || 3;

    var enabledCheck = document.getElementById('s-forum-enabled');
    var retentionSlider = document.getElementById('s-forum-retention');
    var retentionVal = document.getElementById('s-forum-retention-val');

    if (enabledCheck) { enabledCheck.checked = enabled; }
    if (retentionSlider) { retentionSlider.value = retention; }
    if (retentionVal) { retentionVal.textContent = retention; }

    _forumEnabled = enabled;
    _retentionDays = retention;
}

// 页面加载：立即拉便签（服务端返回 enabled 状态），同时异步等 settings 回填控件
document.addEventListener('DOMContentLoaded', function() {
    loadPosts();
    var ta = document.getElementById('post-content');
    if (ta) {
        ta.addEventListener('input', function () { autoGrowTextarea(ta); });
    }
    var attempts = 0;
    function trySyncSettings() {
        attempts++;
        if (typeof _settingsData === 'object' && _settingsData['forum_settings']) {
            applyStoredForumSettings();
        } else if (attempts < 30) {
            setTimeout(trySyncSettings, 200);
        }
    }
    setTimeout(trySyncSettings, 300);
});
