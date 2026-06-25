// ========== 数据管理（存档系统） ==========

var _currentAppMtime = 0;

function loadSaveList() {
    fetch('/api/saves')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            _currentAppMtime = data.current_app_mtime || 0;
            renderDbInfo(data.db_info);
            renderSaveTable(data.saves || []);
        })
        .catch(function (err) {
            document.getElementById('manual-saves-container').textContent = '加载失败: ' + err.message;
        });
    fetch('/api/db/info')
        .then(function (r) { return r.json(); })
        .then(function (info) {
            renderDbLocationInfo(info);
        })
        .catch(function () {});
}

function renderDbInfo(dbInfo) {
    if (!dbInfo) return;
    var tableInfo = [];
    var labelMap = {
        machines: '机器', tasks: '任务', schedules: '排班',
        config: '配置项', deletion_log: '删除记录', repair_log: '维修记录', shift_config: '班次配置'
    };
    for (var t in dbInfo.tables) {
        if (dbInfo.tables[t] >= 0) {
            tableInfo.push((labelMap[t] || t) + ': ' + dbInfo.tables[t]);
        }
    }
    document.getElementById('save-db-info').innerHTML =
        '<div>路径：<code style="font-size:11px;word-break:break-all;">' + escHtml(dbInfo.path) + '</code></div>' +
        '<div>大小：' + escHtml(dbInfo.size_display) +
        '　｜　' + tableInfo.join('　') + '</div>';
}

function renderDbLocationInfo(info) {
    var sourceLabels = {env: '环境变量', cli: '命令行参数', config: '配置文件 (db_config.json)', default: '默认路径'};
    document.getElementById('save-db-location-info').innerHTML =
        '来源：' + (sourceLabels[info.source] || info.source) +
        '　｜　存档目录：<code style="font-size:11px;">' + escHtml(info.save_dir) + '</code>';
}

function renderSaveTable(saves) {
    var manualContainer = document.getElementById('manual-saves-container');
    var autoContainer = document.getElementById('auto-saves-container');

    var manualSaves = [];
    var autoSaves = [];
    for (var i = 0; i < saves.length; i++) {
        if (saves[i].is_autosave) {
            autoSaves.push(saves[i]);
        } else {
            manualSaves.push(saves[i]);
        }
    }

    manualContainer.innerHTML = _renderSaveGroup(manualSaves, false);
    autoContainer.innerHTML = _renderSaveGroup(autoSaves, true);
}

function _renderSaveGroup(group, isAuto) {
    if (group.length === 0) {
        var label = isAuto ? '暂无自动存档' : '暂无手动存档，点上方「保存当前存档」创建';
        return '<div style="color:#999;padding:8px;text-align:center;font-size:12px;">' + label + '</div>';
    }
    var html = '<table style="font-size:12px;width:100%;"><tr><th>存档名称</th><th>大小</th><th>时间</th><th>备注</th><th>操作</th></tr>';
    for (var i = 0; i < group.length; i++) {
        var s = group[i];
        var badge = '';
        if (s.app_mtime && _currentAppMtime && Math.abs(s.app_mtime - _currentAppMtime) > 1) {
            badge = ' <span style="background:#fff3cd;color:#856404;padding:0 4px;border-radius:2px;font-size:10px;" title="存档时程序版本与当前不同，加载后将自动适配">版本变更</span>';
        }
        html += '<tr>' +
            '<td>' + escHtml(s.filename) + badge + '</td>' +
            '<td>' + escHtml(s.size_display) + '</td>' +
            '<td style="font-size:11px;">' + escHtml(s.created_at) + '</td>' +
            '<td style="font-size:11px;color:#666;">' + escHtml(s.note) + '</td>' +
            '<td style="white-space:nowrap;">' +
                '<button onclick="downloadSave(\'' + escHtml(s.filename) + '\')" style="font-size:11px;">下载</button> ' +
                '<button onclick="loadSave(\'' + escHtml(s.filename) + '\', ' + (s.app_mtime || 0) + ')" style="font-size:11px;background:var(--warning);">读档</button> ' +
                '<button onclick="deleteSave(\'' + escHtml(s.filename) + '\')" style="font-size:11px;background:var(--danger);color:#fff;">删除</button>' +
            '</td>' +
        '</tr>';
    }
    html += '</table>';
    return html;
}

function quickSave() {
    var note = (document.getElementById('save-note-input').value || '').trim();
    var body = {};
    if (note) body.note = note;
    fetch('/api/saves/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            showToast(d.msg || '存档完成');
            document.getElementById('save-note-input').value = '';
            loadSaveList();
        });
}

function loadSave(filename, saveAppMtime) {
    var extraMsg = '';
    if (saveAppMtime && _currentAppMtime && Math.abs(saveAppMtime - _currentAppMtime) > 1) {
        extraMsg = '<p style="color:#e6a23c;">此存档来自不同版本的程序，加载后将自动适配当前数据库结构。</p>';
    }
    showConfirm('确认读档',
        '<p>确认从存档 <b>' + escHtml(filename) + '</b> 恢复？</p>' +
        '<p style="color:#c62828;">当前数据库将被覆盖，建议先快速存档。</p>' +
        extraMsg
    ).then(function (ok) {
        if (!ok) return;
        fetch('/api/saves/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: filename })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                showToast(d.msg || '读档完成');
                loadSaveList();
                if (d.msg && d.msg.indexOf('重启') !== -1) {
                    setTimeout(function () {
                        showConfirm('需要刷新', '读档已生效，是否刷新页面以加载新数据？').then(function (yes) {
                            if (yes) location.reload();
                        });
                    }, 1500);
                }
            });
    });
}

