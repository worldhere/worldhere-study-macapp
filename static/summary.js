// 可视化总结面板 JS
var SUMMARY_CACHE = {};

// ── 区域一：班次报告 widget ──
var REPORT_WIDGETS = [
  { id: "shift_report", title: "📋 班次统计", chartType: "report", span: 2, region: "report" },
  { id: "machine_utilization", title: "🏭 机器利用率", chartType: "taskring", span: 2, region: "report" },
  { id: "machine_status", title: "🖥 当前机器状态", chartType: "doughnut", span: 1, region: "report" },
  { id: "push_stats", title: "📡 推送事件统计", chartType: "scatter", span: 1, region: "report" }
];

// ── 区域二：可视化总结 widget ──
// 聚合统计（按维度汇总的图表）
var AGGREGATE_WIDGETS = [
  { id: "daily_trend", title: "📈 每日完成趋势", chartType: "line", span: 1 },
  { id: "completion_heatmap", title: "🔥 完成时段热力图", chartType: "heatmap", span: 2 },
  { id: "repair_summary", title: "🔧 维修时长", chartType: "hbar", span: 1 },
  { id: "repair_frequency", title: "🔧 维修频率", chartType: "scatter", span: 1 },
  { id: "exception_summary", title: "⚠️ 异常次数趋势", chartType: "line", span: 1 },
  { id: "time_deviation", title: "⏳ 提前/延迟模式（直方图）", chartType: "histogram", span: 1 }
];

// 任务明细（每行/每柱是一个具体任务，全宽展示）
var DETAIL_WIDGETS = [
  { id: "estimate_vs_actual", title: "⏱ 预估 vs 实际时长（按任务）", chartType: "hbar", span: 1, grid: "summary-grid-detail" },
  { id: "overdue_tasks", title: "⏰ 过时任务清单", chartType: "table", span: 1, grid: "summary-grid-detail" }
];

var SUMMARY_CHARTS = {};
var COLORS10 = ["#3b82f6","#ef4444","#10b981","#f59e0b","#8b5cf6","#ec4899","#06b6d4","#84cc16","#f97316","#6366f1"];

// ── 参数获取 ──
function summaryGetDays() {
  var el = document.getElementById("summary-days");
  return el ? parseInt(el.value) || 14 : 14;
}
function summaryGetDate() {
  var el = document.getElementById("summary-date");
  return el ? el.value : "";
}
function summaryGetShift() {
  var el = document.getElementById("summary-shift");
  return el ? el.value : "白班";
}
function summaryGetEndDate() {
  var el = document.getElementById("summary-end-date");
  return el ? el.value : "";
}

// ── 通用数据加载 ──
async function summaryLoadData(widgetNames, opts) {
  opts = opts || {};
  var days = opts.days != null ? opts.days : summaryGetDays();
  var date = opts.date != null ? opts.date : summaryGetDate();
  var shift = opts.shift || summaryGetShift();
  var endDate = opts.endDate != null ? opts.endDate : summaryGetEndDate();
  var params = new URLSearchParams({ widgets: widgetNames.join(","), days: String(days), shift: shift });
  if (date) params.set("date", date);
  if (endDate) params.set("end_date", endDate);
  var resp = await fetch("/api/summary/data?" + params.toString());
  var json = await resp.json();
  if (json.data) {
    for (var key in json.data) { SUMMARY_CACHE[key] = json.data[key]; }
  }
  return json;
}

// ── 区域一：班次报告 ──
async function summaryLoadReport() {
  var date = summaryGetDate();
  var shift = summaryGetShift();
  if (!date) { showToast("请先选择日期"); return; }

  // 加载报告数据（push_stats 跟报告日期联动）
  await summaryLoadData(["shift_report", "machine_utilization", "machine_status", "push_stats"], { date: date, shift: shift });
  // 拉取动态任务状态（暂停中等）供任务段环形使用
  try {
    var csResp = await fetch("/current_status");
    var csData = await csResp.json();
    _dynTaskStatuses = csData.task_statuses || {};
  } catch(e) { _dynTaskStatuses = {}; }
  var data = SUMMARY_CACHE["shift_report"];
  var bannerStats = document.getElementById("summary-banner-stats");
  var sendBtn = document.getElementById("btn-send-report");

  if (data && !data.error) {
    bannerStats.style.display = "";
    document.getElementById("stat-packages").textContent = (data.packages || []).length;
    document.getElementById("stat-pct").textContent = data.completion_pct;
    document.getElementById("stat-pending").textContent = data.pending_count;
    document.getElementById("stat-collect").textContent = (data.collect_total || 0).toLocaleString();
    sendBtn.disabled = false;
    var ssBtn = document.getElementById("btn-send-screenshot");
    if (ssBtn) ssBtn.disabled = false;
    // 检查发送状态
    var sResp = await fetch("/api/summary/report-status?date=" + encodeURIComponent(date) + "&shift=" + encodeURIComponent(shift));
    var status = await sResp.json();
    var badge = document.getElementById("summary-sent-badge");
    if (status.sent) {
      badge.style.display = "";
      var methodLabel = status.method === "shift_table_screenshot" ? "表格截图" : "卡片";
      badge.textContent = "✅ 已发送 " + (status.sent_at || "") + " (" + methodLabel + ")";
      sendBtn.textContent = "📤 重新发送";
    } else {
      badge.style.display = "none";
      sendBtn.textContent = "📤 发送到飞书";
    }
  } else {
    bannerStats.style.display = "none";
    sendBtn.disabled = true;
  }

  // 渲染区域一 widget
  renderReportWidgets();
}

function renderReportWidgets() {
  for (var i = 0; i < REPORT_WIDGETS.length; i++) {
    var w = REPORT_WIDGETS[i];
    if (w.id === "shift_report") {
      renderShiftReportWidget(w);
    } else {
      renderWidget(w);
    }
  }
}

function renderShiftReportWidget(w) {
  destroyWidgetChart(w.id);
  var card = ensureWidgetCard(w, "summary-grid-report");
  var body = card.querySelector(".summary-widget-body");
  body.innerHTML = "";
  var data = SUMMARY_CACHE["shift_report"];
  if (!data || data.error) {
    body.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px;">' + (data ? data.error : "暂无数据") + '</p>';
    return;
  }

  var html = '';

  // ── 第一段：📦 任务包进度 ──
  html += '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">📦 任务包进度</div>';
  var pkgs = data.packages || [];
  if (pkgs.length === 0) {
    if (data.total_schedules > 0) {
      html += '<p style="color:var(--text-secondary);font-size:12px;margin-bottom:8px;">本班次无任务包排班</p>';
    }
  } else {
    for (var i = 0; i < pkgs.length; i++) {
      var p = pkgs[i];
      var doneIcon = p.completed >= p.total ? ' ✅' : '';
      var barFilled = Math.round(p.pct / 10);
      var barStr = '';
      for (var b = 0; b < 10; b++) { barStr += b < barFilled ? '█' : '░'; }
      var remainText = (p.completed < p.total) ? '  <span style="color:#ef4444;">⚠ 剩余 ' + (p.total - p.completed) + ' 个</span>' : '';
      html += '<div style="font-size:12px;margin-bottom:2px;">' +
        escHtml(p.name) + '  完成 ' + p.completed + '/' + p.total + '  ' + barStr + '  <strong>' + p.pct + '%</strong>' + doneIcon + remainText +
        '</div>';
    }
  }

  html += '<hr style="border:none;border-top:1px solid var(--border);margin:10px 0;">';

  // ── 第二段：📊 汇总 ──
  html += '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">📊 汇总</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;margin-bottom:6px;">' +
    '<div>任务包<br><strong>已完成 ' + (data.pkg_sch_completed || 0) + ' 条</strong></div>' +
    '<div>独立任务<br><strong>已完成 ' + (data.completed_standalone || 0) + ' 条</strong></div>' +
    '</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;margin-bottom:6px;">' +
    '<div>排班<br><strong>' + (data.total_schedules || 0) + ' 条</strong></div>' +
    '<div>完成率<br><strong>' + (data.completion_pct || 0) + '%</strong></div>' +
    '</div>';
  html += '<div style="font-size:12px;">采集总数 <strong>' + ((data.collect_total || 0)).toLocaleString() + '</strong> 条</div>';

  html += '<hr style="border:none;border-top:1px solid var(--border);margin:10px 0;">';

  // ── 第三段：⚠️ 待处理 ──
  html += '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">⚠️ 待处理</div>';
  if (data.total_schedules === 0) {
    html += '<p style="color:var(--text-secondary);font-size:12px;">本班次无排班</p>';
  } else if (data.pending_count > 0) {
    html += '<p style="font-size:12px;">未完成 <strong style="color:#ef4444;">' + data.pending_count + '</strong> 条</p>';
  } else {
    html += '<p style="font-size:12px;color:#10b981;">全部完成 ✅</p>';
  }

  body.innerHTML = html;
}

