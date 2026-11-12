/*
 * Theme Script Link · 테마 스크립트 연동
 *
 * 실리태번 테마를 바꾸면, 그 테마에 연결해 둔 酒馆助手(JS-Slash-Runner) 전역 스크립트를 켜고
 * 다른 테마의 연결 스크립트는 끈다.
 *
 * - 연결(규칙)은 처음 한 번 확장 탭에서 직접 정한다: 테마 이름 ↔ 스크립트.
 * - 규칙에 들어 있지 않은 스크립트는 절대 건드리지 않는다.
 * - 테마 이름이 바뀌거나 지워지면 그 규칙에 "테마 없음" 표시가 뜨고, 다시 고르면 된다.
 * - 스크립트는 id로 기억하고, id가 바뀌면(다시 가져오기 등) 이름으로 다시 찾는다.
 */
(() => {
    'use strict';

    const KEY = 'themeScriptLink';
    const POLL_MS = 800;
    const READY_TIMEOUT_MS = 60000;

    const ctx = () => SillyTavern.getContext();
    const $ = window.jQuery;

    /* ---------------- 설정 ---------------- */
    function settings() {
        const all = ctx().extensionSettings;
        if (!all[KEY] || typeof all[KEY] !== 'object') all[KEY] = {};
        const s = all[KEY];
        if (typeof s.enabled !== 'boolean') s.enabled = true;
        if (typeof s.notify !== 'boolean') s.notify = true;
        if (!Array.isArray(s.rules)) s.rules = [];
        if (!Number.isInteger(s.pageSize) || s.pageSize < 1) s.pageSize = 6;
        // rules(묶음): [{ uid, label, themes: ['테마 이름', ...], scripts: [{ id, name }] }]
        for (const r of s.rules) {
            if (!Array.isArray(r.themes)) r.themes = r.theme ? [r.theme] : [];
            delete r.theme;
            if (!Array.isArray(r.scripts)) r.scripts = [];
            if (!r.uid) r.uid = 'g' + Math.random().toString(36).slice(2, 10);
            if (typeof r.label !== 'string') r.label = '';
        }
        return s;
    }
    function save() { ctx().saveSettingsDebounced(); }

    /* ---------------- 실리태번 / 酒馆助手 ---------------- */
    function currentTheme() {
        const p = ctx().powerUserSettings;
        return (p && p.theme) || String($('#themes').val() || '');
    }
    function themeNames() {
        return [...document.querySelectorAll('#themes option')].map((o) => o.value).filter(Boolean);
    }
    function helper() {
        const th = window.TavernHelper;
        return th && typeof th.getScriptTrees === 'function' && typeof th.updateScriptTreesWith === 'function' ? th : null;
    }
    /** 전역 스크립트를 폴더 안까지 펼친 목록 */
    function globalScripts() {
        const th = helper();
        if (!th) return [];
        let trees = [];
        try { trees = th.getScriptTrees({ type: 'global' }) || []; } catch (e) { return []; }
        const out = [];
        for (const t of trees) {
            if (t.type === 'folder') {
                for (const s of t.scripts || []) out.push({ id: s.id, name: s.name, enabled: !!s.enabled, folder: t.name, folderEnabled: !!t.enabled });
            } else {
                out.push({ id: t.id, name: t.name, enabled: !!t.enabled, folder: '', folderEnabled: true });
            }
        }
        return out;
    }

    /** 규칙에 저장된 스크립트를 현재 목록의 실제 id로 맞춘다 (id가 바뀌었으면 이름으로 다시 찾기) */
    function resolveIds(list) {
        const s = settings();
        const byId = new Map(list.map((x) => [x.id, x]));
        let fixed = false;
        for (const rule of s.rules) {
            for (const ref of rule.scripts) {
                const hit = byId.get(ref.id);
                if (hit) {
                    if (hit.name !== ref.name) { ref.name = hit.name; fixed = true; }
                    continue;
                }
                const byName = list.filter((x) => x.name === ref.name);
                if (byName.length === 1) { ref.id = byName[0].id; fixed = true; }
            }
        }
        if (fixed) save();
    }

    /* ---------------- 적용 ---------------- */
    let lastTheme = null;
    let ready = false;

    function apply(theme, { quiet = false } = {}) {
        const s = settings();
        if (!s.enabled || !ready) return;
        const th = helper();
        if (!th) return;
        const list = globalScripts();
        resolveIds(list);

        const managed = new Set();
        const want = new Set();
        for (const rule of s.rules) {
            for (const ref of rule.scripts) {
                managed.add(ref.id);
                if (rule.themes.includes(theme)) want.add(ref.id);
            }
        }
        if (!managed.size) return;

        // 바뀔 것이 있는지 먼저 확인 (없으면 아무것도 건드리지 않음)
        const on = [];
        const off = [];
        for (const sc of list) {
            if (!managed.has(sc.id)) continue;
            const should = want.has(sc.id);
            const running = sc.enabled && sc.folderEnabled;
            if (should && !running) on.push(sc.name);
            if (!should && sc.enabled) off.push(sc.name);
        }
        if (!on.length && !off.length) return;

        try {
            th.updateScriptTreesWith((trees) => trees.map((t) => {
                if (t.type === 'folder') {
                    let needFolder = false;
                    const scripts = (t.scripts || []).map((sc) => {
                        if (!managed.has(sc.id)) return sc;
                        const en = want.has(sc.id);
                        if (en) needFolder = true;
                        return { ...sc, enabled: en };
                    });
                    return { ...t, enabled: t.enabled || needFolder, scripts };
                }
                if (!managed.has(t.id)) return t;
                return { ...t, enabled: want.has(t.id) };
            }), { type: 'global' });
        } catch (e) {
            console.error('[Theme Script Link] 스크립트 전환 실패', e);
            toastr.error('스크립트를 켜고 끄지 못했습니다. 콘솔을 확인해 주세요.', 'Theme Script Link');
            return;
        }

        if (s.notify && !quiet) {
            const parts = [];
            if (on.length) parts.push('켬: ' + on.join(', '));
            if (off.length) parts.push('끔: ' + off.join(', '));
            toastr.info(parts.join('<br>'), theme || '테마 변경', { escapeHtml: false, timeOut: 2500 });
        }
        renderRules();
    }

    function check() {
        const t = currentTheme();
        if (t === lastTheme) return;
        lastTheme = t;
        $('#tsl_current').text(t || '(없음)');
        apply(t);
        renderRules();
    }

    /* ---------------- 설정 화면 ---------------- */
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function panelHtml() {
        return `
<div id="tsl_settings" class="tsl">
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>테마 스크립트 연동</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="tsl-row">
        <label class="checkbox_label"><input type="checkbox" id="tsl_enabled"> <span>사용</span></label>
        <label class="checkbox_label"><input type="checkbox" id="tsl_notify"> <span>바꿀 때 알림</span></label>
      </div>
      <div class="tsl-now">지금 테마 <b id="tsl_current"></b> <span id="tsl_current_in"></span></div>
      <div class="tsl-row">
        <div id="tsl_add" class="menu_button menu_button_icon"><i class="fa-solid fa-link"></i><span>지금 테마 연결</span></div>
        <div id="tsl_new" class="menu_button menu_button_icon" title="빈 묶음 만들기"><i class="fa-solid fa-plus"></i><span>새 묶음</span></div>
        <div id="tsl_refresh" class="menu_button menu_button_icon" title="스크립트·테마 목록 새로 읽기"><i class="fa-solid fa-rotate"></i></div>
        <div id="tsl_apply" class="menu_button menu_button_icon" title="지금 테마 기준으로 다시 적용"><i class="fa-solid fa-play"></i></div>
      </div>
      <div class="tsl-row tsl-tools">
        <input id="tsl_search" class="text_pole" type="search" placeholder="테마·스크립트 이름으로 찾기">
        <div id="tsl_sort" class="menu_button menu_button_icon" title="이름순으로 정렬"><i class="fa-solid fa-arrow-down-a-z"></i></div>
        <div id="tsl_fold" class="menu_button menu_button_icon" title="모두 접기"><i class="fa-solid fa-angles-up"></i></div>
      </div>
      <div id="tsl_warn" class="tsl-warn"></div>
      <div id="tsl_rules"></div>
      <div id="tsl_pager" class="tsl-pager"></div>
      <small class="tsl-note">한 묶음에 테마 여러 개와 스크립트 여러 개를 넣을 수 있습니다. 묶음에 든 테마로 바꾸면 그 묶음의 스크립트가 켜지고, 다른 묶음의 스크립트는 꺼집니다. 酒馆助手의 <b>전역</b> 스크립트만 다루며, 어느 묶음에도 없는 스크립트는 건드리지 않습니다.</small>
    </div>
  </div>
</div>`;
    }

    /* 화면 상태 (저장하지 않음) */
    const open = new Set();
    let page = 0;
    let query = '';

    function ruleTitle(rule) {
        if (rule.label) return rule.label;
        if (!rule.themes.length) return '(테마 없음)';
        return rule.themes[0] + (rule.themes.length > 1 ? ` 외 ${rule.themes.length - 1}` : '');
    }
    function ruleMatches(rule, q) {
        if (!q) return true;
        const hay = [rule.label, ...rule.themes, ...rule.scripts.map((r) => r.name)].join('\n').toLowerCase();
        return hay.includes(q);
    }
    function findRuleIndexOfTheme(theme) {
        return settings().rules.findIndex((r) => r.themes.includes(theme));
    }
    /** 지금 테마가 든 묶음이 있는 쪽으로 이동하고 펼친다 */
    function reveal(index) {
        const s = settings();
        const rule = s.rules[index];
        if (!rule) return;
        query = '';
        $('#tsl_search').val('');
        page = Math.floor(index / s.pageSize);
        open.add(rule.uid);
    }

    /* 다시 그리기는 항상 한 박자 늦게 한다.
       클릭한 요소를 그 자리에서 지워 버리면, 실리태번이 "패널 바깥을 눌렀다"고 보고 패널을 닫기 때문. */
    let renderQueued = false;
    function renderRules() {
        if (renderQueued) return;
        renderQueued = true;
        setTimeout(() => { renderQueued = false; renderNow(); }, 0);
    }
    function renderNow() {
        const box = document.getElementById('tsl_rules');
        if (!box) return;
        const s = settings();
        const list = globalScripts();
        const warn = document.getElementById('tsl_warn');
        if (warn) warn.textContent = helper() ? '' : '酒馆助手(JS-Slash-Runner)를 찾지 못했습니다. 설치·활성화되어 있는지 확인해 주세요.';
        resolveIds(list);
        const themes = themeNames();
        const now = currentTheme();
        const nowIdx = findRuleIndexOfTheme(now);
        $('#tsl_current_in').text(nowIdx >= 0 ? `· ${ruleTitle(s.rules[nowIdx])}` : '· 연결 없음');

        const pager = document.getElementById('tsl_pager');
        if (!s.rules.length) {
            box.innerHTML = '<div class="tsl-empty">아직 연결이 없습니다. 테마를 고른 뒤 「지금 테마 연결」을 누르세요.</div>';
            if (pager) pager.innerHTML = '';
            return;
        }

        const q = query.trim().toLowerCase();
        const shown = s.rules.map((rule, i) => ({ rule, i })).filter(({ rule }) => ruleMatches(rule, q));
        const pages = Math.max(1, Math.ceil(shown.length / s.pageSize));
        if (page >= pages) page = pages - 1;
        if (page < 0) page = 0;
        const slice = shown.slice(page * s.pageSize, (page + 1) * s.pageSize);

        box.innerHTML = slice.length ? slice.map(({ rule, i: ri }) => {
            const isOpen = open.has(rule.uid);
            const missingThemes = rule.themes.filter((t) => !themes.includes(t));
            const active = rule.themes.includes(now);
            const scriptNames = rule.scripts.map((r) => r.name);
            const head = `
          <div class="tsl-rule-head" data-uid="${esc(rule.uid)}">
            <i class="fa-solid fa-grip-vertical tsl-grip" draggable="true" data-rule="${ri}" title="끌어서 순서 바꾸기"></i>
            <i class="fa-solid fa-chevron-right tsl-chev"></i>
            <div class="tsl-rule-title">
              <b>${esc(ruleTitle(rule))}</b>
              <small>${rule.themes.length}개 테마 · ${scriptNames.length ? esc(scriptNames.join(', ')) : '스크립트 없음'}</small>
            </div>
            ${missingThemes.length ? '<i class="fa-solid fa-triangle-exclamation tsl-flag" title="없는 테마가 있습니다"></i>' : ''}
            ${active ? '<span class="tsl-badge">사용 중</span>' : ''}
            <span class="tsl-moves">
              <i class="fa-solid fa-chevron-up tsl-move" data-rule="${ri}" data-dir="-1" title="위로"${ri === 0 ? ' data-off="1"' : ''}></i>
              <i class="fa-solid fa-chevron-down tsl-move" data-rule="${ri}" data-dir="1" title="아래로"${ri === s.rules.length - 1 ? ' data-off="1"' : ''}></i>
            </span>
          </div>`;
            if (!isOpen) {
                return `<div class="tsl-rule${active ? ' tsl-active' : ''}" data-rule="${ri}">${head}</div>`;
            }

            const chips = rule.themes.map((t) => `
            <span class="tsl-chip${t === now ? ' tsl-chip-now' : ''}${themes.includes(t) ? '' : ' tsl-chip-missing'}" title="${themes.includes(t) ? '' : '이 이름의 테마가 없습니다. 지우고 다시 추가해 주세요.'}">
              ${esc(t)}<span class="tsl-chip-x" data-rule="${ri}" data-theme="${esc(t)}" title="이 묶음에서 빼기">✕</span>
            </span>`).join('');
            // 이미 어느 묶음에든 들어 있는 테마는 목록에서 뺀다 (테마 하나 = 묶음 하나)
            const taken = new Set(s.rules.flatMap((r) => r.themes));
            const free = themes.filter((t) => !taken.has(t));
            const ids = new Set(rule.scripts.map((r) => r.id));
            const rows = list.map((sc) => `
            <label class="tsl-script${sc.enabled && sc.folderEnabled ? ' tsl-on' : ''}">
              <input type="checkbox" data-rule="${ri}" data-id="${esc(sc.id)}" data-name="${esc(sc.name)}"${ids.has(sc.id) ? ' checked' : ''}>
              <span class="tsl-name">${sc.folder ? `<em>${esc(sc.folder)} /</em> ` : ''}${esc(sc.name)}</span>
              <i class="tsl-dot" title="${sc.enabled && sc.folderEnabled ? '지금 켜짐' : '지금 꺼짐'}"></i>
            </label>`).join('');
            const lost = rule.scripts.filter((r) => !list.some((x) => x.id === r.id))
                .map((r) => `<div class="tsl-lost">찾을 수 없는 스크립트: ${esc(r.name)} <span class="tsl-x" data-rule="${ri}" data-lost="${esc(r.id)}" title="묶음에서 빼기">✕</span></div>`).join('');

            return `
        <div class="tsl-rule tsl-open${active ? ' tsl-active' : ''}" data-rule="${ri}">
          ${head}
          <div class="tsl-body">
            <div class="tsl-label-row">
              <input class="text_pole tsl-label" data-rule="${ri}" placeholder="묶음 이름 (비우면 첫 테마 이름)" value="${esc(rule.label)}">
              <div class="menu_button fa-solid fa-trash-can tsl-del" data-rule="${ri}" title="이 묶음 지우기"></div>
            </div>
            <div class="tsl-sub">테마</div>
            <div class="tsl-chips">${chips || '<span class="tsl-empty">테마를 추가하세요.</span>'}</div>
            ${free.length ? `
            <div class="tsl-add">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input class="text_pole tsl-addsearch" type="search" data-rule="${ri}" data-uid="${esc(rule.uid)}" placeholder="테마 이름으로 찾아 추가" autocomplete="off">
              <div class="tsl-addlist" data-rule="${ri}"></div>
            </div>` : '<div class="tsl-empty">추가할 수 있는 테마가 없습니다.</div>'}
            <div class="tsl-sub">켤 스크립트</div>
            <div class="tsl-scripts">${rows || '<div class="tsl-empty">전역 스크립트가 없습니다.</div>'}</div>
            ${lost}
          </div>
        </div>`;
        }).join('') : '<div class="tsl-empty">찾는 묶음이 없습니다.</div>';

        if (pager) {
            pager.innerHTML = pages > 1 ? `
          <div class="menu_button fa-solid fa-chevron-left tsl-pg" data-go="${page - 1}"${page === 0 ? ' data-off="1"' : ''}></div>
          ${Array.from({ length: pages }, (_, n) => `<span class="tsl-pgn${n === page ? ' tsl-pgn-on' : ''}" data-go="${n}">${n + 1}</span>`).join('')}
          <div class="menu_button fa-solid fa-chevron-right tsl-pg" data-go="${page + 1}"${page === pages - 1 ? ' data-off="1"' : ''}></div>
          <small>${shown.length}개 묶음</small>` : (shown.length > 1 ? `<small>${shown.length}개 묶음</small>` : '');
        }
        if (refocus) {
            const inp = box.querySelector(`input.tsl-addsearch[data-uid="${refocus}"]`);
            refocus = null;
            if (inp) inp.focus();
        }
    }

    /** 새 연결: 이름이 비슷한 스크립트를 미리 체크해 둔다 */
    function suggest(theme, list) {
        const t = theme.toLowerCase().replace(/[\s._-]+/g, '');
        if (!t) return [];
        return list.filter((sc) => {
            const n = sc.name.toLowerCase().replace(/\.?script$/, '').replace(/[\s._-]+/g, '');
            return n && (n.includes(t) || t.includes(n));
        }).map((sc) => ({ id: sc.id, name: sc.name }));
    }
    function newRule(themes, scripts) {
        return { uid: 'g' + Math.random().toString(36).slice(2, 10), label: '', themes, scripts };
    }
    /* ---------- 테마 고르기: 검색 + 체크로 여러 개 ---------- */
    const picks = new Map(); // 묶음 uid → 체크한 테마들
    function freeThemes(q) {
        const taken = new Set(settings().rules.flatMap((r) => r.themes));
        const needle = q.trim().toLowerCase();
        const all = themeNames().filter((t) => !taken.has(t));
        if (!needle) return all;
        const starts = all.filter((t) => t.toLowerCase().startsWith(needle));
        const has = all.filter((t) => !t.toLowerCase().startsWith(needle) && t.toLowerCase().includes(needle));
        return [...starts, ...has];
    }
    function pickSet(uid) {
        if (!picks.has(uid)) picks.set(uid, new Set());
        return picks.get(uid);
    }
    function showFree(input) {
        const list = input.parentNode.querySelector('.tsl-addlist');
        if (!list) return;
        const uid = input.dataset.uid;
        const chosen = pickSet(uid);
        const hits = freeThemes(input.value);
        // 다른 곳에서 묶음에 들어간 테마는 체크에서 정리
        for (const t of [...chosen]) if (!freeThemes('').includes(t)) chosen.delete(t);
        const rows = hits.length
            ? hits.map((t, i) => `
              <div class="tsl-addhit${i === 0 && !chosen.size ? ' tsl-addfirst' : ''}${chosen.has(t) ? ' tsl-picked' : ''}" data-theme="${esc(t)}">
                <span class="tsl-box" title="여러 개 고르기"><i class="fa-solid fa-check"></i></span>
                <span class="tsl-addname">${esc(t)}</span>
              </div>`).join('')
            : '<div class="tsl-addnone">맞는 테마가 없습니다.</div>';
        const foot = chosen.size
            ? `<div class="tsl-addfoot"><span>${chosen.size}개 선택</span><span class="tsl-addclear">선택 해제</span><div class="menu_button tsl-addmany">추가</div></div>`
            : `<div class="tsl-addfoot tsl-addhint"><span>${hits.length}개 · 이름을 누르면 바로 추가, 왼쪽 칸은 여러 개 고르기</span></div>`;
        const prev = list.querySelector('.tsl-addrows');
        const keep = prev ? prev.scrollTop : 0;
        list.innerHTML = `<div class="tsl-addrows">${rows}</div>${foot}`;
        list.classList.add('tsl-show');
        if (keep) list.querySelector('.tsl-addrows').scrollTop = keep;
    }
    let refocus = null;
    function addThemes(ri, themes) {
        const rule = settings().rules[ri];
        if (!rule || !themes.length) return;
        for (const t of themes) if (!rule.themes.includes(t)) rule.themes.push(t);
        picks.delete(rule.uid);
        refocus = rule.uid;
        afterEdit();
    }

    /* ---------- 순서 바꾸기 ---------- */
    let dragFrom = -1;
    function followTo(index) {
        // 옮긴 묶음이 다른 쪽으로 넘어가면 그 쪽을 보여 준다 (검색 중이 아닐 때)
        if (!query.trim()) page = Math.floor(index / settings().pageSize);
    }
    function moveRule(i, dir) {
        const rules = settings().rules;
        const j = i + dir;
        if (!rules[i] || j < 0 || j >= rules.length) return;
        [rules[i], rules[j]] = [rules[j], rules[i]];
        followTo(j);
        save();
        renderRules();
    }
    function dropRule(from, to, after) {
        const rules = settings().rules;
        if (!rules[from] || !rules[to] || from === to) { renderRules(); return; }
        const [item] = rules.splice(from, 1);
        let at = to > from ? to - 1 : to;
        if (after) at += 1;
        rules.splice(at, 0, item);
        followTo(at);
        save();
        renderRules();
    }

    /** 묶음을 고친 뒤: 지금 테마와 관련 있으면 바로 반영 */
    function afterEdit() {
        save();
        apply(currentTheme(), { quiet: true });
        renderRules();
    }

    function bindPanel() {
        const s = settings();
        $('#tsl_enabled').prop('checked', s.enabled).on('change', function () {
            s.enabled = this.checked; save();
            if (s.enabled) { lastTheme = null; check(); }
        });
        $('#tsl_notify').prop('checked', s.notify).on('change', function () { s.notify = this.checked; save(); });
        $('#tsl_current').text(currentTheme() || '(없음)');

        $('#tsl_add').on('click', () => {
            const theme = currentTheme();
            if (!theme) return;
            let idx = findRuleIndexOfTheme(theme);
            if (idx < 0) {
                const list = globalScripts();
                const guess = suggest(theme, list);
                // 같은 스크립트를 쓰는 묶음이 이미 있으면 그 묶음에 테마를 더한다
                const shareIdx = guess.length ? s.rules.findIndex((r) => guess.some((g) => r.scripts.some((x) => x.id === g.id))) : -1;
                if (shareIdx >= 0) {
                    s.rules[shareIdx].themes.push(theme);
                    idx = shareIdx;
                    toastr.info(`같은 스크립트를 쓰는 「${ruleTitle(s.rules[shareIdx])}」 묶음에 넣었습니다.`, theme);
                } else {
                    s.rules.unshift(newRule([theme], guess));
                    idx = 0;
                }
                save();
                apply(theme);
            }
            reveal(idx);
            renderRules();
        });
        $('#tsl_new').on('click', () => {
            s.rules.unshift(newRule([], []));
            save();
            reveal(0);
            renderRules();
        });
        $('#tsl_refresh').on('click', renderRules);
        $('#tsl_apply').on('click', () => { lastTheme = currentTheme(); apply(lastTheme); renderRules(); });
        $('#tsl_search').on('input', function () { query = this.value; page = 0; renderRules(); });
        $('#tsl_fold').on('click', () => { open.clear(); renderRules(); });
        $('#tsl_sort').on('click', () => {
            if (!s.rules.length) return;
            if (!confirm('묶음을 이름순(가나다·ABC)으로 정렬할까요?')) return;
            s.rules.sort((a, b) => ruleTitle(a).localeCompare(ruleTitle(b), 'ko', { numeric: true, sensitivity: 'base' }));
            page = 0;
            save();
            renderRules();
        });

        $('#tsl_pager').on('click', '[data-go]', function () {
            if (this.dataset.off) return;
            page = Number(this.dataset.go);
            renderRules();
        });

        $('#tsl_rules')
            .on('click', '.tsl-rule-head', function (e) {
                if (e.target.closest('.tsl-grip, .tsl-moves')) return;
                const uid = this.dataset.uid;
                if (open.has(uid)) open.delete(uid); else open.add(uid);
                renderRules();
            })
            .on('change', 'input[type=checkbox][data-rule]', function () {
                const rule = s.rules[Number(this.dataset.rule)];
                if (!rule) return;
                const id = this.dataset.id;
                rule.scripts = rule.scripts.filter((r) => r.id !== id);
                if (this.checked) rule.scripts.push({ id, name: this.dataset.name });
                afterEdit();
            })
            .on('focus input', 'input.tsl-addsearch', function () {
                const rows = this.parentNode.querySelector('.tsl-addrows');
                if (rows) rows.scrollTop = 0; // 검색어가 바뀌면 맨 위부터
                showFree(this);
            })
            .on('blur', 'input.tsl-addsearch', function () {
                const list = this.parentNode.querySelector('.tsl-addlist');
                setTimeout(() => { if (list && document.activeElement !== this) list.classList.remove('tsl-show'); }, 150);
            })
            .on('keydown', 'input.tsl-addsearch', function (e) {
                const ri = Number(this.dataset.rule);
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const chosen = [...pickSet(this.dataset.uid)];
                    if (chosen.length) addThemes(ri, chosen);
                    else { const first = freeThemes(this.value)[0]; if (first) addThemes(ri, [first]); }
                } else if (e.key === 'Escape') {
                    this.value = '';
                    picks.delete(this.dataset.uid);
                    this.blur();
                }
            })
            // 목록 안을 눌러도 검색 칸의 커서를 놓치지 않게
            .on('mousedown', '.tsl-addlist', function (e) { e.preventDefault(); })
            .on('click', '.tsl-addlist', function (e) {
                e.stopPropagation();
                const input = this.parentNode.querySelector('input.tsl-addsearch');
                const ri = Number(this.dataset.rule);
                const uid = input.dataset.uid;
                const chosen = pickSet(uid);
                const t = e.target;
                const hit = t.closest('.tsl-addhit');
                if (t.closest('.tsl-addmany')) { addThemes(ri, [...chosen]); return; }
                if (t.closest('.tsl-addclear')) { chosen.clear(); showFree(input); return; }
                if (!hit) return;
                const theme = hit.dataset.theme;
                if (t.closest('.tsl-box')) {
                    if (chosen.has(theme)) chosen.delete(theme); else chosen.add(theme);
                    showFree(input);
                    return;
                }
                addThemes(ri, [theme]);
            })
            .on('click', '.tsl-chip-x', function (e) {
                e.stopPropagation();
                const rule = s.rules[Number(this.dataset.rule)];
                if (!rule) return;
                rule.themes = rule.themes.filter((t) => t !== this.dataset.theme);
                afterEdit();
            })
            .on('click', '.tsl-move', function (e) {
                e.stopPropagation();
                moveRule(Number(this.dataset.rule), Number(this.dataset.dir));
            })
            .on('dragstart', '.tsl-grip', function (e) {
                dragFrom = Number(this.dataset.rule);
                const card = this.closest('.tsl-rule');
                card.classList.add('tsl-dragging');
                e.originalEvent.dataTransfer.effectAllowed = 'move';
                try { e.originalEvent.dataTransfer.setData('text/plain', String(dragFrom)); e.originalEvent.dataTransfer.setDragImage(card, 20, 20); } catch (err) { /* 무시 */ }
            })
            .on('dragend', '.tsl-grip', function () {
                dragFrom = -1;
                $('#tsl_rules .tsl-dragging, #tsl_rules .tsl-drop-before, #tsl_rules .tsl-drop-after').removeClass('tsl-dragging tsl-drop-before tsl-drop-after');
            })
            .on('dragover', '.tsl-rule', function (e) {
                if (dragFrom < 0) return;
                e.preventDefault();
                const r = this.getBoundingClientRect();
                const after = e.originalEvent.clientY > r.top + r.height / 2;
                $('#tsl_rules .tsl-drop-before, #tsl_rules .tsl-drop-after').removeClass('tsl-drop-before tsl-drop-after');
                this.classList.add(after ? 'tsl-drop-after' : 'tsl-drop-before');
            })
            .on('drop', '.tsl-rule', function (e) {
                if (dragFrom < 0) return;
                e.preventDefault();
                e.stopPropagation();
                const to = Number(this.dataset.rule);
                const after = this.classList.contains('tsl-drop-after');
                dropRule(dragFrom, to, after);
                dragFrom = -1;
            })
            .on('change', 'input.tsl-label', function () {
                const rule = s.rules[Number(this.dataset.rule)];
                if (!rule) return;
                rule.label = this.value.trim();
                save(); renderRules();
            })
            .on('click', '.tsl-del', function () {
                const i = Number(this.dataset.rule);
                const rule = s.rules[i];
                if (!rule) return;
                if (!confirm(`「${ruleTitle(rule)}」 묶음을 지울까요? (테마와 스크립트 자체는 지워지지 않습니다)`)) return;
                s.rules.splice(i, 1); open.delete(rule.uid); save(); renderRules();
            })
            .on('click', '.tsl-x', function () {
                const rule = s.rules[Number(this.dataset.rule)];
                if (!rule) return;
                rule.scripts = rule.scripts.filter((r) => r.id !== this.dataset.lost);
                save(); renderRules();
            });

        // 서랍을 열 때마다 목록 새로 읽고, 지금 테마의 묶음 쪽으로 이동
        $('#tsl_settings > .inline-drawer > .inline-drawer-toggle').on('click', () => setTimeout(() => {
            const idx = findRuleIndexOfTheme(currentTheme());
            if (idx >= 0 && !query) page = Math.floor(idx / s.pageSize);
            renderRules();
        }, 0));
    }

    /* ---------------- 시작 ---------------- */
    function waitHelper() {
        return new Promise((resolve) => {
            const t0 = Date.now();
            const tick = () => {
                if (helper()) return resolve(true);
                if (Date.now() - t0 > READY_TIMEOUT_MS) return resolve(false);
                setTimeout(tick, 300);
            };
            tick();
        });
    }

    async function start() {
        const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (host && !document.getElementById('tsl_settings')) {
            host.insertAdjacentHTML('beforeend', panelHtml());
            bindPanel();
        }

        const ok = await waitHelper();
        // 酒馆助手가 스크립트 목록을 다 읽을 시간을 조금 준다
        await new Promise((r) => setTimeout(r, 1200));
        ready = ok;
        renderRules();
        if (!ok) return;

        lastTheme = currentTheme();
        $('#tsl_current').text(lastTheme || '(없음)');
        apply(lastTheme, { quiet: true });

        $(document).on('change', '#themes', () => setTimeout(check, 0));
        setInterval(check, POLL_MS);
    }

    const { eventSource, eventTypes } = ctx();
    eventSource.on(eventTypes.APP_READY, () => { start(); });
})();
