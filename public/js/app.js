const { createApp, ref, onMounted, onUnmounted, reactive, computed, watch } = Vue;

createApp({
    setup() {
        const currentTab = ref(localStorage.getItem('apush_tab') || 'rules');
        const rules = ref([]);
        const logs = ref([]);
        const sources = ref([]);
        const channels = ref([]);
        const showModal = ref(false);
        const modalType = ref('rule');

        const loading = ref(false);
        const rulesLoading = ref(false);
        const channelsLoading = ref(false);
        const sourcesLoading = ref(false);
        const loadingRecords = ref(false);
        const hasMoreRecords = ref(true);
        const recordsPage = ref(0);
        const RECORDS_PAGE_SIZE = 50;

        let statsInterval = null;
        let logsInterval = null;
        let uptimeInterval = null;
        let lastLogId = 0;

        const toast = reactive({ show: false, msg: '', type: 'success' });

        // --- Auth ---
        const needAuth = ref(false);
        const authPassword = ref('');
        const authError = ref('');
        const authToken = ref(localStorage.getItem('apush_token') || '');

        const _fetch = window.fetch;
        window.fetch = (url, opts = {}) => {
            if (typeof url === 'string' && url.includes('/api/manager') && authToken.value) {
                opts.headers = { ...(opts.headers || {}), 'x-auth-token': authToken.value };
            }
            return _fetch(url, opts);
        };

        // --- Uptime ---
        const startTime = Date.now();
        const uptimeStr = ref('');
        const tickUptime = () => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const d = Math.floor(elapsed / 86400);
            const h = Math.floor((elapsed % 86400) / 3600);
            const m = Math.floor((elapsed % 3600) / 60);
            const s = elapsed % 60;
            const parts = [];
            if (d > 0) parts.push(d + '天');
            if (h > 0 || d > 0) parts.push(h + '时');
            if (m > 0 || h > 0 || d > 0) parts.push(m + '分');
            parts.push(s + '秒');
            uptimeStr.value = '已运行 ' + parts.join(' ');
        };

        const pollInterval = ref(Number(localStorage.getItem('apush_poll_interval') || 30000));

        const editForm = ref({
            id: null, name: '', source_id: '*',
            time_range: { start: '', end: '' }, active_days: '1,2,3,4,5,6,0',
            logic_type: 'AND', use_regex: false, target_channel_ids: [], is_active: true, rewrite_rules: [],
        });

        const sourceForm = ref({ id: null, name: '', path: '', parser_mode: 'auto', auth_token: '' });

        const serverUrl = ref(window.location.origin);
        const channelSecretVisible = ref(false);
        const showTemplateHelp = ref(false);

        const getSourceName = (key) => {
            if (key === '*' || key === 'default') return '所有来源';
            const src = sources.value.find(s => (s.path || 'default') === key);
            return src ? src.name : (key || '未知来源');
        };

        const showToast = (msg, type = 'success') => {
            toast.msg = msg;
            toast.type = type;
            toast.show = true;
            setTimeout(() => { toast.show = false; }, 3000);
        };

        const switchTab = (tab) => {
            currentTab.value = tab;
            localStorage.setItem('apush_tab', tab);
            if (tab === 'logs') fetchSystemLogs();
            if (tab === 'records') { recordsPage.value = 0; hasMoreRecords.value = true; loadRecords(true); }
        };

        const stats = ref({ today_total: 0, today_blocked: 0, top_app: '无', last_push: null });

        const channelTypeLabel = (t) => ({
            bark:'Bark', wecom:'企业微信应用', 'wecom-bot':'企业微信机器人',
            dingtalk:'钉钉机器人', feishu:'飞书机器人', tg:'Telegram',
            email:'邮件', webhook:'Webhook'
        }[t] || t);

        const fetchStats = async () => {
            try {
                const res = await fetch('/api/manager');
                stats.value = await res.json();
            } catch (e) { /* ignore */ }
        };

        const fetchChannels = async () => {
            channelsLoading.value = true;
            try {
                const res = await fetch('/api/manager/channels');
                channels.value = await res.json();
            } catch (e) {}
            channelsLoading.value = false;
        };

        const emptyConfig = () => ({
            bark_key: '', corp_id: '', agent_id: '', secret: '', user_id: '@all',
            bot_token: '', chat_id: '', webhook_url: '',
            smtp_host: '', smtp_port: '465', smtp_user: '', smtp_pass: '', to: ''
        });
        const channelForm = ref({ id: null, name: '', type: 'bark', config: emptyConfig(), template: '' });

        const defaultTemplates = {
            bark: '{"title":"{{title}}","body":"{{content}}","group":"{{app_name}}","icon":"{{icon}}","url":"{{url}}"}',
            wecom: '',
            'wecom-text': '{{title}}\n\n{{content}}',
            'wecom-markdown': '## {{title}}\n\n{{content}}\n\n> {{app_name}} · {{created_at}}',
            'wecom-textcard': '',
            'wecom-news': '{"articles":[{"title":"{{title}}","description":"{{content}}","url":"{{url}}","picurl":"{{icon}}"}]}',
            'wecom-bot': '{{title}}\n\n{{content}}\n\n{{app_name}}',
            'wecom-bot-markdown': '## {{title}}\n\n{{content}}\n\n> {{app_name}} · {{created_at}}',
            dingtalk: '## {{title}}\n\n{{content}}\n\n---\n{{app_name}}',
            'dingtalk-text': '{{title}}\n\n{{content}}\n\n{{app_name}} · {{created_at}}',
            tg: '<b>{{title}}</b>\n\n{{content}}\n\n<i>{{app_name}}</i>',
            email: '<h3>{{title}}</h3>\n<p>{{content}}</p>\n<hr>\n<small>{{app_name}}</small>',
            webhook: '{"title":"{{title}}","content":"{{content}}","app_name":"{{app_name}}","metadata":{{metadata_json}},"time":"{{created_at}}"}'
        };
        const defaultTemplatePlaceholder = (type) => {
            if (typeof channelForm.value?.config?.wecom_msgtype === 'string' && type === 'wecom') {
                return defaultTemplates['wecom-' + channelForm.value.config.wecom_msgtype] || '';
            }
            if (typeof channelForm.value?.config?.msgtype === 'string' && (type === 'wecom-bot' || type === 'dingtalk')) {
                return defaultTemplates[type + '-' + channelForm.value.config.msgtype] || '';
            }
            return defaultTemplates[type] || '';
        };

        const openChannelModal = (chan = null) => {
            modalType.value = 'channel';
            channelSecretVisible.value = false;
            if (chan) {
                channelForm.value = JSON.parse(JSON.stringify(chan));
                if (!channelForm.value.config) channelForm.value.config = {};
            } else {
                const cfg = emptyConfig();
                cfg.wecom_msgtype = 'textcard';
                cfg.msgtype = 'text';
                channelForm.value = { id: null, name: '', type: 'bark', config: cfg, template: '' };
            }
            updateParsedFields();
            showModal.value = true;
        };

        const countValidChannels = (ids) => {
            if (!Array.isArray(ids)) return 0;
            return ids.filter(id => channels.value.some(c => c.id === id)).length;
        };

        const saveChannel = async () => {
            if (!channelForm.value.name || !channelForm.value.type) return showToast('请填写通道名称和类型', 'error');
            const isEdit = !!channelForm.value.id;
            const url = isEdit ? `/api/manager/channels/${channelForm.value.id}` : '/api/manager/channels';
            const method = isEdit ? 'PUT' : 'POST';
            const type = channelForm.value.type;
            const cleanConfig = {};
            if (type === 'bark') {
                cleanConfig.bark_key = channelForm.value.config.bark_key;
                cleanConfig.server_url = channelForm.value.config.server_url || '';
                if (!cleanConfig.bark_key) return showToast('Bark Key不能为空', 'error');
            } else if (type === 'wecom') {
                cleanConfig.corp_id = channelForm.value.config.corp_id;
                cleanConfig.agent_id = channelForm.value.config.agent_id;
                cleanConfig.secret = channelForm.value.config.secret;
                cleanConfig.user_id = channelForm.value.config.user_id || '@all';
                cleanConfig.wecom_msgtype = channelForm.value.config.wecom_msgtype || 'textcard';
                if (!cleanConfig.corp_id || !cleanConfig.agent_id || !cleanConfig.secret) return showToast('企业微信配置项不能为空', 'error');
            } else if (type === 'wecom-bot' || type === 'feishu') {
                cleanConfig.webhook_url = channelForm.value.config.webhook_url;
                if (!cleanConfig.webhook_url) return showToast('Webhook 地址不能为空', 'error');
                if (type === 'wecom-bot') cleanConfig.msgtype = channelForm.value.config.msgtype || 'text';
            } else if (type === 'dingtalk') {
                cleanConfig.webhook_url = channelForm.value.config.webhook_url;
                if (!cleanConfig.webhook_url) return showToast('Webhook 地址不能为空', 'error');
                cleanConfig.secret = channelForm.value.config.secret || '';
                cleanConfig.msgtype = channelForm.value.config.msgtype || 'markdown';
            } else if (type === 'tg') {
                cleanConfig.bot_token = channelForm.value.config.bot_token;
                cleanConfig.chat_id = channelForm.value.config.chat_id;
                if (!cleanConfig.bot_token) return showToast('Bot Token 不能为空', 'error');
                if (!cleanConfig.chat_id) return showToast('Chat ID 不能为空', 'error');
            } else if (type === 'email') {
                cleanConfig.smtp_host = channelForm.value.config.smtp_host;
                cleanConfig.smtp_port = channelForm.value.config.smtp_port;
                cleanConfig.smtp_user = channelForm.value.config.smtp_user;
                cleanConfig.smtp_pass = channelForm.value.config.smtp_pass;
                cleanConfig.to = channelForm.value.config.to;
                if (!cleanConfig.smtp_host || !cleanConfig.smtp_user || !cleanConfig.smtp_pass || !cleanConfig.to) return showToast('SMTP 配置不能为空', 'error');
            } else if (type === 'webhook') {
                cleanConfig.webhook_url = channelForm.value.config.webhook_url;
                if (!cleanConfig.webhook_url) return showToast('Webhook URL不能为空', 'error');
            }
            const payload = { name: channelForm.value.name, type: channelForm.value.type, id: channelForm.value.id, config: cleanConfig, template: channelForm.value.template || '' };
            try {
                const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                if (res.ok) { showModal.value = false; fetchData(); showToast(isEdit ? '通道已更新' : '通道添加成功'); }
                else { const err = await res.json(); showToast(err.error || '保存失败', 'error'); }
            } catch (e) { showToast('网络请求失败', 'error'); }
        };
        const deleteChannel = async (id) => {
            if (!confirm('确认删除该通道？')) return;
            try { await fetch(`/api/manager/channels/${id}`, { method: 'DELETE' }); fetchData(); showToast('通道已删除'); }
            catch (e) { showToast('删除失败', 'error'); }
        };

        const testChannel = async () => {
            try {
                const payload = { type: channelForm.value.type, config: channelForm.value.config, template: channelForm.value.template || '' };
                const res = await fetch('/api/manager/channels/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                if (res.ok) showToast('测试通知已发送'); else { const err = await res.json(); showToast(err.error || '测试失败', 'error'); }
            } catch (e) { showToast('测试接口调用失败', 'error'); }
        };

        const fetchSources = async () => {
            sourcesLoading.value = true;
            try {
                const res = await fetch('/api/manager/sources');
                sources.value = await res.json();
            } catch (e) {} finally { sourcesLoading.value = false; }
        };

        const fetchData = async () => {
            loading.value = true; rulesLoading.value = true;
            try {
                const [r, s, c] = await Promise.all([
                    fetch('/api/manager/rules').then(r => r.json()),
                    fetch('/api/manager/sources').then(r => r.json()),
                    fetch('/api/manager/channels').then(r => r.json())
                ]);
                rules.value = Array.isArray(r) ? r.map(i => ({ ...i, tempKw: '', is_active: i.is_active === 1, use_regex: i.use_regex === 1 })) : [];
                sources.value = s; channels.value = c;
            } catch (e) { showToast('数据加载失败', 'error'); }
            finally { rulesLoading.value = false; loading.value = false; }
        };

        // --- 流转记录分页 ---
        const loadRecords = async (reset) => {
            if (reset) { recordsPage.value = 0; hasMoreRecords.value = true; logs.value = []; lastLogId = 0; }
            if (!hasMoreRecords.value || loadingRecords.value) return;
            loadingRecords.value = true;
            try {
                const url = lastLogId > 0 ? `/api/manager/messages?after_id=${lastLogId}&limit=${RECORDS_PAGE_SIZE}` : `/api/manager/messages?limit=${RECORDS_PAGE_SIZE}`;
                const res = await fetch(url);
                const newLogs = await res.json();
                if (newLogs.length > 0) {
                    const existingIds = new Set(logs.value.map(l => l.id));
                    const unique = newLogs.filter(l => !existingIds.has(l.id));
                    logs.value = reset ? newLogs : [...logs.value, ...unique];
                    lastLogId = Math.max(lastLogId, ...newLogs.map(l => l.id));
                }
                if (newLogs.length < RECORDS_PAGE_SIZE) hasMoreRecords.value = false;
            } catch (e) { /* ignore */ }
            loadingRecords.value = false;
        };
        const loadMoreRecords = () => loadRecords(false);
        const refreshRecords = () => loadRecords(true);

        const openRuleModal = async (rule = null) => {
            await Promise.all([fetchChannels(), fetchSources()]);
            modalType.value = 'rule';
            if (rule) {
                const parsed = JSON.parse(JSON.stringify(rule));
                parsed.rewrite_rules = Array.isArray(parsed.rewrite_rules) ? parsed.rewrite_rules : [];
                parsed.rewrite_rules.forEach(r => { r.use_regex = (r.use_regex === 1 || r.use_regex === true); });
                parsed.target_channel_ids = parsed.target_channel_ids || [];
                parsed.use_regex = (parsed.use_regex === 1 || parsed.use_regex === true);
                parsed.is_active = (parsed.is_active === 1 || parsed.is_active === true);
                editForm.value = parsed;
            } else {
                editForm.value = { id: null, name: '', source_id: '*', time_range: { start: '', end: '' }, active_days: '1,2,3,4,5,6,0', logic_type: 'AND', use_regex: false, target_channel_ids: [], is_active: true, rewrite_rules: [] };
            }
            showModal.value = true;
        };

        const openLogConfig = async (log) => {
            await Promise.all([fetchChannels(), fetchSources()]);
            modalType.value = 'rule';
            if (log.rule_name) {
                const existingRule = rules.value.find(r => r.name === log.rule_name);
                if (existingRule) { openRuleModal(existingRule); return; }
            }
            let meta = {};
            try { meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : (log.metadata || {}); } catch {}
            const ruleName = '策略 - ' + (log.app_name || log.title || '未命名');
            const extractRules = [];
            const standardKeys = ['title','content','appName','appID','url'];
            const metaKeys = Object.keys(meta).filter(k => !standardKeys.includes(k) && typeof meta[k] === 'string');
            if (!log.content && metaKeys.length > 0) {
                const contentKeys = ['message','desp','body','data','text','summary','description','msg','detail'];
                for (const ck of contentKeys) { if (meta[ck] && typeof meta[ck] === 'string') { extractRules.push({ source: 'metadata', match: '', replace: '', target: 'content', metadata_key: ck, use_regex: false }); break; } }
            }
            if (!log.title && metaKeys.length > 0) {
                const titleKeys = ['subject','caption','name','heading','header'];
                for (const tk of titleKeys) { if (meta[tk] && typeof meta[tk] === 'string') { extractRules.push({ source: 'metadata', match: '', replace: '', target: 'title', metadata_key: tk, use_regex: false }); break; } }
            }
            editForm.value = { id: null, name: ruleName, source_id: log.source_id || '*', time_range: { start: '', end: '' }, active_days: '1,2,3,4,5,6,0', logic_type: 'AND', use_regex: false, target_channel_ids: [], is_active: true, rewrite_rules: extractRules };
            showModal.value = true;
        };

        const insertTemplateField = (field) => {
            const textarea = document.querySelector('.drawer textarea');
            if (!textarea) return;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = channelForm.value.template || '';
            const tag = '{{' + field + '}}';
            channelForm.value.template = text.substring(0, start) + tag + text.substring(end);
            setTimeout(() => { textarea.focus(); textarea.selectionStart = textarea.selectionEnd = start + tag.length; }, 50);
        };

        const lastParsedFields = ref([]);
        const updateParsedFields = () => {
            lastParsedFields.value = [
                { key: 'title', label: '标题' }, { key: 'content', label: '正文' },
                { key: 'app_name', label: '应用名' }, { key: 'app_id', label: '应用ID' },
                { key: 'url', label: '链接' }, { key: 'metadata_json', label: 'Metadata JSON' },
                { key: 'created_at', label: '时间' }, { key: 'rule_name', label: '规则名' },
            ];
        };

        const addRewriteRule = () => { editForm.value.rewrite_rules.push({ match: '', replace: '', use_regex: false }); };
        const addExtractRule = () => { editForm.value.rewrite_rules.push({ source: 'rawBody', match: '', replace: '', target: 'content', metadata_key: '' }); };
        const removeRewriteRule = (index) => { editForm.value.rewrite_rules.splice(index, 1); };

        const duplicateRule = async (id) => {
            if (!confirm('确认复制该策略吗？')) return;
            loading.value = true;
            try {
                const res = await fetch(`/api/manager/rules/${id}/duplicate`, { method: 'POST' });
                if (res.ok) { showToast('策略已成功复刻'); await fetchData(); }
                else { const err = await res.json(); showToast(err.error || '复制失败', 'error'); }
            } catch (e) { showToast('请求异常', 'error'); }
            finally { loading.value = false; }
        };

        const saveRule = async () => {
            if (!editForm.value.name) return showToast('请填写策略名称', 'error');
            if (editForm.value.target_channel_ids.length === 0) return showToast('请选择推送目标', 'error');
            const isEdit = !!editForm.value.id;
            const url = isEdit ? `/api/manager/rules/${editForm.value.id}` : '/api/manager/rules';
            const method = isEdit ? 'PUT' : 'POST';
            const payload = JSON.parse(JSON.stringify(editForm.value));
            payload.is_active = payload.is_active ? 1 : 0; payload.use_regex = payload.use_regex ? 1 : 0;
            if (payload.rewrite_rules && payload.rewrite_rules.length > 0) payload.rewrite_rules.forEach(r => { r.use_regex = r.use_regex ? 1 : 0; });
            try {
                const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                if (res.ok) { showModal.value = false; fetchData(); showToast('策略保存成功'); }
                else { const err = await res.json(); showToast('保存失败: ' + err.error, 'error'); }
            } catch (e) { showToast('请求异常', 'error'); }
        };

        const updateRuleStatus = async (rule) => {
            const payload = { name: rule.name, source_id: rule.source_id, time_range: rule.time_range, active_days: rule.active_days, logic_type: rule.logic_type, use_regex: rule.use_regex ? 1 : 0, target_channel_ids: rule.target_channel_ids, is_active: rule.is_active ? 1 : 0, rewrite_rules: rule.rewrite_rules };
            await fetch(`/api/manager/rules/${rule.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            showToast(rule.is_active ? '规则已开启' : '规则已禁用');
        };

        const deleteRule = async (id) => { if (!confirm('确认删除策略？')) return; await fetch(`/api/manager/rules/${id}`, { method: 'DELETE' }); fetchData(); showToast('策略已删除'); };
        const addKeyword = async (rule) => {
            if (!rule.tempKw?.trim()) return;
            await fetch('/api/manager/rules/keywords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rule_id: rule.id, word: rule.tempKw.trim() }) });
            rule.tempKw = ''; fetchData(); showToast('关键词已添加');
        };
        const deleteKeyword = async (id) => { await fetch(`/api/manager/rules/keywords/${id}`, { method: 'DELETE' }); fetchData(); showToast('关键词已移除'); };

        const toggleChannelSelection = (id) => {
            const targetId = Number(id);
            editForm.value.target_channel_ids = editForm.value.target_channel_ids.map(i => Number(i)).filter(i => !isNaN(i) && i > 0);
            const idx = editForm.value.target_channel_ids.indexOf(targetId);
            idx > -1 ? editForm.value.target_channel_ids.splice(idx, 1) : editForm.value.target_channel_ids.push(targetId);
        };

        const openSourceModal = (src = null) => {
            modalType.value = 'source';
            sourceForm.value = src ? { ...src } : { id: null, name: '', path: '', parser_mode: 'auto', auth_token: '' };
            showModal.value = true;
        };

        const saveSource = async () => {
            if (!sourceForm.value.name) return showToast('请填写来源名称', 'error');
            const isEdit = !!sourceForm.value.id;
            const url = isEdit ? `/api/manager/sources/${sourceForm.value.id}` : '/api/manager/sources';
            const payload = { name: sourceForm.value.name, path: sourceForm.value.path || '', parser_mode: sourceForm.value.parser_mode || 'auto', auth_token: sourceForm.value.auth_token || '' };
            try {
                const res = await fetch(url, { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                if (res.ok) { showModal.value = false; fetchData(); showToast(isEdit ? '来源配置已更新' : '来源已添加'); }
                else { const err = await res.json(); showToast(err.error || '保存失败', 'error'); }
            } catch (e) { showToast('网络请求失败', 'error'); }
        };

        const deleteSource = async (id) => { if (!confirm('确认删除来源？')) return; await fetch(`/api/manager/sources/${id}`, { method: 'DELETE' }); fetchData(); showToast('来源已移除'); };

        const formatTime = (ts) => new Date(ts).toLocaleString('zh-CN', { hour12: false });

        const logFilters = reactive({ source: '', status: '' });
        const filteredLogs = computed(() => {
            return logs.value.filter(log => {
                const matchSource = !logFilters.source || log.source_id === logFilters.source;
                const matchStatus = !logFilters.status || log.action === logFilters.status;
                return matchSource && matchStatus;
            });
        });
        const getChannelNamesByRule = (ruleName) => {
            if (!ruleName) return '无';
            const rule = rules.value.find(r => r.name === ruleName);
            if (!rule || !rule.target_channel_ids || rule.target_channel_ids.length === 0) return '未指定通道';
            return rule.target_channel_ids.map(id => { const chan = channels.value.find(c => c.id === id); return chan ? chan.name : '未知通道'; }).join(', ');
        };
        const deleteLog = async (id) => { if (!confirm('确定删除此条记录？')) return; await fetch(`/api/manager/messages/${id}`, { method: 'DELETE' }); logs.value = logs.value.filter(l => l.id !== id); showToast('记录已删除'); };
        const clearAllLogs = async () => { if (!confirm('确定清空所有历史记录？此操作不可撤销。')) return; await fetch('/api/manager/messages/all', { method: 'DELETE' }); logs.value = []; lastLogId = 0; hasMoreRecords.value = false; showToast('记录已清空'); };

        // --- 系统日志 ---
        const systemLogs = ref([]);
        const sysLogLevel = ref('');
        const fetchSystemLogs = async () => {
            try {
                let url = '/api/manager/system-logs?limit=200';
                if (sysLogLevel.value) url += '&level=' + sysLogLevel.value;
                const res = await fetch(url);
                systemLogs.value = await res.json();
            } catch (e) {}
        };
        const levelLabel = (l) => ({ error: '错误', warn: '警告', info: '信息' }[l] || l);

        // --- 复制工具 ---
        const copyText = async (text) => {
            try { await navigator.clipboard.writeText(text); showToast('已复制到剪贴板'); }
            catch (e) {
                const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showToast('已复制');
            }
        };
        const copyServerUrl = () => copyText(serverUrl.value);

        const msgIcon = (log) => {
            let src = '';
            try { const meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : (log.metadata || {}); src = meta.icon || meta.logo || meta.image || ''; } catch {}
            if (!src) return 'https://cdn-icons-png.flaticon.com/512/2913/2913964.png';
            if (src.startsWith('data:') || src.startsWith('http')) return src;
            return 'https://cdn-icons-png.flaticon.com/512/2913/2913964.png';
        };

        watch(() => editForm.value.use_regex, (newVal) => { editForm.value.logic_type = newVal ? 'OR' : 'AND'; });

        const isRuleFormValid = computed(() => editForm.value.name && editForm.value.target_channel_ids && editForm.value.target_channel_ids.length > 0);

        const handleNewRuleClick = async () => {
            await Promise.all([fetchChannels(), fetchSources()]);
            if (!channels.value || channels.value.length === 0) { showToast('请先配置一个推送通道', 'error'); openChannelModal(); return; }
            if (!sources.value || sources.value.length === 0) { showToast('请先配置至少一个来源', 'error'); openSourceModal(); return; }
            openRuleModal();
        };

        const toggleChannelSecret = () => { channelSecretVisible.value = !channelSecretVisible.value; };

        // --- Auth ---
        const doLogin = async () => {
            authError.value = '';
            try {
                const res = await fetch('/api/manager/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: authPassword.value }) });
                const data = await res.json();
                if (data.ok) { authToken.value = data.token || ''; if (data.token) localStorage.setItem('apush_token', data.token); needAuth.value = false; authPassword.value = ''; initApp(); }
                else { authError.value = data.error || '密码错误'; }
            } catch (e) { authError.value = '网络请求失败'; }
        };

        const checkAuth = async () => {
            try {
                const res = await fetch('/api/manager/check');
                if (!res.ok) { const data = await res.json(); if (data.needPassword) { needAuth.value = true; return false; } }
                needAuth.value = false; return true;
            } catch (e) { return true; }
        };

        // 长轮询: 等待新消息,收到后立即发起下一次请求
        let pollActive = true;
        const pollLogs = async () => {
            while (pollActive) {
                try {
                    const url = lastLogId > 0
                        ? `/api/manager/messages?after_id=${lastLogId}&wait=1`
                        : '/api/manager/messages';
                    const res = await fetch(url);
                    const newLogs = await res.json();
                    if (!pollActive) break;
                    if (newLogs.length > 0) {
                        const existingIds = new Set(logs.value.map(l => l.id));
                        const unique = newLogs.filter(l => !existingIds.has(l.id));
                        logs.value = [...unique, ...logs.value].slice(0, 200);
                        lastLogId = Math.max(lastLogId, ...newLogs.map(l => l.id));
                    }
                } catch (e) {
                    // 网络异常等 3 秒重试
                    await new Promise(r => setTimeout(r, 3000));
                }
            }
        };

        const initApp = async () => {
            await fetchData();
            loadRecords(true);
            fetchStats();
            pollActive = true;
            pollLogs(); // 启动长轮询循环
            statsInterval = setInterval(fetchStats, pollInterval.value);
        };

        onMounted(async () => {
            tickUptime();
            uptimeInterval = setInterval(tickUptime, 1000);
            const ok = await checkAuth();
            if (ok) await initApp();
        });

        onUnmounted(() => {
            if (statsInterval) clearInterval(statsInterval);
            if (uptimeInterval) clearInterval(uptimeInterval);
            pollActive = false;
        });

        return {
            currentTab, rules, logs, stats, sources,
            showModal, modalType, editForm, sourceForm, toast,
            logFilters, filteredLogs, channels, channelForm,
            fetchData, openRuleModal, saveRule, updateRuleStatus, deleteRule,
            addKeyword, deleteKeyword, fetchChannels, addRewriteRule, removeRewriteRule,
            saveChannel, openChannelModal, openSourceModal, saveSource, deleteSource,
            deleteLog, clearAllLogs, toggleChannelSelection,
            deleteChannel, formatTime, switchTab, showToast, getSourceName,
            rulesLoading, channelsLoading, sourcesLoading, loading,
            isRuleFormValid, handleNewRuleClick, channelSecretVisible, toggleChannelSecret,
            testChannel, addExtractRule, defaultTemplatePlaceholder,
            duplicateRule,
            loadMoreRecords, refreshRecords, hasMoreRecords, loadingRecords,
            msgIcon, openLogConfig, insertTemplateField, lastParsedFields,
            serverUrl, systemLogs, sysLogLevel, fetchSystemLogs, levelLabel, copyText, copyServerUrl,
            needAuth, authPassword, authError, doLogin, uptimeStr, showTemplateHelp, countValidChannels, getChannelNamesByRule,
            channelTypeLabel,
        };
    }
}).mount('#app');