// ── 区域二：可视化总结 ──
async function summaryRefreshTrends() {
  var endDate = summaryGetEndDate();
  var days = summaryGetDays();
  if (!endDate) { showToast("请先选择截止日期"); return; }

  var allWidgets = AGGREGATE_WIDGETS.concat(DETAIL_WIDGETS);
  var ids = allWidgets.map(function(w){ return w.id; });
  await summaryLoadData(ids, { endDate: endDate, days: days });
  for (var i = 0; i < AGGREGATE_WIDGETS.length; i++) { renderWidget(AGGREGATE_WIDGETS[i]); }
  for (var j = 0; j < DETAIL_WIDGETS.length; j++) { renderWidget(DETAIL_WIDGETS[j]); }
}

// ── Widget 渲染派发 ──
function renderWidget(w) {
  var data = SUMMARY_CACHE[w.id];
  if (!data || data.error) { renderEmptyWidget(w, data ? data.error : "暂无数据"); return; }
  switch(w.chartType) {
    case "line": renderLineChart(w, data); break;
    case "bar": renderBarChart(w, data); break;
    case "hbar": renderHBarChart(w, data); break;
    case "treemap": renderTreemap(w, data); break;
    case "piegrid": renderPieGrid(w, data); break;
    case "taskring": renderTaskRing(w, data); break;
    case "doughnut": renderDoughnutChart(w, data); break;
    case "mixed": renderMixedChart(w, data); break;
    case "histogram": renderHistogramChart(w, data); break;
    case "heatmap": renderHeatmap(w, data); break;
    case "scatter": renderScatterChart(w, data); break;
    case "table": renderTableWidget(w, data); break;
  }
}

function ensureWidgetCard(w, gridId) {
  gridId = gridId || "summary-grid";
  var grid = document.getElementById(gridId);
  var card = document.getElementById("widget-" + w.id);
  if (!card) {
    card = document.createElement("div");
    card.className = "summary-widget";
    card.id = "widget-" + w.id;
    card.style.gridColumn = "span " + (w.span || 1);
    card.innerHTML = '<div class="summary-widget-header" onclick="toggleWidget(\'' + w.id + '\')"><span>' + w.title + '</span><span class="summary-widget-toggle">▼</span></div><div class="summary-widget-body">' + (w.chartType === 'taskring' ? '' : '<canvas></canvas>') + '</div>';
    grid.appendChild(card);
  }
  return card;
}

function ensureCanvas(w) {
  var card = document.getElementById("widget-" + w.id);
  if (!card) {
    var gridId = w.grid || (w.region === "report" ? "summary-grid-report" : "summary-grid");
    card = ensureWidgetCard(w, gridId);
  }
  var body = card.querySelector(".summary-widget-body");
  if (!body.querySelector("canvas")) { body.innerHTML = '<canvas></canvas>'; }
  return card.querySelector("canvas");
}

function destroyWidgetChart(widgetId) {
  if (SUMMARY_CHARTS[widgetId]) { SUMMARY_CHARTS[widgetId].destroy(); delete SUMMARY_CHARTS[widgetId]; }
}