function deleteSave(filename) {
    showConfirm('确认删除', '确认删除存档 <b>' + escHtml(filename) + '</b>？此操作不可恢复。').then(function (ok) {
        if (!ok) return;
        fetch('/api/saves/' + encodeURIComponent(filename), { method: 'DELETE' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                showToast(d.msg || '已删除');
                loadSaveList();
            });
    });
}

function downloadSave(filename) {
    var a = document.createElement('a');
    a.href = '/api/saves/' + encodeURIComponent(filename) + '/download';
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function uploadSaveFile(input) {
    var file = input.files[0];
    if (!file) return;
    _doUploadSave(file);
    input.value = '';
}

function _doUploadSave(file) {
    if (!file.name.toLowerCase().endsWith('.sqlite3')) {
        showToast('仅支持 .sqlite3 格式');
        return;
    }
    var fd = new FormData();
    fd.append('file', file);
    fetch('/api/saves/upload', { method: 'POST', body: fd })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            showToast(d.msg || '导入完成');
            loadSaveList();
        })
        .catch(function (e) {
            showToast('导入失败: ' + (e.message || '未知错误'));
        });
}

// ========== 拖拽导入存档 ==========
var _saveDropZoneInited = false;
function initSaveDropZone() {
    if (_saveDropZoneInited) return;
    var zone = document.getElementById('save-drop-zone');
    if (!zone) return;
    _saveDropZoneInited = true;

    var dragCounter = 0;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(function (evt) {
        zone.addEventListener(evt, function (e) { e.preventDefault(); e.stopPropagation(); });
    });

    zone.addEventListener('dragenter', function () {
        dragCounter++;
        zone.style.borderColor = 'var(--primary)';
        zone.style.background = 'rgba(59,130,246,0.06)';
    });
    zone.addEventListener('dragover', function () {
        zone.style.borderColor = 'var(--primary)';
        zone.style.background = 'rgba(59,130,246,0.06)';
    });
    zone.addEventListener('dragleave', function () {
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            zone.style.borderColor = 'var(--border)';
            zone.style.background = '';
        }
    });
    zone.addEventListener('drop', function (e) {
        dragCounter = 0;
        zone.style.borderColor = 'var(--border)';
        zone.style.background = '';
        var files = e.dataTransfer.files;
        if (files.length > 0) {
            _doUploadSave(files[0]);
        }
    });
}

// ========== 数据库位置管理 ==========

function transferDatabase() {
    var newPath = (document.getElementById('db-transfer-path').value || '').trim();
    if (!newPath) { showToast('请输入目标数据库文件路径'); return; }
    showConfirm('转移数据库',
        '<p>将当前数据库复制到：</p><p><code>' + escHtml(newPath) + '</code></p>' +
        '<p style="color:#e6a23c;">操作完成后将自动切换到新位置的数据库，原文件保留。</p>'
    ).then(function (ok) {
        if (!ok) return;
        fetch('/api/db/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: newPath })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                showToast(d.msg || '转移完成');
                document.getElementById('db-transfer-path').value = '';
                loadSaveList();
            });
    });
}

function switchDatabase() {
    var newPath = (document.getElementById('db-switch-path').value || '').trim();
    if (!newPath) { showToast('请输入已有数据库文件路径'); return; }
    showConfirm('切换数据库',
        '<p>切换到已有数据库：</p><p><code>' + escHtml(newPath) + '</code></p>' +
        '<p style="color:#c62828;">请确保该文件是有效的 SQLite 数据库，切换后请刷新页面。</p>'
    ).then(function (ok) {
        if (!ok) return;
        fetch('/api/db/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: newPath })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                showToast(d.msg || '切换完成');
                document.getElementById('db-switch-path').value = '';
                loadSaveList();
                if (d.ok) {
                    setTimeout(function () {
                        showConfirm('需要刷新', '数据库已切换，是否刷新页面以加载新数据？').then(function (yes) {
                            if (yes) location.reload();
                        });
                    }, 1000);
                }
            });
    });
}

function changeSaveDirectory() {
    var newDir = (document.getElementById('save-dir-path').value || '').trim();
    if (!newDir) { showToast('请输入存档目录路径'); return; }
    showConfirm('更改存档目录',
        '<p>将存档目录更改为：</p><p><code>' + escHtml(newDir) + '</code></p>' +
        '<p style="color:#e6a23c;">此操作仅修改存档存储位置，不影响数据库位置。已有的存档文件不会自动迁移。</p>'
    ).then(function (ok) {
        if (!ok) return;
        fetch('/api/db/change-save-dir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: newDir })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                showToast(d.msg || '更改完成');
                document.getElementById('save-dir-path').value = '';
                loadSaveList();
            });
    });
}

function resetDatabase() {
    showConfirm('重置数据库',
        '<p style="color:#c62828;font-weight:700;">确认重置数据库？</p>' +
        '<p>此操作将：</p>' +
        '<ol style="text-align:left;">' +
        '<li>自动备份当前数据库到存档列表</li>' +
        '<li>删除当前数据库并创建全新的空白数据库</li>' +
        '</ol>' +
        '<p style="color:#c62828;">此操作不可恢复，请确认已备份重要数据。</p>'
    ).then(function (ok) {
        if (!ok) return;
        showConfirm('再次确认',
            '<p style="color:#c62828;font-weight:700;">请再次确认：真的要重置数据库吗？</p>' +
            '<p>当前所有数据将被清空。</p>'
        ).then(function (ok2) {
            if (!ok2) return;
            fetch('/api/db/reset', { method: 'POST' })
                .then(function (r) { return r.json(); })
                .then(function (d) {
                    showToast(d.msg || '已重置');
                    setTimeout(function () { location.reload(); }, 800);
                });
        });
    });
}
