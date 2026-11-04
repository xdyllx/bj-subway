"use strict";

/* ---------- 数据 ---------- */
let DATA = null;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtH = (m) => `${Math.floor((m % 1440) / 60)}:${String(m % 60).padStart(2, "0")}`;

/* ---------- 推算引擎 ---------- */
function headwayAt(lineCode, minutes) {
  const hw = DATA.lines[lineCode].headways;
  const d = new Date();
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const h = Math.floor(minutes / 60);
  const peak = weekend ? (h >= 8 && h < 11) || (h >= 16 && h < 19)
                       : (h >= 7 && h < 9) || (h >= 17 && h < 19);
  const table = (weekend && hw.weekend) ? hw.weekend : hw.weekday;
  if (h >= (table.eveningFrom != null ? table.eveningFrom : 20)) return table.evening || table.daytime;
  return peak ? table.peak : table.daytime;
}

// 生成某站某方向当日的班次时刻（分钟数数组）
function timetable(lineCode, station, dir) {
  const first = dir === "A" ? station.first : station.firstB;
  const last = dir === "B" ? station.lastB : station.last;
  if (first == null || last == null || last <= first) return [];
  const out = [first];
  let t = first;
  while (true) {
    t += headwayAt(lineCode, t);
    if (t > last) break;
    out.push(t);
  }
  return out;
}

function nextArrivals(lineCode, station, dir, now, count) {
  const tt = timetable(lineCode, station, dir);
  if (!tt.length) return null;
  const res = [];
  for (const t of tt) {
    if (t >= now) { res.push(t); if (res.length >= count) return res; }
  }
  return res; // 可能不足 count（末班之后）
}

/* ---------- 状态 ---------- */
const state = { view: "home", lineCode: null, stationIdx: null, dir: null };
const FAV_KEY = "bjsubway.favs";
const favs = () => JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
const saveFavs = (f) => localStorage.setItem(FAV_KEY, JSON.stringify(f));
const curFav = () => ({ lineCode: state.lineCode, stationIdx: state.stationIdx, dir: state.dir });
const sameFav = (a, b) => a.lineCode === b.lineCode && a.stationIdx === b.stationIdx && a.dir === b.dir;

function shortName(lineName) {
  return lineName.replace(/号线.*/, "").replace(/(大兴|首都)机场线/, "$1机场");
}

/* ---------- 视图切换 ---------- */
function show(view) {
  state.view = view;
  for (const v of ["homeView", "pickView", "resultView"]) $(v).classList.toggle("hidden", v !== view + "View");
  $("btnBack").classList.toggle("hidden", view === "home");
  if (view === "home") renderHome();
  if (view === "pick") renderPicker();
  if (view === "result") renderResult();
}

$("btnBack").onclick = () => show(state.view === "result" ? "pick" : "home");
$("btnNew").onclick = () => { state.lineCode = null; state.stationIdx = null; state.dir = null; show("pick"); };

/* ---------- 主屏（收藏） ---------- */
const groupOf = (f) => f.group || "未分组";
let homeTimer = null;

function renderHome() {
  const f = favs();
  $("favSection").classList.toggle("hidden", f.length === 0);
  const list = $("favList");
  list.innerHTML = "";
  const groups = [];
  for (const item of f) {
    const g = groupOf(item);
    if (!groups.includes(g)) groups.push(g);
  }
  for (const g of groups) {
    const title = document.createElement("div");
    title.className = "group-title";
    title.textContent = g;
    list.appendChild(title);
    for (const item of f.filter((x) => groupOf(x) === g)) {
      const line = DATA.lines[item.lineCode];
      const st = line && line.stations[item.stationIdx];
      if (!line || !st) continue;
      const dirName = item.dir === "A" ? line.dirA : line.dirB;
      const card = document.createElement("div");
      card.className = "fav-card";
      card.dataset.line = item.lineCode;
      card.dataset.idx = item.stationIdx;
      card.dataset.dir = item.dir;
      card.innerHTML = `
        <div class="fav-head">
          <span class="line-badge" style="background:${line.color}">${esc(shortName(line.name))}</span>
          <div class="fav-info"><b>${esc(st.name)}</b><span class="fav-dir">开往 ${esc(dirName)}</span></div>
          <button class="fav-del" aria-label="删除">✕</button>
        </div>
        <div class="fav-live">
          <div class="fav-live-item"><span class="fl-label">本班</span><span class="fl-val" data-slot="main">--</span><span class="fl-time" data-slot="mainT"></span></div>
          <div class="fav-live-item next"><span class="fl-label">下一班</span><span class="fl-val" data-slot="next">--</span><span class="fl-time" data-slot="nextT"></span></div>
        </div>`;
      card.onclick = (e) => {
        if (e.target.classList.contains("fav-del")) {
          saveFavs(favs().filter((x) => !sameFav(x, item)));
          renderHome();
          return;
        }
        Object.assign(state, { lineCode: item.lineCode, stationIdx: item.stationIdx, dir: item.dir });
        show("result");
      };
      list.appendChild(card);
    }
  }
  $("genTime").textContent = DATA.generated;
  updateFavLive();
  clearInterval(homeTimer);
  homeTimer = setInterval(updateFavLive, 15000);
}