// ── 图表渲染 ──
function renderLineChart(w, data) {
  destroyWidgetChart(w.id);
  var canvas = ensureCanvas(w);
  if (w.id === "daily_trend") {
    // 面积+折线：浅绿色面积=已完成，折线=排班总数
    SUMMARY_CHARTS[w.id] = new Chart(canvas, {
      type: "line",
      data: {
        labels: data.map(function(d){ return d.date.slice(5); }),
        datasets: [
          {
            label: "已完成", data: data.map(function(d){ return d.completed; }),
            borderColor: "#10b981", backgroundColor: "rgba(16, 185, 129, 0.18)",
            tension: 0.3, fill: true, pointRadius: 0
          },
          {
            label: "排班总数", data: data.map(function(d){ return d.total; }),
            borderColor: "#6366f1", backgroundColor: "transparent",
            tension: 0.3, fill: false, pointRadius: 2, borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: { y: { beginAtZero: true } }
      }
    });
  } else if (w.id === "exception_summary") {
    // 总维修次数折线图
    SUMMARY_CHARTS[w.id] = new Chart(canvas, {
      type: "line",
      data: {
        labels: data.map(function(d){ return d.date.slice(5); }),
        datasets: [
          { label: "异常次数", data: data.map(function(d){ return d.count; }),
            borderColor: "#ef4444", backgroundColor: "rgba(239, 68, 68, 0.1)",
            tension: 0.3, fill: true, pointRadius: 3, borderWidth: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom" } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
  } else {
    SUMMARY_CHARTS[w.id] = new Chart(canvas, {
      type: "line",
      data: {
        labels: data.map(function(d){ return d.date; }),
        datasets: [
          { label: "总排班", data: data.map(function(d){ return d.total; }), borderColor: "#3b82f6", tension: 0.2, fill: false },
          { label: "已完成", data: data.map(function(d){ return d.completed; }), borderColor: "#10b981", tension: 0.2, fill: false }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });
  }
}

function renderScatterChart(w, data) {
  destroyWidgetChart(w.id);
  var card = document.getElementById("widget-" + w.id);
  var body = card ? card.querySelector(".summary-widget-body") : null;
  // 清理旧百分比条
  var oldBar = body ? body.querySelector(".percent-bar") : null;
  if (oldBar) { oldBar.remove(); }
  var canvas = ensureCanvas(w);
  canvas.style.maxHeight = "260px";

  if (w.id === "repair_frequency") {
    var machines = data.machines || [];
    var events = data.events || [];
    if (machines.length === 0 || events.length === 0) {
      renderEmptyWidget(w, "暂无维修记录");
      return;
    }
    // 收集唯一日期并排序
    var dateSet = {}, dates = [];
    for (var i = 0; i < events.length; i++) {
      if (!dateSet[events[i].date]) { dates.push(events[i].date); dateSet[events[i].date] = true; }
    }
    dates.sort();
    var dateIdx = {}; for (var di = 0; di < dates.length; di++) { dateIdx[dates[di]] = di; }
    // 机器名 → Y 索引
    var machineIdx = {}; for (var mi = 0; mi < machines.length; mi++) { machineIdx[machines[mi]] = mi; }
    // 时长 → 气泡半径映射 (min 5px, max 18px)
    var maxDur = 0; for (var ei = 0; ei < events.length; ei++) { if (events[ei].duration_min > maxDur) maxDur = events[ei].duration_min; }
    var points = events.map(function(e) {
      return { x: dateIdx[e.date], y: machineIdx[e.machine_name], r: 5 + (e.duration_min / (maxDur || 1)) * 13, date: e.date, machine: e.machine_name, duration: e.duration_min };
    });
    SUMMARY_CHARTS[w.id] = new Chart(canvas, {
      type: "bubble",
      data: {
        datasets: [
          { label: "维修事件", data: points, backgroundColor: "rgba(239, 68, 68, 0.55)", borderColor: "#ef4444", borderWidth: 1 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function(items) { var r = items[0].raw; return r ? r.machine + " | " + r.date : ""; },
              label: function(item) { var r = item.raw; return r ? "单次维修 " + r.duration + " 分钟" : ""; }
            }
          }
        },
        scales: {
          x: {
            type: "linear", min: -0.5, max: dates.length - 0.5,
            ticks: { stepSize: 1, callback: function(v) { return dates[v] ? dates[v].slice(5) : ""; } }
          },
          y: {
            type: "category", labels: machines,
            ticks: { autoSkip: false }
          }
        }
      }
    });
    return;
  }

  var events = data.events || [];
  var typeList = data.type_list || [];
  if (typeList.length === 0) {
    renderEmptyWidget(w, "当天无推送事件");
    return;
  }
  var yLabels = typeList;
  var byType = data.by_type || {};
  var successPoints = [];
  var failPoints = [];
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    var pt = { x: e.minute, y: e.y_row, time: e.time, eventType: e.event_type, success: e.success };
    if (e.success) { successPoints.push(pt); } else { failPoints.push(pt); }
  }
  SUMMARY_CHARTS[w.id] = new Chart(canvas, {
    type: "scatter",
    data: {
      datasets: [
        { label: "成功", data: successPoints, backgroundColor: "#10b98180", borderColor: "#10b981", pointRadius: 4, pointHoverRadius: 7 },
        { label: "失败", data: failPoints, backgroundColor: "#ef444480", borderColor: "#ef4444", pointRadius: 4, pointHoverRadius: 7 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: {
          callbacks: {
            title: function(items) { var r = items[0].raw; return r ? r.time : ""; },
            label: function(item) {
              var r = item.raw;
              return r.eventType + " " + (r.success ? "✓成功" : "✗失败") + " " + r.time;
            }
          }
        }
      },
      scales: {
        x: {
          type: "linear", min: data.x_min || 0, max: data.x_max || 1440,
          ticks: { stepSize: 120, callback: function(v) { var hh = Math.floor((v % 1440) / 60); var mm = (v % 1440) % 60; return hh + ":" + (mm < 10 ? "0" : "") + mm; } }
        },
        y: {
          type: "linear", min: -0.5, max: yLabels.length - 0.5,
          ticks: { stepSize: 1, callback: function(v) { return yLabels[v] || ""; } }
        }
      }
    }
  });

  // ── 成功/失败 计数 ──
  var successCount = successPoints.length;
  var failCount = failPoints.length;
  var grandTotal = data.total || 0;

  // ── 百分比矩形条：各事件类型占比 ──
  var typeEntries = Object.entries(byType).sort(function(a, b) { return b[1].total - a[1].total; });
  if (grandTotal > 0 && typeEntries.length > 0) {
    // 清理旧计数行
    var oldCount = body ? body.querySelector(".push-count-row") : null;
    if (oldCount) { oldCount.remove(); }
    // 成功/失败 计数行
    var countDiv = document.createElement("div");
    countDiv.className = "push-count-row";
    countDiv.style.cssText = "display:flex;gap:16px;padding:8px 12px 0 12px;font-size:12px;";
    countDiv.innerHTML =
      '<span style="color:#10b981;">✓ 成功 <strong>' + successCount + '</strong></span>' +
      '<span style="color:#ef4444;">✗ 失败 <strong>' + failCount + '</strong></span>' +
      '<span style="color:var(--text-secondary);">共 <strong>' + grandTotal + '</strong> 条</span>';
    body.appendChild(countDiv);

    var barDiv = document.createElement("div");
    barDiv.className = "percent-bar";
    barDiv.style.cssText = "display:flex;height:22px;border-radius:4px;overflow:hidden;margin:6px 12px 0 12px;font-size:11px;line-height:22px;";
    var colors10 = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#06b6d4","#84cc16","#f97316","#6366f1"];
    for (var i = 0; i < typeEntries.length; i++) {
      var label = typeEntries[i][0];
      var info = typeEntries[i][1];
      var pct = Math.round(info.total / grandTotal * 1000) / 10;
      if (pct < 1) { break; }
      var seg = document.createElement("div");
      seg.style.cssText = "flex:" + info.total + ";background:" + colors10[i % colors10.length] + ";text-align:center;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;padding:0 4px;";
      seg.title = label + " " + pct + "% (" + info.total + "次)";
      seg.textContent = pct + "% " + label;
      barDiv.appendChild(seg);
    }
    body.appendChild(barDiv);
  }
}

function renderBarChart(w, data) {
  destroyWidgetChart(w.id);
  var canvas = ensureCanvas(w);
  if (w.id === "weekday_load") {
    SUMMARY_CHARTS[w.id] = new Chart(canvas, {
      type: "bar",
      data: {
        labels: data.map(function(d){ return d.label; }),
        datasets: [
          { label: "总排班", data: data.map(function(d){ return d.total; }), backgroundColor: "#93c5fd" },
          { label: "已完成", data: data.map(function(d){ return d.completed; }), backgroundColor: "#6ee7b7" }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });
  }
}

function renderHBarChart(w, data) {
  destroyWidgetChart(w.id);
  var canvas = ensureCanvas(w);
  if (w.id === "machine_utilization") {
    SUMMARY_CHARTS[w.id] = new Chart(canvas, {
      type: "bar",
      data: {
        labels: data.map(function(d){ return d.machine_name; }),
        datasets: [{ label: "利用率 %", data: data.map(function(d){ return d.utilization_pct; }), backgroundColor: "#93c5fd" }]
      },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  } else if (w.id === "estimate_vs_actual") {
    // 水平堆叠：底层=min(预估,实际)，上层=|偏差|（短段在上）
    var topN = data.slice(0, 30);
    var labels = topN.map(function(d){
      var label = (d.task_name||"") + "@" + (d.machine_name||"");
      return label.length > 25 ? label.slice(0, 24) + "…" : label;
    });
    var baseVals = [];
    var overVals = [];
    var overColors = [];
    for (var i = 0; i < topN.length; i++) {
      var est = topN[i].est_min || 0;
      var act = topN[i].actual_min || 0;
      baseVals.push(Math.min(est, act));
      var delta = act - est;
      overVals.push(Math.abs(delta));
      overColors.push(delta > 0 ? "#ef4444" : "#10b981");  // 超时=红，提前=绿
    }
    SUMMARY_CHARTS[w.id] = new Chart(canvas, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          { label: "按时完成", data: baseVals, backgroundColor: "#93c5fd" },
          { label: "偏差", data: overVals, backgroundColor: overColors }
        ]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { return (ctx.datasetIndex===0?"基准":"偏差")+": "+ctx.raw+" min"; } } } },
        scales: { x: { stacked: true }, y: { stacked: true, ticks: { font: { size: 10 } } } }
      }
    });
  } else if (w.id === "repair_summary") {
    // 堆叠水平柱：每段是一次维修
    var maxRepairs = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i].repairs.length > maxRepairs) maxRepairs = data[i].repairs.length;
    }
    var labels = data.map(function(d){ return d.machine_name; });
    var datasets = [];
    for (var pos = 0; pos < maxRepairs; pos++) {
      var vals = data.map(function(d){ return d.repairs[pos] || 0; });
      // 越早的维修颜色越深
      var alpha = 0.3 + (pos / Math.max(maxRepairs, 1)) * 0.7;
      datasets.push({
        label: "维修 #" + (pos + 1),
        data: vals,
        backgroundColor: "rgba(139, 92, 246, " + alpha.toFixed(2) + ")",
        borderColor: "rgba(255,255,255,0.5)",
        borderWidth: 1
      });
    }
    SUMMARY_CHARTS[w.id] = new Chart(canvas, {
      type: "bar",
      data: { labels: labels, datasets: datasets },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(ctx) { return ctx.dataset.label + ": " + ctx.raw + " min"; } } } },
        scales: { x: { stacked: true, title: { display: true, text: "维修时长 (min)" } }, y: { stacked: true } }
      }
    });
  }
}

