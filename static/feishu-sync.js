/* 飞书同步管理器 — v2 简化版（push 由后端统一线程执行） */
var FeishuSync = (function() {
    var _enabled = false;

    function init() {
        fetch('/api/feishu/status')
            .then(function(r) { return r.json(); })
            .then(function(s) {
                _enabled = s.enabled;
                if (typeof updateFeishuStatusUI === 'function') {
                    updateFeishuStatusUI(s);
                }
            })
            .catch(function() {});
    }

    function toggle(enabled, mode) {
        return fetch('/api/feishu/toggle', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({enabled: enabled, mode: mode || 'local'}),
        }).then(function(r) { return r.json(); })
          .then(function(data) {
              _enabled = enabled;
              if (typeof updateFeishuStatusUI === 'function') {
                  updateFeishuStatusUI(data);
              }
              return data;
          });
    }

    function pushNow() {
        return fetch('/api/feishu/push', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({}),
        }).then(function(r) { return r.json(); });
    }

    return {
        init: init,
        toggle: toggle,
        pushNow: pushNow,
        isEnabled: function() { return _enabled; },
    };
})();