function updateFavLive() {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  for (const card of $("favList").querySelectorAll(".fav-card")) {
    const f = favs().filter((x) => x.lineCode === card.dataset.line && +x.stationIdx === +card.dataset.idx && x.dir === card.dataset.dir)[0];
    if (!f) continue;
    const line = DATA.lines[f.lineCode];
    const st = line.stations[f.stationIdx];
    const arr = nextArrivals(f.lineCode, st, f.dir, nowMin, 2);
    const q = (slot) => card.querySelector(`[data-slot="${slot}"]`);
    if (!arr || arr.length === 0) {
      q("main").textContent = "已收班";
      q("mainT").textContent = `明日 ${fmtH(f.dir === "A" ? st.first : st.firstB)}`;
      q("next").textContent = "--";
      q("nextT").textContent = "";
    } else {
      const [a, b] = arr;
      const dm = Math.max(0, Math.round(a - nowMin));
      q("main").textContent = dm <= 1 ? "即将到站" : `${dm} 分`;
      q("mainT").textContent = fmtH(Math.floor(a));
      if (b != null) {
        q("next").textContent = `${Math.max(0, Math.round(b - nowMin))} 分`;
        q("nextT").textContent = fmtH(Math.floor(b));
      } else {
        q("next").textContent = "--";
        q("nextT").textContent = "末班";
      }
    }
  }
}

/* ---------- 选择器 ---------- */
function renderPicker() {
  const stepLine = $("stepLine"), stepStation = $("stepStation"), stepDir = $("stepDir");
  if (!state.lineCode) {
    stepLine.classList.remove("hidden"); stepStation.classList.add("hidden"); stepDir.classList.add("hidden");
    const grid = $("lineList");
    grid.innerHTML = "";
    for (const [code, line] of Object.entries(DATA.lines)) {
      const row = document.createElement("div");
      row.className = "line-row";
      row.innerHTML = `<span class="line-badge" style="background:${line.color}">${esc(shortName(line.name))}</span><span class="line-name">${esc(line.name)}</span>`;
      row.onclick = () => { state.lineCode = code; state.stationIdx = null; state.dir = null; renderPicker(); };
      grid.appendChild(row);
    }
  } else if (state.stationIdx == null) {
    stepLine.classList.add("hidden"); stepStation.classList.remove("hidden"); stepDir.classList.add("hidden");
    $("stationTitle").textContent = DATA.lines[state.lineCode].name;
    $("stationSearch").value = "";
    renderStationList("");
    $("stationSearch").oninput = (e) => renderStationList(e.target.value);
  } else {
    stepLine.classList.add("hidden"); stepStation.classList.add("hidden"); stepDir.classList.remove("hidden");
    const line = DATA.lines[state.lineCode];
    const st = line.stations[state.stationIdx];
    $("dirTitle").textContent = st.name + " · 开往哪个方向";
    const wrap = $("dirList");
    wrap.innerHTML = "";
    const dirs = [
      ["A", line.dirA, st.first != null, st.first, st.last],
      ["B", line.dirB, st.firstB != null, st.firstB, st.lastB],
    ];
    for (const [d, dest, ok, f, l] of dirs) {
      if (!ok) continue;
      const btn = document.createElement("button");
      btn.className = "dir-btn";
      btn.innerHTML = `<span class="dir-arrow">→</span><div><div><b>开往 ${esc(dest)}</b></div><div class="dir-sub">本站通过 ${fmtH(f)} – ${fmtH(l)}</div></div>`;
      btn.onclick = () => { state.dir = d; show("result"); };
      wrap.appendChild(btn);
    }
  }
}

function renderStationList(query) {
  const line = DATA.lines[state.lineCode];
  const q = query.trim();
  const wrap = $("stationList");
  wrap.innerHTML = "";
  for (const [idx, st] of line.stations.entries()) {
    if (q && !st.name.includes(q)) continue;
    const row = document.createElement("div");
    row.className = "station-row";
    row.innerHTML = `<span>${esc(st.name)}</span><span class="st-meta">${st.first != null && st.firstB != null ? "双向" : "单向"}</span>`;
    row.onclick = () => { state.stationIdx = idx; renderPicker(); };
    wrap.appendChild(row);
  }
}