var STATUS_COLORS = {"空闲": "#3b82f6", "工作": "#10b981", "维修停用": "#ef4444"};

function renderDoughnutChart(w, data) {
  destroyWidgetChart(w.id);
  var canvas = ensureCanvas(w);
  var totals = data.total || {};
  var labels = Object.keys(totals);
  var values = labels.map(function(k){ return totals[k]; });
  var bg = w.id === "machine_status"
    ? labels.map(function(k){ return STATUS_COLORS[k] || "#9ca3af"; })
    : COLORS10.slice(0, labels.length);
  SUMMARY_CHARTS[w.id] = new Chart(canvas, {
    type: "doughnut",
    data: { labels: labels, datasets: [{ data: values, backgroundColor: bg }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
  });
}

function renderMixedChart(w, data) {
  destroyWidgetChart(w.id);
  var canvas = ensureCanvas(w);
  var byType = data.by_type || {};
  var keys = Object.keys(byType);
  SUMMARY_CHARTS[w.id] = new Chart(canvas, {
    type: "bar",
    data: {
      labels: ["异常分布"],
      datasets: keys.map(function(k, i){ return { label: k, data: [byType[k]], backgroundColor: COLORS10[i % COLORS10.length] }; })
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { x: { stacked: true }, y: { stacked: true } } }
  });
}

function renderHistogramChart(w, data) {
  destroyWidgetChart(w.id);
  var canvas = ensureCanvas(w);
  function bucket(arr) {
    var b = {};
    for (var i = 0; i < arr.length; i++) {
      var k = Math.floor(arr[i].delta / 10) * 10;
      b[k] = (b[k] || 0) + 1;
    }
    return b;
  }
  var sB = bucket(data.start_deviations || []);
  var eB = bucket(data.end_deviations || []);
  var allKeys = Object.keys(sB).concat(Object.keys(eB)).map(Number);
  allKeys = Array.from(new Set(allKeys)).sort(function(a,b){ return a-b; });
  SUMMARY_CHARTS[w.id] = new Chart(canvas, {
    type: "bar",
    data: {
      labels: allKeys.map(function(k){ return k + "min"; }),
      datasets: [
        { label: "开始偏差", data: allKeys.map(function(k){ return sB[k] || 0; }), backgroundColor: "#93c5fd" },
        { label: "结束偏差", data: allKeys.map(function(k){ return eB[k] || 0; }), backgroundColor: "#fca5a5" }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
  });
}

function heatmapColor(intensity) {
  // 0→1: 浅绿 → 墨绿
  var stops = [
    [0.0, [228, 248, 235]],   // 浅绿
    [0.25, [116, 200, 140]],  // 中绿
    [0.5, [34, 160, 85]],     // 绿
    [0.75, [15, 118, 55]],    // 深绿
    [1.0, [5, 70, 30]]        // 墨绿
  ];
  var lo = stops[0], hi = stops[stops.length - 1];
  for (var i = 0; i < stops.length - 1; i++) {
    if (intensity >= stops[i][0] && intensity <= stops[i+1][0]) {
      lo = stops[i]; hi = stops[i+1]; break;
    }
  }
  var t = (intensity - lo[0]) / (hi[0] - lo[0] || 0.01);
  t = Math.max(0, Math.min(1, t));
  var r = Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * t);
  var g = Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * t);
  var b = Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * t);
  return "rgb(" + r + "," + g + "," + b + ")";
}

function renderHeatmap(w, data) {
  destroyWidgetChart(w.id);
  var canvas = ensureCanvas(w);
  var body = canvas.parentElement;
  body.innerHTML = "";
  var dates = [], dateSet = {};
  for (var i = 0; i < data.length; i++) {
    if (!dateSet[data[i].date]) { dates.push(data[i].date); dateSet[data[i].date] = true; }
  }
  var matrix = {};
  for (var j = 0; j < data.length; j++) { matrix[data[j].date + "|" + data[j].hour] = data[j].count; }
  var maxCount = 0;
  for (var k = 0; k < data.length; k++) { if (data[k].count > maxCount) maxCount = data[k].count; }
  var table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;font-size:11px;";
  var thead = document.createElement("thead");
  var hr = document.createElement("tr");
  var th0 = document.createElement("th"); th0.textContent = ""; th0.style.cssText = "padding:3px 5px;"; hr.appendChild(th0);
  for (var h = 0; h < 24; h++) {
    var th = document.createElement("th"); th.textContent = h + "h"; th.style.cssText = "padding:3px 5px;font-weight:400;font-size:10px;color:var(--text-secondary);"; hr.appendChild(th);
  }
  thead.appendChild(hr); table.appendChild(thead);
  var tbody = document.createElement("tbody");
  for (var di = 0; di < dates.length; di++) {
    var tr = document.createElement("tr");
    var td0 = document.createElement("td"); td0.textContent = dates[di].slice(5); td0.style.cssText = "padding:3px 5px;font-size:10px;white-space:nowrap;"; tr.appendChild(td0);
    for (var h2 = 0; h2 < 24; h2++) {
      var td = document.createElement("td");
      var cnt = matrix[dates[di] + "|" + h2] || 0;
      var intensity = maxCount > 0 ? cnt / maxCount : 0;
      td.style.cssText = "padding:3px 5px;text-align:center;" + (cnt > 0 ? "background:" + heatmapColor(intensity) + ";color:" + (intensity > 0.5 ? "#fff" : "#374151") : "") + ";font-size:12px;";
      td.textContent = cnt || "";
      td.title = dates[di] + " " + h2 + ":00 — " + cnt + " 个完成";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  body.appendChild(table);
}

function renderTableWidget(w, data) {
  destroyWidgetChart(w.id);
  var canvas = ensureCanvas(w);
  var body = canvas.parentElement;
  body.innerHTML = "";
  if (!data || data.length === 0) {
    body.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px;">暂无数据</p>';
    return;
  }
  var table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px;";
  if (w.id === "overdue_tasks") {
    var rows = data.slice(0, 20).map(function(r){
      var hh = Math.floor(r.overdue_min / 60), mm = r.overdue_min % 60;
      return "<tr style='border-bottom:1px solid var(--border);'><td style='padding:4px;'>"+escHtml(r.task_name)+"</td><td style='padding:4px;'>"+escHtml(r.machine_name)+"</td><td style='padding:4px;'>"+r.date+"</td><td style='padding:4px;color:#ef4444;'>"+hh+"h"+mm+"m</td></tr>";
    }).join("");
    table.innerHTML = "<thead><tr style='border-bottom:1px solid var(--border);'><th style='text-align:left;padding:4px;'>任务</th><th style='text-align:left;padding:4px;'>机器</th><th style='text-align:left;padding:4px;'>日期</th><th style='text-align:left;padding:4px;'>超时</th></tr></thead><tbody>"+rows+"</tbody>";
  } else {
    var rows2 = data.map(function(r){
      return "<tr style='border-bottom:1px solid var(--border);'><td style='padding:4px;'>"+escHtml(r.task_name)+"</td><td style='padding:4px;'>"+escHtml(r.machine_name)+"</td><td style='padding:4px;font-size:11px;'>"+r.start_str+"~"+r.end_str+"</td><td style='padding:4px;'>"+r.span_days+"天</td></tr>";
    }).join("");
    table.innerHTML = "<thead><tr style='border-bottom:1px solid var(--border);'><th style='text-align:left;padding:4px;'>任务</th><th style='text-align:left;padding:4px;'>机器</th><th style='text-align:left;padding:4px;'>排班时间</th><th style='text-align:left;padding:4px;'>跨天</th></tr></thead><tbody>"+rows2+"</tbody>";
  }
  body.appendChild(table);
}

// ── 小饼图矩阵：每台机器一个 doughnut ──
function renderPieGrid(w, data) {
  destroyWidgetChart(w.id);
  // 清理旧的小 chart 实例
  var oldKey = "_piegrid_" + w.id;
  if (SUMMARY_CHARTS[oldKey]) {
    for (var oi = 0; oi < SUMMARY_CHARTS[oldKey].length; oi++) {
      if (SUMMARY_CHARTS[oldKey][oi]) SUMMARY_CHARTS[oldKey][oi].destroy();
    }
    delete SUMMARY_CHARTS[oldKey];
  }
  var card = document.getElementById("widget-" + w.id);
  var body = card ? card.querySelector(".summary-widget-body") : null;
  if (body) { body.innerHTML = ""; }
  if (!data || data.length === 0) {
    body.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px;">暂无数据</p>';
    return;
  }

  // 按利用率降序，取前 24 台
  var sorted = data.slice().sort(function(a,b){ return (b.utilization_pct||0) - (a.utilization_pct||0); });
  var items = sorted.slice(0, 24).filter(function(d){ return (d.utilization_pct||0) > 0; });

  if (items.length === 0) {
    body.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px;">无排班数据</p>';
    return;
  }

  var grid = document.createElement("div");
  grid.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:flex-start;";
  body.appendChild(grid);

  var typeColors = _readTypeColors();
  var charts = [];

  for (var i = 0; i < items.length; i++) {
    var d = items[i];
    var pct = d.utilization_pct || 0;
    var remaining = Math.max(100 - pct, 0);

    var wrapper = document.createElement("div");
    wrapper.style.cssText = "display:flex;flex-direction:column;align-items:center;width:100px;";
    var label = document.createElement("span");
    label.style.cssText = "font-size:10px;color:var(--text-secondary);text-align:center;line-height:1.2;margin-bottom:2px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    label.textContent = d.machine_name;
    label.title = d.machine_name + " — " + d.type;
    wrapper.appendChild(label);

    var cvs = document.createElement("canvas");
    cvs.width = 80; cvs.height = 80;
    cvs.style.cssText = "width:80px;height:80px;";
    wrapper.appendChild(cvs);

    var pctLabel = document.createElement("span");
    pctLabel.style.cssText = "font-size:11px;font-weight:600;margin-top:-18px;z-index:1;";
    pctLabel.textContent = pct + "%";
    wrapper.appendChild(pctLabel);

    var color = typeColors[d.type] || typeColors._fallback || "#3b82f6";

    var chart = new Chart(cvs, {
      type: "doughnut",
      data: {
        datasets: [{
          data: [pct, remaining],
          backgroundColor: [color, "#e5e7eb"],
          borderWidth: 0,
          cutout: "70%"
        }]
      },
      options: {
        responsive: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        events: []
      }
    });
    charts.push(chart);
    grid.appendChild(wrapper);
  }

  SUMMARY_CHARTS[oldKey] = charts;
}

// ── 矩形树图（手写 squarified treemap） ──
// 读取设置的机器类型颜色，与排班面板保持一致
function _readTypeColors() {
  try {
    var raw = localStorage.getItem("_schedule_color_types");
    if (raw) {
      var colors = JSON.parse(raw);
      // 第一个色作为缺省兜底
      var vals = Object.values(colors);
      colors._fallback = vals.length > 0 ? vals[0] : "#3b82f6";
      return colors;
    }
  } catch (e) {}
  return { _fallback: "#3b82f6" };
}

// ── 任务段环形渲染 ──

// 从 CSS 变量读颜色，带硬编码兜底
function _ringCSS(varName, fallback) {
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (v) return v;
  } catch (e) {}
  return fallback;
}

function _getTaskRingColor(task, machineType, machineStatus) {
  if (task.status === 'completed') return _ringCSS('--state-color-completed', '#84cc16');
  if (machineStatus === '维修停用') {
    if (task.status === '暂停中') return _ringCSS('--state-color-paused', '#fca5a5');
    return _ringCSS('--state-color-post-pause', '#fbcfe8');
  }
  if (task.split_group) return _ringCSS('--state-color-split', '#a78bfa');
  var tc = _readTypeColors();
  return tc[machineType] || tc._fallback || '#3b82f6';
}

function _drawTaskRingSVG(machine, shiftAvailable, currentTimeMin, showRedLine) {
  var tasks = machine.tasks || [];
  var repairs = machine.repairs || [];
  var machineStatus = machine.machine_status || '空闲';
  var machineType = machine.type || 'BR2';
  var pct = machine.utilization_pct || 0;

  var svgNs = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', '100');
  svg.setAttribute('height', '100');

  var cx = 50, cy = 50, r = 40, sw = 11;
  var circumference = 2 * Math.PI * r;

  // 底环
  var bg = document.createElementNS(svgNs, 'circle');
  bg.setAttribute('cx', cx); bg.setAttribute('cy', cy); bg.setAttribute('r', r);
  bg.setAttribute('fill', 'none');
  bg.setAttribute('stroke', 'var(--border, #e2e8f0)');
  bg.setAttribute('stroke-width', sw);
  svg.appendChild(bg);

  // 任务段
  var cumul = 0;
  for (var i = 0; i < tasks.length; i++) {
    var task = tasks[i];
    var wm = task.working_min || 0;
    if (wm <= 0) continue;

    var dashLen = (wm / shiftAvailable) * circumference;
    if (dashLen < 0.5) dashLen = 0.5; // 极小段也可见

    var color = _getTaskRingColor(task, machineType, machineStatus);

    var seg = document.createElementNS(svgNs, 'circle');
    seg.setAttribute('cx', cx); seg.setAttribute('cy', cy); seg.setAttribute('r', r);
    seg.setAttribute('fill', 'none'); seg.setAttribute('stroke', color); seg.setAttribute('stroke-width', sw);
    seg.setAttribute('pointer-events', 'stroke');
    seg.setAttribute('stroke-dasharray', dashLen.toFixed(1) + ' ' + (circumference - dashLen).toFixed(1));
    seg.setAttribute('transform', 'rotate(-90 ' + cx + ' ' + cy + ')');
    if (cumul > 0) seg.setAttribute('stroke-dashoffset', (-cumul).toFixed(1));

    // hover 数据
    seg.setAttribute('data-task-name', task.name || '');
    seg.setAttribute('data-task-status', task.status || '');
    seg.setAttribute('data-task-status', task.status || '');
    seg.setAttribute('data-task-start', task.start_min || 0);
    seg.setAttribute('data-task-end', task.end_min || 0);
    seg.style.cursor = 'pointer';

    seg.addEventListener('mouseenter', function(ev) {
      var n = this.getAttribute('data-task-name') || '';
      var st = this.getAttribute('data-task-status') || '';
      var sm = parseInt(this.getAttribute('data-task-start')) || 0;
      var em = parseInt(this.getAttribute('data-task-end')) || 0;
      var sh = Math.floor(sm / 60), smm = sm % 60;
      var eh = Math.floor(em / 60), emm = em % 60;
      var pad2 = function(v) { return (v < 10 ? '0' : '') + v; };
      var timeStr = pad2(sh) + ':' + pad2(smm) + '-' + pad2(eh) + ':' + pad2(emm);
      var statusMap = { 'completed':'已完成', 'executing':'采集中', 'split':'切割', '暂停中':'暂停中' };
      _showRingTooltip(ev, n, statusMap[st] || st, timeStr);
    });
    seg.addEventListener('mouseleave', function() { _hideRingTooltip(); });

    svg.appendChild(seg);

    // 维修粉疊（维修停用跳过，已完成跳过）
    if (machineStatus !== '维修停用' && task.status !== 'completed' && repairs.length > 0) {
      for (var ri = 0; ri < repairs.length; ri++) {
        var rp = repairs[ri];
        var ovS = Math.max(task.start_min, rp.start_min);
        var ovE = Math.min(task.end_min, rp.end_min);
        if (ovE > ovS) {
          var ovLen = ((ovE - ovS) / shiftAvailable) * circumference;
          var ovOff = cumul + ((ovS - task.start_min) / wm) * dashLen;
          var ov = document.createElementNS(svgNs, 'circle');
          ov.setAttribute('cx', cx); ov.setAttribute('cy', cy); ov.setAttribute('r', r - 6);
          ov.setAttribute('fill', 'none'); ov.setAttribute('stroke', 'rgba(219,39,119,0.45)');
          ov.setAttribute('stroke-width', '7');
          ov.setAttribute('stroke-dasharray', ovLen.toFixed(1) + ' ' + (circumference - ovLen).toFixed(1));
          ov.setAttribute('stroke-dashoffset', (-ovOff).toFixed(1));
          ov.setAttribute('transform', 'rotate(-90 ' + cx + ' ' + cy + ')');
          svg.appendChild(ov);
        }
      }
    }

    cumul += dashLen;
  }

  // 当前时间红线：在当前任务段内的百分比位置
  var redLineAngle = null;
  if (showRedLine && currentTimeMin !== null) {
    for (var ti = 0; ti < tasks.length; ti++) {
      var t = tasks[ti];
      if (currentTimeMin >= t.start_min && currentTimeMin < t.end_min) {
        // 当前时间在这个任务段内的进度
        var taskProgress = (currentTimeMin - t.start_min) / (t.end_min - t.start_min);
        // 该任务段在环形上的起始偏移 + 任务内进度
        var redLineOffset = 0;
        for (var sj = 0; sj < ti; sj++) {
          redLineOffset += ((tasks[sj].working_min || 0) / shiftAvailable) * circumference;
        }
        redLineOffset += taskProgress * ((t.working_min || 0) / shiftAvailable) * circumference;
        redLineAngle = (redLineOffset / circumference) * 360;
        break;
      }
    }
  }
  if (redLineAngle !== null) {
    var line = document.createElementNS(svgNs, 'line');
    line.setAttribute('x1', cx); line.setAttribute('y1', cy);
    line.setAttribute('x2', cx); line.setAttribute('y2', cy - r + 3);
    line.setAttribute('stroke', '#ef4444'); line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '2 2'); line.setAttribute('opacity', '0.85');
    line.setAttribute('transform', 'rotate(' + redLineAngle + ' ' + cx + ' ' + cy + ')');
    svg.appendChild(line);
    var dot = document.createElementNS(svgNs, 'circle');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy - r + 3); dot.setAttribute('r', '2.5');
    dot.setAttribute('fill', '#ef4444');
    dot.setAttribute('transform', 'rotate(' + redLineAngle + ' ' + cx + ' ' + cy + ')');
    svg.appendChild(dot);
  }

  // 中心百分比（颜色跟随主题，用 CSS 变量引用）
  var txt = document.createElementNS(svgNs, 'text');
  txt.setAttribute('x', cx); txt.setAttribute('y', cy + 3);
  txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('font-size', '20');
  txt.setAttribute('font-weight', '800');
  txt.setAttribute('fill', 'var(--text-primary, #1f2937)');
  txt.textContent = Math.round(pct) + '%';
  svg.appendChild(txt);

  return svg;
}

