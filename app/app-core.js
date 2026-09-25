/* Tuhoe Timesheet — shared app core.
 *
 * This is the single source of truth for the app's logic: state, rendering,
 * the activity multi-select picker, the "Manage activities" modal, hours
 * math, PDF/print building, and backup/restore. It is identical across the
 * three shipped builds (Claude Artifact, standalone offline HTML, and the
 * Electron portable app) — only the storage adapter and the PDF-save
 * adapter differ per environment, and those are passed in by the caller.
 *
 * Usage (see each build's own small init script):
 *   TuhoeTimesheet.init({
 *     storage: { load: () => Promise<data|null>, save: (data) => Promise<boolean> },
 *     savePdf: (doc, filename) => Promise<void>   // optional; defaults to doc.save(filename)
 *   });
 */
(function (global) {
  "use strict";

  function init(adapter) {
    adapter = adapter || {};
    const storage = adapter.storage;
    const savePdf = adapter.savePdf || function (doc, filename) { doc.save(filename); return Promise.resolve(); };
    if (!storage || typeof storage.load !== "function" || typeof storage.save !== "function") {
      throw new Error("TuhoeTimesheet.init requires adapter.storage with load()/save()");
    }

    const LUNCH_OPTIONS = ["None", "1/4 hour", "1/2 hour", "3/4 hour", "1 hour"];
    const LUNCH_HOURS = { "None": 0, "1/4 hour": 0.25, "1/2 hour": 0.5, "3/4 hour": 0.75, "1 hour": 1 };

    // Distinct activity tags found across the migrated history; grows as new ones are added.
    const DEFAULT_ACTIVITY_OPTIONS = [
      "Clean fix honey filter system", "Clean-fix-gear for start of season", "Extraction",
      "Field work", "Honey in Jars", "Mix honey", "Mixing", "moving dums", "Office",
      "packing spec", "Public holiday", "Shed", "shed at Waitawa", "Tangihanga"
    ];
    // "Office, Shed" is the most common single-day combo in the migrated history, so new rows start there.
    const DEFAULT_ACTIVITY_TAGS = ["Office", "Shed"];

    // Migrated from Jim's Access timesheet database (TIMESHEET_JIM.accdb):
    // full history back to Feb 2026, one period per work batch/job as recorded there.
    const SEED_PERIODS = [{"batchId": "190", "batchName": "Te Kokau", "rows": [{"date": "2026-02-23", "activity": "", "start": "07:30", "finish": "13:00", "lunch": "1/2 hour"}, {"date": "2026-02-24", "activity": "", "start": "07:30", "finish": "15:00", "lunch": "1/2 hour"}, {"date": "2026-02-25", "activity": "Honey in Jars", "start": "08:30", "finish": "13:30", "lunch": "1/2 hour"}, {"date": "2026-02-26", "activity": "Honey in Jars", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-02-27", "activity": "Honey in Jars", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-03-02", "activity": "Extraction", "start": "08:00", "finish": "15:00", "lunch": "1/2 hour"}, {"date": "2026-03-03", "activity": "Extraction", "start": "08:30", "finish": "17:00", "lunch": "1/2 hour"}, {"date": "2026-03-04", "activity": "Extraction", "start": "08:00", "finish": "15:00", "lunch": "1/2 hour"}, {"date": "2026-03-05", "activity": "Extraction", "start": "08:00", "finish": "16:00", "lunch": "1/2 hour"}]}, {"batchId": "191", "batchName": "Te Kokau", "rows": [{"date": "2026-03-17", "activity": "Extraction", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-03-18", "activity": "Extraction", "start": "08:30", "finish": "16:00", "lunch": "1/2 hour"}, {"date": "2026-03-19", "activity": "Office, Shed, Extraction", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-03-20", "activity": "Office, Shed, Extraction", "start": "08:00", "finish": "13:30", "lunch": "1/2 hour"}]}, {"batchId": "192", "batchName": "Tamahou", "rows": [{"date": "2026-06-10", "activity": "Office, Shed, Extraction", "start": "08:00", "finish": "16:00", "lunch": "1/2 hour"}, {"date": "2026-06-10", "activity": "Office, Shed, Extraction", "start": "08:00", "finish": "16:00", "lunch": "1/2 hour"}, {"date": "2026-06-11", "activity": "Field work", "start": "08:00", "finish": "12:00", "lunch": "1/2 hour"}]}, {"batchId": "193", "batchName": "Jim", "rows": [{"date": "2026-06-29", "activity": "Field work", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-06-30", "activity": "Field work", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-01", "activity": "Clean-fix-gear for start of season, shed at Waitawa", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-02", "activity": "shed at Waitawa, Mix honey", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-03", "activity": "Mixing, Clean-fix-gear for start of season", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-06", "activity": "shed at Waitawa, Honey in Jars", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-07", "activity": "Office, Shed", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-08", "activity": "Office, Shed, Clean fix honey filter system", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-09", "activity": "Office, Shed, shed at Waitawa", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-10", "activity": "Office, Shed", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}]}, {"batchId": "194", "batchName": "Jim", "rows": [{"date": "2026-07-13", "activity": "Office, Shed", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-14", "activity": "Public holiday", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-15", "activity": "Office, Shed", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-16", "activity": "Office, Shed, moving dums", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-17", "activity": "Office, Shed, Clean-fix-gear for start of season, shed at Waitawa", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-20", "activity": "Office, Shed, shed at Waitawa", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-21", "activity": "Office, Shed", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-22", "activity": "Tangihanga", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-23", "activity": "Tangihanga", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}, {"date": "2026-07-24", "activity": "Mixing, packing spec, shed at Waitawa", "start": "08:00", "finish": "16:30", "lunch": "1/2 hour"}]}, {"batchId": "195", "batchName": "Te Kokau", "rows": [{"date": "2026-07-20", "activity": "shed at Waitawa, Mix honey", "start": "08:00", "finish": "15:00", "lunch": "1/2 hour"}, {"date": "2026-07-21", "activity": "Honey in Jars", "start": "08:00", "finish": "11:00", "lunch": "None"}, {"date": "2026-07-22", "activity": "Office, Shed, Extraction", "start": "08:30", "finish": "11:30", "lunch": "None"}, {"date": "2026-07-23", "activity": "Office, Shed, Extraction", "start": "08:00", "finish": "15:00", "lunch": "1/2 hour"}, {"date": "2026-07-24", "activity": "Office, Shed, Extraction", "start": "11:30", "finish": "13:30", "lunch": "None"}]}, {"batchId": "196", "batchName": "Te Kokau", "rows": [{"date": "2026-07-20", "activity": "Office, Shed, Extraction", "start": "08:00", "finish": "15:00", "lunch": "1/2 hour"}, {"date": "2026-07-21", "activity": "Office, Shed, Extraction", "start": "08:00", "finish": "11:00", "lunch": "None"}, {"date": "2026-07-22", "activity": "Office, Shed", "start": "08:00", "finish": "11:00", "lunch": "None"}, {"date": "2026-07-23", "activity": "Office, Shed", "start": "08:00", "finish": "15:00", "lunch": "1/2 hour"}, {"date": "2026-07-24", "activity": "Office, Shed", "start": "11:00", "finish": "13:30", "lunch": "None"}]}];

    let state = { name: "Jim", nameOptions: ["Jim"], periods: [], currentPeriodId: null, activityOptions: DEFAULT_ACTIVITY_OPTIONS.slice(), defaultActivityTags: DEFAULT_ACTIVITY_TAGS.slice() };
    let saveTimer = null;
    let pickerRowId = null;

    function uid() { return Math.random().toString(36).slice(2, 10); }
    function withRowId(row) { return Object.assign({ id: uid() }, row); }
    function isoDate(d) {
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
    function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
    function displayDate(iso) {
      const d = parseISO(iso);
      return `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    }
    function displayDateShort(iso) {
      const d = parseISO(iso);
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    }
    function nextMonday(from) {
      const d = new Date(from);
      const day = d.getDay();
      const add = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
      d.setDate(d.getDate() + add);
      return d;
    }
    function to12h(hhmm) {
      if (!hhmm) return "";
      let [h, m] = hhmm.split(":").map(Number);
      const suffix = h >= 12 ? "pm" : "am";
      h = h % 12; if (h === 0) h = 12;
      return `${h}:${String(m).padStart(2, "0")} ${suffix}`;
    }
    function hoursBetween(start, finish, lunchLabel) {
      if (!start || !finish) return 0;
      const [sh, sm] = start.split(":").map(Number);
      const [fh, fm] = finish.split(":").map(Number);
      let mins = (fh * 60 + fm) - (sh * 60 + sm);
      if (mins < 0) mins += 24 * 60;
      mins -= (LUNCH_HOURS[lunchLabel] || 0) * 60;
      return Math.max(0, mins / 60);
    }
    function periodTotal(p) {
      return p.rows.reduce((t, r) => t + hoursBetween(r.start, r.finish, r.lunch), 0);
    }
    function periodDateRange(p) {
      if (!p.rows.length) return null;
      const sorted = [...p.rows].sort((a, b) => a.date.localeCompare(b.date));
      return { first: sorted[0].date, last: sorted[sorted.length - 1].date };
    }
    function periodLabel(p) {
      const range = periodDateRange(p);
      if (!range) return "New period";
      return range.first === range.last ? displayDateShort(range.first) : `${displayDateShort(range.first)} – ${displayDateShort(range.last)}`;
    }
    function currentPeriod() {
      return state.periods.find((p) => p.id === state.currentPeriodId) || null;
    }
    function sortedPeriods() {
      return [...state.periods].sort((a, b) => {
        const ra = periodDateRange(a), rb = periodDateRange(b);
        if (!ra && !rb) return 0;
        if (!ra) return -1;
        if (!rb) return 1;
        return rb.first.localeCompare(ra.first);
      });
    }

    const nameSelect = document.getElementById("nameSelect");
    const jobInput = document.getElementById("jobInput");
    const weekStartInput = document.getElementById("weekStart");
    const sheetBody = document.getElementById("sheetBody");
    const emptyState = document.getElementById("emptyState");
    const periodSub = document.getElementById("periodSub");
    const periodList = document.getElementById("periodList");
    const totalHoursEl = document.getElementById("totalHours");
    const statRow = document.getElementById("statRow");
    const saveDot = document.getElementById("saveDot");
    const saveLabel = document.getElementById("saveLabel");

    function renderAll() {
      renderStats();
      renderPeriodList();
      renderMain();
    }

    function renderStats() {
      const allHours = state.periods.reduce((t, p) => t + periodTotal(p), 0);
      const current = currentPeriod();
      const curHours = current ? periodTotal(current) : 0;
      statRow.innerHTML =
        statBlock("This period", `${curHours.toFixed(1)} h`) +
        statBlock("Logged to date", `${allHours.toFixed(1)} h`) +
        statBlock("Periods", String(state.periods.length)) +
        statBlock("Total entries", String(state.periods.reduce((t, p) => t + p.rows.length, 0)));
    }
    function statBlock(label, value) {
      return `<div class="stat"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`;
    }
    function escapeHtml(s) {
      return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function renderNameSelect() {
      if (!state.nameOptions.length) state.nameOptions = [state.name || "Jim"];
      if (state.name && !state.nameOptions.some((n) => n.toLowerCase() === state.name.toLowerCase())) {
        state.nameOptions.push(state.name);
      }
      nameSelect.innerHTML = "";
      state.nameOptions.forEach((n) => {
        const o = document.createElement("option");
        o.value = n; o.textContent = n;
        if (n === state.name) o.selected = true;
        nameSelect.appendChild(o);
      });
    }

    function renderPeriodList() {
      const list = sortedPeriods();
      let html = "";
      list.forEach((p) => {
        const hrs = periodTotal(p);
        html += `<div class="period-item${p.id === state.currentPeriodId ? " active" : ""}" data-period="${p.id}">
          ${p.batchName ? `<div class="p-job">${escapeHtml(p.batchName)}</div>` : ""}
          <div class="p-dates">${escapeHtml(periodLabel(p))}</div>
          <div class="p-meta"><span>${p.rows.length} entr${p.rows.length === 1 ? "y" : "ies"}</span><span>${hrs.toFixed(1)} h</span></div>
        </div>`;
      });
      periodList.innerHTML = html;
      periodList.querySelectorAll("[data-period]").forEach((el) => {
        el.addEventListener("click", () => {
          state.currentPeriodId = el.getAttribute("data-period");
          renderAll();
        });
      });
    }

    function renderMain() {
      renderNameSelect();
      const p = currentPeriod();
      if (!p) {
        jobInput.value = "";
        sheetBody.innerHTML = "";
        emptyState.hidden = false;
        periodSub.textContent = "No period selected — add one to start logging hours.";
        totalHoursEl.textContent = "0.0 h";
        return;
      }

      jobInput.value = p.batchName || "";
      sheetBody.innerHTML = "";
      emptyState.hidden = p.rows.length > 0;

      const sorted = [...p.rows].sort((a, b) => a.date.localeCompare(b.date));
      let total = 0;

      sorted.forEach((row) => {
        const tr = document.createElement("tr");

        const dateTd = document.createElement("td");
        dateTd.className = "col-date";
        const dateInput = document.createElement("input");
        dateInput.type = "date";
        dateInput.value = row.date;
        dateInput.addEventListener("change", () => { row.date = dateInput.value; scheduleSave(); renderAll(); });
        dateTd.appendChild(dateInput);
        tr.appendChild(dateTd);

        const actTd = document.createElement("td");
        actTd.className = "col-activity";
        const actBtn = document.createElement("button");
        actBtn.type = "button";
        actBtn.className = "activity-trigger" + (row.activity ? "" : " placeholder");
        actBtn.setAttribute("data-row", row.id);
        actBtn.textContent = row.activity || "Select activity…";
        actBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openActivityPicker(row.id, actBtn);
        });
        actTd.appendChild(actBtn);
        tr.appendChild(actTd);

        const startTd = document.createElement("td");
        startTd.className = "col-time";
        const startInput = document.createElement("input");
        startInput.type = "time";
        startInput.value = row.start || "";
        startInput.addEventListener("change", () => { row.start = startInput.value; scheduleSave(); renderAll(); });
        startTd.appendChild(startInput);
        tr.appendChild(startTd);

        const finishTd = document.createElement("td");
        finishTd.className = "col-time";
        const finishInput = document.createElement("input");
        finishInput.type = "time";
        finishInput.value = row.finish || "";
        finishInput.addEventListener("change", () => { row.finish = finishInput.value; scheduleSave(); renderAll(); });
        finishTd.appendChild(finishInput);
        const hrs = hoursBetween(row.start, row.finish, row.lunch);
        total += hrs;
        const hrsLabel = document.createElement("div");
        hrsLabel.className = "row-hours";
        hrsLabel.textContent = hrs ? `${hrs.toFixed(2)} h` : "";
        finishTd.appendChild(hrsLabel);
        tr.appendChild(finishTd);

        const lunchTd = document.createElement("td");
        lunchTd.className = "col-lunch";
        const lunchSelect = document.createElement("select");
        LUNCH_OPTIONS.forEach((opt) => {
          const o = document.createElement("option");
          o.value = opt; o.textContent = opt;
          if (row.lunch === opt) o.selected = true;
          lunchSelect.appendChild(o);
        });
        lunchSelect.addEventListener("change", () => { row.lunch = lunchSelect.value; scheduleSave(); renderAll(); });
        lunchTd.appendChild(lunchSelect);
        tr.appendChild(lunchTd);

        const removeTd = document.createElement("td");
        removeTd.className = "col-remove";
        const removeBtn = document.createElement("button");
        removeBtn.className = "btn-icon";
        removeBtn.title = "Remove entry";
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", async () => {
          const ok = await confirmDialog("Remove this entry?", `${displayDate(row.date)} — ${row.activity || "no activity set"}`);
          if (!ok) return;
          p.rows = p.rows.filter((r) => r.id !== row.id);
          scheduleSave(); renderAll();
        });
        removeTd.appendChild(removeBtn);
        tr.appendChild(removeTd);

        sheetBody.appendChild(tr);
      });

      totalHoursEl.textContent = `${total.toFixed(1)} h`;
      periodSub.textContent = sorted.length ? periodLabel(p) : "No entries yet";
    }

    function addWeek() {
      const p = currentPeriod();
      if (!p) return;
      const startVal = weekStartInput.value ? parseISO(weekStartInput.value) : nextMonday(new Date());
      const monday = new Date(startVal);
      const day = monday.getDay();
      const back = day === 0 ? 6 : day - 1;
      monday.setDate(monday.getDate() - back);

      const defaultActivity = (state.defaultActivityTags || []).join(", ");
      for (let i = 0; i < 5; i++) {
        const d = new Date(monday);
        d.setDate(d.getDate() + i);
        p.rows.push(withRowId({ date: isoDate(d), activity: defaultActivity, start: "08:00", finish: "16:30", lunch: "1/2 hour" }));
      }
      scheduleSave();
      renderAll();
    }

    function addSingleDay() {
      const p = currentPeriod();
      if (!p) return;
      const base = weekStartInput.value ? parseISO(weekStartInput.value) : new Date();
      const defaultActivity = (state.defaultActivityTags || []).join(", ");
      p.rows.push(withRowId({ date: isoDate(base), activity: defaultActivity, start: "08:00", finish: "16:30", lunch: "1/2 hour" }));
      scheduleSave();
      renderAll();
    }

    function newPeriod() {
      const p = { id: uid(), batchName: "", rows: [] };
      state.periods.push(p);
      state.currentPeriodId = p.id;
      scheduleSave();
      renderAll();
      jobInput.focus();
    }

    // ---------- activity multi-select picker ----------
    function rowTags(row) {
      return (row.activity || "").split(",").map((s) => s.trim()).filter(Boolean);
    }
    function ensureActivityOption(tag) {
      const exists = state.activityOptions.some((o) => o.toLowerCase() === tag.toLowerCase());
      if (!exists) {
        state.activityOptions.push(tag);
        state.activityOptions.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
      }
    }
    function findRowById(rowId) {
      const p = currentPeriod();
      return p ? p.rows.find((r) => r.id === rowId) : null;
    }
    function updateActivityTrigger(row) {
      const btn = sheetBody.querySelector(`[data-row="${row.id}"]`);
      if (!btn) return;
      btn.textContent = row.activity || "Select activity…";
      btn.classList.toggle("placeholder", !row.activity);
    }
    function openActivityPicker(rowId, btnEl) {
      pickerRowId = rowId;
      renderPopoverList();
      const pop = document.getElementById("activityPopover");
      const rect = btnEl.getBoundingClientRect();
      const width = 250;
      let left = rect.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      if (left < 8) left = 8;
      let top = rect.bottom + 4;
      if (top + 300 > window.innerHeight) top = Math.max(8, rect.top - 300 - 4);
      pop.style.left = left + "px";
      pop.style.top = top + "px";
      pop.hidden = false;
      const addInput = document.getElementById("popoverAddInput");
      addInput.value = "";
      setTimeout(() => addInput.focus(), 0);
    }
    function closeActivityPicker() {
      if (pickerRowId == null) return;
      pickerRowId = null;
      document.getElementById("activityPopover").hidden = true;
      scheduleSave();
    }
    function renderPopoverList() {
      const row = findRowById(pickerRowId);
      if (!row) return;
      const selected = new Set(rowTags(row).map((t) => t.toLowerCase()));
      const list = document.getElementById("popoverList");
      list.innerHTML = "";
      state.activityOptions.forEach((opt) => {
        const label = document.createElement("label");
        label.className = "popover-item";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = selected.has(opt.toLowerCase());
        cb.addEventListener("change", () => {
          let tags = rowTags(row);
          if (cb.checked) {
            if (!tags.some((t) => t.toLowerCase() === opt.toLowerCase())) tags.push(opt);
          } else {
            tags = tags.filter((t) => t.toLowerCase() !== opt.toLowerCase());
          }
          row.activity = tags.join(", ");
          updateActivityTrigger(row);
        });
        const span = document.createElement("span");
        span.textContent = opt;
        label.appendChild(cb);
        label.appendChild(span);
        list.appendChild(label);
      });
    }
    function addCustomActivity() {
      const input = document.getElementById("popoverAddInput");
      const v = input.value.trim();
      if (!v) return;
      ensureActivityOption(v);
      const row = findRowById(pickerRowId);
      if (row) {
        const tags = rowTags(row);
        if (!tags.some((t) => t.toLowerCase() === v.toLowerCase())) tags.push(v);
        row.activity = tags.join(", ");
        updateActivityTrigger(row);
      }
      input.value = "";
      renderPopoverList();
    }

    // ---------- manage activities modal ----------
    function openManageModal() {
      renderManageList();
      document.getElementById("manageBackdrop").hidden = false;
    }
    function closeManageModal() {
      document.getElementById("manageBackdrop").hidden = true;
      scheduleSave();
      renderAll();
    }
    function renderManageList() {
      const list = document.getElementById("manageList");
      list.innerHTML = "";
      if (!state.activityOptions.length) {
        list.innerHTML = '<div class="manage-empty">No activities yet — add one below.</div>';
        return;
      }
      state.activityOptions.forEach((opt, idx) => {
        const row = document.createElement("div");
        row.className = "manage-item";

        const defWrap = document.createElement("div");
        defWrap.style.display = "flex"; defWrap.style.flexDirection = "column"; defWrap.style.alignItems = "center"; defWrap.style.gap = "2px";
        const defCb = document.createElement("input");
        defCb.type = "checkbox";
        defCb.title = "Use as default on new rows";
        defCb.checked = state.defaultActivityTags.some((t) => t.toLowerCase() === opt.toLowerCase());
        defCb.addEventListener("change", () => {
          if (defCb.checked) {
            if (!state.defaultActivityTags.some((t) => t.toLowerCase() === opt.toLowerCase())) state.defaultActivityTags.push(opt);
          } else {
            state.defaultActivityTags = state.defaultActivityTags.filter((t) => t.toLowerCase() !== opt.toLowerCase());
          }
        });
        const defLabel = document.createElement("div");
        defLabel.className = "manage-default-label";
        defLabel.textContent = "Default";
        defWrap.appendChild(defCb);
        defWrap.appendChild(defLabel);
        row.appendChild(defWrap);

        const nameInputEl = document.createElement("input");
        nameInputEl.type = "text";
        nameInputEl.value = opt;
        nameInputEl.addEventListener("change", () => {
          const newVal = nameInputEl.value.trim();
          if (!newVal || newVal === opt) { nameInputEl.value = opt; return; }
          renameActivityOption(opt, newVal);
          renderManageList();
        });
        row.appendChild(nameInputEl);

        const delBtn = document.createElement("button");
        delBtn.className = "btn-icon";
        delBtn.title = "Delete activity";
        delBtn.textContent = "🗑";
        delBtn.addEventListener("click", async () => {
          const count = countActivityUsage(opt);
          const ok = await confirmDialog(`Delete "${opt}"?`, count ? `It's used in ${count} past ${count === 1 ? "entry" : "entries"}. Those entries keep the tag — this only removes it from the picker for new ones.` : "It isn't used in any entries.");
          if (!ok) return;
          deleteActivityOption(opt);
          renderManageList();
        });
        row.appendChild(delBtn);

        list.appendChild(row);
      });
    }
    function countActivityUsage(tag) {
      let n = 0;
      state.periods.forEach((p) => p.rows.forEach((r) => {
        if (rowTags(r).some((t) => t.toLowerCase() === tag.toLowerCase())) n++;
      }));
      return n;
    }
    function renameActivityOption(oldVal, newVal) {
      const idx = state.activityOptions.findIndex((o) => o.toLowerCase() === oldVal.toLowerCase());
      if (idx === -1) return;
      if (state.activityOptions.some((o, i) => i !== idx && o.toLowerCase() === newVal.toLowerCase())) {
        // merging into an existing option: drop the old one, keep the existing target
        state.activityOptions.splice(idx, 1);
      } else {
        state.activityOptions[idx] = newVal;
        state.activityOptions.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
      }
      state.defaultActivityTags = state.defaultActivityTags.map((t) => (t.toLowerCase() === oldVal.toLowerCase() ? newVal : t));
      state.periods.forEach((p) => p.rows.forEach((r) => {
        const tags = rowTags(r);
        let changed = false;
        const next = tags.map((t) => {
          if (t.toLowerCase() === oldVal.toLowerCase()) { changed = true; return newVal; }
          return t;
        });
        if (changed) r.activity = next.join(", ");
      }));
    }
    function deleteActivityOption(val) {
      // Only removes the tag from the future picker list — past entries keep
      // whatever activity text was recorded on them, so history isn't rewritten.
      state.activityOptions = state.activityOptions.filter((o) => o.toLowerCase() !== val.toLowerCase());
      state.defaultActivityTags = state.defaultActivityTags.filter((t) => t.toLowerCase() !== val.toLowerCase());
    }
    function addManageActivity() {
      const input = document.getElementById("manageAddInput");
      const v = input.value.trim();
      if (!v) return;
      ensureActivityOption(v);
      input.value = "";
      renderManageList();
    }

    function confirmDialog(title, body) {
      return new Promise((resolve) => {
        const backdrop = document.getElementById("confirmBackdrop");
        document.getElementById("confirmTitle").textContent = title;
        document.getElementById("confirmBody").textContent = body;
        backdrop.hidden = false;
        const okBtn = document.getElementById("confirmOk");
        const cancelBtn = document.getElementById("confirmCancel");
        function cleanup(v) {
          backdrop.hidden = true;
          okBtn.removeEventListener("click", onOk);
          cancelBtn.removeEventListener("click", onCancel);
          resolve(v);
        }
        function onOk() { cleanup(true); }
        function onCancel() { cleanup(false); }
        okBtn.addEventListener("click", onOk);
        cancelBtn.addEventListener("click", onCancel);
      });
    }

    async function deletePeriod() {
      const p = currentPeriod();
      if (!p) return;
      const ok = await confirmDialog("Delete this period?", `This removes ${p.rows.length} ${p.rows.length === 1 ? "entry" : "entries"} for good.`);
      if (!ok) return;
      state.periods = state.periods.filter((x) => x.id !== p.id);
      const remaining = sortedPeriods();
      state.currentPeriodId = remaining.length ? remaining[0].id : null;
      scheduleSave();
      renderAll();
    }

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      setSaveStatus("saving");
      saveTimer = setTimeout(persist, 600);
    }

    function setSaveStatus(status) {
      saveDot.className = "save-dot" + (status === "saving" ? " saving" : status === "saved" ? " saved" : "");
      saveLabel.textContent = status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "offline" ? "Couldn't save" : "Ready";
    }

    const SCHEMA_VERSION = 1;

    function stateToPlainData() {
      return {
        schemaVersion: SCHEMA_VERSION,
        name: state.name,
        nameOptions: state.nameOptions,
        currentPeriodId: state.currentPeriodId,
        activityOptions: state.activityOptions,
        defaultActivityTags: state.defaultActivityTags,
        periods: state.periods.map((p) => ({
          id: p.id,
          batchName: p.batchName,
          rows: p.rows.map(({ id, date, activity, start, finish, lunch }) => ({ id, date, activity, start, finish, lunch }))
        })),
        updatedAt: new Date().toISOString()
      };
    }

    function applyLoadedData(d) {
      state = {
        name: d.name || "Jim",
        nameOptions: (d.nameOptions && d.nameOptions.length ? d.nameOptions.slice() : [d.name || "Jim"]),
        periods: (d.periods || []).map((p) => ({ id: p.id || uid(), batchName: p.batchName || "", rows: (p.rows || []).map(withRowId) })),
        currentPeriodId: d.currentPeriodId || null,
        activityOptions: (d.activityOptions && d.activityOptions.length ? d.activityOptions.slice() : DEFAULT_ACTIVITY_OPTIONS.slice()),
        defaultActivityTags: (d.defaultActivityTags ? d.defaultActivityTags.slice() : DEFAULT_ACTIVITY_TAGS.slice())
      };
      if (!state.periods.find((p) => p.id === state.currentPeriodId)) {
        const s = sortedPeriods();
        state.currentPeriodId = s.length ? s[0].id : null;
      }
    }

    async function persist() {
      try {
        const data = stateToPlainData();
        const ok = await storage.save(data);
        if (!ok) throw new Error("save failed");
        setSaveStatus("saved");
      } catch (e) {
        setSaveStatus("offline");
      }
    }

    async function loadStoredState() {
      try {
        const d = await storage.load();
        if (!d || !d.periods || !d.periods.length) return false;
        applyLoadedData(d);
        renderAll();
        return true;
      } catch (e) { /* fall back to seeded state */ }
      return false;
    }

    function downloadJson(data, filename) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function backupData() {
      const stamp = isoDate(new Date());
      downloadJson(stateToPlainData(), `Tuhoe_Timesheet_backup_${stamp}.json`);
      toast("Backup saved");
    }

    function restoreData(file) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const d = JSON.parse(reader.result);
          if (!d || !Array.isArray(d.periods)) throw new Error("not a timesheet backup");
          applyLoadedData(d);
          scheduleSave();
          renderAll();
          toast("Data restored");
        } catch (e) {
          toast("That file doesn't look like a timesheet backup");
        }
      };
      reader.readAsText(file);
    }

    function seedState() {
      state.periods = SEED_PERIODS.map((p) => ({
        id: uid(),
        batchName: p.batchName || "",
        rows: p.rows.map(withRowId)
      }));
      const s = sortedPeriods();
      state.currentPeriodId = s.length ? s[0].id : null;
    }

    function buildPdf() {
      const p = currentPeriod();
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const marginX = 14;
      const pageWidth = doc.internal.pageSize.getWidth();
      const contentWidth = pageWidth - marginX * 2;

      doc.setFillColor(230, 224, 209);
      doc.setDrawColor(140, 123, 92);
      doc.rect(marginX, 12, contentWidth, 10, "FD");
      doc.setFont("times", "normal");
      doc.setFontSize(16);
      doc.setTextColor(43, 32, 19);
      doc.text("Tuhoe Tuawhenua Trust - Timesheet", pageWidth / 2, 18.7, { align: "center" });

      doc.setDrawColor(140, 123, 92);
      doc.rect(marginX, 25, contentWidth, 8);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Name", marginX + 3, 29.8);
      doc.setFont("helvetica", "normal");
      doc.text(state.name || "", marginX + 30, 29.8);

      const sorted = p ? [...p.rows].sort((a, b) => a.date.localeCompare(b.date)) : [];
      const body = sorted.map((r) => [
        displayDate(r.date),
        r.activity || "",
        to12h(r.start),
        to12h(r.finish),
        r.lunch || ""
      ]);

      doc.autoTable({
        startY: 36,
        margin: { left: marginX, right: marginX },
        head: [["Date", "Activity", "Start Time", "Finish Time", "Lunch"]],
        body,
        theme: "grid",
        styles: { font: "helvetica", fontSize: 10, textColor: [43, 32, 19], lineColor: [200, 187, 156], cellPadding: 3, valign: "middle" },
        headStyles: { fillColor: [230, 224, 209], textColor: [43, 32, 19], fontStyle: "bold", halign: "center" },
        columnStyles: {
          0: { cellWidth: 24, halign: "center" },
          1: { cellWidth: "auto", halign: "center" },
          2: { cellWidth: 26, halign: "center" },
          3: { cellWidth: 26, halign: "center" },
          4: { cellWidth: 22, halign: "center" }
        }
      });

      let y = doc.lastAutoTable.finalY + 14;
      const colGap = contentWidth / 2;
      doc.setFontSize(10);
      doc.setTextColor(43, 32, 19);
      doc.text("Project Manager:", marginX, y);
      doc.text("Executive Trustee", marginX + colGap, y);
      y += 8;
      doc.text("Hours pay:", marginX, y);
      y += 8;
      doc.text("Hour bank:", marginX, y);

      return doc;
    }

    async function downloadPdf() {
      const p = currentPeriod();
      if (!p || !p.rows.length) { toast("Add some entries to this period first"); return; }
      const doc = buildPdf();
      const sorted = [...p.rows].sort((a, b) => a.date.localeCompare(b.date));
      const first = sorted[0] ? displayDate(sorted[0].date).replace(/\//g, "-") : "period";
      const last = sorted[sorted.length - 1] ? displayDate(sorted[sorted.length - 1].date).replace(/\//g, "-") : "";
      const safeName = (state.name || "Timesheet").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
      const filename = `Timesheet_${safeName}_${first}${last ? "_to_" + last : ""}.pdf`;
      await savePdf(doc, filename);
    }

    function renderPrintView() {
      const p = currentPeriod();
      const sorted = p ? [...p.rows].sort((a, b) => a.date.localeCompare(b.date)) : [];
      const rowsHtml = sorted.map((r) => `<tr>
          <td>${escapeHtml(displayDate(r.date))}</td>
          <td>${escapeHtml(r.activity || "")}</td>
          <td>${escapeHtml(to12h(r.start))}</td>
          <td>${escapeHtml(to12h(r.finish))}</td>
          <td>${escapeHtml(r.lunch || "")}</td>
        </tr>`).join("");
      document.getElementById("printView").innerHTML = `
        <div class="print-sheet">
          <div class="p-title">Tuhoe Tuawhenua Trust - Timesheet</div>
          <div class="p-name"><strong>Name</strong>${escapeHtml(state.name || "")}</div>
          <table>
            <thead><tr><th>Date</th><th>Activity</th><th>Start Time</th><th>Finish Time</th><th>Lunch</th></tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="5">No entries</td></tr>'}</tbody>
          </table>
          <div class="p-signoff">
            <div>
              <div>Project Manager:</div>
              <div>Hours pay:</div>
              <div>Hour bank:</div>
            </div>
            <div>Executive Trustee</div>
          </div>
        </div>`;
    }

    function printPeriod() {
      const p = currentPeriod();
      if (!p || !p.rows.length) { toast("Add some entries to this period first"); return; }
      renderPrintView();
      setTimeout(() => window.print(), 50);
    }

    function toast(msg) {
      const t = document.getElementById("toast");
      if (!t) return;
      t.textContent = msg;
      t.classList.add("show");
      clearTimeout(t._h);
      t._h = setTimeout(() => t.classList.remove("show"), 2200);
    }

    nameSelect.addEventListener("change", () => { state.name = nameSelect.value; scheduleSave(); });
    document.getElementById("addNameBtn").addEventListener("click", () => {
      const row = document.getElementById("addNameRow");
      row.style.display = row.style.display === "none" ? "flex" : "none";
      if (row.style.display === "flex") { document.getElementById("addNameInput").value = ""; document.getElementById("addNameInput").focus(); }
    });
    document.getElementById("addNameCancel").addEventListener("click", () => {
      document.getElementById("addNameRow").style.display = "none";
    });
    function saveNewName() {
      const input = document.getElementById("addNameInput");
      const v = input.value.trim();
      if (!v) return;
      if (!state.nameOptions.some((n) => n.toLowerCase() === v.toLowerCase())) {
        state.nameOptions.push(v);
        state.nameOptions.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
      }
      state.name = v;
      document.getElementById("addNameRow").style.display = "none";
      scheduleSave();
      renderNameSelect();
    }
    document.getElementById("addNameSave").addEventListener("click", saveNewName);
    document.getElementById("addNameInput").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); saveNewName(); }
    });
    jobInput.addEventListener("input", () => { const p = currentPeriod(); if (p) { p.batchName = jobInput.value; scheduleSave(); renderPeriodList(); } });
    document.getElementById("addWeekBtn").addEventListener("click", addWeek);
    document.getElementById("addDayBtn").addEventListener("click", addSingleDay);
    document.getElementById("newPeriodBtn").addEventListener("click", newPeriod);
    document.getElementById("deletePeriodBtn").addEventListener("click", deletePeriod);
    document.getElementById("pdfBtn").addEventListener("click", downloadPdf);
    document.getElementById("printBtn").addEventListener("click", printPeriod);

    document.getElementById("popoverDone").addEventListener("click", closeActivityPicker);
    document.getElementById("popoverAddInput").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); addCustomActivity(); }
    });
    document.getElementById("manageActivitiesBtn").addEventListener("click", openManageModal);
    document.getElementById("manageCloseBtn").addEventListener("click", closeManageModal);
    document.getElementById("manageAddBtn").addEventListener("click", addManageActivity);
    document.getElementById("manageAddInput").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); addManageActivity(); }
    });
    document.addEventListener("click", (ev) => {
      const pop = document.getElementById("activityPopover");
      if (pop.hidden) return;
      if (pop.contains(ev.target)) return;
      if (ev.target.closest(".activity-trigger")) return;
      closeActivityPicker();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && pickerRowId != null) closeActivityPicker();
    });
    window.addEventListener("resize", () => { if (pickerRowId != null) document.getElementById("activityPopover").hidden = true; pickerRowId = null; });

    (function initWeekStart() {
      const monday = nextMonday(new Date());
      weekStartInput.value = isoDate(monday);
    })();

    // Backup/Restore and the storage-note banner are optional — only the
    // standalone HTML and Electron builds ship those DOM elements (the
    // Claude Artifact build has cloud persistence and doesn't need them).
    const backupBtn = document.getElementById("backupBtn");
    const restoreBtn = document.getElementById("restoreBtn");
    const restoreFileInput = document.getElementById("restoreFileInput");
    if (backupBtn) backupBtn.addEventListener("click", backupData);
    if (restoreBtn && restoreFileInput) {
      restoreBtn.addEventListener("click", () => restoreFileInput.click());
      restoreFileInput.addEventListener("change", (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (file) restoreData(file);
        ev.target.value = "";
      });
    }

    if (adapter.storageNote) {
      const note = document.getElementById("storageNote");
      if (note) note.textContent = adapter.storageNote;
    }

    return (async function boot() {
      const loaded = await loadStoredState();
      if (!loaded) {
        seedState();
        renderAll();
        await persist();
      }
    })();
  }

  global.TuhoeTimesheet = { init: init };
})(typeof window !== "undefined" ? window : this);