/* ---------- 结果页 ---------- */
let resultTimer = null;

function renderResult() {
  const line = DATA.lines[state.lineCode];
  const st = line.stations[state.stationIdx];
  const dirName = state.dir === "A" ? line.dirA : line.dirB;

  $("rLineBadge").textContent = shortName(line.name);
  $("rLineBadge").style.background = line.color;
  $("rStation").textContent = st.name;
  $("rDir").textContent = `开往 ${dirName} 方向`;
  $("btnFav").textContent = favs().some((x) => sameFav(x, curFav())) ? "★" : "☆";

  const paint = () => {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const arrivals = nextArrivals(state.lineCode, st, state.dir, nowMin, 2);
    const meta = $("rMeta");
    if (!arrivals || arrivals.length === 0) {
      // 今日运营结束，显示明日首班
      const f = state.dir === "A" ? st.first : st.firstB;
      $("rMainMin").innerHTML = "已收班";
      $("rMainClock").textContent = "";
      $("rNextMin").textContent = "--";
      $("rNextClock").textContent = "";
      meta.innerHTML = `明日首班约 <b>${fmtH(f)}</b> 通过本站`;
    } else {
      const [a, b] = arrivals;
      const dm = Math.max(0, Math.round(a - nowMin));
      $("rMainMin").innerHTML = dm <= 1 ? "即将到站" : `${dm}<small> 分钟</small>`;
      $("rMainClock").textContent = `预计 ${fmtH(Math.floor(a))} 到站`;
      if (b != null) {
        $("rNextMin").innerHTML = `${Math.max(0, Math.round(b - nowMin))}<small> 分钟</small>`;
        $("rNextClock").textContent = `预计 ${fmtH(Math.floor(b))} 到站`;
      } else {
        $("rNextMin").textContent = "--";
        $("rNextClock").textContent = "末班";
      }
      const f = state.dir === "A" ? st.first : st.firstB;
      const l = state.dir === "A" ? st.last : st.lastB;
      meta.innerHTML = `本站运营 <b>${fmtH(f)}</b> – <b>${fmtH(l)}</b> · 官方首末班数据，班次为间隔推算`;
    }
  };
  paint();
  clearInterval(resultTimer);
  resultTimer = setInterval(paint, 15000);
}

$("btnFav").onclick = () => {
  const f = favs();
  const item = curFav();
  const i = f.findIndex((x) => sameFav(x, item));
  if (i >= 0) {
    f.splice(i, 1);
    saveFavs(f);
    $("btnFav").textContent = "☆";
  } else {
    openFavModal();
  }
};

/* ---------- 分组弹窗 ---------- */
function openFavModal() {
  const chips = $("groupChips");
  chips.innerHTML = "";
  let selected = "";
  const groups = [...new Set(favs().map(groupOf))];
  for (const g of groups) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = g;
    chip.onclick = () => {
      selected = g;
      $("groupInput").value = g;
      for (const c of chips.querySelectorAll(".chip")) c.classList.toggle("on", c === chip);
    };
    chips.appendChild(chip);
  }
  $("groupInput").value = "";
  const modal = $("favModal");
  modal.classList.remove("hidden");
  const close = () => modal.classList.add("hidden");
  $("favModalCancel").onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  $("favModalOk").onclick = () => {
    const g = ($("groupInput").value.trim() || selected || "未分组").slice(0, 12);
    const f = favs();
    const item = curFav();
    item.group = g;
    f.push(item);
    saveFavs(f);
    $("btnFav").textContent = "★";
    close();
  };
}

/* ---------- 时钟 ---------- */
function tickClock() {
  const d = new Date();
  $("clock").textContent = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ---------- 延误公告 ---------- */
async function fetchDelay() {
  try {
    const r = await fetch("https://map.bjsubway.com/getdelay");
    const list = await r.json();
    const el = $("delayBanner");
    const latest = (Array.isArray(list) ? list : [list])[0];
    if (latest && latest.title && !latest.title.includes("正常")) {
      el.textContent = latest.title;
      el.classList.remove("hidden", "ok");
    } else {
      el.textContent = "路网运营正常";
      el.classList.add("ok");
      el.classList.remove("hidden");
    }
  } catch (e) { /* 静默降级 */ }
}

/* ---------- 初始化 ---------- */
(async function init() {
  const r = await fetch("./data.json");
  DATA = await r.json();
  tickClock();
  setInterval(tickClock, 10000);
  fetchDelay();
  setInterval(fetchDelay, 5 * 60 * 1000);
  show("home");
})();