// tooltip
var _ringTip = null;
function _showRingTooltip(ev, name, status, timeStr) {
  _hideRingTooltip();
  var tip = document.createElement('div');
  var safeName = (typeof escHtml === 'function') ? escHtml(name || '') : (name || '');
  tip.innerHTML = '<div style="font-weight:700;font-size:13px;margin-bottom:2px;">' + safeName + '</div><div style="font-size:12px;color:#d1d5db;">' + timeStr + ' · ' + status + '</div>';
  tip.style.cssText = 'position:fixed;z-index:9999;background:#1f2937;color:#fff;padding:8px 12px;border-radius:6px;font-size:13px;line-height:1.7;pointer-events:none;left:' + (ev.clientX + 10) + 'px;top:' + (ev.clientY - 10) + 'px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
  document.body.appendChild(tip);
  _ringTip = tip;
}
function _hideRingTooltip() {
  if (_ringTip) { _ringTip.remove(); _ringTip = null; }
}

var _dynTaskStatuses = {}; // 动态任务状态缓存

function renderTaskRing(w, data) {
  destroyWidgetChart(w.id);
  var card = document.getElementById("widget-" + w.id);
  var body = card ? card.querySelector(".summary-widget-body") : null;
  if (body) { body.innerHTML = ""; }
  if (!data) {
    if (body) body.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px;">暂无数据</p>';
    return;
  }

  // data 现在是 {machines: [...], available: N}
  var machines = data.machines || data; // 兼容旧格式
  var available = data.available || 570;

  if (!Array.isArray(machines) || machines.length === 0) {
    if (body) body.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px;">暂无数据</p>';
    return;
  }

  var items = machines.filter(function(d) { return (d.utilization_pct || 0) > 0; });
  if (items.length === 0) {
    if (body) body.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px;">无排班数据</p>';
    return;
  }
  items.sort(function(a, b) { return (b.utilization_pct || 0) - (a.utilization_pct || 0); });

  // 合并动态任务状态（暂停中等）
  for (var i = 0; i < items.length; i++) {
    var tasks = items[i].tasks || [];
    for (var j = 0; j < tasks.length; j++) {
      var tid = tasks[j].task_id;
      if (tid && _dynTaskStatuses[tid]) {
        tasks[j].status = _dynTaskStatuses[tid];
      }
    }
  }

  var showRedLine = false;
  var currentTimeMin = null; // 绝对分钟（从 00:00 起），与 task.start_min/end_min 同一参考系
  var markerCb = document.getElementById('show-current-marker');
  if (markerCb) { showRedLine = markerCb.checked; }
  if (showRedLine) {
    var now = new Date();
    currentTimeMin = now.getHours() * 60 + now.getMinutes();
  }

  var grid = document.createElement("div");
  grid.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:flex-start;";
  body.appendChild(grid);

  for (var i = 0; i < items.length; i++) {
    var m = items[i];
    var wrapper = document.createElement("div");
    wrapper.style.cssText = "display:flex;flex-direction:column;align-items:center;width:100px;";
    var label = document.createElement("span");
    label.style.cssText = "font-size:10px;color:var(--text-secondary);text-align:center;line-height:1.2;margin-bottom:2px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    label.textContent = m.machine_name;
    label.title = m.machine_name;
    wrapper.appendChild(label);
    wrapper.appendChild(_drawTaskRingSVG(m, available, currentTimeMin, showRedLine));
    grid.appendChild(wrapper);
  }
}

