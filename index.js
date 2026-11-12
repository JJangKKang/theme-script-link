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

    function renderRules() {
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
            <i class="fa-solid fa-chevron-right tsl-chev"></i>
            <div class="tsl-rule-title">
              <b>${esc(ruleTitle(rule))}</b>
              <small>${rule.themes.length}개 테마 · ${scriptNames.length ? esc(scriptNames.join(', ')) : '스크립트 없음'}</small>
            </div>
            ${missingThemes.length ? '<i class="fa-solid fa-triangle-exclamation tsl-flag" title="없는 테마가 있습니다"></i>' : ''}
            ${active ? '<span class="tsl-badge">사용 중</span>' : ''}
          </div>`;
            if (!isOpen) {
                return `<div class="tsl-rule${active ? ' tsl-active' : ''}">${head}</div>`;
            }

            const chips = rule.themes.map((t) => `
            <span class="tsl-chip${t === now ? ' tsl-chip-now' : ''}${themes.includes(t) ? '' : ' tsl-chip-missing'}" title="${themes.includes(t) ? '' : '이 이름의 테마가 없습니다. 지우고 다시 추가해 주세요.'}">
              ${esc(t)}<span class="tsl-chip-x" data-rule="${ri}" data-theme="${esc(t)}" title="이 묶음에서 빼기">✕</span>
            </span>`).join('');
            // 이미 어느 묶음에든 들어 있는 테마는 목록에서 뺀다 (테마 하나 = 묶음 하나)
            const taken = new Set(s.rules.flatMap((r) => r.themes));
            const addOpts = themes.filter((t) => !taken.has(t))
                .map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
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
        <div class="tsl-rule tsl-open${active ? ' tsl-active' : ''}">
          ${head}
          <div class="tsl-body">
            <div class="tsl-label-row">
              <input class="text_pole tsl-label" data-rule="${ri}" placeholder="묶음 이름 (비우면 첫 테마 이름)" value="${esc(rule.label)}">
              <div class="menu_button fa-solid fa-trash-can tsl-del" data-rule="${ri}" title="이 묶음 지우기"></div>
            </div>
            <div class="tsl-sub">테마</div>
            <div class="tsl-chips">${chips || '<span class="tsl-empty">테마를 추가하세요.</span>'}</div>
            ${addOpts ? `<select class="text_pole tsl-addtheme" data-rule="${ri}"><option value="">＋ 테마 추가…</option>${addOpts}</select>` : ''}
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

        $('#tsl_pager').on('click', '[data-go]', function () {
            if (this.dataset.off) return;
            page = Number(this.dataset.go);
            renderRules();
        });

        $('#tsl_rules')
            .on('click', '.tsl-rule-head', function () {
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
            .on('change', 'select.tsl-addtheme', function () {
                const rule = s.rules[Number(this.dataset.rule)];
                if (!rule || !this.value) return;
                if (!rule.themes.includes(this.value)) rule.themes.push(this.value);
                afterEdit();
            })
            .on('click', '.tsl-chip-x', function (e) {
                e.stopPropagation();
                const rule = s.rules[Number(this.dataset.rule)];
                if (!rule) return;
                rule.themes = rule.themes.filter((t) => t !== this.dataset.theme);
                afterEdit();
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