function renderTreemap(w, data) {
  destroyWidgetChart(w.id);
  var canvas = ensureCanvas(w);
  var body = canvas.parentElement;
  body.innerHTML = "";
  if (!data || data.length === 0) {
    body.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px;">暂无数据</p>';
    return;
  }
  // 取有利用率的机器，按利用率降序
  var items = [];
  for (var i = 0; i < data.length; i++) {
    var v = data[i].utilization_pct || 0;
    if (v <= 0) continue;
    items.push({
      name: data[i].machine_name,
      value: Math.round(v * 10) / 10,
      type: data[i].type || "未知",
      tasks: data[i].task_count || 0
    });
  }
  if (items.length === 0) {
    body.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px;">无排班数据</p>';
    return;
  }

  // 按机器类型取颜色（与排班面板保持一致）
  var typeColors = _readTypeColors();

  var totalValue = 0;
  for (var si = 0; si < items.length; si++) { totalValue += items[si].value; }

  var container = document.createElement("div");
  container.style.cssText = "position:relative;width:100%;height:360px;border-radius:4px;overflow:hidden;";
  body.appendChild(container);

  // squarified treemap algorithm
  function worstAspect(areas, side1, side2) {
    if (areas.length === 0) return Infinity;
    var s = 0; for (var ai = 0; ai < areas.length; ai++) s += areas[ai];
    if (s <= 0 || side1 <= 0 || side2 <= 0) return Infinity;
    var r1 = (side1 * side1 * areas[areas.length - 1]) / (s * s);
    var r2 = (s * s) / (side1 * side1 * areas[areas.length - 1]);
    return Math.max(r1, r2);
  }

  function layoutRow(areas, x, y, w, h) {
    var s = 0; for (var ai = 0; ai < areas.length; ai++) s += areas[ai];
    var rects = [];
    if (w <= h) {
      var step = s / h;
      var py = y;
      for (var ai = 0; ai < areas.length; ai++) {
        var sz = areas[ai] / step;
        rects.push({ x: x, y: py, w: w, h: sz });
        py += sz;
      }
    } else {
      var step = s / w;
      var px = x;
      for (var ai = 0; ai < areas.length; ai++) {
        var sz = areas[ai] / step;
        rects.push({ x: px, y: y, w: sz, h: h });
        px += sz;
      }
    }
    return rects;
  }

  function squarify(vals, x, y, w, h) {
    if (vals.length === 0) return [];
    if (vals.length === 1) return [{ x: x, y: y, w: w, h: h }];
    var row = [vals[0]];
    var idx = 1;
    var short = Math.min(w, h);
    var long = Math.max(w, h);
    while (idx < vals.length) {
      var withNext = row.concat([vals[idx]]);
      if (worstAspect(withNext, short, long) <= worstAspect(row, short, long)) {
        row.push(vals[idx]);
        idx++;
      } else {
        break;
      }
    }
    var s = 0; for (var ri = 0; ri < row.length; ri++) s += row[ri];
    var rects;
    if (w <= h) {
      var rowH = (h * s) / totalValue;
      rects = layoutRow(row, x, y, w, rowH);
      var rest = squarify(vals.slice(idx), x, y + rowH, w, h - rowH);
    } else {
      var rowW = (w * s) / totalValue;
      rects = layoutRow(row, x, y, rowW, h);
      var rest = squarify(vals.slice(idx), x + rowW, y, w - rowW, h);
    }
    return rects.concat(rest);
  }

  var vals = items.map(function(d){ return d.value; });
  var rectW = container.clientWidth || 400;
  var rectH = 360;
  var rects = squarify(vals, 0, 0, rectW, rectH);

  for (var ri = 0; ri < rects.length; ri++) {
    var rc = rects[ri];
    var it = items[ri];
    var bg = typeColors[it.type] || typeColors._fallback || "#3b82f6";
    var box = document.createElement("div");
    var minDim = Math.min(rc.w, rc.h);
    box.style.cssText = "position:absolute;left:" + rc.x + "px;top:" + rc.y + "px;width:" + Math.max(rc.w - 2, 1) + "px;height:" + Math.max(rc.h - 2, 1) + "px;" +
      "background:" + bg + ";border:1px solid rgba(255,255,255,0.6);display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "font-size:" + (minDim > 40 ? "11px" : minDim > 25 ? "9px" : "7px") + ";color:#fff;overflow:hidden;text-align:center;line-height:1.3;" +
      "text-shadow:0 1px 3px rgba(0,0,0,0.4);cursor:default;";
    box.title = it.name + "\n类型: " + it.type + "\n利用率: " + it.value + "%\n排班数: " + it.tasks;
    if (minDim > 30) {
      box.innerHTML = "<strong>" + escHtml(it.name) + "</strong><span>" + it.value + "%</span>";
    } else if (minDim > 18) {
      box.innerHTML = "<span>" + it.value + "%</span>";
    }
    container.appendChild(box);
  }
}

function renderEmptyWidget(w, msg) {
  destroyWidgetChart(w.id);
  var canvas = ensureCanvas(w);
  canvas.parentElement.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px;">' + (msg || "暂无数据") + '</p>';
}

// ── 折叠 ──
function toggleWidget(widgetId) {
  var card = document.getElementById("widget-" + widgetId);
  if (!card) return;
  var body = card.querySelector(".summary-widget-body");
  var toggle = card.querySelector(".summary-widget-toggle");
  if (body.style.display === "none") { body.style.display = ""; if(toggle) toggle.textContent = "▼"; }
  else { body.style.display = "none"; if(toggle) toggle.textContent = "▶"; }
}

// ── 发送 ──
async function summarySendReport() {
  var date = summaryGetDate();
  var shift = summaryGetShift();
  if (!date) { showToast("请先选择日期和班次"); return; }
  var ok = await showConfirm('发送班次报告', '<p>确认发送 <b>' + date + ' ' + shift + '</b> 报告？</p>');
  if (!ok) return;
  var sendResp = await fetch("/api/summary/send-report", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({date: date, shift: shift})
  });
  var result = await sendResp.json();
  if (result.success) {
    showToast("✅ 报告已发送");
    document.getElementById("summary-sent-badge").style.display = "";
    document.getElementById("summary-sent-badge").textContent = "✅ 已发送";
  } else {
    showToast("❌ 发送失败: " + ((result.errors||[]).map(function(e){return e.error;}).join(", ")));
  }
}

// ── 截图样式切换 ──
var _screenshotStyle = "timeline";

function selectScreenshotStyle(style) {
  _screenshotStyle = style;
  var tBtn = document.getElementById("style-tab-timeline");
  var bBtn = document.getElementById("style-tab-table");
  var sendBtn = document.getElementById("btn-send-screenshot");
  if (style === 'timeline') {
    if (tBtn) { tBtn.style.background = '#fff'; tBtn.style.color = '#333'; tBtn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)'; tBtn.style.fontWeight = '500'; }
    if (bBtn) { bBtn.style.background = 'transparent'; bBtn.style.color = '#888'; bBtn.style.boxShadow = 'none'; bBtn.style.fontWeight = 'normal'; }
    if (sendBtn) sendBtn.textContent = '📸 发送时间轴截图';
  } else {
    if (bBtn) { bBtn.style.background = '#fff'; bBtn.style.color = '#333'; bBtn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.08)'; bBtn.style.fontWeight = '500'; }
    if (tBtn) { tBtn.style.background = 'transparent'; tBtn.style.color = '#888'; tBtn.style.boxShadow = 'none'; tBtn.style.fontWeight = 'normal'; }
    if (sendBtn) sendBtn.textContent = '📸 发送表格截图';
  }
}

// ── 发送排班截图 ──
async function summarySendScreenshot() {
  var btn = document.getElementById("btn-send-screenshot");
  if (!btn || btn.disabled) return;

  var date = summaryGetDate();
  var shift = summaryGetShift();
  if (!date) { showToast("请先选择日期和班次"); return; }

  var style = _screenshotStyle;

  btn.disabled = true;
  btn.textContent = '截图中...';

  // 遮罩
  if (typeof _showExportOverlay === 'function') _showExportOverlay('正在生成截图...', false);

  var blob = null;
  try {
    if (style === 'table') {
      // 样式二：服务端 Pillow 表格截图
      var resp = await fetch('/api/summary/table-screenshot?date=' + encodeURIComponent(date) + '&shift=' + encodeURIComponent(shift));
      if (!resp.ok) {
        var errData = null;
        try { errData = await resp.json(); } catch(e) {}
        throw new Error(errData && errData.error ? errData.error : '表格生成失败 (' + resp.status + ')');
      }
      blob = await resp.blob();
    } else {
      // 样式一：前端 html2canvas 时间轴截图
      var schedulePanel = document.querySelectorAll('.panel')[3];
      if (schedulePanel) schedulePanel.style.display = 'block';

      var dateEl = document.getElementById('schedule-date');
      var viewEl = document.getElementById('view-mode');
      var prevDate = dateEl ? dateEl.value : '';
      var prevView = viewEl ? viewEl.value : 'day';
      if (dateEl) dateEl.value = date;
      if (viewEl) {
        viewEl.value = (shift === '白班') ? 'day' : 'night';
        if (typeof applyViewSettings === 'function') applyViewSettings();
      }

      if (typeof _refreshTimelineFromServer === 'function') _refreshTimelineFromServer();
      await new Promise(function(r) { setTimeout(r, 800); });

      var restore = typeof _preCapture === 'function' ? _preCapture() : function(){};
      var canvas = await _captureTimeline(3);
      restore();

      if (schedulePanel) schedulePanel.style.display = '';
      if (dateEl) dateEl.value = prevDate;
      if (viewEl) {
        viewEl.value = prevView;
        if (typeof applyViewSettings === 'function') applyViewSettings();
      }

      blob = await new Promise(function(resolve) {
        canvas.toBlob(function(b) { resolve(b); }, 'image/png');
      });
    }
  } catch (err) {
    console.error('截图失败:', err);
    if (typeof _hideExportOverlay === 'function') _hideExportOverlay();
    showToast('截图失败: ' + (err.message || ''));
    btn.disabled = false;
    btn.textContent = _screenshotStyle === 'table' ? '📸 发送表格截图' : '📸 发送时间轴截图';
    return;
  }

  if (typeof _hideExportOverlay === 'function') _hideExportOverlay();

  // 生成预览 URL
  var previewUrl = URL.createObjectURL(blob);

  // 弹出预览
  btn.textContent = '等待确认...';
  var ok = await showScreenshotPreview(previewUrl);
  URL.revokeObjectURL(previewUrl);

  if (!ok) {
    btn.disabled = false;
    btn.textContent = _screenshotStyle === 'table' ? '📸 发送表格截图' : '📸 发送时间轴截图';
    return;
  }

  // 确认发送
  btn.textContent = '发送中...';
  try {
    var form = new FormData();
    form.append('image', blob, 'schedule.png');
    if (style === 'table') {
      form.append('date', date);
      form.append('shift', shift);
    }
    var sendResp = await fetch('/api/summary/send-screenshot', {
      method: 'POST', body: form
    });
    var result = await sendResp.json();
    if (result.success) {
      showToast('截图已发送到飞书群');
    } else {
      showToast('发送失败: ' + (result.error || ''));
    }
  } catch (err) {
    console.error('发送截图失败:', err);
    showToast('截图发送失败');
  }

  btn.disabled = false;
  btn.textContent = _screenshotStyle === 'table' ? '📸 发送表格截图' : '📸 发送时间轴截图';
}

// ── 面板激活 ──
function summaryOnActivate() {
  // 初始化班次报告区域
  var dateEl = document.getElementById("summary-date");
  if (dateEl && !dateEl.value) { dateEl.value = new Date().toISOString().slice(0, 10); }

  // 初始化可视化总结区域
  var endDateEl = document.getElementById("summary-end-date");
  if (endDateEl && !endDateEl.value) { endDateEl.value = new Date().toISOString().slice(0, 10); }

  // 初始化报告 widget 卡片
  var reportGrid = document.getElementById("summary-grid-report");
  if (reportGrid && reportGrid.children.length === 0) {
    for (var i = 0; i < REPORT_WIDGETS.length; i++) {
      var w = REPORT_WIDGETS[i];
      var card = document.createElement("div");
      card.className = "summary-widget";
      card.id = "widget-" + w.id;
      card.style.gridColumn = "span " + (w.span || 1);
      card.innerHTML = '<div class="summary-widget-header" onclick="toggleWidget(\'' + w.id + '\')"><span>' + w.title + '</span><span class="summary-widget-toggle">▼</span></div><div class="summary-widget-body">' + (w.chartType === 'taskring' ? '' : '<canvas></canvas>') + '</div>';
      reportGrid.appendChild(card);
    }
  }

  // 初始化聚合统计 widget 卡片
  var trendGrid = document.getElementById("summary-grid");
  if (trendGrid && trendGrid.children.length === 0) {
    for (var j = 0; j < AGGREGATE_WIDGETS.length; j++) {
      var tw = AGGREGATE_WIDGETS[j];
      var tcard = document.createElement("div");
      tcard.className = "summary-widget";
      tcard.id = "widget-" + tw.id;
      tcard.style.gridColumn = "span " + (tw.span || 1);
      tcard.innerHTML = '<div class="summary-widget-header" onclick="toggleWidget(\'' + tw.id + '\')"><span>' + tw.title + '</span><span class="summary-widget-toggle">▼</span></div><div class="summary-widget-body"><canvas></canvas></div>';
      trendGrid.appendChild(tcard);
    }
  }

  // 初始化任务明细 widget 卡片
  var detailGrid = document.getElementById("summary-grid-detail");
  if (detailGrid && detailGrid.children.length === 0) {
    for (var k = 0; k < DETAIL_WIDGETS.length; k++) {
      var dw = DETAIL_WIDGETS[k];
      var dcard = document.createElement("div");
      dcard.className = "summary-widget";
      dcard.id = "widget-" + dw.id;
      dcard.style.gridColumn = "span " + (dw.span || 1);
      dcard.innerHTML = '<div class="summary-widget-header" onclick="toggleWidget(\'' + dw.id + '\')"><span>' + dw.title + '</span><span class="summary-widget-toggle">▼</span></div><div class="summary-widget-body"><canvas></canvas></div>';
      detailGrid.appendChild(dcard);
    }
  }

  // 自动加载默认数据
  summaryLoadReport();
  summaryRefreshTrends();
}
